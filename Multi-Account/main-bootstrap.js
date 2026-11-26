// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
const defaultProcesses = require('node:child_process');
const fs = require('node:fs');
const defaultOs = require('node:os');
const path = require('node:path');
const {deactivateInspector, installMainDebuggerBridge} = require('../Upgrade/main-debugger-bridge');
const {readJsonSafe, writeFileAtomic} = require('../Upgrade/process-io');
const defaultOAuthBridge = require('./oauth-bridge');
const {installUpdateGuard} = require('./update-guard');
const {appendLauncherLog, resolveModule, silenceBrokenStdio} = require('./update-state');
const defaultWindowIdentity = require('./window-identity');
// 2026-10-28
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
/**
 * @used-by {@link import('./launcher.js').buildBootstrapExpression}
 * @used-by {@link import('./launcher.test.js')}
 * @used-by {@link import('./main-bootstrap.js')}
 */
const bootstrap = (appRequire, config) => {
	const codeRoot = config.codeRoot || __dirname;
	const {app, shell, BrowserWindow, BaseWindow} = appRequire('electron');
	const os = resolveModule(appRequire, 'node:os') || defaultOs;
	const processes = resolveModule(appRequire, 'node:child_process') || defaultProcesses;
	const windowIdentity = resolveModule(appRequire, path.join(codeRoot, 'window-identity.js')) || defaultWindowIdentity;
	// 2026-11-10
	// "Fix main-process EPIPE crash on closed launcher stderr pipe, disable differential .blockmap requests, and preserve managed shortcuts and profile bootstrap across updates":
	// https://github.com/dmitry-ai/antigravity-addons/issues/21
	silenceBrokenStdio(process);
	const isPrimary = 'A0' === config.id;
	if (!isPrimary && path.resolve(os.homedir()).toLowerCase() !== path.resolve(config.homeDir).toLowerCase()) {
		throw Error(config.id + ' home isolation failed');
	}
	app.setPath('userData', config.userDataDir);
	app.setPath('sessionData', config.userDataDir);
	app.setPath('logs', path.join(config.userDataDir, 'logs'));
	installMainDebuggerBridge({appRequire, inspector: config.inspectorModule});
	configureProtocolHandler({app, codeRoot, config, isPrimary});
	if (!isPrimary) {
		configureSecondaryProfile({app, appRequire, codeRoot, config, processes, shell, windowIdentity});
	}
	// 2026-11-05
	// "Implement cross-profile auto-update guard (M-2) and unified main-process bootstrap for A0 and A6":
	// https://github.com/dmitry-ai/antigravity-addons/issues/20
	installUpdateGuard(appRequire, config);
	ensureInitialWindowVisible({app, appRequire, BaseWindow});
	globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__ = {
		id: config.id,
		email: config.email || null,
		homeDir: isPrimary ? os.homedir() : config.homeDir,
		userDataDir: app.getPath('userData'),
		tokenStorage: isPrimary ? 'native-credential-manager' : 'server-headless-file-store',
		updateGuard: true
	};
	globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__ = (extraArgs = []) => {
		let windows = listManagedWindows({appRequire, BaseWindow, BrowserWindow, windowIdentity});
		if (!windows.length) {
			const utils = resolveModule(appRequire, './utils');
			const port = resolveModule(appRequire, './languageServer')?.getLsPort?.();
			if (port && 'function' === typeof utils?.showOrCreateWindow) {
				utils.showOrCreateWindow(port);
				windows = listManagedWindows({appRequire, BaseWindow, BrowserWindow, windowIdentity});
			}
		}
		for (const win of windows) {
			if (win.isMinimized?.()) {
				win.restore?.();
			}
			win.show?.();
			win.focus?.();
		}
		if (windows.length) {
			app.focus?.({steal: true});
		}
		// 2026-11-19
		// "Bridge Upgrade and OAuth renderer attach through main-process WebContents debugger":
		// https://github.com/dmitry-ai/antigravity-addons/issues/52
		const links = Array.isArray(extraArgs) ? extraArgs.filter(arg => 'string' === typeof arg && arg.length) : [];
		if (links.length && 'function' === typeof app?.emit) {
			app.emit('second-instance', {preventDefault() {}}, ['Antigravity.exe', ...links], process.cwd());
			for (const item of links) {
				if (/^antigravity:/i.test(item)) {
					app.emit('open-url', {preventDefault() {}}, item);
				}
			}
		}
		return {id: config.id, pid: process.pid, windows: windows.length};
	};
	// 2026-11-20
	// "Deactivate V8 inspector and dispose debugger bridge on Electron shutdown":
	// https://github.com/dmitry-ai/antigravity-addons/issues/57
	globalThis.__ANTIGRAVITY_RUNTIME_SHUTDOWN__?.dispose?.();
	if (config.inspector) {
		const runtimeFile = path.join(config.userDataDir, 'main-runtime.json');
		writeFileAtomic(runtimeFile, JSON.stringify({id: config.id, pid: process.pid, inspector: config.inspector, userDataDir: config.userDataDir}), {fs});
		const removeRuntimeFile = () => {
			if (readJsonSafe(runtimeFile, fs)?.pid === process.pid) {
				fs.rmSync(runtimeFile, {force: true});
			}
		};
		const onWillQuit = event => {
			if (!event?.defaultPrevented) {
				removeRuntimeFile();
			}
		};
		const onQuit = () => {
			removeRuntimeFile();
			globalThis.__ANTIGRAVITY_MAIN_DEBUGGER_BRIDGE__?.dispose?.();
			deactivateInspector(appRequire, config.inspectorModule);
			disposeShutdown();
		};
		const disposeShutdown = () => {
			app.removeListener?.('will-quit', onWillQuit);
			app.removeListener?.('quit', onQuit);
			if (shutdownHandle === globalThis.__ANTIGRAVITY_RUNTIME_SHUTDOWN__) {
				delete globalThis.__ANTIGRAVITY_RUNTIME_SHUTDOWN__;
			}
		};
		const shutdownHandle = {dispose: disposeShutdown};
		app.on('will-quit', onWillQuit);
		app.on('quit', onQuit);
		globalThis.__ANTIGRAVITY_RUNTIME_SHUTDOWN__ = shutdownHandle;
	}
	return globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__;
};
// 2026-11-19
// "Bridge Upgrade and OAuth renderer attach through main-process WebContents debugger":
// https://github.com/dmitry-ai/antigravity-addons/issues/52
/**
 * @used-by {@link bootstrap}
 * @used-by {@link import('./main-bootstrap.js')}
 */
