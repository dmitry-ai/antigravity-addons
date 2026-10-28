// Executed once through the main-process CDP at the first line of app startup.
// No installed source is changed. The child already has isolated paths.
const bootstrap = (require, config) => {
	const {app, shell, BrowserWindow} = require('electron');
	const path = require('node:path');
	const fs = require('node:fs');
	const os = require('node:os');
	const processes = require('node:child_process');
	if (path.resolve(os.homedir()).toLowerCase() !== path.resolve(config.homeDir).toLowerCase()) throw Error('A6 home isolation failed');
	app.setPath('userData', config.userDataDir);
	app.setPath('sessionData', config.userDataDir);
	app.setPath('logs', path.join(config.userDataDir, 'logs'));
	app.setAppUserModelId('Google.Antigravity.' + config.id);
	require(path.join(config.codeRoot, 'window-identity.js')).installWindowIdentity(require, config);
	// The server's supported headless mode explicitly selects its file token store.
	// Electron itself stays graphical. A separate home alone DOES NOT isolate the OS keyring.
	const originalSpawn = processes.spawn;
	processes.spawn = function(executable, args, options) {
		if (path.basename(executable).toLowerCase() === 'language_server.exe' && Array.isArray(args) && args.includes('--standalone')) {
			args = [...args, '--headless', '--gemini_dir=' + path.join(config.homeDir, '.gemini')];
			options = {...options, env: {...options?.env, USERPROFILE: config.homeDir, ANTIGRAVITY_VSCODE_HOST: '1'}};
		}
		const child = originalSpawn.call(this, executable, args, options);
		if (path.basename(executable).toLowerCase() === 'language_server.exe' && Array.isArray(args) && args.includes('--standalone')) {
			const {OAuthBridge, refreshInitialPage} = require(path.join(config.codeRoot, 'oauth-bridge.js'));
			const bridge = new OAuthBridge({child, chromePort: config.chrome.debugPort, expectedEmail: config.email, onAuthenticated: () => refreshInitialPage({id: config.id, userDataDir: config.userDataDir}), open: url => shell.openExternal(url), report: message => fs.appendFileSync(path.join(config.userDataDir, 'launcher.log'), new Date().toISOString() + ' ' + message + '\n')});
			globalThis.__ANTIGRAVITY_OAUTH_BRIDGES__ ||= new Map();
			globalThis.__ANTIGRAVITY_OAUTH_BRIDGES__.set(child.pid, bridge);
			child.on('exit', () => globalThis.__ANTIGRAVITY_OAUTH_BRIDGES__.delete(child.pid));
		}
		return child;
	};
	// A0 retains the machine's antigravity:// protocol registration.
	const register = app.setAsDefaultProtocolClient.bind(app);
	app.setAsDefaultProtocolClient = (scheme, ...args) => scheme === 'antigravity' ? false : register(scheme, ...args);
	const originalOpen = shell.openExternal.bind(shell);
	shell.openExternal = async (url, options) => {
		let parsed;
		try { parsed = new URL(url); } catch { return originalOpen(url, options); }
		if (!['http:', 'https:'].includes(parsed.protocol)) return originalOpen(url, options);
		if (parsed.hostname === 'accounts.google.com' && parsed.pathname.includes('/oauth2/')) parsed.searchParams.set('login_hint', config.email);
		await new Promise((resolve, reject) => {
			const child = processes.spawn(config.chrome.executable, [...config.chrome.arguments, parsed.href], {env: {...process.env, ...config.browserEnvironment}, windowsHide: true, detached: true, stdio: 'ignore'});
			child.once('error', reject);
			child.once('spawn', () => {child.unref(); resolve();});
		});
	};
	app.on('browser-window-created', (_event, win) => {
		win.webContents.on('page-title-updated', (event, title) => {
			if (title.startsWith('[' + config.id + '] ')) return;
			event.preventDefault(); win.setTitle('[' + config.id + '] ' + title);
		});
	});
	// This storage is UI-only; do not copy credentials, projects or conversations.
	const storage = path.join(config.userDataDir, 'app_storage.json');
	let items = fs.existsSync(storage) ? JSON.parse(fs.readFileSync(storage, 'utf8')) : {};
	items.autoCheckForUpdates = 'false';
	fs.writeFileSync(storage, JSON.stringify(items));
	globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__ = {id: config.id, email: config.email, homeDir: config.homeDir, userDataDir: app.getPath('userData'), tokenStorage: 'server-headless-file-store'};
	globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__ = () => {
		const windows = BrowserWindow.getAllWindows().filter(win => /^https:\/\/(127\.0\.0\.1|localhost):\d+\//.test(win.webContents.getURL()));
		for (const win of windows) {if (win.isMinimized()) win.restore(); win.show(); win.focus();}
		return {id: config.id, pid: process.pid, windows: windows.length};
	};
	if (config.inspector) {
		const runtimeFile = path.join(config.userDataDir, 'main-runtime.json');
		fs.writeFileSync(runtimeFile, JSON.stringify({id: config.id, pid: process.pid, inspector: config.inspector, userDataDir: config.userDataDir}));
		app.on('will-quit', () => {try {if (JSON.parse(fs.readFileSync(runtimeFile, 'utf8')).pid === process.pid) fs.unlinkSync(runtimeFile);} catch {}});
	}
	return globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__;
};
module.exports = {bootstrap};
