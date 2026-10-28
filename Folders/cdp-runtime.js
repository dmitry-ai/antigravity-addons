const path = require('node:path');
const fs = require('node:fs');
const {FoldersStore} = require('./folders-store');
const {rendererSource} = require('./renderer-source');
module.exports = ({broadcast, stateRoot = path.join(__dirname, 'state')}) => {
	const store = new FoldersStore(path.join(__dirname, 'folders.json'));
	const viewFile = path.join(stateRoot, 'folders-view.json');
	store.on('change', snapshot => broadcast(`window.__FOLDERS_REVISION__=${JSON.stringify(snapshot.revision)};window.__PROJECT_FOLDERS_CLIENT__?.notifyUpdate(${JSON.stringify(snapshot.data || {folders: [], projectFolderMap: {}})});window.__PROJECT_FOLDERS_VIEW__?.reportAction(${JSON.stringify(snapshot.error)});`));
	return {
		styleSheet: () => fs.readFileSync(path.join(__dirname, 'folders-view.css'), 'utf8'),
		source: () => rendererSource(store.data || {folders: [], projectFolderMap: {}}),
		request(message) {
			if (message.method === 'GET_VIEW_STATE') return fs.existsSync(viewFile) ? JSON.parse(fs.readFileSync(viewFile, 'utf8')) : {schemaVersion: 1};
			if (message.method === 'SET_VIEW_STATE') {
				const collapsed = message.body?.collapsed;
				if (!Array.isArray(collapsed) || collapsed.some(key => typeof key !== 'string')) throw Error('Invalid folder view state');
				const data = {schemaVersion: 1, collapsed}; fs.mkdirSync(stateRoot, {recursive: true}); fs.writeFileSync(viewFile + '.tmp', JSON.stringify(data)); fs.renameSync(viewFile + '.tmp', viewFile);
				broadcast(`window.dispatchEvent(new CustomEvent('antigravity-folders-view-state',{detail:${JSON.stringify(data)}}))`);
				return data;
			}
			if (message.method === 'GET') { const result = store.reload(); if (result.error) throw Error(result.error); return result; }
			if (message.method === 'POST') return store.dispatch(message.body);
			throw Error('Unknown Folders storage request');
		},
		dispose: () => store.dispose()
	};
};
