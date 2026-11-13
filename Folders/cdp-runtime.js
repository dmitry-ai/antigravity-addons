// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Merge Folders browser UI layer (folders-client.js + folders-view.js) and purge dead v1 Less selectors":
// https://github.com/dmitry-ai/antigravity-addons/issues/34
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Unify Folders domain validation, tree traversal helpers, store checks, and CLI listing/mutations around folders-model.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/31
const crypto = require('node:crypto');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const {readJsonSafe, writeFileAtomic} = require('../Upgrade/process-io');
const manager = require('./folders-manager');
const {applyAction, validateConfig} = require('./folders-model');
const disposeExpression = 'window.__PROJECT_FOLDERS_VIEW__?.dispose();delete window.__FOLDERS_RUNTIME_VERSION__;';
const filenames = ['folders-model.js', 'antigravity-adapter.js', 'folders-client.js'];
const inspectExpression = "window.__PROJECT_FOLDERS_VIEW__?.inspect()||{state:'missing',reason:'Folders runtime is not attached'}";
class FoldersStore extends EventEmitter {
	constructor(filename) {
		super();
		this.filename = path.resolve(filename);
		this.data = null;
		this.revision = '';
		this.statSignature = null;
		this.error = null;
		this.reload();
		this.watcher = fs.watch(path.dirname(this.filename), (_event, name) => {
			if (null === name || path.basename(this.filename) === String(name)) {
				clearTimeout(this.timer);
				this.timer = setTimeout(() => this.reload(), 75);
			}
		});
		this.watcher.on('error', error => {
			this.error = error.message;
			this.emit('change', this.snapshot());
		});
	}
	dispose() {
		clearTimeout(this.timer);
		this.watcher.close();
		this.removeAllListeners();
	}
	dispatch(body) {
		this.reload();
		if (this.error) {
			throw Error(this.error);
		}
		if (body.revision && body.revision !== this.revision) {
			throw Error('Folders configuration changed concurrently; reload it and retry');
		}
		const data = applyAction(this.data, body);
		manager.writeConfig(data, this.filename, {expectedHash: this.revision});
		this.reload();
		if (this.error) {
			throw Error(this.error);
		}
		return {success: true, ...this.snapshot()};
	}
	reload() {
		const previousRevision = this.revision;
		const previousError = this.error;
		try {
			const raw = fs.readFileSync(this.filename, 'utf8');
			const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
			validateConfig(data);
			this.data = data;
			this.revision = crypto.createHash('sha256').update(raw).digest('hex');
			this.statSignature = this.statKey();
			this.error = null;
		}
		catch (error) {
			this.statSignature = null;
			this.error = error.message;
		}
		if (previousRevision !== this.revision || previousError !== this.error) {
			this.emit('change', this.snapshot());
		}
		return this.snapshot();
	}
	reloadIfChanged() {
		const signature = this.statKey();
		return !this.error && this.data && signature && signature === this.statSignature
			? this.snapshot()
			: this.reload();
	}
	snapshot() {
		return {schemaVersion: 2, revision: this.revision, data: this.data, error: this.error};
	}
	statKey() {
		let r = null;
		try {
			const stat = fs.statSync(this.filename);
			r = `${stat.mtimeMs}:${stat.size}`;
		}
		catch {}
		return r;
	}
}
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
				r = readJsonSafe(viewFile, {schemaVersion: 1});
			}
			else if ('POST' === message.method) {
				r = store.dispatch(message.body);
			}
			else if ('GET' === message.method) {
				const result = store.reloadIfChanged();
				if (result.error) {
					throw Error(result.error);
				}
				r = result;
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
			else {
				throw Error('Unknown Folders storage request');
			}
			return r;
		},
		source: () => rendererSource(store.data || {folders: [], projectFolderMap: {}}, {includeStyle: false}),
		styleSheet: () => fs.readFileSync(path.join(__dirname, 'folders-view.css'), 'utf8')
	};
};
const rendererSource = (data, {includeStyle = true} = {}) => {
	const scripts = filenames.map(filename => fs.readFileSync(path.join(__dirname, filename), 'utf8')).join('\n;\n');
	const version = crypto.createHash('sha256').update(scripts).digest('hex');
	const styleAssignment = includeStyle ? `window.__FOLDERS_STYLE__=${JSON.stringify(fs.readFileSync(path.join(__dirname, 'folders-view.css'), 'utf8'))};` : '';
	return `(() => {let r;if('/onboarding'===location.pathname||location.pathname.startsWith('/onboarding/')){window.__PROJECT_FOLDERS_VIEW__?.dispose();delete window.__FOLDERS_RUNTIME_VERSION__;r={attached:false,reason:'onboarding'};}else if(${JSON.stringify(version)}===window.__FOLDERS_RUNTIME_VERSION__){window.__PROJECT_FOLDERS_VIEW__?.notifyUpdate(${JSON.stringify(data)});r={attached:true};}else if(window.__PROJECT_FOLDERS_VIEW__?.activeModal||window.__PROJECT_FOLDERS_VIEW__?.activeMenu){r={attached:false,reason:'user-dialog'};}else{window.__PROJECT_FOLDERS_VIEW__?.dispose();${styleAssignment}window.__PROJECT_FOLDERS_DATA__=${JSON.stringify(data)};\n${scripts}\n;window.__FOLDERS_RUNTIME_VERSION__=${JSON.stringify(version)};r={attached:true};}return r;})()`;
};
const reportExpression = message => `window.__PROJECT_FOLDERS_VIEW__?.reportAction(${JSON.stringify(message)});`;
Object.assign(createFoldersRuntime, {
	FoldersStore,
	disposeExpression,
	filenames,
	inspectExpression,
	rendererSource,
	reportExpression
});
module.exports = createFoldersRuntime;
