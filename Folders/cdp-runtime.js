// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Merge Folders browser UI layer (folders-client.js + folders-view.js) and purge dead v1 Less selectors":
// https://github.com/dmitry-ai/antigravity-addons/issues/34
const path = require('node:path');
const fs = require('node:fs');
const {writeFileAtomic} = require('../Upgrade/process-io');
const {FoldersStore} = require('./folders-store');
const {filenames, rendererSource} = require('./renderer-source');
const disposeExpression = 'window.__PROJECT_FOLDERS_VIEW__?.dispose();window.__PROJECT_FOLDERS_CLIENT__?.dispose?.();delete window.__FOLDERS_RUNTIME_VERSION__;';
const inspectExpression = "window.__PROJECT_FOLDERS_VIEW__?.inspect()||{state:'missing',reason:'Folders runtime is not attached'}";
const reportExpression = message => `window.__PROJECT_FOLDERS_VIEW__?.reportAction(${JSON.stringify(message)});`;
const createFoldersRuntime = ({broadcast, invalidate, report, stateRoot = path.join(__dirname, 'state')}) => {
	const store = new FoldersStore(path.join(__dirname, 'folders.json'));
	const viewFile = path.join(stateRoot, 'folders-view.json');
	const watchedNames = new Set([...filenames, 'folders-view.css']);
	let watchTimer;
	const assetWatcher = fs.watch(__dirname, (_event, name) => {
		if (null === name || watchedNames.has(String(name))) {
			clearTimeout(watchTimer);
			watchTimer = setTimeout(() => invalidate?.(), 75);
		}
	});
	assetWatcher.on('error', error => report?.(error.message));
	store.on('change', snapshot => {
		invalidate?.();
		broadcast(`window.__FOLDERS_REVISION__=${JSON.stringify(snapshot.revision)};window.__PROJECT_FOLDERS_VIEW__?.notifyUpdate(${JSON.stringify(snapshot.data || {folders: [], projectFolderMap: {}})});window.__PROJECT_FOLDERS_VIEW__?.reportAction(${JSON.stringify(snapshot.error)});`);
	});
	return {
		dispose: () => {
			clearTimeout(watchTimer);
			assetWatcher.close();
			store.dispose();
		},
		disposeExpression,
		inspectExpression,
		reportExpression,
		request(message) {
			let r;
			if ('GET_VIEW_STATE' === message.method) {
				r = fs.existsSync(viewFile) ? JSON.parse(fs.readFileSync(viewFile, 'utf8')) : {schemaVersion: 1};
			}
			else if ('SET_VIEW_STATE' === message.method) {
				const collapsed = message.body?.collapsed;
				if (!Array.isArray(collapsed) || collapsed.some(key => 'string' !== typeof key)) {
					throw Error('Invalid folder view state');
				}
				const data = {schemaVersion: 1, collapsed};
				writeFileAtomic(viewFile, JSON.stringify(data));
				broadcast(`window.dispatchEvent(new CustomEvent('antigravity-folders-view-state',{detail:${JSON.stringify(data)}}))`);
				r = data;
			}
			else if ('GET' === message.method) {
				const result = store.reload();
				if (result.error) {
					throw Error(result.error);
				}
				r = result;
			}
			else if ('POST' === message.method) {
				r = store.dispatch(message.body);
			}
			else {
				throw Error('Unknown Folders storage request');
			}
			return r;
		},
		source: () => rendererSource(store.data || {folders: [], projectFolderMap: {}}, {includeStyle: false}),
		styleSheet: () => fs.readFileSync(path.join(__dirname, 'folders-view.css'), 'utf8')
	};
};
createFoldersRuntime.disposeExpression = disposeExpression;
createFoldersRuntime.inspectExpression = inspectExpression;
createFoldersRuntime.reportExpression = reportExpression;
module.exports = createFoldersRuntime;
