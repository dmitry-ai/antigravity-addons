// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
// 2026-11-05 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement cross-profile auto-update guard (M-2) and unified main-process bootstrap for A0 and A6":
// https://github.com/dmitry-ai/antigravity-addons/issues/20
// 2026-11-10 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Fix main-process EPIPE crash on closed launcher stderr pipe, disable differential .blockmap requests, and preserve managed shortcuts and profile bootstrap across updates":
// https://github.com/dmitry-ai/antigravity-addons/issues/21
// 2026-11-10 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Support Electron BaseWindow + WebContentsView in Antigravity 2.30.0 for existing-window activation, taskbar badge identity, [A6] window title prefix, and update-guard focus lookup":
// https://github.com/dmitry-ai/antigravity-addons/issues/22
// 2026-11-10 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Fix main-process TypeError 'Object has been destroyed' on window close by capturing window id before closed event":
// https://github.com/dmitry-ai/antigravity-addons/issues/23
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace bootstrap.toString() injection with require, deduplicate Electron window hooks, split update-guard.js, and parameterize scripts from profiles.json":
// https://github.com/dmitry-ai/antigravity-addons/issues/26
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Extract UpdateGuard and DeferredUpdateStore ES6 classes from installUpdateGuard and applyUpdate in Multi-Account/update-guard.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/29
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Break Upgrade and Multi-Account circular dependency, replace bootstrap.toString() with require, and split update-guard.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/40
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Unify temporary directory fixtures and CDP/Electron/Connect-RPC test mocks across Upgrade, Multi-Account, and Folders":
// https://github.com/dmitry-ai/antigravity-addons/issues/37
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {MockBaseWindow, createElectronHarness, createTempDir} = require('../Upgrade/test-helpers');
const {activateExisting, buildBootstrapExpression, childEnvironment, prepareProfile} = require('./launcher');
const {readProfiles} = require('./profiles');
const {bootstrap} = require('./main-bootstrap');
const {UpdateGuard, UpdateRunner, installUpdateGuard, activeSiblingProfiles, isLockfileHeld, silenceBrokenStdio, applyUpdate, parseCliOptions} = require('./update-guard');
const fixture = context => createTempDir(context, 'antigravity-accounts-');
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
test('Broken launcher stderr/stdout pipes are silenced so console.error in electron-log never throws EPIPE', () => {
	const makeBrokenStream = () => {
		const stream = new EventEmitter();
		stream.write = () => {
			const err = Error('EPIPE: broken pipe, write');
			err.code = 'EPIPE';
			stream.emit('error', err);
			throw err;
		};
		return stream;
	};
	const fakeProc = {stderr: makeBrokenStream(), stdout: makeBrokenStream()};
	silenceBrokenStdio(fakeProc);
	let callbackCalled = false;
	assert.equal(fakeProc.stderr.write('Cannot download differentially', () => {
		callbackCalled = true;
	}), true);
	assert.equal(callbackCalled, true);
	assert.doesNotThrow(() => {
		const err = Error('EPIPE: broken pipe, write');
		err.code = 'EPIPE';
		fakeProc.stderr.emit('error', err);
		fakeProc.stdout.emit('error', err);
	});
});
test('Browser routing preserves the OAuth state and callback while selecting the configured Chrome identity, and A0 bootstrap keeps native auth', async context => {
	const root = fixture(context);
	const {app, fakeRequire, native, opened, paths, processes, shell} = createElectronHarness({codeRoot: __dirname, homedir: root});
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
test('Cross-profile update guard disables .blockmap requests, blocks installation across async before-quit while sibling profile is active, and runs post-update runner with shortcut repair and profile relaunch', async context => {
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
	const {app, autoUpdater, dialogs, fakeRequire, menuItem, processes: mockCp, spawns, state, updater} = createElectronHarness({installerPath});
	const a0Guard = installUpdateGuard(fakeRequire, {id: 'A0', userDataDir: a0Dir}, {
		profiles,
		pendingDir,
		cp: mockCp,
		pid: 50000,
		nodeExecutable: 'C:/tools/nodejs/node.exe',
		isPidAlive: pid => 66006 === pid && a6Alive
	});
	context.after(() => a0Guard.dispose());
	// 1. Differential .blockmap download and web installer are disabled; update-available transitions directly to downloading
	assert.equal(autoUpdater.disableDifferentialDownload, true);
	assert.equal(autoUpdater.disableWebInstaller, true);
	updater.broadcastState({type: 'available for download', update: {version: '2.30.0'}});
	autoUpdater.emit('update-available', {version: '2.30.0'});
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(state.lastState, {type: 'downloading'});
	// 2. Before update is downloaded, autoInstallOnAppQuit stays true so BaseUpdater.addQuitHandler() registers
	assert.equal(autoUpdater.autoInstallOnAppQuit, true);
	autoUpdater.emit('update-downloaded', {version: '2.30.0'});
	updater.broadcastState({type: 'ready', update: {version: '2.30.0'}});
	autoUpdater.quitHandlerAdded = true;
	assert.equal(fs.existsSync(path.join(pendingDir, 'deferred-update.json')), true);
	// 3. Transient network error on subsequent hourly check must not wipe out Ready state ("Restart to Update" blue pill)
	updater.broadcastState({type: 'idle'});
	menuItem.label = 'Check for Updates';
	autoUpdater.emit('error', Error('net::ERR_NAME_NOT_RESOLVED'));
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(state.lastState, {type: 'ready', update: {version: '2.30.0'}});
	assert.equal(menuItem.label, 'Restart to Update');
	// 4. Clicking "Restart to Update" (quitAndInstall) while A6 is open is blocked, restores Ready state from Updating, and informs the user
	updater.broadcastState({type: 'updating'});
	assert.equal(autoUpdater.quitAndInstall(false, false), false);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(state.lastState, {type: 'ready', update: {version: '2.30.0'}});
	assert.equal(state.quitAndInstallCalls, 0);
	assert.equal(dialogs.length, 1);
	assert.match(dialogs[0].message, /A6/);
	// 5. Closing A0 while A6 is open keeps autoInstallOnAppQuit false even across async before-quit ticks
	app.emit('before-quit');
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(autoUpdater.autoInstallOnAppQuit, false);
	assert.equal(autoUpdater.install(true, false), false);
	assert.equal(state.installCalls, 0);
	app.emit('quit', {}, 0);
	assert.equal(spawns.length, 0);
	// 6. When A6 closes, clicking "Restart to Update" in A0 spawns the external post-update runner with --relaunch=A0 and quits A0
	a6Alive = false;
	assert.equal(autoUpdater.quitAndInstall(false, false), true);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(state.appQuitCalls, 1);
	assert.equal(spawns.length, 1);
	assert.equal(spawns[0].command, 'C:/tools/nodejs/node.exe');
	const parsedRestartCli = parseCliOptions(spawns[0].args.slice(1));
	assert.equal(parsedRestartCli.applyUpdate, true);
	assert.equal(parsedRestartCli.installerPath, installerPath);
	assert.equal(parsedRestartCli.waitPid, 50000);
	assert.equal(parsedRestartCli.profileId, 'A0');
	assert.equal(parsedRestartCli.relaunchProfile, 'A0');
	// 7. Execute applyUpdate for the post-update runner: waits for exiting PID, runs silent installer, repairs shortcuts, and relaunches A0 via launcher.js
	let waitingPidAlive = true;
	setTimeout(() => {
		waitingPidAlive = false;
	}, 20);
	let shortcutsRepairedCount = 0;
	const relaunchedProfiles = [];
	const applyResult = await applyUpdate({
		...parsedRestartCli,
		profiles,
		cp: mockCp,
		isPidAlive: pid => 50000 === pid && waitingPidAlive,
		pollMs: 5,
		repairShortcuts: () => {
			shortcutsRepairedCount++;
			return true;
		},
		launchProfile: async id => {
			relaunchedProfiles.push(id);
		}
	});
	assert.equal(applyResult.status, 'installed');
	assert.equal(shortcutsRepairedCount, 1);
	assert.deepEqual(relaunchedProfiles, ['A0']);
	assert.equal(spawns.length, 2);
	assert.equal(spawns[1].command, installerPath);
	assert.deepEqual(spawns[1].args, ['--updated', '/S']);
	a0Guard.dispose();
	// 8. When A6 later closes as the last active profile with a deferred update, A6 spawns the post-update runner without relaunch
	fs.writeFileSync(path.join(pendingDir, 'deferred-update.json'), JSON.stringify({version: '2.30.0', fileName: 'Antigravity-x64.exe', installerPath, deferredBy: 'A0'}));
	const {app: a6App, fakeRequire: a6Require} = createElectronHarness();
	const a6Guard = installUpdateGuard(a6Require, {id: 'A6', userDataDir: a6Dir}, {profiles, pendingDir, cp: mockCp, pid: 66006, nodeExecutable: 'C:/tools/nodejs/node.exe', isPidAlive: () => false});
	context.after(() => a6Guard.dispose());
	a6App.emit('before-quit');
	a6App.emit('quit', {}, 0);
	assert.equal(spawns.length, 3);
	const parsedQuitCli = parseCliOptions(spawns[2].args.slice(1));
	assert.equal(parsedQuitCli.applyUpdate, true);
	assert.equal(parsedQuitCli.installerPath, installerPath);
	assert.equal(parsedQuitCli.waitPid, 66006);
	assert.equal(parsedQuitCli.profileId, 'A6');
	assert.equal(parsedQuitCli.relaunchProfile, undefined);
	assert.equal(fs.existsSync(path.join(pendingDir, 'deferred-update.json')), false);
});
test('activateExisting activates a running A0 window via DevToolsActivePort when main-runtime.json is absent, and rejects main-runtime activation when 0 windows are restored', async context => {
	const root = fixture(context);
	fs.writeFileSync(path.join(root, 'DevToolsActivePort'), '63972\n/devtools/browser/1234');
	const broughtToFront = [];
	const result = await activateExisting({id: 'A0', userDataDir: root}, {
		isLockfileHeld: () => true,
		fetch: async url => Response.json(url.endsWith('/json/version') ? {'User-Agent': 'Antigravity/2.30.0'} : [
			{type: 'page', url: 'https://127.0.0.1:63977/ cascade', webSocketDebuggerUrl: 'ws://127.0.0.1:63972/devtools/page/w1'}
		]),
		CDP: {
			open: async wsUrl => ({
				call: async method => {
					broughtToFront.push({wsUrl, method});
				},
				close: () => {}
			})
		}
	});
	assert.deepEqual(result, {id: 'A0', port: 63972, windows: 1});
	assert.deepEqual(broughtToFront, [{wsUrl: 'ws://127.0.0.1:63972/devtools/page/w1', method: 'Page.bringToFront'}]);
	const a6Dir = path.join(root, 'a6');
	fs.mkdirSync(a6Dir, {recursive: true});
	fs.writeFileSync(path.join(a6Dir, 'main-runtime.json'), JSON.stringify({id: 'A6', pid: 5472, inspector: 'ws://127.0.0.1:2884/73b4eb3c-066a-4c05-83c4-a249fe7ad5ef', userDataDir: a6Dir}));
	let activateWindows = 0;
	const zeroResult = await activateExisting({id: 'A6', userDataDir: a6Dir}, {
		CDP: {
			open: async () => ({
				evaluate: async expr => expr.includes('__ANTIGRAVITY_MANAGED_ACTIVATE__') ? {id: 'A6', pid: 5472, windows: activateWindows} : {pid: 5472, account: {id: 'A6', userDataDir: a6Dir, tokenStorage: 'server-headless-file-store'}},
				close: () => {}
			})
		}
	});
	assert.equal(zeroResult, null);
	activateWindows = 4;
	const fourResult = await activateExisting({id: 'A6', userDataDir: a6Dir}, {
		CDP: {
			open: async () => ({
				evaluate: async expr => expr.includes('__ANTIGRAVITY_MANAGED_ACTIVATE__') ? {id: 'A6', pid: 5472, windows: activateWindows} : {pid: 5472, account: {id: 'A6', userDataDir: a6Dir, tokenStorage: 'server-headless-file-store'}},
				close: () => {}
			})
		}
	});
	assert.deepEqual(fourResult, {id: 'A6', pid: 5472, windows: 4});
});
test('Antigravity 2.30.0 BaseWindow + WebContentsView windows receive A6 badge icon, taskbar AppUserModelId, [A6] title prefix, and foreground activation', async context => {
	const root = fixture(context);
	const desktop = path.join(root, 'Desktop');
	fs.mkdirSync(desktop, {recursive: true});
	const {app, baseWindows, fakeRequire, state} = createElectronHarness({
		codeRoot: __dirname,
		desktop,
		homedir: root,
		realModules: true,
		windows: [new MockBaseWindow(1, '50 - smokeday.com - U.P.2...', true)]
	});
	bootstrap(fakeRequire, {
		id: 'A6',
		email: 'admin6@mage2.pro',
		homeDir: root,
		userDataDir: root,
		codeRoot: __dirname,
		chrome: {executable: 'chrome.exe', arguments: ['--profile-directory=Profile 8'], debugPort: 9222},
		browserEnvironment: {USERPROFILE: 'real'}
	});
	context.after(() => {
		globalThis.__ANTIGRAVITY_WINDOW_IDENTITY__?.dispose();
		globalThis.__ANTIGRAVITY_UPDATE_GUARD__?.dispose();
		delete globalThis.__ANTIGRAVITY_WINDOW_IDENTITY__;
		delete globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__;
		delete globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__;
	});
	// Existing BaseWindow gets A6 icon, AppUserModelId, and [A6] title prefix, and preserves [A6] across dist/utils.js handleTitleUpdate setTitle calls
	assert.equal(baseWindows[0].appDetails?.appId, 'Google.Antigravity.A6');
	assert.match(baseWindows[0].appDetails?.relaunchCommand || '', /launch\.vbs" A6$/);
	assert.equal(app.listenerCount('browser-window-created'), 1);
	assert.equal(app.listenerCount('web-contents-created'), 2);
	assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'app_storage.json'), 'utf8')).autoCheckForUpdates, 'false');
	assert.equal(baseWindows[0].getTitle(), '[A6] 50 - smokeday.com - U.P.2...');
	baseWindows[0].setTitle('10 - Harness - Antigravit...');
	assert.equal(baseWindows[0].getTitle(), '[A6] 10 - Harness - Antigravit...');
	// Activating restores minimized BaseWindow and calls app.focus({steal: true})
	const activated = globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__();
	assert.equal(activated.windows, 1);
	assert.equal(baseWindows[0].isMinimized(), false);
	assert.equal(baseWindows[0].shown, true);
	assert.equal(baseWindows[0].focused, true);
	assert.deepEqual(state.focusOptions, {steal: true});
	// If 0 windows are open in a running process, __ANTIGRAVITY_MANAGED_ACTIVATE__ creates one via utils.showOrCreateWindow and applies A6 identity on web-contents-created
	baseWindows.length = 0;
	const createdActivation = globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__();
	assert.equal(state.showOrCreateCalls, 1);
	assert.equal(createdActivation.windows, 1);
	app.emit('web-contents-created', {}, baseWindows[0].webContents);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(baseWindows[0].appDetails?.appId, 'Google.Antigravity.A6');
	assert.equal(baseWindows[0].getTitle(), '[A6] Antigravity');
	assert.equal(globalThis.__ANTIGRAVITY_WINDOW_IDENTITY__.status().windows.length, 2);
	// Closing a BaseWindow cleans up applied registry without throwing 'Object has been destroyed' from win.id access
	const closingWindow = baseWindows[0];
	closingWindow.destroy();
	assert.throws(() => closingWindow.id, /Object has been destroyed/);
	assert.doesNotThrow(() => closingWindow.setTitle('Post destroy title update'));
	assert.equal(globalThis.__ANTIGRAVITY_WINDOW_IDENTITY__.status().windows.length, 1);
	assert.equal(globalThis.__ANTIGRAVITY_WINDOW_IDENTITY__.status().windows[0].id, 1);
	globalThis.__ANTIGRAVITY_WINDOW_IDENTITY__.dispose();
	globalThis.__ANTIGRAVITY_UPDATE_GUARD__.dispose();
	assert.equal(app.listenerCount('browser-window-created'), 0);
	assert.equal(app.listenerCount('web-contents-created'), 0);
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
test('Parameterized launch.vbs and installer scripts read profiles.json without per-account wrapper duplication', () => {
	assert.equal(fs.existsSync(path.join(__dirname, 'launch.vbs')), true);
	for (const legacy of ['launch_A0.vbs', 'launch_A6.vbs', 'launch.ps1']) {
		assert.equal(fs.existsSync(path.join(__dirname, legacy)), false);
	}
	const launchVbs = fs.readFileSync(path.join(__dirname, 'launch.vbs'), 'utf8');
	assert.match(launchVbs, /launcher\.js/);
	assert.doesNotMatch(launchVbs, /powershell\.exe/i);
	for (const script of ['build-icon.ps1', 'install.ps1']) {
		const source = fs.readFileSync(path.join(__dirname, script), 'utf8');
		assert.match(source, /profiles\.json/);
		assert.doesNotMatch(source, /launch_A0\.vbs|launch_A6\.vbs/);
	}
});
test('UpdateGuard and UpdateRunner classes isolate installer resolution, idempotent re-installation, and PID wait timeout', async context => {
	const root = fixture(context);
	const pendingDir = path.join(root, 'pending');
	fs.mkdirSync(pendingDir, {recursive: true});
	const installerPath = path.join(pendingDir, 'Antigravity-2.31.0.exe');
	fs.writeFileSync(installerPath, 'binary');
	fs.writeFileSync(path.join(pendingDir, 'update-info.json'), JSON.stringify({fileName: 'Antigravity-2.31.0.exe'}));
	const autoUpdater = new EventEmitter();
	autoUpdater.autoInstallOnAppQuit = true;
	const first = new UpdateGuard(() => null, {id: 'A0', userDataDir: root}, {autoUpdater, pendingDir, profiles: []}).install();
	const second = new UpdateGuard(() => null, {id: 'A0', userDataDir: root}, {autoUpdater, pendingDir, profiles: []}).install();
	assert.equal(globalThis.__ANTIGRAVITY_UPDATE_GUARD__, second);
	assert.deepEqual(second.resolveInstaller('2.31.0'), {installerPath, fileName: 'Antigravity-2.31.0.exe', version: '2.31.0'});
	second.dispose();
	assert.equal(Object.getOwnPropertyDescriptor(autoUpdater, 'autoInstallOnAppQuit')?.value, true);
	assert.equal(first.status().id, 'A0');
	const runner = new UpdateRunner({
		installerPath,
		pendingDir,
		profileId: 'A0',
		userDataDir: root,
		waitPid: 99999,
		waitTimeoutMs: 10,
		pollMs: 2,
		isPidAlive: () => true,
		profiles: []
	});
	const timedOut = await runner.run();
	assert.deepEqual(timedOut, {status: 'timeout', waitPid: 99999});
	assert.equal(JSON.parse(fs.readFileSync(path.join(pendingDir, 'deferred-update.json'), 'utf8')).deferredBy, 'A0');
});
test('launcher.js avoids bootstrap.toString and update-guard loading, executes buildBootstrapExpression in vm, and filters showDeferredDialog windows via allWindows', context => {
	const root = fixture(context);
	const launcherCode = fs.readFileSync(path.join(__dirname, 'launcher.js'), 'utf8').split(/\r?\n/).filter(line => !/^\s*\/\//.test(line)).join('\n');
	assert.equal(launcherCode.includes('bootstrap.toString'), false);
	const prodFiles = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && !name.endsWith('.test.js'));
	for (const name of prodFiles) {
		const lines = fs.readFileSync(path.join(__dirname, name), 'utf8').split(/\r?\n/);
		const count = '' === lines.at(-1) ? lines.length - 1 : lines.length;
		assert.ok(360 >= count, `Expected ${name} <= 360 lines, got ${count}`);
	}
	const loaded = JSON.parse(cp.execFileSync(process.execPath, ['-e', 'require(' + JSON.stringify(path.join(__dirname, 'launcher.js')) + '); console.log(JSON.stringify(Object.keys(require.cache)));'], {encoding: 'utf8', windowsHide: true}));
	for (const forbidden of ['update-guard.js', 'update-runner.js', 'main-bootstrap.js']) {
		assert.equal(loaded.some(item => item.endsWith(path.sep + forbidden)), false, `launcher.js should not load ${forbidden}`);
	}
	const {app, fakeRequire: vmRequire, paths} = createElectronHarness({codeRoot: __dirname, homedir: root});
	const vmResult = vm.runInNewContext(buildBootstrapExpression({
		id: 'A6', email: 'admin6@mage2.pro', homeDir: root, userDataDir: root, codeRoot: __dirname,
		chrome: {executable: 'chrome.exe', arguments: ['--profile-directory=Profile 8'], debugPort: 9222}, browserEnvironment: {USERPROFILE: 'real'}
	}), {require: vmRequire});
	context.after(() => {
		globalThis.__ANTIGRAVITY_UPDATE_GUARD__?.dispose();
		delete globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__;
		delete globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__;
	});
	assert.equal(vmResult.id, 'A6');
	assert.equal(vmResult.updateGuard, true);
	assert.equal(paths.appId, 'Google.Antigravity.A6');
	const dialogCalls = [];
	const destroyedWin = {isDestroyed: () => true};
	const popupWin = {__isWebviewPopupWindow: true, isDestroyed: () => false};
	const healthyWin = {isDestroyed: () => false};
	const dialogGuard = new UpdateGuard(name => 'electron' === name ? {
		app,
		BaseWindow: {getFocusedWindow: () => destroyedWin, getAllWindows: () => [popupWin, healthyWin]},
		BrowserWindow: {getFocusedWindow: () => popupWin, getAllWindows: () => []},
		dialog: {showMessageBox: (first, second) => dialogCalls.push({first, second})}
	} : null, {id: 'A0', userDataDir: root}, {pendingDir: path.join(root, 'pending'), profiles: []});
	dialogGuard.showDeferredDialog([{id: 'A6'}]);
	assert.equal(dialogCalls.length, 1);
	assert.equal(dialogCalls[0].first, healthyWin);
	assert.match(dialogCalls[0].second.message, /A6/);
});
