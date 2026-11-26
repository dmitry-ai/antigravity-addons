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
	/**
	 * @used-by {@link import('./test-cdp-runtime.js')}
	 * @uses {@link FakeCDP#close}
	 * @uses {@link FakeCDP#on}
	 */
	constructor() {
		Object.assign(this, {calls: [], closed: false, expressions: [], handlers: new Map()});
	}
	/**
	 * @used-by {@link import('./test-cdp-runtime.js')}
	 */
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
	/**
	 * @used-by {@link FakeCDP#constructor}
	 */
	close() {
		this.closed = true;
		this.handlers.get('close')?.();
	}
	/**
	 * @used-by {@link import('./test-cdp-runtime.js')}
	 */
	async evaluate(expression) {
		this.expressions.push(expression);
		return expression.startsWith('({product:') ? {product: 'Antigravity', csrf: 'string', ready: 'complete', origin: 'https://127.0.0.1:12345', appRoot: true, nativeStorage: 'function'} : undefined;
	}
	/**
	 * @used-by {@link FakeCDP#constructor}
	 */
	on(name, handler) {
		this.handlers.set(name, handler);
	}
}
class MockBaseWindow extends EventEmitter {
	/**
	 * @used-by {@link import('../Multi-Account/launcher.test.js')}
	 */
	constructor(id, title = 'Antigravity', minimized = false) {
		super();
		Object.assign(this, {_id: id, appDetails: null, destroyed: false, focused: false, icon: null, minimized, shown: false, title, webContents: Object.assign(new EventEmitter(), {getURL: () => 'https://127.0.0.1:2890/'})});
	}
	/**
	 * @used-by {@link import('../Multi-Account/launcher.js').launch}
	 * @used-by {@link import('../Multi-Account/launcher.test.js')}
	 */
	destroy() { this.destroyed = true; this.emit('closed'); }
	/**
	 * @used-by {@link import('../Folders/folder-dialogs.js').FolderDialogController#openCreateFolder}
	 * @used-by {@link import('../Folders/folder-dialogs.js').FolderDialogController#openModal}
	 * @used-by {@link import('../Folders/folder-menu.js').FolderMenuController#appendFolderTree}
	 * @used-by {@link import('../Folders/folder-menu.js').FolderMenuController#createMenuItemRow}
	 * @used-by {@link import('../Folders/folder-menu.js').FolderMenuController#handleTreeRowKeydown}
	 * @used-by {@link import('../Folders/folder-menu.js').FolderMenuController#show}
	 * @used-by {@link import('../Folders/folders-client.js').FolderTreeRenderer#handleKeydown}
	 * @used-by {@link import('../Folders/folders-client.js').FolderTreeRenderer#restoreFocus}
	 * @used-by {@link import('../Multi-Account/main-bootstrap.js').bootstrap}
	 * @used-by {@link import('../Multi-Account/main-bootstrap.js').ensureInitialWindowVisible}
	 */
	focus() { this.focused = true; }
	/**
	 * @used-by {@link import('../Multi-Account/launcher.test.js')}
	 * @used-by {@link import('../Multi-Account/window-identity.js').patchWindowTitle}
	 * @used-by {@link import('./main-debugger-bridge.js').installMainDebuggerBridge}
	 */
	getTitle() { return this.title; }
	/**
	 * @used-by {@link import('../Folders/antigravity-adapter.js')} (AntigravityAdapter#hasProject)
	 * @used-by {@link import('../Folders/antigravity-adapter.js')} (AntigravityAdapter#validateProjects)
	 * @used-by {@link import('../Folders/architecture.test.js')}
	 * @used-by {@link import('../Folders/browser-fixture.js').openFixture}
	 * @used-by {@link import('../Folders/browser.test.js')}
	 * @used-by {@link import('../Folders/folder-dialogs.js').FolderDialogController#openCreateFolder}
	 * @used-by {@link import('../Folders/folder-dialogs.js').FolderDialogController#openRenameProject}
	 * @used-by {@link import('../Folders/folder-dialogs.js').FolderDialogController#populateFolderSelect}
	 * @used-by {@link import('../Folders/folder-drag.js').SidebarDragController#canDropOnTarget}
	 * @used-by {@link import('../Folders/folder-menu.js').FolderMenuController#appendFolderTree}
	 * @used-by {@link import('../Folders/folder-menu.js').FolderMenuController#createFolderTreeRow}
	 * @used-by {@link import('../Folders/folder-menu.js').FolderMenuController#handleTreeRowKeydown}
	 * @used-by {@link import('../Folders/folder-menu.js').FolderMenuController#openConversationMenu}
	 * @used-by {@link import('../Folders/folder-menu.js').folderPickerModel}
	 * @used-by {@link import('../Folders/folder-picker.test.js')}
	 * @used-by {@link import('../Folders/folders-client.js').FolderStorageClient#loadViewState}
	 * @used-by {@link import('../Folders/folders-client.js').FolderTreeRenderer#renderConversationRow}
	 * @used-by {@link import('../Folders/folders-client.js').FolderTreeRenderer#renderProjectRow}
	 * @used-by {@link import('../Folders/folders-client.js').FolderTreeRenderer#renderRow}
	 * @used-by {@link import('../Folders/folders-client.js').FolderTreeRenderer#reveal}
	 * @used-by {@link import('../Folders/folders-client.js').FoldersView#getFolder}
	 * @used-by {@link import('../Folders/folders-client.js').FoldersView#handleProjects}
	 * @used-by {@link import('../Folders/folders-manager.js').FoldersCliManager#addFolder}
	 * @used-by {@link import('../Folders/folders-manager.js').FoldersCliManager#assignProject}
	 * @used-by {@link import('../Folders/folders-manager.js').FoldersCliManager#findFolder}
	 * @used-by {@link import('../Folders/folders-manager.js').FoldersCliManager#listAll}
	 * @used-by {@link import('../Folders/folders-manager.js').FoldersCliManager#listProjects}
	 * @used-by {@link import('../Folders/folders-manager.js').FoldersCliManager#loadAntigravityProjects}
	 * @used-by {@link import('../Folders/folders-manager.js').FoldersCliManager#moveFolder}
	 * @used-by {@link import('../Folders/folders-manager.js').FoldersCliManager#removeFolder}
	 * @used-by {@link import('../Folders/folders-manager.js').FoldersCliManager#renameFolder}
	 * @used-by {@link import('../Folders/folders-manager.js').FoldersCliManager#resolveProject}
	 * @used-by {@link import('../Folders/folders-manager.js').FoldersCliManager#unassignProject}
	 * @used-by {@link import('../Folders/folders-model.js').FolderActionDispatcher#addFolder}
	 * @used-by {@link import('../Folders/folders-model.js').FolderActionDispatcher#findFolder}
	 * @used-by {@link import('../Folders/folders-model.js').FolderActionDispatcher#moveFolder}
	 * @used-by {@link import('../Folders/folders-model.js').FolderActionDispatcher#removeFolder}
	 * @used-by {@link import('../Folders/folders-model.js').FolderActionDispatcher#renameFolder}
	 * @used-by {@link import('../Folders/folders-model.js').FolderRowBuilder#appendProjectRows}
	 * @used-by {@link import('../Folders/folders-model.js').FolderRowBuilder#indexProjects}
	 * @used-by {@link import('../Folders/folders-model.js').FolderRowBuilder#isVisibleProject}
	 * @used-by {@link import('../Folders/folders-model.js').FolderRowBuilder#markActiveFolders}
	 * @used-by {@link import('../Folders/folders-model.js').FolderRowBuilder#sortCollections}
	 * @used-by {@link import('../Folders/folders-model.js').FolderRowBuilder#visitFolder}
	 * @used-by {@link import('../Folders/folders-model.js').compare}
	 * @used-by {@link import('../Folders/folders-model.js').getDescendantIds}
	 * @used-by {@link import('../Folders/folders-model.js').getFolderPath}
	 * @used-by {@link import('../Folders/folders-model.js').indexTree}
	 * @used-by {@link import('../Multi-Account/launcher.js').activateExisting}
	 * @used-by {@link import('../Multi-Account/launcher.js').childEnvironment}
	 * @used-by {@link import('../Multi-Account/launcher.js').launch}
	 * @used-by {@link import('../Multi-Account/launcher.js').prepareProfile}
	 * @used-by {@link import('../Multi-Account/launcher.test.js')}
	 * @used-by {@link import('../Multi-Account/main-bootstrap.js').bootstrap}
	 * @used-by {@link import('../Multi-Account/main-bootstrap.js').configureSecondaryProfile}
	 * @used-by {@link import('../Multi-Account/main-bootstrap.js')} (configureProtocolHandler)
	 * @used-by {@link import('../Multi-Account/update-guard.js')} (UpdateGuard#blockForSiblings)
	 * @used-by {@link import('../Multi-Account/update-guard.js')} (UpdateGuard#constructor)
	 * @used-by {@link import('../Multi-Account/update-guard.js')} (UpdateGuard#handleInstall)
	 * @used-by {@link import('../Multi-Account/update-guard.js')} (UpdateGuard#handleQuitAndInstall)
	 * @used-by {@link import('../Multi-Account/update-guard.js')} (UpdateGuard#recordDeferredUpdate)
	 * @used-by {@link import('../Multi-Account/update-guard.js')} (UpdateGuard#showDeferredDialog)
	 * @used-by {@link import('../Multi-Account/update-guard.js')} (UpdateGuard#spawnManagedUpdate)
	 * @used-by {@link import('../Multi-Account/update-guard.js')} (UpdateGuard#status)
	 * @used-by {@link import('../Multi-Account/update-runner.js').UpdateRunner#run}
	 * @used-by {@link import('../Multi-Account/update-state.js').activeSiblingProfiles}
	 * @used-by {@link import('../Multi-Account/window-identity.js').installWindowIdentity}
	 * @used-by {@link import('../Titlebar-Badges/badges.test.js')}
	 * @used-by {@link import('./cdp-client.js').CDP#constructor}
	 * @used-by {@link import('./cdp-client.js').MainDebuggerClient#call}
	 * @used-by {@link import('./cdp-client.js').MainDebuggerClient#close}
	 * @used-by {@link import('./cdp-client.js').MainDebuggerClient#evaluate}
	 * @used-by {@link import('./cdp-client.js').MainDebuggerClient#open}
	 * @used-by {@link import('./cdp-companion.js').Companion#attach}
	 * @used-by {@link import('./cdp-companion.js').Companion#bootstrap}
	 * @used-by {@link import('./cdp-companion.js').Companion#handleRequest}
	 * @used-by {@link import('./cdp-companion.js').Companion#loadModules}
	 * @used-by {@link import('./cdp-companion.js').Companion#tick}
	 * @used-by {@link import('./main-debugger-bridge.js').installMainDebuggerBridge}
	 * @used-by {@link import('./profile-endpoints.js').probeProfileEndpoint}
	 * @used-by {@link import('./profiles.js').readProfiles}
	 * @used-by {@link import('./registry.js').discover}
	 * @used-by {@link import('./runtime-health.js').buildInspectExpression}
	 * @used-by {@link import('./runtime-health.js').inspectRuntime}
	 * @used-by {@link import('./test-cdp-runtime.js')}
	 * @used-by {@link import('./test-registry.js')}
	 * @used-by {@link import('./upgrade-runtime.js').run}
	 */
	get id() {
		if (this.destroyed) {
			throw new TypeError('Object has been destroyed');
		}
		return this._id;
	}
	/**
	 * @used-by {@link import('../Multi-Account/main-bootstrap.js').ensureInitialWindowVisible}
	 * @used-by {@link import('../Multi-Account/window-identity.js').allWindows}
	 * @used-by {@link import('../Multi-Account/window-identity.js').installWindowIdentity}
	 * @used-by {@link import('../Multi-Account/window-identity.js').patchWindowTitle}
	 * @used-by {@link import('./main-debugger-bridge.js').installMainDebuggerBridge}
	 */
	isDestroyed() { return this.destroyed; }
	/**
	 * @used-by {@link import('../Multi-Account/launcher.test.js')}
	 * @used-by {@link import('../Multi-Account/main-bootstrap.js').bootstrap}
	 * @used-by {@link import('../Multi-Account/main-bootstrap.js').ensureInitialWindowVisible}
	 */
	isMinimized() { return this.minimized; }
	/**
	 * @used-by {@link import('../Folders/architecture.test.js')}
	 * @used-by {@link import('../Multi-Account/main-bootstrap.js').bootstrap}
	 * @used-by {@link import('./test-cdp-runtime.js')}
	 */
	restore() { this.minimized = false; }
	/**
	 * @used-by {@link import('../Multi-Account/window-identity.js').installWindowIdentity}
	 */
	setAppDetails(details) { this.appDetails = details; }
	/**
	 * @used-by {@link import('../Multi-Account/window-identity.js').installWindowIdentity}
	 */
	setIcon(icon) { this.icon = icon; }
	/**
	 * @used-by {@link import('../Multi-Account/launcher.test.js')}
	 * @used-by {@link import('../Multi-Account/window-identity.js').patchWindowTitle}
	 */
	setTitle(title) { this.title = title; }
	/**
	 * @used-by {@link import('../Multi-Account/launcher.test.js')}
	 */
	show() { this.shown = true; }
}
/**
 * @used-by {@link import('../Multi-Account/launcher.test.js')}
 * @used-by {@link import('./test-helpers.js')}
 */
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
/**
 * @used-by {@link import('../Folders/architecture.test.js')}
 * @used-by {@link import('../Folders/folder-picker.test.js')}
 * @used-by {@link import('./test-helpers.js')}
 */
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
/**
 * @used-by {@link import('../Folders/architecture.test.js')}
 * @used-by {@link import('../Folders/architecture.test.js')} (scratch)
 * @used-by {@link import('../Multi-Account/launcher.test.js')}
 * @used-by {@link import('../Multi-Account/launcher.test.js')} (fixture)
 * @used-by {@link import('../Multi-Account/skills-manifest.test.js')}
 * @used-by {@link import('../Multi-Account/skills-manifest.test.js')} (fixture)
 * @used-by {@link import('./test-cdp-runtime.js')}
 * @used-by {@link import('./test-cdp-runtime.js')} (fixture)
 * @used-by {@link import('./test-helpers.js')}
 * @used-by {@link import('./test-registry.js')}
 * @used-by {@link import('./test-registry.js')} (fixture)
 */
