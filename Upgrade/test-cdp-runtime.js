// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {Companion, bridgeSource, runtimeVersion} = require('./cdp-companion');
const {CDP} = require('./cdp-client');
const fixture = context => {
	const parent = os.tmpdir();
	const r = fs.mkdtempSync(path.join(parent, 'antigravity-cdp-'));
	context.after(() => {
		assert.ok(path.resolve(r).startsWith(path.resolve(parent) + path.sep));
		fs.rmSync(r, {recursive: true, force: true});
	});
	return r;
};
class FakeCDP {
	constructor() {
		this.handlers = new Map();
		this.calls = [];
		this.expressions = [];
		this.closed = false;
	}
	on(name, handler) {
		this.handlers.set(name, handler);
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
	async evaluate(expression) {
		let r;
		this.expressions.push(expression);
		if (expression.startsWith('({product:')) {
			r = {product: 'Antigravity', csrf: 'string', ready: 'complete', origin: 'https://127.0.0.1:12345', appRoot: true, nativeStorage: 'function'};
		}
		return r;
	}
	close() {
		this.closed = true;
		this.handlers.get('close')?.();
	}
}
test('Adding a module or changing its declared Node files changes the supervisor version; editing data does not', context => {
	const root = fixture(context);
	const manifest = path.join(root, 'tool.json');
	const entry = path.join(root, 'cdp-runtime.js');
	const helper = path.join(root, 'helper.js');
	const data = path.join(root, 'data.json');
	fs.writeFileSync(manifest, '{"id":"fixture"}');
	fs.writeFileSync(entry, 'module.exports=()=>({})');
	fs.writeFileSync(helper, 'module.exports=1');
	fs.writeFileSync(data, '{}');
	const modules = [];
	context.mock.method(require('./registry'), 'discover', () => modules);
	const empty = runtimeVersion();
	modules.push({manifest, cdp: entry, runtimeFiles: [helper]});
	const added = runtimeVersion();
	assert.notEqual(added, empty);
	fs.writeFileSync(data, '{"newData":true}');
	assert.equal(runtimeVersion(), added);
	fs.writeFileSync(helper, 'module.exports=2');
	assert.notEqual(runtimeVersion(), added);
});
// 2026-10-12 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Verify native multi-window architecture (Ctrl+Shift+N) for concurrent project workflows under primary account A0":
// https://github.com/dmitry-ai/antigravity-addons/issues/5
test('CDP modules attach to eight independent shells and reinject after a native document replacement', async context => {
	const root = fixture(context);
	const runtime = new Companion({root});
	const sockets = [];
	context.mock.method(CDP, 'open', async () => {
		const r = new FakeCDP();
		sockets.push(r);
		return r;
	});
	runtime.modules.set('css', {styleSheet: () => '.native {color:red}'});
	runtime.modules.set('folders', {source: () => 'window.fixtureFolders=true', styleSheet: () => '.folder {color:blue}'});
	for (let index = 0; 8 > index; index++) {
		await runtime.attach({id: `window-${index}`, webSocketDebuggerUrl: 'fixture'});
	}
	assert.equal(runtime.connections.size, 8);
	for (const socket of sockets) {
		assert.equal(socket.calls.filter(call => 'CSS.createStyleSheet' === call.method).length, 1);
		assert.match(socket.calls.find(call => 'CSS.setStyleSheetText' === call.method).params.text, /native.*\n.*folder/);
		assert.equal(socket.calls.some(call => /reload|closeTarget|Browser.close|navigate/i.test(call.method)), false);
	}
	const connection = runtime.connections.get('window-0');
	const before = sockets[0].expressions.length;
	await runtime.bootstrap(connection);
	assert.equal(sockets[0].expressions.slice(before).some(value => value.includes('fixtureFolders=true')), false);
	sockets[0].handlers.get('Runtime.executionContextsCleared')();
	await runtime.bootstrap(connection);
	assert.equal(sockets[0].expressions.filter(value => value.includes('fixtureFolders=true')).length, 2);
	await runtime.dispose();
	assert.ok(sockets.every(socket => socket.closed));
});
test('Only the verified main execution context can call a module storage channel', async context => {
	const runtime = new Companion({root: fixture(context)});
	const cdp = new FakeCDP();
	let mutations = 0;
	runtime.modules.set('folders', {
		request: message => {
			mutations++;
			return {id: message.id};
		}
	});
	const connection = {cdp, shell: true, contextId: 7};
	await runtime.handleRequest(connection, {name: '__antigravityToolsCall', executionContextId: 55, payload: JSON.stringify({id: 1, tool: 'folders', message: {id: 'wrong-iframe'}})});
	assert.equal(mutations, 0);
	await runtime.handleRequest(connection, {name: '__antigravityToolsCall', executionContextId: 7, payload: JSON.stringify({id: 2, tool: 'folders', message: {id: 'exact-project-id'}})});
	assert.equal(mutations, 1);
	assert.match(cdp.expressions[0], /exact-project-id/);
	await runtime.handleRequest(connection, {name: '__antigravityToolsCall', executionContextId: 7, payload: JSON.stringify({id: 3, tool: 'unregistered', message: {}})});
	assert.match(cdp.expressions[1], /Unknown Tools storage channel/);
	assert.ok(bridgeSource.includes('15000'));
});
test('The runtime rereads the dynamic CDP port and reports a foreign application without attaching', async context => {
	const root = fixture(context);
	const roaming = path.join(root, 'roaming');
	fs.mkdirSync(path.join(roaming, 'Antigravity'), {recursive: true});
	const previous = process.env.APPDATA;
	process.env.APPDATA = roaming;
	context.after(() => {
		process.env.APPDATA = previous;
	});
	const filename = path.join(roaming, 'Antigravity/DevToolsActivePort');
	const runtime = new Companion({root});
	const requests = [];
	context.mock.method(globalThis, 'fetch', async url => {
		requests.push(url);
		return Response.json(url.endsWith('/json/version') ? {'User-Agent': 'Antigravity/2.27.0'} : []);
	});
	fs.writeFileSync(filename, '10001\nunused');
	await runtime.tick();
	fs.writeFileSync(filename, '10002\nunused');
	await runtime.tick();
	assert.ok(requests.some(url => url.includes(':10001/')));
	assert.ok(requests.some(url => url.includes(':10002/')));
	globalThis.fetch = async () => Response.json({'User-Agent': 'Codex/1.0'});
	await runtime.tick();
	assert.match(runtime.errors.A0, /not Antigravity/);
	assert.equal(runtime.connections.size, 0);
});
test('A deferred source is retried after a user dialog closes and failed attachments release their sockets', async context => {
	const runtime = new Companion({root: fixture(context)});
	const cdp = new FakeCDP();
	let deferred = true;
	const evaluate = cdp.evaluate.bind(cdp);
	cdp.evaluate = async source => source.includes('fixtureDeferred') ? {attached: !deferred, reason: 'user-dialog'} : evaluate(source);
	context.mock.method(CDP, 'open', async () => cdp);
	runtime.modules.set('folders', {source: () => 'fixtureDeferred'});
	const connection = await runtime.attach({id: 'dialog-window', webSocketDebuggerUrl: 'fixture'});
	assert.equal(connection.sources.has('folders'), false);
	deferred = false;
	await runtime.bootstrap(connection);
	assert.equal(connection.sources.has('folders'), true);
	await runtime.dispose();
	const broken = new FakeCDP();
	broken.call = async () => {
		throw Error('Window closed during attach');
	};
	CDP.open = async () => broken;
	await assert.rejects(runtime.attach({id: 'closed-window', webSocketDebuggerUrl: 'fixture'}), /Window closed/);
	assert.equal(broken.closed, true);
	assert.equal(runtime.connections.has('closed-window'), false);
});
test('Opening a native conversation route keeps the same CDP binding and storage connection', async context => {
	const runtime = new Companion({root: fixture(context)});
	const cdp = new FakeCDP();
	let url = 'https://127.0.0.1:12345/';
	const roaming = path.join(runtime.root, 'roaming');
	fs.mkdirSync(path.join(roaming, 'Antigravity'), {recursive: true});
	fs.writeFileSync(path.join(roaming, 'Antigravity/DevToolsActivePort'), '10001');
	const previous = process.env.APPDATA;
	process.env.APPDATA = roaming;
	context.after(() => {
		process.env.APPDATA = previous;
	});
	context.mock.method(CDP, 'open', async () => cdp);
	context.mock.method(globalThis, 'fetch', async endpoint => Response.json(endpoint.endsWith('/json/version') ? {'User-Agent': 'Antigravity/2.27.0', webSocketDebuggerUrl: 'ws://127.0.0.1:10001/browser'} : [{id: 'main', type: 'page', url, webSocketDebuggerUrl: 'ws://127.0.0.1:10001/main'}]));
	runtime.modules.set('folders', {source: () => 'window.testFolders=true'});
	await runtime.tick();
	const connection = runtime.connections.get('A0:main');
	assert.ok(connection?.shell);
	url = 'https://127.0.0.1:12345/c/existing-conversation?section=project';
	await runtime.tick();
	assert.equal(runtime.connections.get('A0:main'), connection);
	assert.equal(cdp.closed, false);
	assert.equal(cdp.calls.filter(call => 'Runtime.addBinding' === call.method).length, 1);
	await runtime.dispose();
});
test('Profiles with identical target IDs remain independent when one endpoint disappears or restarts', async context => {
	const root = fixture(context);
	const roaming = path.join(root, 'roaming');
	for (const [name, port] of [['Antigravity', '10001'], ['Antigravity-A6', '10006']]) {
		fs.mkdirSync(path.join(roaming, name), {recursive: true});
		fs.writeFileSync(path.join(roaming, name, 'DevToolsActivePort'), port);
	}
	const previous = process.env.APPDATA;
	process.env.APPDATA = roaming;
	context.after(() => {
		process.env.APPDATA = previous;
	});
	let offline = false;
	let generation = 1;
	context.mock.method(CDP, 'open', async () => new FakeCDP());
	context.mock.method(globalThis, 'fetch', async endpoint => {
		const port = new URL(endpoint).port;
		if ('10006' === port && offline) {
			throw Error('closed');
		}
		return Response.json(endpoint.endsWith('/json/version') ? {'User-Agent': 'Antigravity/2.27.0', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/browser/${generation}`} : [{id: 'same', type: 'page', url: 'https://127.0.0.1:12345/', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/same`}]);
	});
	const runtime = new Companion({root});
	await runtime.tick();
	assert.equal(runtime.connections.size, 2);
	const primary = runtime.connections.get('A0:same');
	const secondary = runtime.connections.get('A6:same');
	offline = true;
	await runtime.tick();
	assert.equal(runtime.connections.size, 1);
	assert.equal(runtime.connections.get('A0:same'), primary);
	assert.equal(primary.cdp.closed, false);
	assert.equal(secondary.cdp.closed, true);
	offline = false;
	await runtime.tick();
	assert.equal(runtime.connections.size, 2);
	assert.notEqual(runtime.connections.get('A6:same'), secondary);
	generation++;
	await runtime.tick();
	assert.equal(primary.cdp.closed, true);
	assert.equal(runtime.connections.size, 2);
	await runtime.dispose();
});
// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Add Project settings action to project context menu in Folders":
// https://github.com/dmitry-ai/antigravity-addons/issues/17
test('ensureRunning stops an outdated companion, launches via explorer.exe startup shortcut outside caller Job Object, and falls back when shell is absent', async context => {
	const root = fixture(context);
	const roaming = path.join(root, 'roaming');
	const sysRoot = path.join(root, 'Windows');
	const shortcut = path.join(roaming, 'Microsoft/Windows/Start Menu/Programs/Startup/Antigravity Tools (CDP).lnk');
	const explorer = path.join(sysRoot, 'explorer.exe');
	fs.mkdirSync(path.dirname(shortcut), {recursive: true});
	fs.mkdirSync(sysRoot, {recursive: true});
	fs.writeFileSync(shortcut, 'shortcut');
	fs.writeFileSync(explorer, 'explorer');
	const prevAppData = process.env.APPDATA;
	const prevSystemRoot = process.env.SystemRoot;
	process.env.APPDATA = roaming;
	process.env.SystemRoot = sysRoot;
	context.after(() => {
		process.env.APPDATA = prevAppData;
		process.env.SystemRoot = prevSystemRoot;
	});
	const cp = require('node:child_process');
	const control = require('./runtime-control');
	const expectedVersion = runtimeVersion();
	const expectedPath = path.join(__dirname, 'cdp-companion.js');
	fs.writeFileSync(path.join(root, 'runtime.json'), JSON.stringify({
		instance: 'stale-instance',
		version: 'old-version',
		pid: process.pid,
		runtimePath: expectedPath,
		state: 'connected',
		updated: new Date().toISOString()
	}));
	const spawns = [];
	let shellStartsCompanion = true;
	context.mock.method(cp, 'spawn', (command, args, options) => {
		spawns.push({command, args, options});
		if (command === explorer && shellStartsCompanion) {
			setImmediate(() => {
				fs.writeFileSync(path.join(root, 'runtime.json'), JSON.stringify({
					instance: 'shell-instance',
					version: expectedVersion,
					pid: process.pid,
					runtimePath: expectedPath,
					state: 'connected',
					updated: new Date().toISOString()
				}));
			});
		}
		else if (command === process.execPath) {
			setImmediate(() => {
				fs.writeFileSync(path.join(root, 'runtime.json'), JSON.stringify({
					instance: 'fallback-instance',
					version: expectedVersion,
					pid: process.pid,
					runtimePath: expectedPath,
					state: 'connected',
					updated: new Date().toISOString()
				}));
			});
		}
		return {unref() {}};
	});
	const watchControl = setInterval(() => {
		const controlFile = path.join(root, 'control.json');
		if (fs.existsSync(controlFile)) {
			const cmd = JSON.parse(fs.readFileSync(controlFile, 'utf8'));
			fs.unlinkSync(controlFile);
			if ('stale-instance' === cmd.instance && 'stop' === cmd.action) {
				fs.writeFileSync(path.join(root, 'runtime.json'), JSON.stringify({
					instance: 'stale-instance',
					version: 'old-version',
					pid: process.pid,
					runtimePath: expectedPath,
					state: 'stopped',
					updated: new Date().toISOString()
				}));
			}
		}
	}, 2);
	context.after(() => clearInterval(watchControl));
	const started = await control.ensureRunning({root, delay: 5});
	assert.equal(started.instance, 'shell-instance');
	assert.equal(spawns.length, 1, 'Shell launch via explorer.exe must succeed without spawning direct node.exe inside caller Job Object');
	assert.equal(spawns[0].command, explorer);
	assert.deepEqual(spawns[0].args, [shortcut]);
	spawns.length = 0;
	shellStartsCompanion = false;
	fs.unlinkSync(path.join(root, 'runtime.json'));
	const fallback = await control.ensureRunning({root, delay: 5});
	assert.equal(fallback.instance, 'fallback-instance');
	assert.equal(spawns.length, 2, 'Fallback to direct node.exe must run after shell launch attempts expire');
	assert.equal(spawns[0].command, explorer);
	assert.equal(spawns[1].command, process.execPath);
	assert.deepEqual(spawns[1].args, [expectedPath]);
});
test('Executing bridgeSource across a companion restart re-dispatches in-flight storage requests without a 15s timeout', async context => {
	const vm = require('node:vm');
	const root = fixture(context);
	const runtime = new Companion({root});
	runtime.modules.set('folders', {
		request: message => ({schemaVersion: 2, revision: 'rev-1', method: message.method, data: {folders: [], projectFolderMap: {}}})
	});
	let bindingOnline = false;
	const cdp = new FakeCDP();
	const win = {
		setTimeout,
		clearTimeout,
		__antigravityToolsCall: payload => {
			if (bindingOnline) {
				void runtime.handleRequest({cdp, shell: true, contextId: 7}, {
					name: '__antigravityToolsCall',
					executionContextId: 7,
					payload
				});
			}
		}
	};
	win.window = win;
	vm.createContext(win);
	cdp.evaluate = async expression => {
		let r;
		cdp.expressions.push(expression);
		if (expression.startsWith('({product:')) {
			r = {product: 'Antigravity', csrf: 'string', ready: 'complete', origin: 'https://127.0.0.1:12345', appRoot: true, nativeStorage: 'function'};
		}
		else {
			r = vm.runInContext(expression, win);
		}
		return r;
	};
	vm.runInContext(bridgeSource, win);
	const inflight = win.__ANTIGRAVITY_TOOLS_REQUEST__('folders', {method: 'GET'});
	bindingOnline = true;
	await runtime.bootstrap({
		id: 'A0:main',
		profileId: 'A0',
		email: 'user@example.com',
		frameId: 'main',
		contextId: 7,
		cdp,
		sources: new Map(),
		sheets: new Map(),
		shell: false,
		booting: false
	});
	const result = await inflight;
	assert.equal(result.revision, 'rev-1');
	assert.equal(result.method, 'GET');
	await runtime.dispose();
});