const configureProtocolHandler = ({app, codeRoot, config, isPrimary}) => {
	if ('function' !== typeof app?.setAsDefaultProtocolClient) {
		return;
	}
	const rawRegister = app.__antigravityRawProtocolRegister ||= app.setAsDefaultProtocolClient.bind(app);
	const launchVbs = path.join(codeRoot, 'launch.vbs');
	const wscript = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/wscript.exe');
	app.setAsDefaultProtocolClient = (scheme, ...args) => {
		if ('antigravity' !== scheme) {
			return rawRegister(scheme, ...args);
		}
		if (!isPrimary) {
			return false;
		}
		return 'win32' === process.platform && fs.existsSync(launchVbs)
			? rawRegister('antigravity', wscript, [launchVbs, config.id])
			: rawRegister(scheme, ...args);
	};
};
// 2026-11-14
// "Break Upgrade and Multi-Account circular dependency, replace bootstrap.toString() with require, and split update-guard.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/40
/**
 * @used-by {@link bootstrap}
 * @used-by {@link import('./main-bootstrap.js')}
 * @uses {@link import('./oauth-bridge.js').OAuthBridge#constructor}
 * @uses {@link import('./oauth-bridge.js').refreshInitialPage}
 * @uses {@link import('./window-identity.js').installWindowIdentity}
 */
const configureSecondaryProfile = ({app, appRequire, codeRoot, config, processes, shell, windowIdentity}) => {
	app.setAppUserModelId('Google.Antigravity.' + config.id);
	windowIdentity.installWindowIdentity(appRequire, config);
	const originalSpawn = processes.spawn;
	processes.spawn = function(executable, args, options) {
		const isStandalone = 'language_server.exe' === path.basename(executable).toLowerCase() && Array.isArray(args) && args.includes('--standalone');
		if (isStandalone) {
			args = [...args, '--headless', '--gemini_dir=' + path.join(config.homeDir, '.gemini')];
			options = {...options, env: {...options?.env, USERPROFILE: config.homeDir, ANTIGRAVITY_VSCODE_HOST: '1'}};
		}
		const r = originalSpawn.call(this, executable, args, options);
		if (isStandalone) {
			const {OAuthBridge, refreshInitialPage} = resolveModule(appRequire, path.join(codeRoot, 'oauth-bridge.js')) || defaultOAuthBridge;
			const bridge = new OAuthBridge({
				child: r,
				chromePort: config.chrome.debugPort,
				expectedEmail: config.email,
				onAuthenticated: () => refreshInitialPage({appRequire, id: config.id, userDataDir: config.userDataDir}),
				open: url => shell.openExternal(url),
				report: message => appendLauncherLog(config.userDataDir, message, {fs})
			});
			globalThis.__ANTIGRAVITY_OAUTH_BRIDGES__ ||= new Map();
			globalThis.__ANTIGRAVITY_OAUTH_BRIDGES__.set(r.pid, bridge);
			r.on('exit', () => globalThis.__ANTIGRAVITY_OAUTH_BRIDGES__.delete(r.pid));
		}
		return r;
	};
	const originalOpen = shell.openExternal.bind(shell);
	shell.openExternal = async (url, options) => {
		let r;
		let parsed = null;
		try {
			parsed = new URL(url);
		}
		catch {}
		if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
			r = await originalOpen(url, options);
		}
		else {
			if ('accounts.google.com' === parsed.hostname && parsed.pathname.includes('/oauth2/')) {
				parsed.searchParams.set('login_hint', config.email);
			}
			await new Promise((resolve, reject) => {
				const child = processes.spawn(config.chrome.executable, [...config.chrome.arguments, parsed.href], {
					env: {...process.env, ...config.browserEnvironment},
					windowsHide: true,
					detached: true,
					stdio: 'ignore'
				});
				child.once('error', reject);
				child.once('spawn', () => {
					child.unref();
					resolve();
				});
			});
		}
		return r;
	};
	// 2026-11-14
	// "Replace bootstrap.toString() injection with require, deduplicate Electron window hooks, split update-guard.js, and parameterize scripts from profiles.json":
	// https://github.com/dmitry-ai/antigravity-addons/issues/26
	const storage = path.join(config.userDataDir, 'app_storage.json');
	const existing = readJsonSafe(storage, fs);
	const items = existing && 'object' === typeof existing && !Array.isArray(existing) ? existing : {};
	items.autoCheckForUpdates = 'false';
	writeFileAtomic(storage, JSON.stringify(items), {fs});
};
// 2026-11-18
// "Fix Desktop launcher starting Antigravity hidden in system tray without opening Hub window":
// https://github.com/dmitry-ai/antigravity-addons/issues/50
/**
 * @used-by {@link bootstrap}
 * @used-by {@link import('./main-bootstrap.js')}
 */
