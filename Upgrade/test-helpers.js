// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Unify temporary directory fixtures and CDP/Electron/Connect-RPC test mocks across Upgrade, Multi-Account, and Folders":
// https://github.com/dmitry-ai/antigravity-addons/issues/37
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {ConnectSummaryStream} = require('../Folders/antigravity-adapter');
class FakeCDP {
	constructor() {
		Object.assign(this, {calls: [], closed: false, expressions: [], handlers: new Map()});
	}
	async call(method, params = {}) {
		let r = {};
		this.calls.push({method, params});
		if ('Page.getFrameTree' === method) {
			r = {frameTree: {frame: {id: 'main'}}};
		}
		else if ('Runtime.enable' === method) {
			this.handlers.get('Runtime.executionContextCreated')?.({context: {id: 7, auxData: {isDefault: true, frameId: 'main'}}});
		}
		else if ('CSS.createStyleSheet' === method) {
			r = {styleSheetId: 'owned-styles'};
		}
		return r;
	}
	close() {
		this.closed = true;
		this.handlers.get('close')?.();
	}
	async evaluate(expression) {
		this.expressions.push(expression);
		return expression.startsWith('({product:') ? {product: 'Antigravity', csrf: 'string', ready: 'complete', origin: 'https://127.0.0.1:12345', appRoot: true, nativeStorage: 'function'} : undefined;
	}
	on(name, handler) {
		this.handlers.set(name, handler);
	}
}
class MockBaseWindow extends EventEmitter {
	constructor(id, title = 'Antigravity', minimized = false) {
		super();
		Object.assign(this, {_id: id, appDetails: null, destroyed: false, focused: false, icon: null, minimized, shown: false, title, webContents: Object.assign(new EventEmitter(), {getURL: () => 'https://127.0.0.1:2890/'})});
	}
	destroy() { this.destroyed = true; this.emit('closed'); }
	focus() { this.focused = true; }
	getTitle() { return this.title; }
	get id() {
		if (this.destroyed) {
			throw new TypeError('Object has been destroyed');
		}
		return this._id;
	}
	isDestroyed() { return this.destroyed; }
	isMinimized() { return this.minimized; }
	restore() { this.minimized = false; }
	setAppDetails(details) { this.appDetails = details; }
	setIcon(icon) { this.icon = icon; }
	setTitle(title) { this.title = title; }
	show() { this.shown = true; }
}
const createElectronHarness = ({codeRoot = '', desktop = null, homedir = null, installerPath = '', overrides = {}, realModules = false, version = '2.29.1', windows = []} = {}) => {
	const app = new EventEmitter();
	const baseWindows = [...windows];
	const dialogs = [];
	const menuItem = {enabled: true, label: 'Check for Updates'};
	const native = [];
	const paths = desktop ? {desktop} : {};
	const spawns = [];
	const state = {appQuitCalls: 0, focusOptions: null, installCalls: 0, lastState: {type: 'idle'}, quitAndInstallCalls: 0, showOrCreateCalls: 0};
	Object.assign(app, {
		focus: options => { state.focusOptions = options; },
		getPath: key => paths[key],
		getVersion: () => version,
		isReady: () => true,
		quit: () => { state.appQuitCalls++; },
		setAppUserModelId: id => { paths.appId = id; },
		setAsDefaultProtocolClient: () => true,
		setPath: (key, value) => { paths[key] = value; }
	});
	class ScopedBaseWindow extends MockBaseWindow {}
	ScopedBaseWindow.getAllWindows = () => baseWindows;
	ScopedBaseWindow.getFocusedWindow = () => null;
	const autoUpdater = Object.assign(new EventEmitter(), {
		autoDownload: true, autoInstallOnAppQuit: true, autoRunAppAfterInstall: true, disableDifferentialDownload: false, disableWebInstaller: false,
		install: () => (state.installCalls++, autoUpdater.quitAndInstallCalled = true, true), installerPath,
		quitAndInstall: () => (state.quitAndInstallCalls++, autoUpdater.quitAndInstallCalled = true, true), quitAndInstallCalled: false, quitHandlerAdded: false
	});
	const processes = {
		spawn: (command, args, options) => {
			spawns.push({args, command, executable: command, options});
			const r = {
				on: () => r,
				once: (event, cb) => ('spawn' === event ? queueMicrotask(cb) : 'exit' === event ? queueMicrotask(() => cb(0)) : null, r),
				pid: 12345,
				unref: () => {}
			};
			return r;
		}
	};
	const shell = {openExternal: async url => { native.push(url); }, writeShortcutLink: () => true};
	const updater = {MenuUpdateStep: {RestartToUpdate: 'Restart to Update'}, broadcastState: next => { state.lastState = next; }, getLastState: () => state.lastState};
	const utils = {getHubWebContents: win => win.webContents, getHubWindows: () => baseWindows, showOrCreateWindow: () => { state.showOrCreateCalls++; baseWindows.push(new ScopedBaseWindow(2, 'Antigravity', false)); }};
	const electron = {
		BaseWindow: ScopedBaseWindow, BrowserWindow: {getAllWindows: () => [], getFocusedWindow: () => null},
		Menu: {getApplicationMenu: () => ({getMenuItemById: id => 'check-for-updates' === id ? menuItem : null})},
		app, autoUpdater: new EventEmitter(),
		dialog: {showMessageBox: async (first, second) => (dialogs.push(second || first), {response: 0})},
		nativeImage: {createFromPath: () => ({getSize: () => ({height: 256, width: 256}), isEmpty: () => false})}, shell
	};
	const fakeRequire = name => name in overrides ? overrides[name]
		: 'electron' === name ? electron
		: 'electron-updater' === name ? {autoUpdater}
		: './updater' === name ? updater
		: './utils' === name ? utils
		: './languageServer' === name ? {getLsPort: () => 2890}
		: 'node:os' === name && homedir ? {homedir: () => homedir}
		: 'node:child_process' === name ? processes
		: !realModules && codeRoot && path.join(codeRoot, 'oauth-bridge.js') === name ? {OAuthBridge: class {}}
		: !realModules && codeRoot && path.join(codeRoot, 'window-identity.js') === name ? {allWindows: () => [], installWindowIdentity: () => {}}
		: require(name);
	return {BaseWindow: ScopedBaseWindow, app, autoUpdater, baseWindows, dialogs, electron, fakeRequire, menuItem, native, opened: spawns, paths, processes, shell, spawns, state, updater, utils};
};
const createMockDocument = () => {
	const makeNode = tag => {
		const map = new Map();
		const upper = String(tag).toUpperCase();
		const node = {
			_value: undefined, attributes: {}, children: [], className: '', dataset: {}, isConnected: true, listeners: {},
			offsetHeight: 120, offsetWidth: 180, parentElement: null, style: {paddingTop: '', removeProperty() {}, setProperty() {}}, tag: upper, textContent: '',
			addEventListener(type, fn) { this.listeners[type] = fn; map.set(type, [...(map.get(type) || []), fn]); },
			append(...items) {
				for (const item of items) {
					if (item && 'object' === typeof item) {
						item.parentElement = this; item.isConnected = true; this.children.push(item);
					}
				}
			},
			appendChild(child) { this.append(child); return child; },
			click() { this.dispatch('click'); },
			closest(selector) {
				let r = null;
				for (let cur = this; cur; cur = cur.parentElement) {
					if (matchesSelector(cur, selector)) { r = cur; break; }
				}
				return r;
			},
			contains(target) {
				let r = false;
				for (let cur = target; cur; cur = cur.parentElement) {
					if (cur === this) { r = true; break; }
				}
				return r;
			},
			dispatch(type, event = {}) { for (const fn of map.get(type) || []) { fn({preventDefault() {}, stopPropagation() {}, target: node, ...event}); } },
			focus() { doc.activeElement = node; },
			querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
			querySelectorAll(selector) {
				const r = [];
				const walk = el => {
					for (const child of el.children || []) {
						if (matchesSelector(child, selector)) { r.push(child); }
						walk(child);
					}
				};
				walk(this);
				return r;
			},
			remove() { this.removed = true; this.isConnected = false; },
			removeAttribute(key) { delete this.attributes[key]; },
			replaceChildren(...items) { this.children = []; this.append(...items); },
			reportValidity() {},
			scrollIntoView() {},
			setAttribute(key, val) { this.attributes[key] = String(val); },
			setCustomValidity(msg) { this.validationMessage = msg; },
			get value() { return undefined !== this._value ? this._value : 'SELECT' === upper ? this.children.find(opt => opt.selected)?.value || '' : ''; },
			set value(v) { this._value = v; }
		};
		return node;
	};
	const documentElement = makeNode('html');
	const body = makeNode('body');
	documentElement.append(body);
	const doc = {activeElement: null, body, createElement: makeNode, documentElement, querySelector: selector => documentElement.querySelector(selector), querySelectorAll: selector => documentElement.querySelectorAll(selector)};
	return doc;
};
const createTempDir = (context, prefix = 'antigravity-test-') => {
	const parent = path.resolve(os.tmpdir());
	const r = fs.mkdtempSync(path.join(parent, prefix));
	context.after(() => {
		assert.ok(path.resolve(r).startsWith(parent + path.sep));
		fs.rmSync(r, {recursive: true, force: true});
	});
	return r;
};
const encodeConnectFrame = value => ConnectSummaryStream.encodeFrame(value);
const matchesSelector = (el, selector) => {
	const role = el?.attributes?.role;
	const testid = el?.dataset?.testid ?? el?.attributes?.['data-testid'];
	return ('[data-testid="conversation-list-sidebar"]' === selector && 'conversation-list-sidebar' === testid)
		|| ('[role="navigation"]' === selector && 'navigation' === role)
		|| (selector.includes('aria-selected=true') && 'treeitem' === role && 'true' === el?.attributes?.['aria-selected'])
		|| (!selector.includes('aria-selected=true') && ((selector.includes('treeitem') && 'treeitem' === role) || (selector.includes('menuitem') && 'menuitem' === role) || (selector.includes('button') && 'button' === role)));
};
const mockProfileEndpoints = (context, root, ports = {Antigravity: '10001'}) => {
	const roaming = path.join(root, 'roaming');
	for (const [name, port] of Object.entries(ports)) {
		fs.mkdirSync(path.join(roaming, name), {recursive: true});
		if (null !== port) { fs.writeFileSync(path.join(roaming, name, 'DevToolsActivePort'), String(port)); }
	}
	withEnv(context, {APPDATA: roaming});
	return roaming;
};
const withEnv = (context, entries) => {
	const previous = Object.fromEntries(Object.keys(entries).map(key => [key, process.env[key]]));
	for (const [key, value] of Object.entries(entries)) { undefined === value ? delete process.env[key] : (process.env[key] = value); }
	context.after(() => {
		for (const [key, value] of Object.entries(previous)) { undefined === value ? delete process.env[key] : (process.env[key] = value); }
	});
};
module.exports = {FakeCDP, MockBaseWindow, createElectronHarness, createMockDocument, createTempDir, encodeConnectFrame, mockProfileEndpoints, withEnv};