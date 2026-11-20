// 2026-11-20 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Close underlying V8 inspector WebSocket on MainDebuggerClient disconnect":
// https://github.com/dmitry-ai/antigravity-addons/issues/56
// 2026-11-19 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Bridge Upgrade and OAuth renderer attach through main-process WebContents debugger":
// https://github.com/dmitry-ai/antigravity-addons/issues/52
// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
const crypto = require('node:crypto');
const {BRIDGE_GLOBAL, ensureRemoteBridge} = require('./main-debugger-bridge');
class CDP {
	constructor(socket) {
		this.socket = socket;
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
	on(event, handler) {
		const handlers = this.listeners.get(event) || new Set();
		handlers.add(handler);
		this.listeners.set(event, handlers);
	}
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
	async evaluate(expression) {
		const response = await this.call('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
		if (response.exceptionDetails) {
			throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
		}
		return response.result?.value;
	}
	close() {
		this.closed = true;
		try {
			this.socket.close();
		}
		catch {}
	}
}
class MainDebuggerClient {
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
	on(event, handler) {
		const handlers = this.listeners.get(event) || new Set();
		handlers.add(handler);
		this.listeners.set(event, handlers);
	}
	emitEvent(event, params) {
		for (const handler of this.listeners.get(event) || []) {
			try {
				handler(params);
			}
			catch {}
		}
	}
	handleDisconnect() {
		if (!this.closed) {
			this.closed = true;
			try {
				this.inspector?.close?.();
			}
			catch {}
			this.emitEvent('close');
		}
	}
	async evalInspector(expression, timeout = 5000) {
		const response = await this.inspector.call('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, timeout);
		if (response?.exceptionDetails) {
			throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
		}
		return response?.result?.value;
	}
	async call(method, params = {}, timeout = 5000) {
		if (this.closed) {
			throw Error('CDP disconnected');
		}
		const expr = `globalThis[${JSON.stringify(BRIDGE_GLOBAL)}].send(${JSON.stringify(this.clientId)}, ${JSON.stringify(String(this.target.id))}, ${JSON.stringify(method)}, ${JSON.stringify(params)})`;
		return this.evalInspector(expr, timeout);
	}
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
	close() {
		if (!this.closed) {
			this.closed = true;
			this.emitEvent('close');
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
const openTargetSession = (target, options = {}) => target?.mainInspectorUrl
	? MainDebuggerClient.open(target, {cdpFactory: url => CDP.open(url), ...options})
	: CDP.open(target.webSocketDebuggerUrl);
module.exports = {CDP, MainDebuggerClient, openTargetSession};
