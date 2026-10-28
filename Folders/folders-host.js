const {net} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {FoldersStore} = require('./folders-store');
const {rendererSource, filenames} = require('./renderer-source');
const stores = new Map();
const sessions = new WeakMap();
const defaultConfig = path.join(__dirname, 'folders.json');
const appUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' && ['127.0.0.1', 'localhost'].includes(url.hostname); } catch { return false; } };
module.exports = (win, configPath = defaultConfig) => {
	if (!win || win.isDestroyed()) return;
	const wc = win.webContents, ses = wc.session;
	if (wc.__antigravityFoldersV2) return;
	configPath = path.resolve(configPath);
	let shared = stores.get(configPath);
	if (!shared) { shared = {store: new FoldersStore(configPath), windows: new Set()}; stores.set(configPath, shared); }
	const {store} = shared;
	shared.windows.add(win);
	const sessionState = sessions.get(ses);
	if (sessionState && sessionState.shared.windows.size && sessionState.shared !== shared) throw Error('One Electron session cannot use different Folders configurations');
	if (sessionState) sessionState.shared = shared;
	if (!sessionState) {
		// Live migration is limited to the old handler owned by this module.
		if (ses._antigravityFoldersHooked) ses.protocol.unhandle('https');
		ses.protocol.handle('https', async request => {
			const activeStore = sessions.get(ses).shared.store;
			const url = new URL(request.url);
			if (!appUrl(url.href) || url.pathname !== '/api/project-folders') return net.fetch(request, {bypassCustomProtocolHandlers: true});
			const origin = request.headers?.get('origin');
			if (origin && origin !== url.origin) return Response.json({error: 'Origin is not allowed'}, {status: 403});
			if (request.method === 'GET') { const snapshot = activeStore.reload(); return Response.json(snapshot, {status: snapshot.error ? 503 : 200, headers: {'cache-control': 'no-store'}}); }
			if (request.method === 'POST') {
				try { return Response.json(activeStore.dispatch(await request.json())); }
				catch (error) { return Response.json({...activeStore.snapshot(), success: false, error: error.message}, {status: /concurrently/.test(error.message) ? 409 : 400}); }
			}
			return Response.json({error: 'Method is not allowed'}, {status: 405});
		});
		sessions.set(ses, {shared}); ses._antigravityFoldersV2 = true;
	}
	const update = snapshot => {
		if (!wc.isDestroyed() && appUrl(wc.getURL())) wc.executeJavaScript(`window.__FOLDERS_REVISION__=${JSON.stringify(snapshot.revision)};window.__PROJECT_FOLDERS_CLIENT__?.notifyUpdate(${JSON.stringify(snapshot.data || {folders: [], projectFolderMap: {}})});window.__PROJECT_FOLDERS_HOST_STATUS__=${JSON.stringify(snapshot.error)};`).catch(log);
	};
	const apply = () => {
		if (!wc.isDestroyed() && appUrl(wc.getURL())) wc.executeJavaScript(rendererSource(store.data || {folders: [], projectFolderMap: {}})).catch(log);
	};
	const log = error => console.error('[folders-host]', error);
	store.on('change', update); wc.on('dom-ready', apply);
	let timer;
	const watcher = fs.watch(__dirname, (_event, filename) => { if (filename && filenames.includes(String(filename))) { clearTimeout(timer); timer = setTimeout(apply, 100); } });
	watcher.on('error', log);
	const dispose = () => {
		clearTimeout(timer); watcher.close(); store.removeListener('change', update); wc.removeListener('dom-ready', apply); win.removeListener('closed', dispose);
		shared.windows.delete(win); delete wc.__antigravityFoldersV2;
		if (!shared.windows.size) { store.dispose(); stores.delete(configPath); }
	};
	wc.__antigravityFoldersV2 = {dispose, apply}; win.once('closed', dispose);
	if (appUrl(wc.getURL()) && !wc.isLoading?.()) apply();
};
