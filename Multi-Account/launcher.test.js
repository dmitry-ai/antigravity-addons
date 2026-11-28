// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {MockBaseWindow, createElectronHarness, createTempDir} = require('../Upgrade/test-helpers');
const {activateExisting, buildBootstrapExpression, childEnvironment, prepareProfile, spawnOptions} = require('./launcher');
const {readProfiles} = require('./profiles');
const {bootstrap} = require('./main-bootstrap');
const {UpdateGuard, UpdateRunner, installUpdateGuard, activeSiblingProfiles, isLockfileHeld, silenceBrokenStdio, applyUpdate, parseCliOptions} = require('./update-guard');
// 2026-11-14
// "Unify temporary directory fixtures and CDP/Electron/Connect-RPC test mocks across Upgrade, Multi-Account, and Folders":
// https://github.com/dmitry-ai/antigravity-addons/issues/37
/**
 * @used-by {@link import('./launcher.test.js')}
 */
const fixture = context => createTempDir(context, 'antigravity-accounts-');
// 2026-10-16
// "Distinguish background agy-node.cmd sidecar (ELECTRON_RUN_AS_NODE=1) from GUI processes in Upg during Antigravity 2.24.0 upgrade":
// https://github.com/dmitry-ai/antigravity-addons/issues/7
// 2026-10-28
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
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
	// 2026-11-05
	// "Implement cross-profile auto-update guard (M-2) and unified main-process bootstrap for A0 and A6":
	// https://github.com/dmitry-ai/antigravity-addons/issues/20
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
// 2026-11-10
// "Fix main-process EPIPE crash on closed launcher stderr pipe, disable differential .blockmap requests, and preserve managed shortcuts and profile bootstrap across updates":
// https://github.com/dmitry-ai/antigravity-addons/issues/21
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
	globalThis.__ANTIGRAVITY_INITIAL_WINDOW__?.dispose();
	globalThis.__ANTIGRAVITY_UPDATE_GUARD__?.dispose();
	delete globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__;
	delete globalThis.__ANTIGRAVITY_OAUTH_BRIDGES__;
	delete globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__;
});
// 2026-11-05
// "Implement cross-profile auto-update guard (M-2) and unified main-process bootstrap for A0 and A6":
// https://github.com/dmitry-ai/antigravity-addons/issues/20
// 2026-11-10
// "Fix main-process EPIPE crash on closed launcher stderr pipe, disable differential .blockmap requests, and preserve managed shortcuts and profile bootstrap across updates":
// https://github.com/dmitry-ai/antigravity-addons/issues/21
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
// 2026-11-10
// "Fix main-process EPIPE crash on closed launcher stderr pipe, disable differential .blockmap requests, and preserve managed shortcuts and profile bootstrap across updates":
// https://github.com/dmitry-ai/antigravity-addons/issues/21
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
	// 2026-11-10
	// "Support Electron BaseWindow + WebContentsView in Antigravity 2.30.0 for existing-window activation, taskbar badge identity, [A6] window title prefix, and update-guard focus lookup":
	// https://github.com/dmitry-ai/antigravity-addons/issues/22
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
// 2026-11-10
// "Support Electron BaseWindow + WebContentsView in Antigravity 2.30.0 for existing-window activation, taskbar badge identity, [A6] window title prefix, and update-guard focus lookup":
// https://github.com/dmitry-ai/antigravity-addons/issues/22
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
	// 2026-11-10
	// "Fix main-process TypeError 'Object has been destroyed' on window close":
	// https://github.com/dmitry-ai/antigravity-addons/issues/23
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
	// 2026-10-30
	// "Extract Antigravity Addons into standalone code and meta (_) repositories, flatten tool directories, and prevent A6 working-directory locks":
	// https://github.com/dmitry-ai/antigravity-addons/issues/15
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
// 2026-11-14
// "Replace bootstrap.toString() injection with require, deduplicate Electron window hooks, split update-guard.js, and parameterize scripts from profiles.json":
// https://github.com/dmitry-ai/antigravity-addons/issues/26
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
// 2026-11-14
// "Extract UpdateGuard and DeferredUpdateStore ES6 classes from installUpdateGuard and applyUpdate in Multi-Account/update-guard.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/29
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
// 2026-11-14
// "Break Upgrade and Multi-Account circular dependency, replace bootstrap.toString() with require, and split update-guard.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/40
test('launcher.js avoids bootstrap.toString and update-guard loading, executes buildBootstrapExpression in vm, and filters showDeferredDialog windows via allWindows', context => {
	const root = fixture(context);
	const launcherCode = fs.readFileSync(path.join(__dirname, 'launcher.js'), 'utf8').split(/\r?\n/).filter(line => !/^\s*\/\//.test(line)).join('\n');
	assert.equal(launcherCode.includes('bootstrap.toString'), false);
	const prodFiles = fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && !name.endsWith('.test.js'));
	for (const name of prodFiles) {
		// 2026-11-26
		// "Adopt navigable JSDoc cross-reference annotations across Antigravity Addons":
		// https://github.com/dmitry-ai/antigravity-addons/issues/71
		const lines = fs.readFileSync(path.join(__dirname, name), 'utf8').replace(/^[ \t]*\/\*\*[\s\S]*?\*\/\r?\n?/gm, '').split(/\r?\n/);
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
		globalThis.__ANTIGRAVITY_INITIAL_WINDOW__?.dispose();
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
// 2026-11-18
// "Fix Desktop launcher starting Antigravity hidden in system tray without opening Hub window":
// https://github.com/dmitry-ai/antigravity-addons/issues/50
test('spawnOptions disables windowsHide and cold bootstrap reveals and focuses a hidden initial Hub window once', async context => {
	const root = fixture(context);
	const desktop = path.join(root, 'Desktop');
	fs.mkdirSync(desktop, {recursive: true});
	const executable = 'C:/Local/Programs/antigravity/Antigravity.exe';
	for (const profile of [{id: 'A0', homeDir: 'unused', userDataDir: 'C:/Roaming/Antigravity'}, {id: 'A6', homeDir: path.join(root, 'home'), userDataDir: root}]) {
		const opts = spawnOptions(executable, profile, {USERPROFILE: 'C:/Users/dfedi'});
		assert.equal(opts.windowsHide, false);
		assert.equal(opts.detached, true);
		assert.equal(opts.cwd, 'C:/Local/Programs/antigravity');
		assert.deepEqual(opts.stdio, ['ignore', 'ignore', 'pipe']);
	}
	const {app, baseWindows, fakeRequire, state} = createElectronHarness({codeRoot: __dirname, desktop, homedir: root, realModules: true});
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
		globalThis.__ANTIGRAVITY_INITIAL_WINDOW__?.dispose();
		globalThis.__ANTIGRAVITY_WINDOW_IDENTITY__?.dispose();
		globalThis.__ANTIGRAVITY_UPDATE_GUARD__?.dispose();
		delete globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__;
		delete globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__;
	});
	assert.ok(globalThis.__ANTIGRAVITY_INITIAL_WINDOW__);
	app.emit('web-contents-created', {}, {});
	await new Promise(resolve => setImmediate(resolve));
	assert.ok(globalThis.__ANTIGRAVITY_INITIAL_WINDOW__);
	assert.equal(state.focusOptions, null);
	const hiddenWin = new MockBaseWindow(1, 'Antigravity', false);
	hiddenWin.visible = false;
	hiddenWin.isVisible = () => hiddenWin.visible;
	hiddenWin.show = () => {
		hiddenWin.visible = true;
		hiddenWin.shown = true;
	};
	baseWindows.push(hiddenWin);
	app.emit('web-contents-created', {}, hiddenWin.webContents);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(hiddenWin.isVisible(), true);
	assert.equal(hiddenWin.shown, true);
	assert.equal(hiddenWin.focused, true);
	assert.deepEqual(state.focusOptions, {steal: true});
	assert.equal(globalThis.__ANTIGRAVITY_INITIAL_WINDOW__, undefined);
	globalThis.__ANTIGRAVITY_WINDOW_IDENTITY__.dispose();
	globalThis.__ANTIGRAVITY_UPDATE_GUARD__.dispose();
	assert.equal(app.listenerCount('web-contents-created'), 0);
});
// 2026-11-19
// "Bridge Upgrade and OAuth renderer attach through main-process WebContents debugger":
// https://github.com/dmitry-ai/antigravity-addons/issues/52
test('Protocol handler keeps A0 launch.vbs command, activateExisting forwards antigravity:// URLs, and in-process refreshInitialPage reloads empty targets', async context => {
	const root = fixture(context);
	const protocolCalls = [];
	const {app, baseWindows, fakeRequire} = createElectronHarness({codeRoot: __dirname, homedir: root, realModules: true, windows: [new MockBaseWindow(1, 'Antigravity', false)]});
	app.setAsDefaultProtocolClient = (scheme, execPath, args) => {
		protocolCalls.push({scheme, execPath, args});
		return true;
	};
	bootstrap(fakeRequire, {id: 'A0', homeDir: root, userDataDir: root, codeRoot: __dirname});
	context.after(() => {
		globalThis.__ANTIGRAVITY_MAIN_DEBUGGER_BRIDGE__?.dispose?.();
		globalThis.__ANTIGRAVITY_INITIAL_WINDOW__?.dispose?.();
		globalThis.__ANTIGRAVITY_WINDOW_IDENTITY__?.dispose?.();
		globalThis.__ANTIGRAVITY_UPDATE_GUARD__?.dispose?.();
		delete globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__;
		delete globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__;
	});
	const regA0 = app.setAsDefaultProtocolClient('antigravity');
	assert.equal(regA0, true);
	if ('win32' === process.platform) {
		assert.match(protocolCalls[0].execPath, /wscript\.exe$/i);
		assert.equal(protocolCalls[0].args[0], path.join(__dirname, 'launch.vbs'));
		assert.equal(protocolCalls[0].args[1], 'A0');
	}
	const secondInstances = [];
	const openUrls = [];
	app.on('second-instance', (_ev, argv) => secondInstances.push(argv));
	app.on('open-url', (_ev, url) => openUrls.push(url));
	const act = globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__(['antigravity://oauth?code=xyz']);
	assert.equal(act.windows, 1);
	assert.equal(secondInstances[0][1], 'antigravity://oauth?code=xyz');
	assert.deepEqual(openUrls, ['antigravity://oauth?code=xyz']);
	const reloaded = [];
	const blankWc = {
		id: 11,
		getType: () => 'window',
		getURL: () => 'https://127.0.0.1:25522/',
		getTitle: () => '',
		isDestroyed: () => false,
		executeJavaScript: async () => true,
		reload: () => reloaded.push('blank')
	};
	const loadedWc = {
		id: 12,
		getType: () => 'window',
		getURL: () => 'https://127.0.0.1:25522/',
		getTitle: () => 'App',
		isDestroyed: () => false,
		executeJavaScript: async () => false,
		reload: () => reloaded.push('loaded')
	};
	const oauthWindows = [{isDestroyed: () => false, webContents: blankWc}, {isDestroyed: () => false, webContents: loadedWc}];
	baseWindows.splice(0, baseWindows.length, ...oauthWindows);
	globalThis.__ANTIGRAVITY_MAIN_DEBUGGER_BRIDGE__?.dispose?.();
	const {refreshInitialPage} = require('./oauth-bridge');
	await refreshInitialPage({appRequire: name => 'electron' === name ? fakeRequire('electron') : './utils' === name ? {getHubWindows: () => oauthWindows, getHubWebContents: w => w.webContents} : null, delayMs: 0, id: 'A6', userDataDir: root});
	assert.deepEqual(reloaded, ['blank']);
	const launchVbs = fs.readFileSync(path.join(__dirname, 'launch.vbs'), 'utf8');
	assert.match(launchVbs, /WScript\.Arguments\.Count/);
	const installPs1 = fs.readFileSync(path.join(__dirname, 'install.ps1'), 'utf8');
	assert.match(installPs1, /Software\\Classes\\antigravity/);
});
// 2026-11-20
// "Add real-process inspector disconnect and clean-exit regression tests":
// https://github.com/dmitry-ai/antigravity-addons/issues/58
test('main-bootstrap respects prevented will-quit, cleans main-runtime.json, disposes bridge, and closes active inspector on quit', context => {
	const root = fixture(context);
	const {app, fakeRequire} = createElectronHarness({codeRoot: __dirname, homedir: root, realModules: true});
	let inspectorClosed = 0;
	const mockInspector = {
		url: () => 'ws://127.0.0.1:51337/00000000-0000-4000-8000-000000000001',
		close: () => {
			inspectorClosed++;
		}
	};
	bootstrap(fakeRequire, {
		id: 'A0',
		homeDir: root,
		userDataDir: root,
		codeRoot: __dirname,
		inspector: mockInspector.url(),
		inspectorModule: mockInspector
	});
	context.after(() => {
		globalThis.__ANTIGRAVITY_RUNTIME_SHUTDOWN__?.dispose?.();
		globalThis.__ANTIGRAVITY_MAIN_DEBUGGER_BRIDGE__?.dispose?.();
		globalThis.__ANTIGRAVITY_INITIAL_WINDOW__?.dispose?.();
		globalThis.__ANTIGRAVITY_WINDOW_IDENTITY__?.dispose?.();
		globalThis.__ANTIGRAVITY_UPDATE_GUARD__?.dispose?.();
		delete globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__;
		delete globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__;
	});
	const runtimeFile = path.join(root, 'main-runtime.json');
	assert.equal(fs.existsSync(runtimeFile), true);
	app.emit('will-quit', {defaultPrevented: true});
	assert.equal(fs.existsSync(runtimeFile), true);
	assert.equal(inspectorClosed, 0);
	assert.ok(globalThis.__ANTIGRAVITY_MAIN_DEBUGGER_BRIDGE__);
	app.emit('will-quit', {defaultPrevented: false});
	assert.equal(fs.existsSync(runtimeFile), false);
	assert.equal(inspectorClosed, 0);
	app.emit('quit', {}, 0);
	assert.equal(globalThis.__ANTIGRAVITY_MAIN_DEBUGGER_BRIDGE__, undefined);
	assert.equal(globalThis.__ANTIGRAVITY_RUNTIME_SHUTDOWN__, undefined);
	assert.ok(1 <= inspectorClosed);
});
// 2026-11-20
// "Resolve skillsRoot templates in Multi-Account profiles from Harness paths.json":
// https://github.com/dmitry-ai/antigravity-addons/issues/60
test('readProfiles resolves ${HARNESS_SKILLS_DIR} from Harness paths.json and rejects cyclic or unknown templates', context => {
	const {expandPathTemplate} = require('../Upgrade/profiles');
	const root = fixture(context);
	const skillsDir = path.join(root, '\u2c0f', '\u227b', '\u2655', '\u26ef', 'skills');
	fs.mkdirSync(path.join(skillsDir, 'upwork-init'), {recursive: true});
	fs.writeFileSync(path.join(skillsDir, 'upwork-init', 'SKILL.md'), '---\nname: upwork-init\ndescription: test\n---\n');
	const regFile = path.join(root, 'paths.json');
	fs.writeFileSync(regFile, JSON.stringify({
		version: 1,
		variables: {
			HARNESS_ROOT: root.replaceAll('\\', '/'),
			HARNESS_CODE: '${HARNESS_ROOT}/\u2c0f/\u227b/\u2655/\u26ef',
			HARNESS_SKILLS_DIR: '${HARNESS_CODE}/skills'
		}
	}));
	const cfgFile = path.join(root, 'profiles.json');
	const base = {
		schemaVersion: 1,
		skillsRoot: '${HARNESS_SKILLS_DIR}',
		profiles: [
			{id: 'A0', userData: 'Antigravity'},
			{id: 'A6', userData: 'Antigravity-A6', email: 'admin6@mage2.pro', chromeShortcut: '6'}
		]
	};
	fs.writeFileSync(cfgFile, JSON.stringify(base));
	const loaded = readProfiles({roaming: root, filename: cfgFile, pathsRegistry: regFile});
	assert.equal(path.resolve(loaded[1].skillsRoot), path.resolve(skillsDir));
	prepareProfile(loaded[1]);
	assert.equal(fs.existsSync(path.join(loaded[1].homeDir, '.gemini/config/skills.json')), true);
	// 2026-11-20
	// "Discover Ⰿ/≻/♕/⛯ Harness registry and ancestor project overlays in Upgrade/profiles.js":
	// https://github.com/dmitry-ai/antigravity-addons/issues/63
	const tree = path.join(root, 'sim-ai');
	const simHarnessReg = path.join(tree, 'harness', '\u2c0f', '\u227b', '\u2655', '\u26ef', 'paths.json');
	const simAddonsRoot = path.join(tree, 'products', 'Google', 'Antigravity', 'Addons');
	const simOverlay = path.join(simAddonsRoot, '\ua616', 'paths.json');
	const simProfilesFile = path.join(simAddonsRoot, '\u2c0f', '\u227b', '\u2655', '\u26ef', 'Multi-Account', 'profiles.json');
	fs.mkdirSync(path.dirname(simHarnessReg), {recursive: true});
	fs.mkdirSync(path.dirname(simOverlay), {recursive: true});
	fs.mkdirSync(path.dirname(simProfilesFile), {recursive: true});
	const customSkills = path.join(root, 'overlay-skills');
	fs.mkdirSync(customSkills, {recursive: true});
	fs.writeFileSync(simHarnessReg, JSON.stringify({version: 1, variables: {HARNESS_SKILLS_DIR: skillsDir.replaceAll('\\', '/')}}));
	fs.writeFileSync(simOverlay, JSON.stringify({version: 1, variables: {OVERLAY_SKILLS: customSkills.replaceAll('\\', '/')}}));
	fs.writeFileSync(simProfilesFile, JSON.stringify({...base, skillsRoot: '${OVERLAY_SKILLS}'}));
	const simLoaded = readProfiles({roaming: root, filename: simProfilesFile, env: {}});
	assert.equal(path.resolve(simLoaded[1].skillsRoot), path.resolve(customSkills));
	const liveProfiles = readProfiles({roaming: root});
	const liveA6 = liveProfiles.find(item => 'A6' === item.id);
	assert.ok(liveA6);
	assert.equal(fs.existsSync(liveA6.skillsRoot), true);
	assert.throws(() => expandPathTemplate('${A}', {A: '${B}', B: '${A}'}), /unresolved variable/);
	assert.throws(() => expandPathTemplate('${MISSING_VAR}', {}), /unresolved variable/);
	assert.throws(() => expandPathTemplate('C:/work/${UNCLOSED', {}), /unclosed variable/);
});
// 2026-11-20
// "Record pre-spawn profile preparation failures in Multi-Account launcher.log":
// https://github.com/dmitry-ai/antigravity-addons/issues/61
test('Pre-spawn profile preparation failures write ERROR to launcher.log and exit cleanly in a real launcher process', async context => {
	const {launch} = require('./launcher');
	const root = fixture(context);
	const missingSkills = path.join(root, 'missing-skills');
	const cfgFile = path.join(root, 'profiles.json');
	fs.writeFileSync(cfgFile, JSON.stringify({
		schemaVersion: 1,
		skillsRoot: missingSkills,
		profiles: [
			{id: 'A0', userData: 'Antigravity'},
			{id: 'A6', userData: 'Antigravity-A6', email: 'admin6@mage2.pro', chromeShortcut: '6'}
		]
	}));
	await assert.rejects(launch('A6', [], {
		roaming: root,
		profilesFile: cfgFile,
		readChrome: () => ({executable: 'chrome.exe', arguments: [], directory: 'Profile 8', userData: root, debugPort: 9222})
	}), /shared skills source is unavailable/);
	const logPath = path.join(root, 'Antigravity-A6', 'launcher.log');
	assert.equal(fs.existsSync(logPath), true);
	assert.match(fs.readFileSync(logPath, 'utf8'), /ERROR: The shared skills source is unavailable/);
	// 2026-11-26 "Isolate launcher test state and block worktree companion hijacking": https://github.com/dmitry-ai/antigravity-addons/issues/74
	const {runtimeVersion} = require('../Upgrade/cdp-companion');
	const realDir = path.join(root, 'real-roaming');
	const toolsState = path.join(root, 'tools-state');
	fs.mkdirSync(toolsState, {recursive: true});
	fs.writeFileSync(path.join(toolsState, 'runtime.json'), JSON.stringify({
		instance: 'test-isolated-instance',
		version: runtimeVersion(),
		pid: process.pid,
		runtimePath: path.resolve(__dirname, '../Upgrade/cdp-companion.js'),
		state: 'connected',
		updated: new Date().toISOString()
	}));
	const readLiveSnapshot = () => {
		const liveDir = process.env.APPDATA ? path.join(process.env.APPDATA, 'AntigravityTools') : '';
		const readPart = name => {
			let out = null;
			const target = liveDir ? path.join(liveDir, name) : '';
			if (target && fs.existsSync(target)) {
				try {
					const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
					out = {instance: parsed.instance ?? null, pid: parsed.pid ?? null, runtimePath: parsed.runtimePath ?? null, version: parsed.version ?? null};
				}
				catch {
					out = null;
				}
			}
			return out;
		};
		return {runtime: readPart('runtime.json'), lock: readPart('instance.lock')};
	};
	const beforeHost = readLiveSnapshot();
	const startedAt = Date.now();
	const child = cp.spawnSync(process.execPath, [path.join(__dirname, 'launcher.js'), 'A0'], {
		encoding: 'utf8',
		timeout: 10000,
		env: {
			...process.env,
			APPDATA: realDir,
			ANTIGRAVITY_TOOLS_STATE_DIR: toolsState,
			LOCALAPPDATA: path.join(root, 'missing-localappdata'),
			ANTIGRAVITY_ROAMING_DIR: realDir,
			ANTIGRAVITY_PROFILES_FILE: cfgFile
		}
	});
	const elapsedMs = Date.now() - startedAt;
	assert.equal(child.status, 1);
	assert.equal(5000 > elapsedMs, true, `Isolated launcher test took ${elapsedMs} ms`);
	assert.deepEqual(readLiveSnapshot(), beforeHost);
	const a0LogPath = path.join(realDir, 'Antigravity', 'launcher.log');
	assert.equal(fs.existsSync(a0LogPath), true);
	assert.match(fs.readFileSync(a0LogPath, 'utf8'), /ERROR: /);
	assert.doesNotMatch(fs.readFileSync(a0LogPath, 'utf8'), /WARNING: Addons runtime unavailable/);
});
// 2026-11-20
// "Write UTF-16 IShellLinkW shortcuts in Multi-Account and Upgrade PowerShell installers":
// https://github.com/dmitry-ai/antigravity-addons/issues/64
test('Save-UnicodeShortcut writes UTF-16 IShellLinkW .lnk files preserving Ⰿ/≻/♕/⛯ paths without ? corruption', {skip: 'win32' !== process.platform}, context => {
	const root = fixture(context);
	const uniDir = path.join(root, '\u2c0f', '\u227b', '\u2655', '\u26ef', 'Multi-Account');
	fs.mkdirSync(uniDir, {recursive: true});
	const vbsPath = path.join(uniDir, 'launch.vbs');
	fs.writeFileSync(vbsPath, '');
	const lnkPath = path.join(root, 'A6.lnk');
	const helperPath = path.resolve(__dirname, '../Upgrade/shortcut.ps1');
	const psExe = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
	const script = [
		'[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
		'. $env:TEST_SHORTCUT_HELPER',
		'Save-UnicodeShortcut -ShortcutPath $env:TEST_LNK -TargetPath "C:\\Windows\\System32\\wscript.exe" -Arguments (\'"\' + $env:TEST_VBS + \'" A6\') -WorkingDirectory $env:TEST_UNI_DIR -Description "Antigravity A6" -WindowStyle 7',
		'Read-UnicodeShortcut -ShortcutPath $env:TEST_LNK | ConvertTo-Json -Compress'
	].join('; ');
	const res = cp.spawnSync(psExe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
		encoding: 'utf8',
		timeout: 15000,
		env: {...process.env, TEST_SHORTCUT_HELPER: helperPath, TEST_LNK: lnkPath, TEST_VBS: vbsPath, TEST_UNI_DIR: uniDir}
	});
	assert.equal(res.status, 0, res.stderr);
	const parsed = JSON.parse(res.stdout.trim());
	assert.equal(parsed.Arguments, `"${vbsPath}" A6`);
	assert.equal(parsed.WorkingDirectory, uniDir);
	assert.equal(parsed.WindowStyle, 7);
	assert.equal(parsed.Arguments.includes('?'), false);
});
// 2026-11-21
// "Forward language_server stdin payload in OAuthBridge to fix A6 startup freeze in Antigravity 2.34.0":
// https://github.com/dmitry-ai/antigravity-addons/issues/65
test('OAuthBridge forwards host bridge stdin payload written via child.stdin.end in a real child process while keeping stdin open, and refreshInitialPage uses loadHubWindowUrl when available', async context => {
	const {OAuthBridge, refreshInitialPage} = require('./oauth-bridge');
	const root = fixture(context);
	const mockChild = new EventEmitter();
	const writeCalls = [];
	mockChild.stdin = {
		end: () => {
			throw Error('stdin must stay open');
		},
		write: (...args) => {
			writeCalls.push(args);
			const cb = args.find(arg => 'function' === typeof arg);
			cb?.();
			return true;
		}
	};
	mockChild.stderr = new EventEmitter();
	mockChild.stdout = new EventEmitter();
	const mockBridge = new OAuthBridge({child: mockChild, chromePort: 9222, open: async () => {}});
	context.after(() => mockBridge.dispose());
	let emptyEndCb = 0;
	let payloadEndCb = 0;
	assert.equal(mockChild.stdin.end(), mockChild.stdin);
	assert.equal(mockChild.stdin.end(() => {
		emptyEndCb++;
	}), mockChild.stdin);
	assert.equal(mockChild.stdin.end('host-token-1\n\n'), mockChild.stdin);
	assert.equal(mockChild.stdin.end('host-token-2\n\n', 'utf8', () => {
		payloadEndCb++;
	}), mockChild.stdin);
	assert.equal(emptyEndCb, 1);
	assert.equal(payloadEndCb, 1);
	assert.deepEqual(writeCalls.map(call => call.slice(0, 2).filter(item => 'function' !== typeof item)), [
		['host-token-1\n\n'],
		['host-token-2\n\n', 'utf8']
	]);
	const childScript = [
		"const readline = require('node:readline');",
		'const rl = readline.createInterface({input: process.stdin, crlfDelay: Infinity});',
		'const lines = [];',
		'let sawEof = false;',
		"rl.on('close', () => { sawEof = true; });",
		"rl.on('line', line => {",
		'  lines.push(line);',
		'  if (2 === lines.length) {',
		"    process.stdout.write('TOKEN:' + lines[0] + '\\n');",
		"    process.stdout.write('https://accounts.google.com/o/oauth2/auth?state=real-stdin-state&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback\\n');",
		'  } else if (3 === lines.length) {',
		"    process.stdout.write('CODE:' + line + ':EOF:' + sawEof + '\\n');",
		'    rl.close();',
		'    process.exit(0);',
		'  }',
		'});'
	].join('\n');
	const realChild = cp.spawn(process.execPath, ['-e', childScript], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
	context.after(() => {
		if (null === realChild.exitCode && !realChild.killed) {
			realChild.kill();
		}
	});
	let stdoutText = '';
	realChild.stdout.on('data', chunk => {
		stdoutText += chunk.toString('utf8');
	});
	const realBridge = new OAuthBridge({
		child: realChild,
		chromePort: 9222,
		open: async () => {},
		request: async () => Response.json([{type: 'page', url: 'https://antigravity.google/oauth-callback?state=real-stdin-state&code=live-oauth-code'}])
	});
	context.after(() => realBridge.dispose());
	realChild.stdin.end('bridge-secret-234\n\n');
	assert.equal(realChild.stdin.writableEnded, false);
	const exitCode = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(Error('Timed out waiting for real child process: ' + stdoutText)), 10000);
		realChild.once('exit', code => {
			clearTimeout(timer);
			resolve(code);
		});
	});
	assert.equal(exitCode, 0);
	assert.match(stdoutText, /TOKEN:bridge-secret-234/);
	assert.match(stdoutText, /CODE:live-oauth-code:EOF:false/);
	const loadedCalls = [];
	const reloadedCalls = [];
	const emptyWc = {
		id: 21,
		getType: () => 'window',
		getURL: () => 'https://127.0.0.1:51827/',
		getTitle: () => '',
		isDestroyed: () => false,
		executeJavaScript: async () => true,
		reload: () => reloadedCalls.push('empty')
	};
	const hubWin = {id: 1, isDestroyed: () => false, webContents: emptyWc};
	const {fakeRequire} = createElectronHarness({codeRoot: __dirname, homedir: root, realModules: true, windows: [hubWin]});
	globalThis.__ANTIGRAVITY_MAIN_DEBUGGER_BRIDGE__?.dispose?.();
	context.after(() => globalThis.__ANTIGRAVITY_MAIN_DEBUGGER_BRIDGE__?.dispose?.());
	await refreshInitialPage({
		appRequire: name => 'electron' === name ? fakeRequire('electron') : './utils' === name ? {
			getHubWindows: () => [hubWin],
			getHubWebContents: w => w.webContents,
			resolveHubWindowFromWebContents: wc => wc === emptyWc ? hubWin : null,
			loadHubWindowUrl: async (win, url) => loadedCalls.push({winId: win.id, url})
		} : null,
		delayMs: 0,
		id: 'A6',
		userDataDir: root
	});
	assert.deepEqual(loadedCalls, [{winId: 1, url: 'https://127.0.0.1:51827/'}]);
	assert.deepEqual(reloadedCalls, []);
});
// 2026-11-21
// "Launch Antigravity profiles even when the addons CDP runtime fails to start":
// https://github.com/dmitry-ai/antigravity-addons/issues/66
test('A failing addons CDP runtime is logged as a warning and does not abort the profile launch', async context => {
	const {launch} = require('./launcher');
	const root = fixture(context);
	const skillsRoot = path.join(root, 'skills');
	fs.mkdirSync(path.join(skillsRoot, 'upwork-init'), {recursive: true});
	fs.writeFileSync(path.join(skillsRoot, 'upwork-init', 'SKILL.md'), '---\nname: upwork-init\ndescription: test\n---\n');
	const cfgFile = path.join(root, 'profiles.json');
	fs.writeFileSync(cfgFile, JSON.stringify({
		schemaVersion: 1,
		skillsRoot,
		profiles: [
			{id: 'A0', userData: 'Antigravity'},
			{id: 'A6', userData: 'Antigravity-A6', email: 'admin6@mage2.pro', chromeShortcut: '6'}
		]
	}));
	let runtimeCalls = 0;
	const missingExe = path.join(root, 'missing', 'Antigravity.exe');
	await assert.rejects(launch('A6', [], {
		roaming: root,
		profilesFile: cfgFile,
		executable: missingExe,
		readChrome: () => ({executable: 'chrome.exe', arguments: [], directory: 'Profile 8', userData: root, debugPort: 9222}),
		ensureRuntime: async () => {
			runtimeCalls++;
			throw Error('CDP runtime did not start; inspect test-root');
		}
	}), /Antigravity is not installed at/);
	assert.equal(runtimeCalls, 1);
	const log = fs.readFileSync(path.join(root, 'Antigravity-A6', 'launcher.log'), 'utf8');
	assert.match(log, /WARNING: Addons runtime unavailable \(CDP runtime did not start; inspect test-root\); launching without addons/);
	assert.doesNotMatch(log, /ERROR: CDP runtime did not start/);
});
// 2026-11-28
// "Remove hardcoded A6 profile defaults from OAuthBridge and launchers":
// https://github.com/dmitry-ai/antigravity-addons/issues/76
test('OAuthBridge reports configured profileId dynamically, launchers require explicit profile arguments, and readChromeShortcut preserves --disable-features', async context => {
	const {OAuthBridge} = require('./oauth-bridge');
	const {readChromeShortcut} = require('./launcher');
	const makeMockChild = () => {
		const child = new EventEmitter();
		child.stdin = {destroyed: false, end: () => child.stdin, write: () => true};
		child.stderr = new EventEmitter();
		child.stdout = new EventEmitter();
		return child;
	};
	const mismatchLogs = [];
	const mismatchBridge = new OAuthBridge({
		child: makeMockChild(),
		chromePort: 9222,
		expectedEmail: 'admin5@mage2.pro',
		profileId: 'A5',
		open: async () => {},
		report: msg => mismatchLogs.push(msg)
	});
	context.after(() => mismatchBridge.dispose());
	mismatchBridge.consume('Headless auth: authenticated as "wrong@example.com"\n');
	assert.equal(mismatchLogs[0], 'The signed-in account differs from the configured A5 email');
	const refreshLogs = [];
	const refreshBridge = new OAuthBridge({
		child: makeMockChild(),
		chromePort: 9222,
		expectedEmail: 'admin5@mage2.pro',
		profileId: 'A5',
		open: async () => {},
		onAuthenticated: async () => {
			throw Error('refresh boom');
		},
		report: msg => refreshLogs.push(msg)
	});
	context.after(() => refreshBridge.dispose());
	refreshBridge.consume('Headless auth: authenticated as "admin5@mage2.pro"\n');
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(refreshLogs[0], 'The A5 window could not refresh after sign-in');
	const timeoutLogs = [];
	const timeoutBridge = new OAuthBridge({
		child: makeMockChild(),
		chromePort: 9222,
		profileId: 'A5',
		open: async () => {},
		report: msg => timeoutLogs.push(msg)
	});
	context.after(() => timeoutBridge.dispose());
	timeoutBridge.pending = {deadline: Date.now() - 1, redirect: new URL('https://antigravity.google/oauth-callback'), state: 'expired'};
	await timeoutBridge.poll();
	assert.equal(timeoutLogs[0], 'Google sign-in timed out; retry in A5');
	const noArgLauncher = cp.spawnSync(process.execPath, [path.join(__dirname, 'launcher.js')], {encoding: 'utf8', timeout: 10000});
	assert.equal(noArgLauncher.status, 1);
	assert.match(noArgLauncher.stderr, /Profile ID argument is required/i);
	if ('win32' === process.platform) {
		const cscript = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/cscript.exe');
		const noArgVbs = cp.spawnSync(cscript, ['//Nologo', path.join(__dirname, 'launch.vbs')], {encoding: 'utf8', timeout: 10000});
		assert.notEqual(noArgVbs.status, 0);
		assert.match(noArgVbs.stderr + noArgVbs.stdout, /profile argument is required/i);
	}
	const root = fixture(context);
	const chromeExe = path.join(root, 'chrome.exe');
	const chromeData = path.join(root, 'ChromeU');
	fs.writeFileSync(chromeExe, '');
	fs.mkdirSync(chromeData, {recursive: true});
	fs.writeFileSync(path.join(chromeData, 'Local State'), JSON.stringify({
		profile: {info_cache: {'Profile 7': {user_name: 'admin5@mage2.pro'}}}
	}));
	const parsedWithFeatures = readChromeShortcut(
		{id: 'A5', email: 'admin5@mage2.pro', chromeShortcut: '5'},
		{readShortcut: () => ({executable: chromeExe, command: `--disable-features=ExtensionManifestV2Unsupported,ExtensionManifestV2Disabled --profile-directory="Profile 7" --remote-debugging-port=9222 --user-data-dir="${chromeData}"`})}
	);
	assert.equal(parsedWithFeatures.directory, 'Profile 7');
	assert.ok(parsedWithFeatures.arguments.includes('--disable-features=ExtensionManifestV2Unsupported,ExtensionManifestV2Disabled'));
	const parsedDefaultFeatures = readChromeShortcut(
		{id: 'A5', email: 'admin5@mage2.pro', chromeShortcut: '5'},
		{readShortcut: () => ({executable: chromeExe, command: `--profile-directory="Profile 7" --remote-debugging-port=9222 --user-data-dir="${chromeData}"`})}
	);
	assert.ok(parsedDefaultFeatures.arguments.includes('--disable-features=ExtensionManifestV2Unsupported,ExtensionManifestV2Disabled'));
	const bridgeOpts = [];
	const {fakeRequire, processes} = createElectronHarness({
		codeRoot: __dirname,
		homedir: root,
		overrides: {
			[path.join(__dirname, 'oauth-bridge.js')]: {
				OAuthBridge: class {
					constructor(opts) {
						bridgeOpts.push(opts);
					}
				},
				refreshInitialPage: async () => {}
			}
		}
	});
	bootstrap(fakeRequire, {
		id: 'A5',
		email: 'admin5@mage2.pro',
		homeDir: root,
		userDataDir: root,
		codeRoot: __dirname,
		chrome: {executable: chromeExe, arguments: ['--profile-directory=Profile 7'], debugPort: 9222},
		browserEnvironment: {USERPROFILE: 'real'}
	});
	context.after(() => {
		globalThis.__ANTIGRAVITY_INITIAL_WINDOW__?.dispose();
		globalThis.__ANTIGRAVITY_UPDATE_GUARD__?.dispose();
		delete globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__;
		delete globalThis.__ANTIGRAVITY_OAUTH_BRIDGES__;
		delete globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__;
	});
	processes.spawn('C:/installed/language_server.exe', ['--standalone'], {env: {}});
	assert.equal(bridgeOpts[0]?.profileId, 'A5');
});
