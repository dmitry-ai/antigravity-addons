const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {EventEmitter} = require('node:events');
const manager = require('./folders-manager');
const {validateFolders, applyAction} = require('./folders-model');
class FoldersStore extends EventEmitter {
	constructor(filename) {
		super(); this.filename = path.resolve(filename); this.data = null; this.revision = ''; this.error = null;
		this.reload();
		this.watcher = fs.watch(path.dirname(this.filename), (_event, name) => {
			if (name !== null && String(name) !== path.basename(this.filename)) return;
			clearTimeout(this.timer); this.timer = setTimeout(() => this.reload(), 75);
		});
		this.watcher.on('error', error => { this.error = error.message; this.emit('change', this.snapshot()); });
	}
	reload() {
		const previousRevision = this.revision, previousError = this.error;
		try {
			const raw = fs.readFileSync(this.filename, 'utf8');
			const data = JSON.parse(raw.replace(/^\uFEFF/, '')); const ids = validateFolders(data.folders);
			if (!data.projectFolderMap || typeof data.projectFolderMap !== 'object' || Array.isArray(data.projectFolderMap)) throw Error('Invalid projectFolderMap');
			for (const [projectId, folderId] of Object.entries(data.projectFolderMap)) if (!projectId || typeof folderId !== 'string' || !ids.has(folderId)) throw Error(`Invalid folder assignment: ${projectId}`);
			this.data = data; this.revision = crypto.createHash('sha256').update(raw).digest('hex'); this.error = null;
		} catch (error) { this.error = error.message; }
		if (previousRevision !== this.revision || previousError !== this.error) this.emit('change', this.snapshot());
		return this.snapshot();
	}
	snapshot() { return {schemaVersion: 2, revision: this.revision, data: this.data, error: this.error}; }
	dispatch(body) {
		this.reload(); if (this.error) throw Error(this.error);
		if (body.revision && body.revision !== this.revision) throw Error('Folders configuration changed concurrently; reload it and retry');
		const data = applyAction(this.data, body);
		manager.writeConfig(data, this.filename, {expectedHash: this.revision});
		this.reload(); if (this.error) throw Error(this.error);
		return {success: true, ...this.snapshot()};
	}
	dispose() { clearTimeout(this.timer); this.watcher.close(); this.removeAllListeners(); }
}
module.exports = {FoldersStore};
