// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {Companion, bridgeSource, runtimeVersion} = require('./cdp-companion');
const {CDP} = require('./cdp-client');
const {FakeCDP, createTempDir, mockProfileEndpoints, withEnv} = require('./test-helpers');
// 2026-11-14
// "Unify temporary directory fixtures and CDP/Electron/Connect-RPC test mocks across Upgrade, Multi-Account, and Folders":
// https://github.com/dmitry-ai/antigravity-addons/issues/37
const fixture = context => createTempDir(context, 'antigravity-cdp-');
// 2026-10-28
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
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
	// 2026-11-14
	// "Fix GET_VIEW_STATE persistence, synchronize Folders revisions, throttle runtime.json writes, and exclude data from runtimeVersion()":
	// https://github.com/dmitry-ai/antigravity-addons/issues/38
	const readSpy = context.mock.method(fs, 'readFileSync');
	runtimeVersion();
	assert.equal(readSpy.mock.calls.some(call => String(call.arguments[0]).endsWith('profiles.json')), false);
	readSpy.mock.restore();
});
// 2026-10-12
// "Verify native multi-window architecture (Ctrl+Shift+N) for concurrent project workflows under primary account A0":
// https://github.com/dmitry-ai/antigravity-addons/issues/5
// 2026-10-28
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
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
// 2026-10-28
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
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
// 2026-10-28
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
// 2026-10-28
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
test('The runtime rereads the dynamic CDP port and reports a foreign application without attaching', async context => {
	const root = fixture(context);
	const roaming = mockProfileEndpoints(context, root, {Antigravity: null});
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
// 2026-10-28
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
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
// 2026-10-28
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
// 2026-10-28
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
test('Opening a native conversation route keeps the same CDP binding and storage connection', async context => {
	const runtime = new Companion({root: fixture(context)});
	const cdp = new FakeCDP();
	let url = 'https://127.0.0.1:12345/';
	mockProfileEndpoints(context, runtime.root);
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
// 2026-10-28
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
test('Profiles with identical target IDs remain independent when one endpoint disappears or restarts', async context => {
	const root = fixture(context);
	mockProfileEndpoints(context, root, {Antigravity: '10001', 'Antigravity-A6': '10006'});
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
// 2026-10-31
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
	withEnv(context, {APPDATA: roaming, SystemRoot: sysRoot});
	const cp = require('node:child_process');
	const control = require('./runtime-control');
	const expectedVersion = runtimeVersion();
	const expectedPath = path.join(__dirname, 'cdp-companion.js');
	const writeRuntime = (instance, version, state = 'connected') => fs.writeFileSync(path.join(root, 'runtime.json'), JSON.stringify({instance, version, pid: process.pid, runtimePath: expectedPath, state, updated: new Date().toISOString()}));
	writeRuntime('stale-instance', 'old-version');
	const spawns = [];
	let shellStartsCompanion = true;
	context.mock.method(cp, 'spawn', (command, args, options) => {
		spawns.push({command, args, options});
		if (command === explorer && shellStartsCompanion) {
			setImmediate(() => writeRuntime('shell-instance', expectedVersion));
		}
		else if (command === process.execPath) {
			setImmediate(() => writeRuntime('fallback-instance', expectedVersion));
		}
		return {unref() {}};
	});
	const watchControl = setInterval(() => {
		const controlFile = path.join(root, 'control.json');
		if (fs.existsSync(controlFile)) {
			const cmd = JSON.parse(fs.readFileSync(controlFile, 'utf8'));
			fs.unlinkSync(controlFile);
			if ('stale-instance' === cmd.instance && 'stop' === cmd.action) {
				writeRuntime('stale-instance', 'old-version', 'stopped');
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
// 2026-10-31
// "Add Project settings action to project context menu in Folders":
// https://github.com/dmitry-ai/antigravity-addons/issues/17
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
// 2026-11-13
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
test('Upgrade host files contain zero Folders imports or globals, skip idle tick re-evaluations until invalidated, and validate endpoint socket ports', async context => {
	const vm = require('node:vm');
	const {probeProfileEndpoint} = require('./profile-endpoints');
	const {buildInspectExpression} = require('./runtime-health');
	const upgradeFiles = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && !name.startsWith('test-'));
	for (const name of upgradeFiles) {
		const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
		assert.equal(/\.\.\/Folders\/|__PROJECT_FOLDERS_|__FOLDERS_/.test(source), false, `Unexpected Folders coupling in ${name}`);
		// 2026-11-14
		// "Break Upgrade and Multi-Account circular dependency, replace bootstrap.toString() with require, and split update-guard.js":
		// https://github.com/dmitry-ai/antigravity-addons/issues/40
		assert.equal(/\.\.\/Multi-Account\//.test(source), false, `Unexpected Multi-Account coupling in ${name}`);
	}
	assert.equal(require('./profiles').readProfiles, require('../Multi-Account/profiles').readProfiles);
	const root = fixture(context);
	const roaming = mockProfileEndpoints(context, root);
	const cdp = new FakeCDP();
	let styleReads = 0;
	let sourceReads = 0;
	context.mock.method(CDP, 'open', async () => cdp);
	context.mock.method(globalThis, 'fetch', async endpoint => Response.json(endpoint.endsWith('/json/version') ? {'User-Agent': 'Antigravity/2.30.0', webSocketDebuggerUrl: 'ws://127.0.0.1:10001/browser'} : [{id: 'main', type: 'page', url: 'https://127.0.0.1:12345/', webSocketDebuggerUrl: 'ws://127.0.0.1:10001/main'}]));
	const runtime = new Companion({root});
	runtime.modules.set('css', {
		styleSheet: () => {
			styleReads++;
			return '.compact{}';
		}
	});
	runtime.modules.set('folders', {
		disposeExpression: 'window.disposedFolders=true;',
		source: () => {
			sourceReads++;
			return '({attached:true})';
		}
	});
	await runtime.tick();
	assert.equal(styleReads, 1);
	assert.equal(sourceReads, 1);
	// 2026-11-14
	// "Fix GET_VIEW_STATE persistence, synchronize Folders revisions, throttle runtime.json writes, and exclude data from runtimeVersion()":
	// https://github.com/dmitry-ai/antigravity-addons/issues/38
	const firstStateRaw = fs.readFileSync(path.join(root, 'runtime.json'), 'utf8');
	const evaluationsAfterAttach = cdp.expressions.length;
	await new Promise(resolve => setTimeout(resolve, 15));
	await runtime.tick();
	assert.equal(styleReads, 1);
	assert.equal(sourceReads, 1);
	assert.equal(cdp.expressions.length, evaluationsAfterAttach);
	assert.equal(fs.readFileSync(path.join(root, 'runtime.json'), 'utf8'), firstStateRaw);
	runtime.lastStateWriteTime -= 10001;
	await runtime.tick();
	assert.notEqual(fs.readFileSync(path.join(root, 'runtime.json'), 'utf8'), firstStateRaw);
	runtime.invalidate();
	await runtime.tick();
	assert.equal(styleReads, 2);
	assert.equal(sourceReads, 2);
	await runtime.dispose();
	const mismatched = await probeProfileEndpoint({id: 'A6', userDataDir: path.join(roaming, 'Antigravity')}, {
		fetch: async endpoint => Response.json(endpoint.endsWith('/json/version') ? {'User-Agent': 'Antigravity/2.30.0'} : [{id: 'p1', type: 'page', url: 'https://127.0.0.1:12345/', webSocketDebuggerUrl: 'ws://127.0.0.1:19999/p1'}])
	});
	assert.equal(mismatched.state, 'error');
	assert.match(mismatched.error, /socket does not belong/);
	const inspectExpr = buildInspectExpression(['css', 'folders'], [{id: 'folders', expr: 'window.fakeInspect()'}]);
	const inspected = vm.runInNewContext(inspectExpr, {
		window: {
			__ANTIGRAVITY_TOOLS_STATUS__: {tools: ['css', 'folders'], pending: []},
			fakeInspect: () => ({state: 'ready', projects: 3})
		}
	});
	assert.equal(inspected.state, 'ready');
	assert.equal(inspected.projects, 3);
});
// 2026-11-19
// "Bridge Upgrade and OAuth renderer attach through main-process WebContents debugger":
// https://github.com/dmitry-ai/antigravity-addons/issues/52
test('Main-process WebContents debugger bridge discovers and attaches shells without DevToolsActivePort while readOnly health skips detach', async context => {
	const {EventEmitter} = require('node:events');
	const vm = require('node:vm');
	const {probeProfileEndpoint} = require('./profile-endpoints');
	const {installMainDebuggerBridge} = require('./main-debugger-bridge');
	const {inspectRuntime} = require('./runtime-health');
	const root = fixture(context);
	const roaming = mockProfileEndpoints(context, root, {Antigravity: null, 'Antigravity-A6': null});
	const a6Dir = path.join(roaming, 'Antigravity-A6');
	const inspectorUrl = 'ws://127.0.0.1:25517/00000000-0000-4000-8000-000000000006';
	fs.writeFileSync(path.join(a6Dir, 'main-runtime.json'), JSON.stringify({id: 'A6', pid: process.pid, inspector: inspectorUrl, userDataDir: a6Dir}));
	const pageWin = {
		window: null,
		document: {readyState: 'complete', querySelector: selector => '#root' === selector ? {} : null},
		__APP_CONFIG__: {productName: 'Antigravity', csrfToken: 'tok'},
		nativeStorage: {getItems: () => {}},
		location: {origin: 'https://127.0.0.1:25522'},
		setTimeout,
		clearTimeout
	};
	pageWin.window = pageWin;
	vm.createContext(pageWin);
	const dbg = new EventEmitter();
	let attached = false;
	let attachCount = 0;
	let detachCount = 0;
	let executeCalls = 0;
	let sheetText = '';
	Object.assign(dbg, {
		isAttached: () => attached,
		attach: version => {
			assert.equal(version, '1.3');
			attached = true;
			attachCount++;
		},
		// 2026-11-26 "Eliminate debugger bridge self-detach loop and emit detach in mock": https://github.com/dmitry-ai/antigravity-addons/issues/73
		detach: () => {
			if (attached) {
				attached = false;
				detachCount++;
				dbg.emit('detach', {}, 'replaced');
			}
		},
		sendCommand: async (method, params = {}) => {
			if ('Page.getFrameTree' === method) {
				return {frameTree: {frame: {id: 'main-frame'}}};
			}
			if ('Runtime.enable' === method) {
				queueMicrotask(() => dbg.emit('message', {}, 'Runtime.executionContextCreated', {context: {id: 7, auxData: {isDefault: true, frameId: 'main-frame'}}}));
				return {};
			}
			if ('Runtime.addBinding' === method) {
				pageWin[params.name] = payload => queueMicrotask(() => dbg.emit('message', {}, 'Runtime.bindingCalled', {name: params.name, payload, executionContextId: 7}));
				return {};
			}
			if ('CSS.createStyleSheet' === method) {
				return {styleSheetId: 'sheet-1'};
			}
			if ('CSS.setStyleSheetText' === method) {
				sheetText = params.text;
				return {};
			}
			if ('Runtime.evaluate' === method) {
				return {result: {value: vm.runInContext(params.expression, pageWin)}};
			}
			return {};
		}
	});
	const wc = {
		id: 1,
		getType: () => 'window',
		getURL: () => 'https://127.0.0.1:25522/c/test?project=p1',
		getTitle: () => 'Antigravity',
		isDestroyed: () => false,
		executeJavaScript: async expr => {
			executeCalls++;
			return vm.runInContext(expr, pageWin);
		},
		debugger: dbg,
		once: () => {}
	};
	const bridge = installMainDebuggerBridge({
		electron: {app: {getPath: () => a6Dir, getVersion: () => '2.33.0'}, BaseWindow: {getAllWindows: () => [{isDestroyed: () => false, webContents: wc}]}, BrowserWindow: {getAllWindows: () => []}, webContents: {getAllWebContents: () => [wc]}},
		utils: {getHubWindows: () => [{isDestroyed: () => false, webContents: wc}], getHubWebContents: w => w.webContents}
	});
	context.after(() => bridge.dispose());
	const makeInspectorSession = () => {
		const session = new EventEmitter();
		session.closed = false;
		session.close = () => {
			if (!session.closed) {
				session.closed = true;
				session.emit('close');
			}
		};
		session.call = async (method, params = {}) => {
			if ('Runtime.enable' === method) {
				return {};
			}
			if ('Runtime.addBinding' === method) {
				globalThis[params.name] = payload => session.emit('Runtime.bindingCalled', {name: params.name, payload});
				context.after(() => delete globalThis[params.name]);
				return {};
			}
			if ('Runtime.evaluate' === method) {
				return {result: {value: await eval(params.expression)}};
			}
			return {};
		};
		session.evaluate = async expr => eval(expr);
		return session;
	};
	context.mock.method(CDP, 'open', async url => {
		assert.equal(url, inspectorUrl);
		return makeInspectorSession();
	});
	const probed = await probeProfileEndpoint({id: 'A6', userDataDir: a6Dir});
	assert.equal(probed.state, 'available');
	assert.equal(probed.transport, 'main-debugger');
	assert.equal(probed.appVersion, '2.33.0');
	assert.equal(probed.pages.length, 1);
	const companion = new Companion({root});
	companion.modules.set('css', {styleSheet: () => '.sidebar{color:green}', inspectExpression: '({state:"ready"})'});
	companion.modules.set('folders', {
		request: msg => ({ok: msg.id}),
		inspectExpression: 'window.__FOLDERS_OK__?{state:"ready"}:{state:"missing"}',
		source: () => 'window.__FOLDERS_OK__=true;({attached:true})'
	});
	await companion.tick();
	const conn = companion.connections.get('A6:1');
	assert.equal(conn?.shell, true);
	assert.match(sheetText, /sidebar/);
	assert.equal(attachCount, 1);
	const rpcResult = await pageWin.__ANTIGRAVITY_TOOLS_REQUEST__('folders', {id: 'folder-rpc-1'});
	assert.equal(rpcResult.ok, 'folder-rpc-1');
	const healthToolsRoot = path.join(root, 'tools');
	fs.mkdirSync(path.join(healthToolsRoot, 'folders'), {recursive: true});
	fs.writeFileSync(path.join(healthToolsRoot, 'folders/tool.json'), JSON.stringify({id: 'folders', name: 'Folders', cdp: 'health-cdp.js'}));
	fs.writeFileSync(path.join(healthToolsRoot, 'folders/health-cdp.js'), 'module.exports=()=>({});module.exports.inspectExpression="({state:\\"ready\\"})";');
	context.mock.method(require('./registry'), 'discover', () => [
		{id: 'folders', cdp: path.join(healthToolsRoot, 'folders/health-cdp.js')}
	]);
	const health = await inspectRuntime({expectedTools: ['folders'], toolsRoot: healthToolsRoot});
	assert.equal(health.state, 'ready');
	assert.equal(health.windows[0].profile, 'A6');
	assert.ok(2 <= executeCalls);
	assert.equal(attachCount, 1);
	assert.equal(detachCount, 0);
	await companion.dispose();
	assert.equal(attached, false);
	assert.equal(detachCount, 1);
});
// 2026-11-19
// "Fail closed when active Antigravity profiles lack a reachable inspector endpoint":
// https://github.com/dmitry-ai/antigravity-addons/issues/53
test('Idle closed profiles report unavailable while active profiles without a reachable endpoint fail closed as error', async context => {
	const {probeProfileEndpoint} = require('./profile-endpoints');
	const {inspectRuntime} = require('./runtime-health');
	const {isLockfileHeld} = require('./process-io');
	const root = fixture(context);
	const roaming = mockProfileEndpoints(context, root, {Antigravity: null, 'Antigravity-A6': null});
	const a0Dir = path.join(roaming, 'Antigravity');
	const a6Dir = path.join(roaming, 'Antigravity-A6');
	const idle = await probeProfileEndpoint({id: 'A0', userDataDir: a0Dir}, {isLockfileHeld: () => false});
	assert.equal(idle.state, 'unavailable');
	assert.equal(idle.error, undefined);
	assert.equal(isLockfileHeld(a0Dir, {openSync: () => { throw Object.assign(Error('busy'), {code: 'EBUSY'}); }}), true);
	assert.equal(require('../Multi-Account/update-state').isLockfileHeld, isLockfileHeld);
	const lockedNoEndpoint = await probeProfileEndpoint({id: 'A0', userDataDir: a0Dir}, {isLockfileHeld: () => true});
	assert.equal(lockedNoEndpoint.state, 'error');
	assert.match(lockedNoEndpoint.error, /Active Antigravity profile A0 has no reachable inspector or CDP endpoint/);
	const staleInspectorUrl = 'ws://127.0.0.1:25599/00000000-0000-4000-8000-000000000099';
	fs.writeFileSync(path.join(a6Dir, 'main-runtime.json'), JSON.stringify({id: 'A6', pid: process.pid, inspector: staleInspectorUrl, userDataDir: a6Dir}));
	const livePidBrokenInspector = await probeProfileEndpoint({id: 'A6', userDataDir: a6Dir}, {
		isLockfileHeld: () => false,
		openInspector: async () => { throw Error('Inspector closed'); }
	});
	assert.equal(livePidBrokenInspector.state, 'error');
	assert.match(livePidBrokenInspector.error, /Inspector closed/);
	context.mock.method(CDP, 'open', async () => { throw Error('Inspector connection refused'); });
	const companion = new Companion({root});
	await companion.tick();
	assert.match(companion.errors.A6, /Inspector connection refused/);
	await companion.dispose();
	await assert.rejects(inspectRuntime({expectedTools: ['folders']}), /A6: Inspector connection refused/);
});
// 2026-11-20
// "Add real-process inspector disconnect and clean-exit regression tests":
// https://github.com/dmitry-ai/antigravity-addons/issues/58
test('Real --inspect-brk processes exit cleanly on target destruction and on app quit even with leaked inspector sockets, and v1 bridges hot-upgrade to v2', async context => {
	const cp = require('node:child_process');
	const {MainDebuggerClient} = require('./cdp-client');
	const {BRIDGE_GLOBAL, BRIDGE_VERSION, ensureRemoteBridge} = require('./main-debugger-bridge');
	const root = fixture(context);
	const bridgePath = path.join(__dirname, 'main-debugger-bridge.js');
	const hostScript = path.join(root, 'inspect-brk-host.js');
	fs.writeFileSync(hostScript, [
		"const {EventEmitter} = require('node:events');",
		`const {installMainDebuggerBridge} = require(${JSON.stringify(bridgePath)});`,
		'const app = new EventEmitter();',
		'app.getPath = () => process.cwd();',
		"app.getVersion = () => '2.33.0';",
		'const dbg = new EventEmitter();',
		'let attached = false;',
		'Object.assign(dbg, {isAttached: () => attached, attach: () => { attached = true; }, detach: () => { attached = false; }, sendCommand: async () => ({})});',
		'const wc = new EventEmitter();',
		"Object.assign(wc, {id: 1, getType: () => 'window', getURL: () => 'https://127.0.0.1:25522/', getTitle: () => 'Antigravity', isDestroyed: () => false, debugger: dbg});",
		'installMainDebuggerBridge({electron: {app, BaseWindow: {getAllWindows: () => [{isDestroyed: () => false, webContents: wc}]}, BrowserWindow: {getAllWindows: () => []}, webContents: {getAllWebContents: () => [wc]}}, utils: {getHubWindows: () => [{isDestroyed: () => false, webContents: wc}], getHubWebContents: w => w.webContents}});',
		'globalThis.__TEST_APP__ = app;',
		'globalThis.__TEST_WC__ = wc;',
		'const keepAlive = setInterval(() => {}, 60000);',
		'globalThis.__END_PROCESS__ = () => clearInterval(keepAlive);',
		"console.log('HOST_READY');"
	].join('\n'));
	const spawnHost = async () => {
		const child = cp.spawn(process.execPath, ['--inspect-brk=127.0.0.1:0', hostScript], {stdio: ['ignore', 'pipe', 'pipe']});
		let stdout = '';
		let stderr = '';
		let inspectorUrl = null;
		let exitInfo = null;
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', chunk => {
			stdout += chunk;
		});
		child.stderr.on('data', chunk => {
			stderr += chunk;
			inspectorUrl ||= stderr.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];
		});
		const exited = new Promise(resolve => child.once('exit', (code, signal) => {
			exitInfo = {code, signal};
			resolve(exitInfo);
		}));
		context.after(() => {
			if (!exitInfo) {
				child.kill();
			}
		});
		const deadline = Date.now() + 5000;
		while (!inspectorUrl && !exitInfo && Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 20));
		}
		assert.ok(inspectorUrl, `Inspector URL was not published: ${stderr}`);
		const boot = await CDP.open(inspectorUrl);
		try {
			const paused = new Promise(resolve => {
				const timer = setTimeout(() => resolve(false), 2000);
				boot.on('Debugger.paused', () => {
					clearTimeout(timer);
					resolve(true);
				});
			});
			await boot.call('Debugger.enable', {}, 2000);
			await boot.call('Runtime.runIfWaitingForDebugger', {}, 2000);
			if (await paused) {
				await boot.call('Debugger.resume', {}, 2000);
			}
			await boot.call('Debugger.disable', {}, 2000);
		}
		finally {
			boot.close();
		}
		const readyDeadline = Date.now() + 5000;
		while (!stdout.includes('HOST_READY') && !exitInfo && Date.now() < readyDeadline) {
			await new Promise(resolve => setTimeout(resolve, 20));
		}
		assert.match(stdout, /HOST_READY/);
		return {child, exited, getExitInfo: () => exitInfo, getStderr: () => stderr, inspectorUrl};
	};
	// 1. Target destruction closes the underlying real WebSocket inside MainDebuggerClient so the --inspect-brk child exits cleanly
	const host1 = await spawnHost();
	const client = await MainDebuggerClient.open({id: '1', mainInspectorUrl: host1.inspectorUrl}, {ownerKey: 'companion:A6:1'});
	context.after(() => client.close());
	let clientClosed = false;
	const closedNotice = new Promise(resolve => client.on('close', () => {
		clientClosed = true;
		resolve();
	}));
	await client.evalInspector('void setTimeout(() => { globalThis.__TEST_WC__.emit("destroyed"); setTimeout(() => globalThis.__END_PROCESS__(), 50); }, 20);');
	await Promise.race([closedNotice, new Promise((_, reject) => setTimeout(() => reject(Error('MainDebuggerClient did not emit close')), 3000))]);
	assert.equal(clientClosed, true);
	assert.equal(client.closed, true);
	assert.equal(client.inspector.closed, true);
	const exit1 = await Promise.race([host1.exited, new Promise(resolve => setTimeout(() => resolve(null), 4000))]);
	assert.deepEqual(exit1, {code: 0, signal: null}, `Child hung on exit: ${host1.getStderr()}`);
	// 2. Even with a deliberately leaked raw inspector WebSocket, app.emit('quit') invokes node:inspector.close() and exits cleanly
	const host2 = await spawnHost();
	const rogue = await CDP.open(host2.inspectorUrl);
	context.after(() => rogue.close());
	let rogueClosed = false;
	const rogueNotice = new Promise(resolve => rogue.on('close', () => {
		rogueClosed = true;
		resolve();
	}));
	await rogue.evaluate('void setTimeout(() => { globalThis.__TEST_APP__.emit("will-quit", {defaultPrevented: false}); globalThis.__TEST_APP__.emit("quit", {}, 0); globalThis.__END_PROCESS__(); }, 20);');
	await Promise.race([rogueNotice, new Promise((_, reject) => setTimeout(() => reject(Error('Rogue inspector socket was not forcibly disconnected on quit')), 3000))]);
	assert.equal(rogueClosed, true);
	const exit2 = await Promise.race([host2.exited, new Promise(resolve => setTimeout(() => resolve(null), 4000))]);
	assert.deepEqual(exit2, {code: 0, signal: null}, `Child hung with rogue client: ${host2.getStderr()}`);
	// 3. ensureRemoteBridge hot-upgrades a v1 bridge to v2 and disposes the superseded v1 instance
	let disposedV1 = 0;
	globalThis[BRIDGE_GLOBAL] = {version: 1, dispose: () => { disposedV1++; }};
	context.after(() => globalThis[BRIDGE_GLOBAL]?.dispose?.());
	const fakeInspector = {evaluate: async expr => eval(expr)};
	assert.equal(await ensureRemoteBridge(fakeInspector, {bridgePath}), true);
	assert.equal(disposedV1, 1);
	assert.equal(globalThis[BRIDGE_GLOBAL]?.version, BRIDGE_VERSION);
});
// 2026-11-26 "Eliminate debugger bridge self-detach loop and emit detach in mock": https://github.com/dmitry-ai/antigravity-addons/issues/73
test('Main debugger bridge recovers from ungraceful companion crash with detach-emitting mock and hot-upgrades v2 to v3', async context => {
	const {EventEmitter} = require('node:events');
	const {BRIDGE_GLOBAL, BRIDGE_VERSION, ensureRemoteBridge, installMainDebuggerBridge} = require('./main-debugger-bridge');
	const bridgePath = path.join(__dirname, 'main-debugger-bridge.js');
	assert.equal(BRIDGE_VERSION, 3);
	const dbg = new EventEmitter();
	let attached = false;
	let detachCount = 0;
	let sendCount = 0;
	Object.assign(dbg, {
		isAttached: () => attached,
		attach: () => {
			attached = true;
		},
		detach: () => {
			if (attached) {
				attached = false;
				detachCount++;
				dbg.emit('detach', {}, 'replaced');
			}
		},
		sendCommand: async method => {
			if (!attached) {
				throw Error('Not attached');
			}
			sendCount++;
			return {method, ok: true};
		}
	});
	const wc = new EventEmitter();
	Object.assign(wc, {id: 2, getType: () => 'window', getURL: () => 'https://127.0.0.1:3733/', getTitle: () => 'Antigravity', isDestroyed: () => false, debugger: dbg});
	const bridge = installMainDebuggerBridge({
		electron: {app: {getPath: () => __dirname, getVersion: () => '2.35.2'}, BaseWindow: {getAllWindows: () => [{isDestroyed: () => false, webContents: wc}]}, BrowserWindow: {getAllWindows: () => []}, webContents: {getAllWebContents: () => [wc]}},
		utils: {getHubWindows: () => [{isDestroyed: () => false, webContents: wc}], getHubWebContents: w => w.webContents}
	});
	context.after(() => bridge.dispose());
	bridge.attach('client-1', '2', '__b1', {ownerKey: 'companion:A0:2'});
	assert.deepEqual(await bridge.send('client-1', '2', 'Page.getFrameTree'), {method: 'Page.getFrameTree', ok: true});
	bridge.attach('client-2', '2', '__b2', {ownerKey: 'companion:A0:2'});
	assert.equal(attached, true);
	assert.equal(1 <= detachCount, true);
	assert.deepEqual(await bridge.send('client-2', '2', 'Page.getFrameTree'), {method: 'Page.getFrameTree', ok: true});
	bridge.detach('client-2', '2');
	assert.equal(attached, false);
	attached = true;
	bridge.attach('client-3', '2', '__b3', {ownerKey: 'companion:A0:2'});
	assert.equal(attached, true);
	assert.deepEqual(await bridge.send('client-3', '2', 'Runtime.enable'), {method: 'Runtime.enable', ok: true});
	assert.equal(sendCount, 3);
	bridge.dispose();
	let disposedV2 = 0;
	globalThis[BRIDGE_GLOBAL] = {version: 2, dispose: () => { disposedV2++; }};
	context.after(() => globalThis[BRIDGE_GLOBAL]?.dispose?.());
	assert.equal(await ensureRemoteBridge({evaluate: async expr => eval(expr)}, {bridgePath}), true);
	assert.equal(disposedV2, 1);
	assert.equal(globalThis[BRIDGE_GLOBAL]?.version, 3);
});
// 2026-11-26 "Isolate launcher test state and block worktree companion hijacking": https://github.com/dmitry-ai/antigravity-addons/issues/74
test('resolveStateRoot honors ANTIGRAVITY_TOOLS_STATE_DIR and runtime-control refuses linked worktree hijack without explicit isolation', async context => {
	const cp = require('node:child_process');
	const {resolveStateRoot} = require('./cdp-companion');
	const control = require('./runtime-control');
	const root = fixture(context);
	const roaming = path.join(root, 'roaming');
	const defaultToolsDir = path.join(roaming, 'AntigravityTools');
	const customState = path.join(root, 'custom-state');
	const fakeWt = path.join(root, 'wt-checkout/Upgrade');
	const fakeMain = path.join(root, 'main-checkout/Upgrade');
	fs.mkdirSync(defaultToolsDir, {recursive: true});
	fs.mkdirSync(fakeWt, {recursive: true});
	fs.mkdirSync(path.join(root, 'main-checkout/.git'), {recursive: true});
	fs.mkdirSync(fakeMain, {recursive: true});
	fs.writeFileSync(path.join(root, 'wt-checkout/.git'), 'gitdir: ../main-checkout/.git/worktrees/demo\n');
	assert.equal(resolveStateRoot({APPDATA: roaming, ANTIGRAVITY_TOOLS_STATE_DIR: customState}), path.resolve(customState));
	assert.equal(resolveStateRoot({APPDATA: roaming}), path.join(roaming, 'AntigravityTools'));
	assert.equal(control.isLinkedWorktree(fakeWt), true);
	assert.equal(control.isLinkedWorktree(fakeMain), false);
	const liveState = {instance: 'live-main', version: 'other-version', pid: process.pid, runtimePath: path.join(fakeMain, 'cdp-companion.js'), state: 'connected', updated: new Date().toISOString()};
	fs.writeFileSync(path.join(defaultToolsDir, 'runtime.json'), JSON.stringify(liveState));
	withEnv(context, {APPDATA: roaming, ANTIGRAVITY_TOOLS_STATE_DIR: undefined});
	const spawns = [];
	context.mock.method(cp, 'spawn', (command, args, options) => {
		spawns.push({command, args, options});
		setImmediate(() => fs.writeFileSync(path.join(customState, 'runtime.json'), JSON.stringify({instance: 'isolated-ok', version: runtimeVersion(), pid: process.pid, runtimePath: path.join(__dirname, 'cdp-companion.js'), state: 'connected', updated: new Date().toISOString()})));
		return {unref() {}};
	});
	await assert.rejects(control.ensureRunning({delay: 5, checkoutDir: fakeWt}), /linked Git worktree/i);
	await assert.rejects(control.stopRuntime({delay: 5, checkoutDir: fakeWt}), /linked Git worktree/i);
	assert.equal(fs.existsSync(path.join(defaultToolsDir, 'control.json')), false);
	assert.equal(spawns.length, 0);
	withEnv(context, {APPDATA: roaming, ANTIGRAVITY_TOOLS_STATE_DIR: customState});
	const started = await control.ensureRunning({delay: 5, checkoutDir: fakeWt});
	assert.equal(started.instance, 'isolated-ok');
	assert.equal(spawns.length, 1);
	assert.equal(spawns[0].options?.env?.ANTIGRAVITY_TOOLS_STATE_DIR, path.resolve(customState));
});
