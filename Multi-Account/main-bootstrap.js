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
const bootstrap = (require, config) => {
	const {app, shell, BrowserWindow, BaseWindow} = require('electron');
	const path = require('node:path');
	const fs = require('node:fs');
	const os = require('node:os');
	const processes = require('node:child_process');
	const {installUpdateGuard, silenceBrokenStdio, resolveModule} = require(path.join(config.codeRoot, 'update-guard.js'));
	silenceBrokenStdio(process);
	const isPrimary = 'A0' === config.id;
	if (!isPrimary && path.resolve(os.homedir()).toLowerCase() !== path.resolve(config.homeDir).toLowerCase()) {
		throw Error(config.id + ' home isolation failed');
	}
	app.setPath('userData', config.userDataDir);
	app.setPath('sessionData', config.userDataDir);
	app.setPath('logs', path.join(config.userDataDir, 'logs'));
	if (!isPrimary) {
		app.setAppUserModelId('Google.Antigravity.' + config.id);
		require(path.join(config.codeRoot, 'window-identity.js')).installWindowIdentity(require, config);
		const originalSpawn = processes.spawn;
		processes.spawn = function(executable, args, options) {
			if ('language_server.exe' === path.basename(executable).toLowerCase() && Array.isArray(args) && args.includes('--standalone')) {
				args = [...args, '--headless', '--gemini_dir=' + path.join(config.homeDir, '.gemini')];
				options = {...options, env: {...options?.env, USERPROFILE: config.homeDir, ANTIGRAVITY_VSCODE_HOST: '1'}};
			}
			const r = originalSpawn.call(this, executable, args, options);
			if ('language_server.exe' === path.basename(executable).toLowerCase() && Array.isArray(args) && args.includes('--standalone')) {
				const {OAuthBridge, refreshInitialPage} = require(path.join(config.codeRoot, 'oauth-bridge.js'));
				const bridge = new OAuthBridge({
					child: r,
					chromePort: config.chrome.debugPort,
					expectedEmail: config.email,
					onAuthenticated: () => refreshInitialPage({id: config.id, userDataDir: config.userDataDir}),
					open: url => shell.openExternal(url),
					report: message => fs.appendFileSync(path.join(config.userDataDir, 'launcher.log'), new Date().toISOString() + ' ' + message + '\n')
				});
				globalThis.__ANTIGRAVITY_OAUTH_BRIDGES__ ||= new Map();
				globalThis.__ANTIGRAVITY_OAUTH_BRIDGES__.set(r.pid, bridge);
				r.on('exit', () => globalThis.__ANTIGRAVITY_OAUTH_BRIDGES__.delete(r.pid));
			}
			return r;
		};
		const register = app.setAsDefaultProtocolClient.bind(app);
		app.setAsDefaultProtocolClient = (scheme, ...args) => 'antigravity' === scheme ? false : register(scheme, ...args);
		const originalOpen = shell.openExternal.bind(shell);
		shell.openExternal = async (url, options) => {
			let r;
			result: {
				let parsed;
				try {
					parsed = new URL(url);
				}
				catch {
					r = await originalOpen(url, options);
					break result;
				}
				if (!['http:', 'https:'].includes(parsed.protocol)) {
					r = await originalOpen(url, options);
					break result;
				}
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
		const prefixTitle = win => {
			if (win && !win.isDestroyed?.() && !win.__isWebviewPopupWindow) {
				const prefix = '[' + config.id + '] ';
				if ('function' === typeof win.setTitle && !win.__antigravityTitlePatched) {
					const originalSetTitle = win.setTitle.bind(win);
					win.__antigravityOriginalSetTitle = originalSetTitle;
					win.__antigravityTitlePatched = true;
					win.setTitle = title => {
						if (win.isDestroyed?.()) {
							return;
						}
						const text = String(title || '');
						return originalSetTitle(text.startsWith(prefix) ? text : prefix + text);
					};
				}
				if ('function' === typeof win.getTitle && 'function' === typeof win.setTitle) {
					const current = win.getTitle();
					if (current && !current.startsWith(prefix)) {
						win.setTitle(current);
					}
				}
				if (win.webContents?.on && !win.__antigravityTitleListener) {
					const onTitleUpdated = (event, title) => {
						if ('string' === typeof title && !title.startsWith(prefix) && !win.isDestroyed?.()) {
							event?.preventDefault?.();
							win.setTitle?.(prefix + title);
						}
					};
					win.__antigravityTitleListener = onTitleUpdated;
					win.webContents.on('page-title-updated', onTitleUpdated);
				}
			}
		};
		app.on('browser-window-created', (_event, win) => prefixTitle(win));
		app.on('web-contents-created', () => setImmediate(() => {
			for (const win of [...(BaseWindow?.getAllWindows?.() || []), ...(BrowserWindow?.getAllWindows?.() || [])]) {
				prefixTitle(win);
			}
		}));
		const storage = path.join(config.userDataDir, 'app_storage.json');
		const items = fs.existsSync(storage) ? JSON.parse(fs.readFileSync(storage, 'utf8')) : {};
		items.autoCheckForUpdates = 'false';
		fs.writeFileSync(storage, JSON.stringify(items));
	}
	installUpdateGuard(require, config);
	globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__ = {
		id: config.id,
		email: config.email || null,
		homeDir: isPrimary ? os.homedir() : config.homeDir,
		userDataDir: app.getPath('userData'),
		tokenStorage: isPrimary ? 'native-credential-manager' : 'server-headless-file-store',
		updateGuard: true
	};
	const listManagedWindows = () => {
		const utils = resolveModule(require, './utils');
		const hubWindows = utils?.getHubWindows?.() || [];
		const seen = new Set();
		const r = [];
		for (const win of [...hubWindows, ...(BaseWindow?.getAllWindows?.() || []), ...(BrowserWindow?.getAllWindows?.() || [])]) {
			if (win && !seen.has(win) && !win.isDestroyed?.() && !win.__isWebviewPopupWindow) {
				seen.add(win);
				const contents = utils?.getHubWebContents?.(win) ?? win.webContents;
				const url = contents?.getURL?.() || '';
				if (hubWindows.includes(win) || (BaseWindow && win instanceof BaseWindow) || /^https:\/\/(127\.0\.0\.1|localhost):\d+\//.test(url)) {
					r.push(win);
				}
			}
		}
		return r;
	};
	globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__ = () => {
		let windows = listManagedWindows();
		if (!windows.length) {
			const utils = resolveModule(require, './utils');
			const languageServer = resolveModule(require, './languageServer');
			const port = languageServer?.getLsPort?.();
			if (port && 'function' === typeof utils?.showOrCreateWindow) {
				utils.showOrCreateWindow(port);
				windows = listManagedWindows();
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
		return {id: config.id, pid: process.pid, windows: windows.length};
	};
	if (config.inspector) {
		const runtimeFile = path.join(config.userDataDir, 'main-runtime.json');
		fs.writeFileSync(runtimeFile, JSON.stringify({id: config.id, pid: process.pid, inspector: config.inspector, userDataDir: config.userDataDir}));
		app.on('will-quit', () => {
			try {
				if (JSON.parse(fs.readFileSync(runtimeFile, 'utf8')).pid === process.pid) {
					fs.unlinkSync(runtimeFile);
				}
			}
			catch {}
		});
	}
	return globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__;
};
module.exports = {bootstrap};
