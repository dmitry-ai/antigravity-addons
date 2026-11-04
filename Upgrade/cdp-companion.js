// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {CDP} = require('./cdp-client');
const registry = require('./registry');
const {shellProbe, isShell} = require('./antigravity-shell');
const {discoverEndpoints} = require('./profile-endpoints');
const stateRoot = path.join(process.env.APPDATA || path.join(__dirname, 'state'), 'AntigravityTools');
const binding = '__antigravityToolsCall';
// 2026-11-05 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement cross-profile auto-update guard (M-2) and unified main-process bootstrap for A0 and A6":
// https://github.com/dmitry-ai/antigravity-addons/issues/20
const runtimeVersion = () => {
	const core = ['cdp-companion.js', 'cdp-client.js', 'registry.js', 'antigravity-shell.js', 'profile-endpoints.js', '../Multi-Account/profiles.js', '../Multi-Account/profiles.json', '../Multi-Account/update-guard.js'].map(filename => path.join(__dirname, filename));
	const modules = registry.discover().flatMap(tool => [tool.manifest, tool.cdp, tool.prepare, ...(tool.runtimeFiles || [])].filter(Boolean));
	return crypto.createHash('sha256').update([...new Set([...core, ...modules])].map(filename => filename + '\n' + fs.readFileSync(filename, 'utf8')).join('\n')).digest('hex');
};
// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Add Project settings action to project context menu in Folders":
// https://github.com/dmitry-ai/antigravity-addons/issues/17
const bridgeSource = `(() => {
if(window.__ANTIGRAVITY_TOOLS_BRIDGE_VERSION__===1){window.__ANTIGRAVITY_TOOLS_RETRY__?.();return;}
const pending=new Map();let sequence=0;
window.__ANTIGRAVITY_TOOLS_REQUEST__=(tool,message)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Tools storage did not respond; run Upg to reconnect'));},15000);pending.set(id,{resolve,reject,timer,tool,message});window.${binding}(JSON.stringify({id,tool,message}));});
window.__ANTIGRAVITY_TOOLS_RETRY__=()=>{for(const [id,item] of pending)if(item.tool)window.${binding}(JSON.stringify({id,tool:item.tool,message:item.message}));};
window.__ANTIGRAVITY_TOOLS_DELIVER__=reply=>{const request=pending.get(reply.id);if(!request)return;pending.delete(reply.id);clearTimeout(request.timer);reply.error?request.reject(Error(reply.error)):request.resolve(reply.result);};
window.__ANTIGRAVITY_TOOLS_BRIDGE_VERSION__=1;
})()`;
class Companion {
	constructor({root = stateRoot} = {}) {
		this.root = root;
		this.connections = new Map();
		this.modules = new Map();
		this.errors = {};
		this.instance = crypto.randomUUID();
		this.version = runtimeVersion();
		this.stopped = false;
	}
	writeState(state, extra = {}) {
		const record = {
			schemaVersion: 1,
			instance: this.instance,
			version: this.version,
			pid: process.pid,
			runtimePath: __filename,
			state,
			updated: new Date().toISOString(),
			windows: this.connections.size,
			profiles: this.profileStates || [],
			tools: [...this.modules.keys()],
			errors: this.errors,
			...extra
		};
		const filename = path.join(this.root, 'runtime.json');
		const temporary = filename + '.tmp';
		fs.writeFileSync(temporary, JSON.stringify(record, null, 2));
		fs.renameSync(temporary, filename);
	}
	async broadcast(source) {
		await Promise.allSettled([...this.connections.values()].filter(item => item.shell).map(item => item.cdp.evaluate(source)));
	}
	loadModules() {
		for (const tool of registry.discover()) {
			if (!tool.cdp) {
				throw Error(`Tool ${tool.id} has no CDP runtime adapter`);
			}
			const runtime = require(tool.cdp)({
				stateRoot: this.root,
				broadcast: source => this.broadcast(source),
				report: message => {
					if (message) {
						this.errors[tool.id] = message;
					}
					else {
						delete this.errors[tool.id];
					}
					void this.broadcast(`window.__PROJECT_FOLDERS_VIEW__?.reportAction(${JSON.stringify(message)});`);
				}
			});
			this.modules.set(tool.id, runtime);
		}
	}
	async attach(target) {
		const cdp = await CDP.open(target.webSocketDebuggerUrl);
		const key = target.key || target.id;
		const r = {
			cdp,
			id: key,
			profileId: target.profileId || 'A0',
			endpoint: target.endpoint,
			email: target.email,
			sources: new Map(),
			sheets: new Map(),
			shell: false,
			booting: false
		};
		this.connections.set(key, r);
		try {
			const frame = await cdp.call('Page.getFrameTree');
			r.frameId = frame.frameTree.frame.id;
			cdp.on('close', () => {
				if (this.connections.get(key) === r) {
					this.connections.delete(key);
				}
				delete this.errors[key];
			});
			cdp.on('Runtime.executionContextCreated', ({context}) => {
				if (context.auxData?.isDefault && context.auxData?.frameId === r.frameId) {
					r.contextId = context.id;
				}
			});
			cdp.on('Runtime.executionContextsCleared', () => {
				r.contextId = null;
				r.sources.clear();
				r.sheets.clear();
				r.shell = false;
			});
			cdp.on('Page.frameNavigated', ({frame: nextFrame}) => {
				if (!nextFrame.parentId) {
					r.frameId = nextFrame.id;
					r.sources.clear();
					r.sheets.clear();
				}
			});
			cdp.on('Page.domContentEventFired', () => {
				void this.bootstrap(r).catch(error => {
					this.errors[key] = error.message;
				});
			});
			cdp.on('Runtime.bindingCalled', event => {
				void this.handleRequest(r, event).catch(error => {
					this.errors[key] = error.message;
				});
			});
			await cdp.call('Runtime.enable');
			await cdp.call('Page.enable');
			await cdp.call('DOM.enable');
			await cdp.call('CSS.enable');
			await cdp.call('Runtime.addBinding', {name: binding});
			await this.bootstrap(r);
			return r;
		}
		catch (error) {
			cdp.close();
			if (this.connections.get(key) === r) {
				this.connections.delete(key);
			}
			throw error;
		}
	}
	async handleRequest(connection, event) {
		if (event.name === binding && event.executionContextId === connection.contextId && connection.shell) {
			const request = JSON.parse(event.payload);
			if (!Number.isSafeInteger(request.id) || 0 >= request.id || 'string' !== typeof request.tool) {
				throw Error('Invalid Tools request envelope');
			}
			const reply = {id: request.id};
			try {
				const runtime = this.modules.get(request.tool);
				if (!runtime?.request) {
					throw Error('Unknown Tools storage channel');
				}
				reply.result = await runtime.request(request.message);
			}
			catch (error) {
				reply.error = error.message;
			}
			await connection.cdp.evaluate(`window.__ANTIGRAVITY_TOOLS_DELIVER__?.(${JSON.stringify(reply)})`);
		}
	}
	async bootstrap(connection) {
		if (!connection.booting && !connection.cdp.closed) {
			connection.booting = true;
			try {
				const info = await connection.cdp.evaluate(shellProbe);
				if (isShell(info)) {
					connection.shell = true;
					await connection.cdp.evaluate(`window.__ANTIGRAVITY_TOOLS_PROFILE__=${JSON.stringify({id: connection.profileId, email: connection.email})}`);
					await connection.cdp.evaluate(bridgeSource);
					if (!this.modules.has('folders')) {
						await connection.cdp.evaluate('window.__PROJECT_FOLDERS_VIEW__?.dispose();window.__PROJECT_FOLDERS_CLIENT__?.dispose?.();delete window.__FOLDERS_RUNTIME_VERSION__;');
					}
					const styles = [...this.modules.values()].filter(runtime => runtime.styleSheet).map(runtime => runtime.styleSheet()).join('\n');
					const styleHash = crypto.createHash('sha256').update(styles).digest('hex');
					if (connection.sources.get(':styles') !== styleHash) {
						let sheet = connection.sheets.get(':styles');
						if (!sheet) {
							sheet = (await connection.cdp.call('CSS.createStyleSheet', {frameId: connection.frameId, force: true})).styleSheetId;
							connection.sheets.set(':styles', sheet);
						}
						await connection.cdp.call('CSS.setStyleSheetText', {styleSheetId: sheet, text: styles});
						connection.sources.set(':styles', styleHash);
					}
					const pending = [];
					for (const [id, runtime] of this.modules) {
						if (runtime.source) {
							const source = runtime.source();
							const hash = crypto.createHash('sha256').update(source).digest('hex');
							if (connection.sources.get(id) !== hash) {
								const attached = await connection.cdp.evaluate(`window.__ANTIGRAVITY_TOOLS_INSPECTOR_STYLES__=true;\n${source}`);
								if (false === attached?.attached) {
									pending.push({id, reason: attached.reason});
								}
								else {
									connection.sources.set(id, hash);
								}
							}
						}
					}
					await connection.cdp.evaluate(`window.__ANTIGRAVITY_TOOLS_STATUS__=${JSON.stringify({architecture: 1, tools: [...this.modules.keys()], pending, stylesHash: styleHash})}`);
					delete this.errors[connection.id];
				}
			}
			finally {
				connection.booting = false;
			}
		}
	}
	async tick() {
		result: {
			const controlFile = path.join(this.root, 'control.json');
			if (fs.existsSync(controlFile)) {
				const control = JSON.parse(fs.readFileSync(controlFile, 'utf8'));
				fs.unlinkSync(controlFile);
				if (control.instance === this.instance && 'stop' === control.action) {
					await this.dispose();
					break result;
				}
			}
			const profiles = await discoverEndpoints();
			const pages = profiles.flatMap(profile => profile.pages.map(page => ({
				...page,
				key: `${profile.id}:${page.id}`,
				profileId: profile.id,
				endpoint: profile.endpoint,
				email: profile.email
			})));
			const current = new Set(pages.map(page => page.key));
			delete this.errors.runtime;
			for (const id of Object.keys(this.errors)) {
				if (!current.has(id) && !this.modules.has(id)) {
					delete this.errors[id];
				}
			}
			for (const profile of profiles) {
				if (profile.error) {
					this.errors[profile.id] = profile.error;
				}
			}
			for (const [id, connection] of this.connections) {
				if (!current.has(id) || pages.find(page => page.key === id)?.endpoint !== connection.endpoint) {
					connection.cdp.close();
					this.connections.delete(id);
				}
			}
			await Promise.all(pages.map(async page => {
				try {
					const connection = this.connections.get(page.key);
					if (!connection || connection.cdp.closed) {
						await this.attach(page);
					}
					else {
						await this.bootstrap(connection);
					}
				}
				catch (error) {
					this.errors[page.key] = error.message;
				}
			}));
			this.profileStates = profiles.map(({id, state, appVersion, error}) => ({
				id,
				state,
				appVersion,
				error,
				windows: [...this.connections.values()].filter(connection => connection.profileId === id && connection.shell).length
			}));
			this.writeState(Object.keys(this.errors).length ? 'error' : [...this.connections.values()].some(item => item.shell) ? 'connected' : pages.length ? 'waiting-for-shell' : 'waiting-for-antigravity');
		}
	}
	async start() {
		let r = false;
		result: {
			fs.mkdirSync(this.root, {recursive: true});
			const lockfile = path.join(this.root, 'instance.lock');
			if (fs.existsSync(lockfile)) {
				const previous = JSON.parse(fs.readFileSync(lockfile, 'utf8'));
				try {
					process.kill(previous.pid, 0);
					break result;
				}
				catch (error) {
					if ('ESRCH' !== error.code) {
						throw error;
					}
				}
				fs.rmSync(lockfile);
			}
			fs.writeFileSync(lockfile, JSON.stringify({pid: process.pid, instance: this.instance}), {flag: 'wx'});
			try {
				this.loadModules();
			}
			catch (error) {
				for (const runtime of this.modules.values()) {
					runtime.dispose?.();
				}
				this.modules.clear();
				this.errors.runtime = error.message;
				this.writeState('error');
				fs.rmSync(lockfile, {force: true});
				throw error;
			}
			this.writeState('starting');
			const cycle = async () => {
				if (!this.stopped) {
					try {
						await this.tick();
					}
					catch (error) {
						this.errors.runtime = error.message;
						this.writeState('error');
					}
					if (!this.stopped) {
						this.timer = setTimeout(cycle, 1500);
					}
				}
			};
			await cycle();
			r = true;
		}
		return r;
	}
	async dispose() {
		if (!this.stopped) {
			this.stopped = true;
			clearTimeout(this.timer);
			await Promise.allSettled([...this.connections.values()].filter(connection => connection.shell).map(async connection => {
				await connection.cdp.evaluate('window.__PROJECT_FOLDERS_VIEW__?.dispose();window.__PROJECT_FOLDERS_CLIENT__?.dispose?.();delete window.__FOLDERS_RUNTIME_VERSION__;delete window.__ANTIGRAVITY_TOOLS_BRIDGE_VERSION__;delete window.__ANTIGRAVITY_TOOLS_REQUEST__;delete window.__ANTIGRAVITY_TOOLS_RETRY__;delete window.__ANTIGRAVITY_TOOLS_DELIVER__;delete window.__ANTIGRAVITY_TOOLS_STATUS__;');
				const sheet = connection.sheets.get(':styles');
				if (sheet) {
					await connection.cdp.call('CSS.setStyleSheetText', {styleSheetId: sheet, text: ''});
				}
			}));
			for (const connection of this.connections.values()) {
				connection.cdp.close();
			}
			this.connections.clear();
			for (const runtime of this.modules.values()) {
				runtime.dispose?.();
			}
			this.modules.clear();
			this.writeState('stopped');
			fs.rmSync(path.join(this.root, 'instance.lock'), {force: true});
		}
	}
}
if (module === require.main) {
	const runtime = new Companion();
	runtime.start().catch(error => {
		console.error(error.stack);
		process.exitCode = 1;
	});
	process.on('SIGINT', () => runtime.dispose());
	process.on('SIGTERM', () => runtime.dispose());
}
module.exports = {Companion, stateRoot, bridgeSource, runtimeVersion};
