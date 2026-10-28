const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {CDP} = require('./cdp-client');
const registry = require('./registry');
const {isCandidateTarget, shellProbe, isShell} = require('./antigravity-shell');
const stateRoot = path.join(process.env.APPDATA || path.join(__dirname, 'state'), 'AntigravityTools');
const binding = '__antigravityToolsCall';
const runtimeVersion = () => {
	const core = ['cdp-companion.js', 'cdp-client.js', 'registry.js', 'antigravity-shell.js'].map(filename => path.join(__dirname, filename));
	const modules = registry.discover().flatMap(tool => [tool.manifest, tool.cdp, tool.prepare, ...(tool.runtimeFiles || [])].filter(Boolean));
	return crypto.createHash('sha256').update([...new Set([...core, ...modules])].map(filename => filename + '\n' + fs.readFileSync(filename, 'utf8')).join('\n')).digest('hex');
};
const bridgeSource = `(() => {
if(window.__ANTIGRAVITY_TOOLS_BRIDGE_VERSION__===1)return;
const pending=new Map();let sequence=0;
window.__ANTIGRAVITY_TOOLS_REQUEST__=(tool,message)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Tools storage did not respond; run Upg to reconnect'));},15000);pending.set(id,{resolve,reject,timer});window.${binding}(JSON.stringify({id,tool,message}));});
window.__ANTIGRAVITY_TOOLS_DELIVER__=reply=>{const request=pending.get(reply.id);if(!request)return;pending.delete(reply.id);clearTimeout(request.timer);reply.error?request.reject(Error(reply.error)):request.resolve(reply.result);};
window.__ANTIGRAVITY_TOOLS_BRIDGE_VERSION__=1;
})()`;
class Companion {
	constructor({root = stateRoot} = {}) {
		this.root = root; this.connections = new Map(); this.modules = new Map(); this.errors = {}; this.instance = crypto.randomUUID(); this.version = runtimeVersion(); this.stopped = false;
	}
	writeState(state, extra = {}) {
		const record = {schemaVersion: 1, instance: this.instance, version: this.version, pid: process.pid, runtimePath: __filename, state, updated: new Date().toISOString(), windows: this.connections.size, tools: [...this.modules.keys()], errors: this.errors, ...extra};
		const filename = path.join(this.root, 'runtime.json'), temporary = filename + '.tmp';
		fs.writeFileSync(temporary, JSON.stringify(record, null, 2)); fs.renameSync(temporary, filename);
	}
	async broadcast(source) { await Promise.allSettled([...this.connections.values()].filter(item => item.shell).map(item => item.cdp.evaluate(source))); }
	loadModules() {
		for (const tool of registry.discover()) {
			if (!tool.cdp) throw Error(`Tool ${tool.id} has no CDP runtime adapter`);
			const runtime = require(tool.cdp)({stateRoot: this.root, broadcast: source => this.broadcast(source), report: message => { if (message) this.errors[tool.id] = message; else delete this.errors[tool.id]; void this.broadcast(`window.__PROJECT_FOLDERS_VIEW__?.reportAction(${JSON.stringify(message)});`); }});
			this.modules.set(tool.id, runtime);
		}
	}
	async attach(target) {
		const cdp = await CDP.open(target.webSocketDebuggerUrl);
		const connection = {cdp, id: target.id, sources: new Map(), sheets: new Map(), shell: false, booting: false};
		this.connections.set(target.id, connection);
		try {
		const frame = await cdp.call('Page.getFrameTree'); connection.frameId = frame.frameTree.frame.id;
		cdp.on('close', () => { if (this.connections.get(target.id) === connection) this.connections.delete(target.id); delete this.errors[target.id]; });
		cdp.on('Runtime.executionContextCreated', ({context}) => { if (context.auxData?.isDefault && context.auxData?.frameId === connection.frameId) connection.contextId = context.id; });
		cdp.on('Runtime.executionContextsCleared', () => {connection.contextId = null; connection.sources.clear(); connection.sheets.clear(); connection.shell = false;});
		cdp.on('Page.frameNavigated', ({frame}) => { if (!frame.parentId) {connection.frameId = frame.id; connection.sources.clear(); connection.sheets.clear();} });
		cdp.on('Page.domContentEventFired', () => { void this.bootstrap(connection).catch(error => {this.errors[target.id] = error.message;}); });
		cdp.on('Runtime.bindingCalled', event => { void this.handleRequest(connection, event).catch(error => {this.errors[target.id] = error.message;}); });
		await cdp.call('Runtime.enable'); await cdp.call('Page.enable'); await cdp.call('DOM.enable'); await cdp.call('CSS.enable'); await cdp.call('Runtime.addBinding', {name: binding});
		await this.bootstrap(connection);
		return connection;
		} catch (error) {cdp.close(); if (this.connections.get(target.id) === connection) this.connections.delete(target.id); throw error;}
	}
	async handleRequest(connection, event) {
		if (event.name !== binding || event.executionContextId !== connection.contextId || !connection.shell) return;
		const request = JSON.parse(event.payload);
		if (!Number.isSafeInteger(request.id) || request.id <= 0 || typeof request.tool !== 'string') throw Error('Invalid Tools request envelope');
		const reply = {id: request.id};
		try { const runtime = this.modules.get(request.tool); if (!runtime?.request) throw Error('Unknown Tools storage channel'); reply.result = await runtime.request(request.message); }
		catch (error) {reply.error = error.message;}
		await connection.cdp.evaluate(`window.__ANTIGRAVITY_TOOLS_DELIVER__?.(${JSON.stringify(reply)})`);
	}
	async bootstrap(connection) {
		if (connection.booting || connection.cdp.closed) return;
		connection.booting = true;
		try {
			const info = await connection.cdp.evaluate(shellProbe);
			if (!isShell(info)) return;
			connection.shell = true;
			await connection.cdp.evaluate(bridgeSource);
			if (!this.modules.has('folders')) await connection.cdp.evaluate('window.__PROJECT_FOLDERS_VIEW__?.dispose();window.__PROJECT_FOLDERS_CLIENT__?.dispose?.();delete window.__FOLDERS_RUNTIME_VERSION__;');
			const styles = [...this.modules.values()].filter(runtime => runtime.styleSheet).map(runtime => runtime.styleSheet()).join('\n');
			const styleHash = crypto.createHash('sha256').update(styles).digest('hex');
			if (connection.sources.get(':styles') !== styleHash) {
				let sheet = connection.sheets.get(':styles');
				if (!sheet) { sheet = (await connection.cdp.call('CSS.createStyleSheet', {frameId: connection.frameId, force: true})).styleSheetId; connection.sheets.set(':styles', sheet); }
				await connection.cdp.call('CSS.setStyleSheetText', {styleSheetId: sheet, text: styles}); connection.sources.set(':styles', styleHash);
			}
			const pending = [];
			for (const [id, runtime] of this.modules) {
				if (runtime.source) {
					const source = runtime.source(), hash = crypto.createHash('sha256').update(source).digest('hex');
					if (connection.sources.get(id) !== hash) {const result = await connection.cdp.evaluate(`window.__ANTIGRAVITY_TOOLS_INSPECTOR_STYLES__=true;\n${source}`); if (result?.attached === false) pending.push({id, reason: result.reason}); else connection.sources.set(id, hash);}
				}
			}
			await connection.cdp.evaluate(`window.__ANTIGRAVITY_TOOLS_STATUS__=${JSON.stringify({architecture: 1, tools: [...this.modules.keys()], pending, stylesHash: styleHash})}`);
			delete this.errors[connection.id];
		} finally { connection.booting = false; }
	}
	async tick() {
		const controlFile = path.join(this.root, 'control.json');
		if (fs.existsSync(controlFile)) { const control = JSON.parse(fs.readFileSync(controlFile, 'utf8')); fs.unlinkSync(controlFile); if (control.instance === this.instance && control.action === 'stop') {await this.dispose(); return;} }
		const filename = path.join(process.env.APPDATA || '', 'Antigravity/DevToolsActivePort');
		if (!fs.existsSync(filename)) {this.writeState('waiting-for-antigravity'); return;}
		const port = Number(fs.readFileSync(filename, 'utf8').split(/\r?\n/)[0]);
		if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid current Antigravity CDP endpoint');
		let version, targets;
		try {version = await (await fetch(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(2000)})).json(); targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(2000)})).json();}
		catch {for (const connection of this.connections.values()) connection.cdp.close(); this.connections.clear(); this.writeState('waiting-for-antigravity'); return;}
		if (!/Antigravity\//.test(version['User-Agent'] || '')) throw Error('The CDP endpoint is not Antigravity');
		const endpoint = version.webSocketDebuggerUrl || `port:${port}`;
		if (this.endpoint !== endpoint) {for (const connection of this.connections.values()) connection.cdp.close(); this.connections.clear(); this.endpoint = endpoint;}
		const pages = targets.filter(isCandidateTarget);
		const current = new Set(pages.map(page => page.id));
		delete this.errors.runtime;
		for (const id of Object.keys(this.errors)) if (!current.has(id) && !this.modules.has(id)) delete this.errors[id];
		for (const [id, connection] of this.connections) if (!current.has(id)) {connection.cdp.close(); this.connections.delete(id);}
		await Promise.all(pages.map(async page => {
			try { const connection = this.connections.get(page.id); if (!connection || connection.cdp.closed) await this.attach(page); else await this.bootstrap(connection); }
			catch (error) {this.errors[page.id] = error.message;}
		}));
		this.writeState(Object.keys(this.errors).length ? 'error' : [...this.connections.values()].some(item => item.shell) ? 'connected' : 'waiting-for-shell', {appVersion: version['User-Agent']?.match(/Antigravity\/([^ ]+)/)?.[1]});
	}
	async start() {
		fs.mkdirSync(this.root, {recursive: true});
		const lockfile = path.join(this.root, 'instance.lock');
		if (fs.existsSync(lockfile)) {
			const previous = JSON.parse(fs.readFileSync(lockfile, 'utf8'));
			try {process.kill(previous.pid, 0); return false;} catch (error) {if (error.code !== 'ESRCH') throw error;}
			fs.rmSync(lockfile);
		}
		fs.writeFileSync(lockfile, JSON.stringify({pid: process.pid, instance: this.instance}), {flag: 'wx'});
		try {this.loadModules();} catch (error) {for (const runtime of this.modules.values()) runtime.dispose?.(); this.modules.clear(); this.errors.runtime = error.message; this.writeState('error'); fs.rmSync(lockfile, {force: true}); throw error;}
		this.writeState('starting');
		const cycle = async () => { if (this.stopped) return; try {await this.tick();} catch (error) {this.errors.runtime = error.message; this.writeState('error');} if (!this.stopped) this.timer = setTimeout(cycle, 1500); };
		await cycle(); return true;
	}
	async dispose() {
		if (this.stopped) return; this.stopped = true; clearTimeout(this.timer);
		await Promise.allSettled([...this.connections.values()].filter(connection => connection.shell).map(async connection => {
			await connection.cdp.evaluate('window.__PROJECT_FOLDERS_VIEW__?.dispose();window.__PROJECT_FOLDERS_CLIENT__?.dispose?.();delete window.__FOLDERS_RUNTIME_VERSION__;delete window.__ANTIGRAVITY_TOOLS_BRIDGE_VERSION__;delete window.__ANTIGRAVITY_TOOLS_REQUEST__;delete window.__ANTIGRAVITY_TOOLS_DELIVER__;delete window.__ANTIGRAVITY_TOOLS_STATUS__;');
			const sheet = connection.sheets.get(':styles'); if (sheet) await connection.cdp.call('CSS.setStyleSheetText', {styleSheetId: sheet, text: ''});
		}));
		for (const connection of this.connections.values()) connection.cdp.close(); this.connections.clear();
		for (const runtime of this.modules.values()) runtime.dispose?.(); this.modules.clear();
		this.writeState('stopped'); fs.rmSync(path.join(this.root, 'instance.lock'), {force: true});
	}
}
if (require.main === module) {
	const runtime = new Companion();
	runtime.start().catch(error => {console.error(error.stack); process.exitCode = 1;});
	process.on('SIGINT', () => runtime.dispose()); process.on('SIGTERM', () => runtime.dispose());
}
module.exports = {Companion, stateRoot, bridgeSource, runtimeVersion};
