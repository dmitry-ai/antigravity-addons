const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {Companion, bridgeSource, runtimeVersion} = require('./cdp-companion');
const {CDP} = require('./cdp-client');
const fixture = context => {
	const parent = path.join(__dirname, 'work'); fs.mkdirSync(parent, {recursive: true}); const root = fs.mkdtempSync(path.join(parent, 'cdp-runtime-'));
	context.after(() => {assert.ok(path.resolve(root).startsWith(path.resolve(parent) + path.sep)); fs.rmSync(root, {recursive: true, force: true});});
	return root;
};
class FakeCDP {
	constructor() {this.handlers = new Map(); this.calls = []; this.expressions = []; this.closed = false;}
	on(name, handler) {this.handlers.set(name, handler);}
	async call(method, params = {}) {
		this.calls.push({method, params});
		if (method === 'Page.getFrameTree') return {frameTree: {frame: {id: 'main'}}};
		if (method === 'Runtime.enable') this.handlers.get('Runtime.executionContextCreated')?.({context: {id: 7, auxData: {isDefault: true, frameId: 'main'}}});
		if (method === 'CSS.createStyleSheet') return {styleSheetId: 'owned-styles'};
		return {};
	}
	async evaluate(expression) {this.expressions.push(expression); if (expression.startsWith('({product:')) return {product: 'Antigravity', csrf: 'string', ready: 'complete', origin: 'https://127.0.0.1:12345'};}
	close() {this.closed = true; this.handlers.get('close')?.();}
}

test('Adding a module or changing its declared Node files changes the supervisor version; editing data does not', context => {
	const root = fixture(context), manifest = path.join(root,'tool.json'), entry = path.join(root,'cdp-runtime.js'), helper = path.join(root,'helper.js'), data = path.join(root,'data.json');
	fs.writeFileSync(manifest,'{"id":"fixture"}');fs.writeFileSync(entry,'module.exports=()=>({})');fs.writeFileSync(helper,'module.exports=1');fs.writeFileSync(data,'{}');
	const modules=[];context.mock.method(require('./registry'),'discover',()=>modules);
	const empty=runtimeVersion();modules.push({manifest,cdp:entry,runtimeFiles:[helper]});
	const added=runtimeVersion();assert.notEqual(added,empty);
	fs.writeFileSync(data,'{"newData":true}');assert.equal(runtimeVersion(),added);
	fs.writeFileSync(helper,'module.exports=2');assert.notEqual(runtimeVersion(),added);
});
test('CDP modules attach to eight independent shells and reinject after a native document replacement', async context => {
	const root = fixture(context), runtime = new Companion({root}), sockets = [];
	context.mock.method(CDP, 'open', async () => {const socket = new FakeCDP(); sockets.push(socket); return socket;});
	runtime.modules.set('css', {styleSheet: () => '.native {color:red}'});
	runtime.modules.set('folders', {source: () => 'window.fixtureFolders=true', styleSheet: () => '.folder {color:blue}'});
	for (let index = 0; index < 8; index++) await runtime.attach({id: `window-${index}`, webSocketDebuggerUrl: 'fixture'});
	assert.equal(runtime.connections.size, 8);
	for (const socket of sockets) {
		assert.equal(socket.calls.filter(call => call.method === 'CSS.createStyleSheet').length, 1);
		assert.match(socket.calls.find(call => call.method === 'CSS.setStyleSheetText').params.text, /native.*\n.*folder/);
		assert.equal(socket.calls.some(call => /reload|closeTarget|Browser.close|navigate/i.test(call.method)), false);
	}
	const connection = runtime.connections.get('window-0'), before = sockets[0].expressions.length;
	await runtime.bootstrap(connection); assert.equal(sockets[0].expressions.slice(before).some(value => value.includes('fixtureFolders=true')), false);
	sockets[0].handlers.get('Runtime.executionContextsCleared')();
	await runtime.bootstrap(connection); assert.equal(sockets[0].expressions.filter(value => value.includes('fixtureFolders=true')).length, 2);
	await runtime.dispose(); assert.ok(sockets.every(socket => socket.closed));
});
test('Only the verified main execution context can call a module storage channel', async context => {
	const runtime = new Companion({root: fixture(context)}), cdp = new FakeCDP(); let mutations = 0;
	runtime.modules.set('folders', {request: message => {mutations++; return {id: message.id};}});
	const connection = {cdp, shell: true, contextId: 7};
	await runtime.handleRequest(connection, {name: '__antigravityToolsCall', executionContextId: 55, payload: JSON.stringify({id: 1, tool: 'folders', message: {id: 'wrong-iframe'}})});
	assert.equal(mutations, 0);
	await runtime.handleRequest(connection, {name: '__antigravityToolsCall', executionContextId: 7, payload: JSON.stringify({id: 2, tool: 'folders', message: {id: 'exact-project-id'}})});
	assert.equal(mutations, 1); assert.match(cdp.expressions[0], /exact-project-id/);
	await runtime.handleRequest(connection, {name: '__antigravityToolsCall', executionContextId: 7, payload: JSON.stringify({id: 3, tool: 'unregistered', message: {}})});
	assert.match(cdp.expressions[1], /Unknown Tools storage channel/);
	assert.ok(bridgeSource.includes('15000'));
});
test('The runtime rereads the dynamic CDP port and never connects to a different application', async context => {
	const root = fixture(context), roaming = path.join(root, 'roaming'); fs.mkdirSync(path.join(roaming, 'Antigravity'), {recursive: true});
	const previous = process.env.APPDATA; process.env.APPDATA = roaming; context.after(() => {process.env.APPDATA = previous;});
	const filename = path.join(roaming, 'Antigravity/DevToolsActivePort');
	const runtime = new Companion({root}), requests = [];
	context.mock.method(globalThis, 'fetch', async url => {requests.push(url); return Response.json(url.endsWith('/json/version') ? {'User-Agent': 'Antigravity/2.27.0'} : []);});
	fs.writeFileSync(filename, '10001\nunused'); await runtime.tick();
	fs.writeFileSync(filename, '10002\nunused'); await runtime.tick();
	assert.ok(requests.some(url => url.includes(':10001/'))); assert.ok(requests.some(url => url.includes(':10002/')));
	globalThis.fetch = async () => Response.json({'User-Agent': 'Codex/1.0'});
	await assert.rejects(runtime.tick(), /not Antigravity/);
});

test('A deferred source is retried after a user dialog closes and failed attachments release their sockets', async context => {
	const runtime = new Companion({root: fixture(context)}), cdp = new FakeCDP(); let deferred = true;
	const evaluate = cdp.evaluate.bind(cdp);
	cdp.evaluate = async source => source.includes('fixtureDeferred') ? {attached: !deferred, reason: 'user-dialog'} : evaluate(source);
	context.mock.method(CDP, 'open', async () => cdp);
	runtime.modules.set('folders', {source: () => 'fixtureDeferred'});
	const connection = await runtime.attach({id:'dialog-window',webSocketDebuggerUrl:'fixture'});
	assert.equal(connection.sources.has('folders'), false);
	deferred = false; await runtime.bootstrap(connection);
	assert.equal(connection.sources.has('folders'), true);
	await runtime.dispose();
	const broken = new FakeCDP(); broken.call = async () => {throw Error('Window closed during attach');};
	CDP.open = async () => broken;
	await assert.rejects(runtime.attach({id:'closed-window',webSocketDebuggerUrl:'fixture'}), /Window closed/);
	assert.equal(broken.closed, true); assert.equal(runtime.connections.has('closed-window'), false);
});