const createTempDir = (context, prefix = 'antigravity-test-') => {
	const parent = path.resolve(os.tmpdir());
	const r = fs.mkdtempSync(path.join(parent, prefix));
	context.after(() => {
		assert.ok(path.resolve(r).startsWith(parent + path.sep));
		fs.rmSync(r, {recursive: true, force: true});
	});
	return r;
};
/**
 * @used-by {@link import('../Folders/architecture.test.js')}
 * @used-by {@link import('./test-helpers.js')}
 */
const encodeConnectFrame = value => ConnectSummaryStream.encodeFrame(value);
/**
 * @used-by {@link createMockDocument}
 * @used-by {@link import('./test-helpers.js')}
 */
const matchesSelector = (el, selector) => {
	const role = el?.attributes?.role;
	const testid = el?.dataset?.testid ?? el?.attributes?.['data-testid'];
	return ('[data-testid="conversation-list-sidebar"]' === selector && 'conversation-list-sidebar' === testid)
		|| ('[role="navigation"]' === selector && 'navigation' === role)
		|| (selector.includes('aria-selected=true') && 'treeitem' === role && 'true' === el?.attributes?.['aria-selected'])
		|| (!selector.includes('aria-selected=true') && ((selector.includes('treeitem') && 'treeitem' === role) || (selector.includes('menuitem') && 'menuitem' === role) || (selector.includes('button') && 'button' === role)));
};
/**
 * @used-by {@link import('./test-cdp-runtime.js')}
 * @used-by {@link import('./test-helpers.js')}
 */
const mockProfileEndpoints = (context, root, ports = {Antigravity: '10001'}) => {
	const roaming = path.join(root, 'roaming');
	for (const [name, port] of Object.entries(ports)) {
		fs.mkdirSync(path.join(roaming, name), {recursive: true});
		if (null !== port) { fs.writeFileSync(path.join(roaming, name, 'DevToolsActivePort'), String(port)); }
	}
	withEnv(context, {APPDATA: roaming});
	return roaming;
};
/**
 * @used-by {@link import('./test-cdp-runtime.js')}
 * @used-by {@link import('./test-helpers.js')}
 * @used-by {@link mockProfileEndpoints}
 */
const withEnv = (context, entries) => {
	const previous = Object.fromEntries(Object.keys(entries).map(key => [key, process.env[key]]));
	for (const [key, value] of Object.entries(entries)) { undefined === value ? delete process.env[key] : (process.env[key] = value); }
	context.after(() => {
		for (const [key, value] of Object.entries(previous)) { undefined === value ? delete process.env[key] : (process.env[key] = value); }
	});
};
module.exports = {FakeCDP, MockBaseWindow, createElectronHarness, createMockDocument, createTempDir, encodeConnectFrame, mockProfileEndpoints, withEnv};