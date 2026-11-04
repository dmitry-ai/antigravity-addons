// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
// 2026-11-05 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement cross-profile auto-update guard (M-2) and unified main-process bootstrap for A0 and A6":
// https://github.com/dmitry-ai/antigravity-addons/issues/20
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {childEnvironment, prepareProfile} = require('./launcher');
const {readProfiles} = require('./profiles');
const {bootstrap} = require('./main-bootstrap');
const {installUpdateGuard, activeSiblingProfiles, isLockfileHeld} = require('./update-guard');
const fixture = context => {
	const parent = os.tmpdir();
	const r = fs.mkdtempSync(path.join(parent, 'antigravity-accounts-'));
	context.after(() => {
		assert.ok(path.resolve(r).startsWith(path.resolve(parent) + path.sep));
		fs.rmSync(r, {recursive: true, force: true});
	});
	return r;
};
// 2026-10-16 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Distinguish background agy-node.cmd sidecar (ELECTRON_RUN_AS_NODE=1) from GUI processes in Upg during Antigravity 2.24.0 upgrade":
// https://github.com/dmitry-ai/antigravity-addons/issues/7
test('Account environment isolates secondary Electron/Go home while keeping real USERPROFILE for A0', () => {
	const original = {USERPROFILE: 'real', APPDATA: 'roaming', LOCALAPPDATA: 'local', Path: 'tools', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require unwanted'};
	const result = childEnvironment({homeDir: 'isolated', id: 'A6'}, original);
	assert.equal(original.USERPROFILE, 'real');
	assert.equal(result.USERPROFILE, 'isolated');
	assert.equal(result.ANTIGRAVITY_ORIGINAL_USERPROFILE, 'real');
	assert.equal(result.APPDATA, 'roaming');
	assert.equal(result.LOCALAPPDATA, 'local');
	assert.equal(result.Path, 'tools');
	assert.equal(result.ELECTRON_RUN_AS_NODE, undefined);
	assert.equal(result.NODE_OPTIONS, undefined);
	const primary = childEnvironment({homeDir: 'unused-a0-home', id: 'A0'}, original);
	assert.equal(primary.USERPROFILE, 'real');
	assert.equal(primary.ANTIGRAVITY_ORIGINAL_USERPROFILE, 'real');
	assert.equal(primary.ANTIGRAVITY_ACCOUNT, 'A0');
	assert.equal(primary.ELECTRON_RUN_AS_NODE, undefined);
	assert.equal(primary.NODE_OPTIONS, undefined);
});
test('Shared skills stay at their source; existing account state and skill entries are preserved; A0 prepares logs without isolated home', context => {
	const root = fixture(context);
	const skillsRoot = path.join(root, 'skills');
	const homeDir = path.join(root, 'account/home');
	fs.mkdirSync(path.join(skillsRoot, 'upwork-init'), {recursive: true});
	fs.writeFileSync(path.join(skillsRoot, 'upwork-init/SKILL.md'), '---\nname: upwork-init\ndescription: test\n---\n');
	const profile = {id: 'A6', skillsRoot, homeDir, userDataDir: path.dirname(homeDir)};
	const config = path.join(homeDir, '.gemini/config');
	prepareProfile(profile);
	const filename = path.join(config, 'skills.json');
	assert.deepEqual(JSON.parse(fs.readFileSync(filename)), {entries: [{path: skillsRoot}]});
	fs.writeFileSync(path.join(config, 'auth-sentinel'), 'do not copy or overwrite');
	prepareProfile(profile);
	assert.equal(JSON.parse(fs.readFileSync(filename)).entries.length, 1);
	assert.equal(fs.readFileSync(path.join(config, 'auth-sentinel'), 'utf8'), 'do not copy or overwrite');
	assert.equal(fs.existsSync(path.join(config, 'skills/upwork-init')), false);
	const a0Dir = path.join(root, 'a0');
	prepareProfile({id: 'A0', skillsRoot, homeDir: path.join(a0Dir, 'home'), userDataDir: a0Dir});
	assert.equal(fs.existsSync(path.join(a0Dir, 'logs')), true);
	assert.equal(fs.existsSync(path.join(a0Dir, 'home/.gemini/config/skills.json')), false);
});
test('Unsafe and overlapping profile directories are rejected before launching', context => {
	const root = fixture(context);
	const filename = path.join(root, 'profiles.json');
	const base = {schemaVersion: 1, skillsRoot: root, profiles: [{id: 'A0', userData: 'Antigravity'}, {id: 'A6', userData: 'Antigravity-A6', email: 'admin6@mage2.pro', chromeShortcut: '6'}]};
	fs.writeFileSync(filename, JSON.stringify(base));
	assert.equal(readProfiles({roaming: root, filename}).length, 2);
	base.profiles[1].userData = '../Antigravity';
	fs.writeFileSync(filename, JSON.stringify(base));
	assert.throws(() => readProfiles({roaming: root, filename}), /profile/);
	base.profiles[1].userData = 'antigravity';
	fs.writeFileSync(filename, JSON.stringify(base));
	assert.throws(() => readProfiles({roaming: root, filename}), /profile/);
});
test('Browser routing preserves the OAuth state and callback while selecting the configured Chrome identity, and A0 bootstrap keeps native auth', async context => {
	const root = fixture(context);
	const events = {};
	const opened = [];
	const native = [];
	const paths = {};
	const app = {
		setPath: (key, value) => {
			paths[key] = value;
		},
		getPath: key => paths[key],
		setAppUserModelId: id => {
			paths.appId = id;
		},
		setAsDefaultProtocolClient: () => true,
		on: (event, handler) => {
			events[event] = handler;
		},
		removeListener: () => {}
	};
	const shell = {
		openExternal: async url => {
			native.push(url);
		}
	};
	const processes = {
		spawn: (executable, args, options) => {
			opened.push({executable, args, options});
			const r = {
				pid: 12345,
				on: () => r,
				once: (event, callback) => {
					if ('spawn' === event) {
						queueMicrotask(callback);
					}
					return r;
				},
				unref: () => {}
			};
			return r;
		}
	};
	const fakeRequire = name => 'electron' === name ? {app, shell} : 'node:os' === name ? {homedir: () => root} : 'node:child_process' === name ? processes : path.join(__dirname, 'oauth-bridge.js') === name ? {OAuthBridge: class {}} : path.join(__dirname, 'window-identity.js') === name ? {installWindowIdentity: () => {}} : require(name);
	bootstrap(fakeRequire, {id: 'A6', email: 'admin6@mage2.pro', homeDir: root, userDataDir: root, codeRoot: __dirname, chrome: {executable: 'chrome.exe', arguments: ['--profile-directory=Profile 8']}, browserEnvironment: {USERPROFILE: 'real'}});
	await shell.openExternal('https://accounts.google.com/o/oauth2/auth?state=exact-state&redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcallback');
	const url = new URL(opened[0].args.at(-1));
	assert.equal(url.searchParams.get('state'), 'exact-state');
	assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:1234/callback');
	assert.equal(url.searchParams.get('login_hint'), 'admin6@mage2.pro');
	assert.equal(opened[0].options.env.USERPROFILE, 'real');
	assert.equal(paths.appId, 'Google.Antigravity.A6');
	assert.equal(app.setAsDefaultProtocolClient('antigravity'), false);
	await shell.openExternal('mailto:example@example.org');
	assert.deepEqual(native, ['mailto:example@example.org']);
	assert.equal(globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__.tokenStorage, 'server-headless-file-store');
	assert.equal(globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__.updateGuard, true);
	processes.spawn('C:/installed/language_server.exe', ['--standalone', '--https_server_port', '0'], {env: {Path: 'tools'}});
	assert.ok(opened[1].args.includes('--headless'));
	assert.ok(opened[1].args.includes('--gemini_dir=' + path.join(root, '.gemini')));
	assert.equal(opened[1].options.env.USERPROFILE, root);
	assert.equal(opened[1].options.env.ANTIGRAVITY_VSCODE_HOST, '1');
	const a0Dir = path.join(root, 'a0-data');
	fs.mkdirSync(a0Dir, {recursive: true});
	const a0Result = bootstrap(fakeRequire, {id: 'A0', homeDir: path.join(a0Dir, 'home'), userDataDir: a0Dir, codeRoot: __dirname});
	assert.equal(a0Result.id, 'A0');
	assert.equal(a0Result.tokenStorage, 'native-credential-manager');
	assert.equal(a0Result.updateGuard, true);
	assert.equal(fs.existsSync(path.join(a0Dir, 'app_storage.json')), false);
	globalThis.__ANTIGRAVITY_UPDATE_GUARD__?.dispose();
	delete globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__;
	delete globalThis.__ANTIGRAVITY_OAUTH_BRIDGES__;
	delete globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__;
});
test('Cross-profile update guard blocks installation while sibling profile is active, preserves Ready state on transient errors, and installs when last profile quits', async context => {
	const root = fixture(context);
	const a0Dir = path.join(root, 'Antigravity');
	const a6Dir = path.join(root, 'Antigravity-A6');
	const pendingDir = path.join(root, 'pending');
	fs.mkdirSync(a0Dir, {recursive: true});
	fs.mkdirSync(a6Dir, {recursive: true});
	fs.mkdirSync(pendingDir, {recursive: true});
	const installerPath = path.join(pendingDir, 'Antigravity-x64.exe');
	fs.writeFileSync(installerPath, 'installer-binary');
	fs.writeFileSync(path.join(pendingDir, 'update-info.json'), JSON.stringify({fileName: 'Antigravity-x64.exe', isAdminRightsRequired: false}));
	const profiles = [
		{id: 'A0', userDataDir: a0Dir},
		{id: 'A6', userDataDir: a6Dir}
	];
	let a6Alive = true;
	fs.writeFileSync(path.join(a6Dir, 'main-runtime.json'), JSON.stringify({id: 'A6', pid: 66006, userDataDir: a6Dir}));
	assert.equal(isLockfileHeld(a6Dir, {openSync: () => { const err = Error('busy'); err.code = 'EBUSY'; throw err; }}), true);
	assert.equal(isLockfileHeld(a6Dir), false);
	const siblings = activeSiblingProfiles({id: 'A0', userDataDir: a0Dir}, {profiles, isPidAlive: pid => 66006 === pid && a6Alive});
	assert.equal(siblings.length, 1);
	assert.equal(siblings[0].id, 'A6');
	const app = new EventEmitter();
	app.getVersion = () => '2.29.0';
	const dialogs = [];
	const dialog = {
		showMessageBox: async (_win, box) => {
			dialogs.push(box || _win);
			return {response: 0};
		}
	};
	const menuItem = {label: 'Check for Updates', enabled: true};
	const Menu = {
		getApplicationMenu: () => ({
			getMenuItemById: id => 'check-for-updates' === id ? menuItem : null
		})
	};
	let lastState = {type: 'idle'};
	const updater = {
		MenuUpdateStep: {RestartToUpdate: 'Restart to Update'},
		getLastState: () => lastState,
		broadcastState: state => {
			lastState = state;
		}
	};
	const autoUpdater = new EventEmitter();
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.installerPath = installerPath;
	autoUpdater.quitAndInstallCalled = false;
	autoUpdater.quitHandlerAdded = false;
	let installCalls = 0;
	let quitAndInstallCalls = 0;
	autoUpdater.install = () => {
		installCalls++;
		autoUpdater.quitAndInstallCalled = true;
		return true;
	};
	autoUpdater.quitAndInstall = () => {
		quitAndInstallCalls++;
		autoUpdater.quitAndInstallCalled = true;
		return true;
	};
	const spawns = [];
	const mockCp = {
		spawn: (command, args, options) => {
			spawns.push({command, args, options});
			return {unref() {}};
		}
	};
	const fakeRequire = name => 'electron' === name ? {app, dialog, BrowserWindow: {getFocusedWindow: () => null, getAllWindows: () => []}, Menu} : 'electron-updater' === name ? {autoUpdater} : './updater' === name ? updater : null;
	const a0Guard = installUpdateGuard(fakeRequire, {id: 'A0', userDataDir: a0Dir}, {
		profiles,
		pendingDir,
		cp: mockCp,
		isPidAlive: pid => 66006 === pid && a6Alive
	});
	context.after(() => a0Guard.dispose());
	// 1. While running (not quitting), autoInstallOnAppQuit stays true so BaseUpdater.addQuitHandler() registers
	assert.equal(autoUpdater.autoInstallOnAppQuit, true);
	autoUpdater.emit('update-downloaded', {version: '2.30.0'});
	updater.broadcastState({type: 'ready', update: {version: '2.30.0'}});
	autoUpdater.quitHandlerAdded = true;
	assert.equal(fs.existsSync(path.join(pendingDir, 'deferred-update.json')), true);
	// 2. Transient network error on subsequent hourly check must not wipe out Ready state ("Restart to Update" blue pill)
	updater.broadcastState({type: 'idle'});
	menuItem.label = 'Check for Updates';
	autoUpdater.emit('error', Error('net::ERR_NAME_NOT_RESOLVED'));
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(lastState, {type: 'ready', update: {version: '2.30.0'}});
	assert.equal(menuItem.label, 'Restart to Update');
	// 3. Clicking "Restart to Update" (quitAndInstall) while A6 is open is blocked and informs the user
	assert.equal(autoUpdater.quitAndInstall(false, false), false);
	assert.equal(quitAndInstallCalls, 0);
	assert.equal(dialogs.length, 1);
	assert.match(dialogs[0].message, /A6/);
	// 4. Closing A0 while A6 is open evaluates autoInstallOnAppQuit as false and blocks install()
	app.emit('before-quit');
	assert.equal(autoUpdater.autoInstallOnAppQuit, false);
	assert.equal(autoUpdater.install(true, false), false);
	assert.equal(installCalls, 0);
	app.emit('quit', {}, 0);
	assert.equal(spawns.length, 0);
	a0Guard.dispose();
	// 5. When A6 later closes as the last active profile, A6 spawns the deferred update installer
	a6Alive = false;
	const a6App = new EventEmitter();
	a6App.getVersion = () => '2.29.0';
	const a6AutoUpdater = new EventEmitter();
	a6AutoUpdater.autoInstallOnAppQuit = true;
	a6AutoUpdater.quitAndInstallCalled = false;
	a6AutoUpdater.quitHandlerAdded = false;
	const a6Require = name => 'electron' === name ? {app: a6App} : 'electron-updater' === name ? {autoUpdater: a6AutoUpdater} : null;
	const a6Guard = installUpdateGuard(a6Require, {id: 'A6', userDataDir: a6Dir}, {
		profiles,
		pendingDir,
		cp: mockCp,
		isPidAlive: () => false
	});
	context.after(() => a6Guard.dispose());
	a6App.emit('before-quit');
	a6App.emit('quit', {}, 0);
	assert.equal(spawns.length, 1);
	assert.equal(spawns[0].command, installerPath);
	assert.deepEqual(spawns[0].args, ['--updated', '/S']);
	assert.equal(fs.existsSync(path.join(pendingDir, 'deferred-update.json')), false);
});
test('The native terminal OAuth bridge accepts only the matching state at the official callback and keeps stdin open', async () => {
	const {OAuthBridge, callbackCode} = require('./oauth-bridge');
	const child = new EventEmitter();
	const written = [];
	const opened = [];
	child.stdin = {
		end: () => {
			throw Error('would close the auth pipe');
		},
		write: value => written.push(value)
	};
	child.stderr = new EventEmitter();
	child.stdout = new EventEmitter();
	const pending = {redirect: new URL('https://antigravity.google/oauth-callback'), state: 'exact-pending-state'};
	const targets = [{type: 'page', url: 'https://antigravity.google/oauth-callback?state=wrong&code=unrelated'}, {type: 'page', url: 'https://other.example/oauth-callback?state=exact-pending-state&code=unrelated'}];
	assert.equal(callbackCode(targets, pending), null);
	targets.push({type: 'page', url: 'https://antigravity.google/oauth-callback?state=exact-pending-state&code=one-time-code'});
	assert.deepEqual(callbackCode(targets, pending), {code: 'one-time-code'});
	const bridge = new OAuthBridge({child, chromePort: 9222, open: async url => opened.push(url), request: async () => Response.json(targets)});
	child.stdin.end();
	assert.deepEqual(written, []);
	child.stdout.emit('data', 'Please visit:\n\x1b[34mhttps://accounts.google.com/o/oauth2/auth?state=exact-pending-state&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback');
	assert.deepEqual(opened, []);
	child.stdout.emit('data', '\x1b[0m\n');
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(opened.length, 1);
	assert.deepEqual(written, ['one-time-code\n']);
	assert.equal(bridge.pending, null);
	bridge.dispose();
});
test('The official callback can clear its address bar; the original navigation still must match A6 OAuth state', async context => {
	const {OAuthBridge} = require('./oauth-bridge');
	const {CDP} = require('../Upgrade/cdp-client');
	const child = new EventEmitter();
	const written = [];
	child.stdin = {end: () => {}, write: value => written.push(value)};
	child.stderr = new EventEmitter();
	let closed = 0;
	context.mock.method(CDP, 'open', async url => {
		assert.equal(url, 'ws://127.0.0.1:9222/own-callback');
		return {
			evaluate: async () => 'https://antigravity.google/oauth-callback?state=own-state&code=matching-code',
			close: () => {
				closed++;
			}
		};
	});
	const bridge = new OAuthBridge({
		child,
		chromePort: 9222,
		open: async () => {},
		request: async () => Response.json([{type: 'page', url: 'https://antigravity.google/oauth-callback', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/own-callback'}])
	});
	context.after(() => bridge.dispose());
	await bridge.start(new URL('https://accounts.google.com/o/oauth2/auth?state=own-state&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback'));
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(written, ['matching-code\n']);
	assert.equal(closed, 1);
});
test('Post-login recovery refuses A0 and never reloads an app or a draft', async context => {
	const {refreshInitialPage} = require('./oauth-bridge');
	const {CDP} = require('../Upgrade/cdp-client');
	const vm = require('node:vm');
	await assert.rejects(refreshInitialPage({id: 'A0', userDataDir: 'unused'}), /secondary profile/);
	const root = fixture(context);
	fs.writeFileSync(path.join(root, 'DevToolsActivePort'), '10006');
	const calls = [];
	context.mock.method(globalThis, 'fetch', async url => {
		assert.match(url, /^http:\/\/127\.0\.0\.1:10006\//);
		return Response.json(url.endsWith('/json/version') ? {'User-Agent': 'Antigravity/2.27.0'} : ['blank', 'app', 'draft'].map(id => ({id, type: 'page', url: 'https://127.0.0.1:20006/', webSocketDebuggerUrl: 'ws://127.0.0.1:10006/' + id})));
	});
	context.mock.method(CDP, 'open', async url => {
		const id = url.split('/').at(-1);
		return {
			evaluate: async expression => vm.runInNewContext(expression, {
				window: {__APP_CONFIG__: 'app' === id ? {} : undefined},
				document: {readyState: 'complete', body: {innerText: ''}, querySelectorAll: () => 'draft' === id ? [{value: 'user draft'}] : []}
			}),
			call: async method => calls.push({id, method}),
			close: () => {}
		};
	});
	await refreshInitialPage({id: 'A6', userDataDir: root});
	assert.deepEqual(calls, [{id: 'blank', method: 'Page.reload'}]);
});