const ensureInitialWindowVisible = ({app, appRequire, BaseWindow}) => {
	globalThis.__ANTIGRAVITY_INITIAL_WINDOW__?.dispose?.();
	if ('headless' === process.env.ELECTRON_OZONE_PLATFORM_HINT) {
		return null;
	}
	const findInitialHubWindow = () => {
		const utils = resolveModule(appRequire, './utils');
		return utils?.getLastFocusedLocalHubWindow?.() || (BaseWindow?.getAllWindows?.() || []).find(win => win && !win.isDestroyed?.() && !win.__isWebviewPopupWindow) || null;
	};
	const reveal = win => {
		if (win && !win.isDestroyed?.()) {
			if ('function' === typeof win.isVisible && !win.isVisible() && !win.isMinimized?.()) {
				win.show?.();
			}
			if (!win.isMinimized?.()) {
				win.focus?.();
				app?.focus?.({steal: true});
			}
			return true;
		}
		return false;
	};
	if (reveal(findInitialHubWindow())) {
		return null;
	}
	let scheduled = false;
	const check = () => {
		scheduled = false;
		if (reveal(findInitialHubWindow())) {
			dispose();
		}
	};
	const onWebContentsCreated = () => {
		if (!scheduled) {
			scheduled = true;
			setImmediate(check);
		}
	};
	const dispose = () => {
		app?.removeListener?.('web-contents-created', onWebContentsCreated);
		app?.removeListener?.('will-quit', dispose);
		if (handle === globalThis.__ANTIGRAVITY_INITIAL_WINDOW__) {
			delete globalThis.__ANTIGRAVITY_INITIAL_WINDOW__;
		}
	};
	const handle = {dispose};
	app?.on?.('web-contents-created', onWebContentsCreated);
	app?.on?.('will-quit', dispose);
	globalThis.__ANTIGRAVITY_INITIAL_WINDOW__ = handle;
	return handle;
};
// 2026-11-10
// "Support Electron BaseWindow + WebContentsView in Antigravity 2.30.0 for existing-window activation, taskbar badge identity, [A6] window title prefix, and update-guard focus lookup":
// https://github.com/dmitry-ai/antigravity-addons/issues/22
/**
 * @used-by {@link bootstrap}
 * @used-by {@link import('./main-bootstrap.js')}
 * @uses {@link import('./window-identity.js').allWindows}
 */
const listManagedWindows = ({appRequire, BaseWindow, BrowserWindow, windowIdentity}) => {
	const utils = resolveModule(appRequire, './utils');
	const hubWindows = utils?.getHubWindows?.() || [];
	const candidates = windowIdentity.allWindows ? windowIdentity.allWindows({BaseWindow, BrowserWindow, include: hubWindows}) : hubWindows;
	const r = [];
	for (const win of candidates) {
		const contents = utils?.getHubWebContents?.(win) ?? win.webContents;
		const url = contents?.getURL?.() || '';
		if (hubWindows.includes(win) || (BaseWindow && win instanceof BaseWindow) || /^https:\/\/(127\.0\.0\.1|localhost):\d+\//.test(url)) {
			r.push(win);
		}
	}
	return r;
};
module.exports = {bootstrap, configureSecondaryProfile, ensureInitialWindowVisible, listManagedWindows};
