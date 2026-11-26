// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
const crypto = require('node:crypto');
const {BRIDGE_GLOBAL, ensureRemoteBridge} = require('./main-debugger-bridge');
// 2026-10-28
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
class CDP {
	/**
	 * @used-by {@link CDP#open}
	 */
	constructor(socket) {
		this.socket = socket;
		// 2026-11-20
		// "Close underlying V8 inspector WebSocket on MainDebuggerClient disconnect":
		// https://github.com/dmitry-ai/antigravity-addons/issues/56
		this.closed = false;
		this.sequence = 0;
		this.pending = new Map();
		this.listeners = new Map();
		socket.addEventListener('message', event => {
			const message = JSON.parse(event.data);
			if (!message.id) {
				for (const handler of this.listeners.get(message.method) || []) {
					handler(message.params);
				}
			}
			else {
				const request = this.pending.get(message.id);
				if (request) {
					this.pending.delete(message.id);
					clearTimeout(request.timer);
					message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result);
				}
			}
		});
		socket.addEventListener('close', () => {
			this.closed = true;
			for (const request of this.pending.values()) {
				clearTimeout(request.timer);
				request.reject(Error('CDP disconnected'));
			}
			this.pending.clear();
			for (const handler of this.listeners.get('close') || []) {
				handler();
			}
		});
	}
	/**
	 * @used-by {@link import('./cdp-client.js')}
	 * @used-by {@link openTargetSession}
	 */
	static async open(url) {
		const socket = new WebSocket(url);
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				socket.close();
				reject(Error('CDP connection timeout'));
			}, 3000);
			socket.addEventListener('open', () => {
				clearTimeout(timer);
				resolve();
			}, {once: true});
			socket.addEventListener('error', () => {
				clearTimeout(timer);
				reject(Error('CDP connection failed'));
			}, {once: true});
		});
		return new CDP(socket);
	}
	/**
	 * @used-by {@link openTargetSession}
	 */
	on(event, handler) {
		const handlers = this.listeners.get(event) || new Set();
		handlers.add(handler);
		this.listeners.set(event, handlers);
	}
	/**
	 * @used-by {@link CDP#evaluate}
	 */
	call(method, params = {}, timeout = 5000) {
		return this.closed ? Promise.reject(Error('CDP disconnected')) : new Promise((resolve, reject) => {
			const id = ++this.sequence;
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(Error(`${method} timed out`));
			}, timeout);
			this.pending.set(id, {resolve, reject, timer});
			this.socket.send(JSON.stringify({id, method, params}));
		});
	}
	/**
	 * @used-by {@link openTargetSession}
	 */
	async evaluate(expression) {
		const response = await this.call('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
		if (response.exceptionDetails) {
			throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
		}
		return response.result?.value;
	}
	// 2026-11-20
	// "Close underlying V8 inspector WebSocket on MainDebuggerClient disconnect":
	// https://github.com/dmitry-ai/antigravity-addons/issues/56
	/**
	 * @used-by {@link openTargetSession}
	 */
	close() {
		this.closed = true;
		try {
			this.socket.close();
		}
		catch {}
	}
}
// 2026-11-19
// "Bridge Upgrade and OAuth renderer attach through main-process WebContents debugger":
// https://github.com/dmitry-ai/antigravity-addons/issues/52
class MainDebuggerClient {
	/**
	 * @used-by {@link MainDebuggerClient#open}
	 */
	constructor({bindingName = null, clientId = '', inspector, readOnly = false, target}) {
		this.inspector = inspector;
		this.target = target;
		this.readOnly = readOnly;
		this.clientId = clientId;
		this.bindingName = bindingName;
		this.closed = false;
		this.listeners = new Map();
		inspector.on?.('close', () => this.handleDisconnect());
		if (!readOnly && bindingName) {
			inspector.on?.('Runtime.bindingCalled', event => {
				if (event?.name !== this.bindingName || this.closed) {
					return;
				}
				let msg;
				try {
					msg = JSON.parse(event.payload);
				}
				catch {
					return;
				}
				if ('event' === msg?.type) {
					this.emitEvent(msg.method, msg.params);
				}
				else if ('close' === msg?.type) {
					this.handleDisconnect();
				}
			});
		}
	}
	/**
	 * @used-by {@link openTargetSession}
	 */
	static async open(target, {cdpFactory = url => CDP.open(url), ownerKey = null, readOnly = false} = {}) {
		const inspector = await cdpFactory(target.mainInspectorUrl);
		try {
			await ensureRemoteBridge(inspector);
			if (readOnly) {
				return new MainDebuggerClient({inspector, readOnly: true, target});
			}
			const clientId = crypto.randomUUID();
			const bindingName = '__antigravityDbg_' + clientId.replace(/-/g, '');
			await inspector.call('Runtime.enable');
			await inspector.call('Runtime.addBinding', {name: bindingName});
			const attached = await inspector.evaluate(`globalThis[${JSON.stringify(BRIDGE_GLOBAL)}].attach(${JSON.stringify(clientId)}, ${JSON.stringify(String(target.id))}, ${JSON.stringify(bindingName)}, ${JSON.stringify({ownerKey})})`);
			if (!attached?.attached) {
				throw Error(`Could not attach main-process debugger to target ${target.id}`);
			}
			return new MainDebuggerClient({bindingName, clientId, inspector, readOnly: false, target});
		}
		catch (error) {
			inspector.close();
			throw error;
		}
	}
	/**
	 * @used-by {@link openTargetSession}
	 */
	on(event, handler) {
		const handlers = this.listeners.get(event) || new Set();
		handlers.add(handler);
		this.listeners.set(event, handlers);
	}
	/**
	 * @used-by {@link MainDebuggerClient#close}
	 * @used-by {@link MainDebuggerClient#constructor}
	 * @used-by {@link MainDebuggerClient#handleDisconnect}
	 */
	emitEvent(event, params) {
		for (const handler of this.listeners.get(event) || []) {
			try {
				handler(params);
			}
			catch {}
		}
	}
	/**
	 * @used-by {@link MainDebuggerClient#constructor}
	 */
	handleDisconnect() {
		if (!this.closed) {
			this.closed = true;
			// 2026-11-20
			// "Close underlying V8 inspector WebSocket on MainDebuggerClient disconnect":
			// https://github.com/dmitry-ai/antigravity-addons/issues/56
			try {
				this.inspector?.close?.();
			}
			catch {}
			this.emitEvent('close');
		}
	}
	/**
	 * @used-by {@link MainDebuggerClient#call}
	 * @used-by {@link MainDebuggerClient#evaluate}
	 * @used-by {@link import('./test-cdp-runtime.js')}
	 */
	async evalInspector(expression, timeout = 5000) {
		const response = await this.inspector.call('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, timeout);
		if (response?.exceptionDetails) {
			throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
		}
		return response?.result?.value;
	}
	/**
	 * @used-by {@link MainDebuggerClient#evaluate}
	 */
	async call(method, params = {}, timeout = 5000) {
		if (this.closed) {
			throw Error('CDP disconnected');
		}
		const expr = `globalThis[${JSON.stringify(BRIDGE_GLOBAL)}].send(${JSON.stringify(this.clientId)}, ${JSON.stringify(String(this.target.id))}, ${JSON.stringify(method)}, ${JSON.stringify(params)})`;
		return this.evalInspector(expr, timeout);
	}
	/**
	 * @used-by {@link openTargetSession}
	 */
	async evaluate(expression, timeout = 5000) {
		if (this.closed) {
			throw Error('CDP disconnected');
		}
		if (this.readOnly) {
			const expr = `globalThis[${JSON.stringify(BRIDGE_GLOBAL)}].evaluate(${JSON.stringify(String(this.target.id))}, ${JSON.stringify(expression)})`;
			return this.evalInspector(expr, timeout);
		}
		const response = await this.call('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, timeout);
		if (response?.exceptionDetails) {
			throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
		}
		return response?.result?.value;
	}
	/**
	 * @used-by {@link openTargetSession}
	 */
	close() {
		if (!this.closed) {
			this.closed = true;
			this.emitEvent('close');
			// 2026-11-20
			// "Close underlying V8 inspector WebSocket on MainDebuggerClient disconnect":
			// https://github.com/dmitry-ai/antigravity-addons/issues/56
			if (this.readOnly || this.inspector?.closed) {
				try {
					this.inspector?.close?.();
				}
				catch {}
			}
			else {
				const expr = `globalThis[${JSON.stringify(BRIDGE_GLOBAL)}]?.detach(${JSON.stringify(this.clientId)}, ${JSON.stringify(String(this.target.id))})`;
				void this.inspector.call('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}, 500).catch(() => {}).finally(() => {
					try {
						this.inspector?.close?.();
					}
					catch {}
				});
			}
		}
	}
}
// 2026-11-19
// "Bridge Upgrade and OAuth renderer attach through main-process WebContents debugger":
// https://github.com/dmitry-ai/antigravity-addons/issues/52
/**
 * @used-by {@link import('../Multi-Account/launcher.js').activateExisting}
 * @used-by {@link import('../Multi-Account/launcher.js')}
 * @used-by {@link import('../Multi-Account/oauth-bridge.js').refreshInitialPage}
 * @used-by {@link import('../Multi-Account/oauth-bridge.js')}
 * @used-by {@link import('./cdp-client.js')}
 * @used-by {@link import('./cdp-companion.js').Companion#attach}
 * @used-by {@link import('./cdp-companion.js')}
 * @used-by {@link import('./runtime-health.js').inspectRuntime}
 * @used-by {@link import('./runtime-health.js')}
 * @uses {@link CDP#close}
 * @uses {@link CDP#evaluate}
 * @uses {@link CDP#on}
 * @uses {@link MainDebuggerClient#close}
 * @uses {@link MainDebuggerClient#evaluate}
 * @uses {@link MainDebuggerClient#on}
 */
const openTargetSession = (target, options = {}) => target?.mainInspectorUrl
	? MainDebuggerClient.open(target, {cdpFactory: url => CDP.open(url), ...options})
	: CDP.open(target.webSocketDebuggerUrl);
module.exports = {CDP, MainDebuggerClient, openTargetSession};
