const {discover} = require('./registry');
const {app, BrowserWindow} = require('electron');
const windows = new WeakMap();
const observed = new WeakSet();
let watching = false;
const isAppUrl = value => {
	try { const url = new URL(value); return 'https:' === url.protocol && ['localhost', '127.0.0.1'].includes(url.hostname); }
	catch { return false; }
};
const attach = (win, {root} = {}) => {
	if (win && !win.isDestroyed()) {
		let tools;
		try { tools = discover(root); }
		catch (error) { console.error('[antigravity-tools]', error); return; }
		const loaded = windows.get(win) || new Set();
		windows.set(win, loaded);
		for (const tool of tools) {
			if (loaded.has(tool.id)) continue;
			loaded.add(tool.id);
			try {
				const pending = require(tool.entry)(win);
				pending?.catch?.(error => { loaded.delete(tool.id); console.error(`[antigravity-tools:${tool.id}]`, error); });
			}
			catch (error) {
				loaded.delete(tool.id);
				console.error(`[antigravity-tools:${tool.id}]`, error);
			}
		}
	}
};
const observe = (win, options) => {
	if (!win || win.isDestroyed() || observed.has(win)) return;
	observed.add(win);
	const wc = win.webContents;
	const navigation = (_event, url, _inPlace, mainFrame) => {
		if (mainFrame !== false && isAppUrl(url)) attach(win, options);
	};
	const ready = () => { if (isAppUrl(wc.getURL())) attach(win, options); };
	wc.on('did-start-navigation', navigation);
	wc.on('dom-ready', ready);
	win.once('closed', () => { wc.removeListener('did-start-navigation', navigation); wc.removeListener('dom-ready', ready); });
	ready();
};
module.exports = (win, options = {}) => {
	if (!watching && app?.on && BrowserWindow?.getAllWindows) {
		watching = true;
		app.on('browser-window-created', (_event, created) => observe(created, options));
		for (const existing of BrowserWindow.getAllWindows()) observe(existing, options);
	}
	attach(win, options);
};
