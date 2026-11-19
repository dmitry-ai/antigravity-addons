// 2026-11-19 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Bridge Upgrade and OAuth renderer attach through main-process WebContents debugger":
// https://github.com/dmitry-ai/antigravity-addons/issues/52
const fs = require('node:fs');
const path = require('node:path');
const BRIDGE_GLOBAL = '__ANTIGRAVITY_MAIN_DEBUGGER_BRIDGE__';
const NON_PAGE_TYPES = new Set(['backgroundPage', 'devtools', 'offscreen', 'webview']);
const resolveAppModule = (appRequire, id) => {
	let r = null;
	if ('function' === typeof appRequire) {
		try {
			r = appRequire(id);
		}
		catch {}
	}
	if (!r && process.resourcesPath) {
		try {
			const asarMain = path.join(process.resourcesPath, 'app.asar/dist/main.js');
			if (fs.existsSync(asarMain)) {
				const {createRequire} = require('node:module');
				r = createRequire(asarMain)(id);
			}
		}
		catch {}
	}
	if (!r && 'electron' === id) {
		try {
			r = require('electron');
		}
		catch {}
	}
	return r;
};
const installMainDebuggerBridge = ({appRequire, electron: explicitElectron, utils: explicitUtils} = {}) => {
	const existing = globalThis[BRIDGE_GLOBAL];
	if (1 === existing?.version && !explicitElectron && !explicitUtils) {
		if (appRequire) {
			existing.setAppRequire?.(appRequire);
		}
		return existing;
	}
	let currentAppRequire = appRequire || null;
	const attachments = new Map();
	const byId = new Map();
	const weakIds = new WeakMap();
	let nextAnonId = 0;
	const getElectron = () => explicitElectron || resolveAppModule(currentAppRequire, 'electron');
	const getUtils = () => explicitUtils || resolveAppModule(currentAppRequire, './utils');
	const targetIdFor = wc => {
		let r;
		if (Number.isInteger(wc.id)) {
			r = String(wc.id);
		}
		else {
			r = weakIds.get(wc);
			if (!r) {
				r = 'wc-' + (++nextAnonId);
				weakIds.set(wc, r);
			}
		}
		return r;
	};
	const listWebContents = () => {
		const electron = getElectron();
		const utils = getUtils();
		const seen = new Set();
		const r = [];
		const pushWc = wc => {
			if (!wc || 'object' !== typeof wc || seen.has(wc) || wc.isDestroyed?.()) {
				return;
			}
			seen.add(wc);
			const rawType = 'function' === typeof wc.getType ? wc.getType() : (wc.type || 'page');
			if (NON_PAGE_TYPES.has(rawType)) {
				return;
			}
			const url = String(('function' === typeof wc.getURL ? wc.getURL() : wc.url) || '');
			const title = String(('function' === typeof wc.getTitle ? wc.getTitle() : wc.title) || '');
			const id = targetIdFor(wc);
			byId.set(id, wc);
			r.push({id, title, type: 'page', rawType, url, wc});
		};
		for (const win of utils?.getHubWindows?.() || []) {
			if (win && !win.isDestroyed?.()) {
				pushWc(utils?.getHubWebContents?.(win) ?? win.webContents);
			}
		}
		for (const win of electron?.BaseWindow?.getAllWindows?.() || []) {
			if (win && !win.isDestroyed?.()) {
				pushWc(utils?.getHubWebContents?.(win) ?? win.webContents);
				for (const view of win.contentView?.children || []) {
					pushWc(view?.webContents);
				}
			}
		}
		for (const win of electron?.BrowserWindow?.getAllWindows?.() || []) {
			if (win && !win.isDestroyed?.()) {
				pushWc(win.webContents);
			}
		}
		for (const wc of electron?.webContents?.getAllWebContents?.() || []) {
			pushWc(wc);
		}
		return r;
	};
	const findWebContents = targetId => {
		const key = String(targetId || '');
		let wc = byId.get(key);
		if (!wc || wc.isDestroyed?.()) {
			listWebContents();
			wc = byId.get(key);
		}
		return wc && !wc.isDestroyed?.() ? wc : null;
	};
	const dispatch = (attachment, payload) => {
		const serialized = JSON.stringify(payload);
		for (const sub of [...attachment.subscribers.values()]) {
			const fn = globalThis[sub.bindingName];
			if ('function' === typeof fn) {
				try {
					fn(serialized);
				}
				catch {}
			}
		}
	};
	const removeListeners = attachment => {
		try {
			attachment.wc.debugger?.removeListener?.('message', attachment.onMessage);
			attachment.wc.debugger?.removeListener?.('detach', attachment.onDetach);
			attachment.wc.removeListener?.('destroyed', attachment.onDestroyed);
		}
		catch {}
	};
	const cleanupAttachment = (targetId, notice) => {
		const attachment = attachments.get(targetId);
		if (attachment) {
			attachments.delete(targetId);
			removeListeners(attachment);
			if (notice) {
				dispatch(attachment, notice);
			}
			attachment.subscribers.clear();
		}
	};
	const discover = () => {
		const electron = getElectron();
		const account = globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__;
		return {
			pid: process.pid,
			accountId: account?.id || null,
			userDataDir: electron?.app?.getPath?.('userData') || account?.userDataDir || null,
			appVersion: electron?.app?.getVersion?.() || null,
			targets: listWebContents().map(({id, title, type, url}) => ({id, title, type, url}))
		};
	};
	const evaluate = async (targetId, expression) => {
		const wc = findWebContents(targetId);
		if (!wc || 'function' !== typeof wc.executeJavaScript) {
			throw Error(`WebContents target ${targetId} is unavailable`);
		}
		return wc.executeJavaScript(expression, false);
	};
	const attach = (clientId, targetId, bindingName, {ownerKey = null} = {}) => {
		const key = String(targetId || '');
		const wc = findWebContents(key);
		if (!wc || !wc.debugger) {
			throw Error(`WebContents debugger is unavailable for target ${key}`);
		}
		let attachment = attachments.get(key);
		if (attachment && attachment.wc !== wc) {
			cleanupAttachment(key, {type: 'close', reason: 'replaced'});
			attachment = null;
		}
		if (attachment && ownerKey) {
			for (const [subId, sub] of [...attachment.subscribers.entries()]) {
				if (sub.ownerKey === ownerKey) {
					attachment.subscribers.delete(subId);
				}
			}
		}
		if (!attachment) {
			attachment = {
				targetId: key,
				wc,
				subscribers: new Map(),
				onMessage: (_event, method, params, sessionId) => {
					if (!sessionId) {
						dispatch(attachment, {type: 'event', method, params});
					}
				},
				onDetach: (_event, reason) => cleanupAttachment(key, {type: 'close', reason: reason || 'detached'}),
				onDestroyed: () => cleanupAttachment(key, {type: 'close', reason: 'destroyed'})
			};
			wc.debugger.on?.('message', attachment.onMessage);
			wc.debugger.once?.('detach', attachment.onDetach);
			wc.once?.('destroyed', attachment.onDestroyed);
			attachments.set(key, attachment);
		}
		if (!attachment.subscribers.size && wc.debugger.isAttached?.()) {
			try {
				wc.debugger.detach();
			}
			catch {}
		}
		if (!wc.debugger.isAttached?.()) {
			wc.debugger.attach('1.3');
		}
		attachment.subscribers.set(clientId, {clientId, bindingName, ownerKey});
		return {attached: true, targetId: key, subscribers: attachment.subscribers.size};
	};
	const send = async (clientId, targetId, method, params = {}) => {
		const attachment = attachments.get(String(targetId || ''));
		if (!attachment || !attachment.subscribers.has(clientId) || attachment.wc.isDestroyed?.()) {
			throw Error(`Debugger session for target ${targetId} is not attached`);
		}
		return attachment.wc.debugger.sendCommand(method, params);
	};
	const detach = (clientId, targetId) => {
		const key = String(targetId || '');
		const attachment = attachments.get(key);
		if (!attachment) {
			return false;
		}
		attachment.subscribers.delete(clientId);
		if (!attachment.subscribers.size) {
			attachments.delete(key);
			removeListeners(attachment);
			try {
				if (attachment.wc.debugger?.isAttached?.()) {
					attachment.wc.debugger.detach();
				}
			}
			catch {}
		}
		return true;
	};
	const dispose = () => {
		for (const [key, attachment] of [...attachments.entries()]) {
			removeListeners(attachment);
			try {
				if (attachment.wc.debugger?.isAttached?.()) {
					attachment.wc.debugger.detach();
				}
			}
			catch {}
			attachment.subscribers.clear();
			attachments.delete(key);
		}
		byId.clear();
		if (globalThis[BRIDGE_GLOBAL] === bridge) {
			delete globalThis[BRIDGE_GLOBAL];
		}
	};
	const bridge = {
		version: 1,
		setAppRequire: fn => {
			if ('function' === typeof fn) {
				currentAppRequire = fn;
			}
		},
		listWebContents,
		discover,
		evaluate,
		attach,
		send,
		detach,
		dispose
	};
	globalThis[BRIDGE_GLOBAL] = bridge;
	return bridge;
};
const ensureRemoteBridge = async (inspectorCdp, {bridgePath = __filename} = {}) => {
	const expr = `(()=>{const k=${JSON.stringify(BRIDGE_GLOBAL)};if(1===globalThis[k]?.version)return true;const loader='function'===typeof require?require:process.getBuiltinModule('node:module').createRequire(${JSON.stringify(bridgePath)});return 1===loader(${JSON.stringify(bridgePath)}).installMainDebuggerBridge().version;})()`;
	const ok = await inspectorCdp.evaluate(expr);
	if (true !== ok) {
		throw Error('Failed to install main-process debugger bridge');
	}
	return true;
};
module.exports = {BRIDGE_GLOBAL, ensureRemoteBridge, installMainDebuggerBridge};
