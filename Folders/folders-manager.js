// 2026-10-12 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement left-sidebar project folders (Folders), CLI manager, installer scripts, and remove right-panel sidecar prototype":
// https://github.com/dmitry-ai/antigravity-addons/issues/3
// 2026-10-12 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Add interactive GUI folder management (folders-client.js), nested parentId hierarchy, drag-and-drop, Windows Explorer sorting, and adaptive Light/Dark menus":
// https://github.com/dmitry-ai/antigravity-addons/issues/4
// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Integrate with universal dmitry-ai/harness, format codebase per P.md/P.ES6.md/P.Bash.md, and link source files to GitHub Issues":
// https://github.com/dmitry-ai/antigravity-addons/issues/16
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders around standalone v2 architecture, delegated events, UMD test exports, and shared folders-model mutations":
// https://github.com/dmitry-ai/antigravity-addons/issues/24
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Unify Folders domain validation, tree traversal helpers, store checks, and CLI listing/mutations around folders-model.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/31
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Extract FolderRowBuilder, FolderActionDispatcher, and FoldersCliManager ES6 classes in Folders/folders-model.js and folders-manager.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/42
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders module loader, tree indexer, declarative DOM helper, and CAS store/CLI wrappers":
// https://github.com/dmitry-ai/antigravity-addons/issues/44
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {writeFileAtomic} = require('../Upgrade/process-io');
const model = require('./folders-model');
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'folders.json').replace(/\\/g, '/');
const DEFAULT_PROJECTS_DIR = path.join(process.env.USERPROFILE || os.homedir(), '.gemini/config/projects').replace(/\\/g, '/');
const {getDescendantIds, getFolderPath, validateFolders: validateTree} = model;
class FoldersCliManager {
	constructor({configPath = DEFAULT_CONFIG_PATH, fs: fileSystem = fs, logger = console, projectsDir = DEFAULT_PROJECTS_DIR} = {}) {
		Object.assign(this, {configPath, fs: fileSystem, logger, projectsDir, revisions: new WeakMap()});
	}
	addFolder(input, parentQuery = null, color = '#10b981', configPath = this.configPath) {
		const isObject = 'object' === typeof input && null !== input;
		const name = String(isObject ? input.name : input).trim();
		const rawParent = isObject ? input.parentId || null : parentQuery;
		const folderColor = (isObject ? input.color : color) || '#10b981';
		return this.mutateConfig(isObject ? parentQuery || this.configPath : configPath, data => {
			let r;
			const parentId = rawParent ? this.findFolder(data.folders, rawParent)?.id || null : null;
			const sibling = data.folders.find(f => parentId === (f.parentId || null) && name.toLowerCase() === f.name.toLowerCase());
			if (sibling) {
				sibling.color = folderColor;
				this.logger.log(`✅ Folder "${name}" (${sibling.id}) under parent "${parentId || 'root'}" updated.`);
				r = {next: data, result: sibling};
			}
			else {
				const baseId = (isObject ? input.id : null) || slugify(name);
				let id = baseId;
				for (let seq = 1; data.folders.some(f => id === f.id); seq++) {
					id = `${baseId}-${seq}`;
				}
				const next = model.applyAction(data, {action: 'add-folder', id, name, parentId, color: folderColor});
				this.logger.log(`✅ Created folder "${name}" (ID: ${id}, Parent: ${parentId || 'root'}).`);
				r = {next, result: next.folders.find(f => id === f.id)};
			}
			return r;
		});
	}
	assignProject(projQuery, folderQuery, configPath = this.configPath) {
		return this.mutateConfig(configPath, data => {
			const project = this.requireProject(projQuery);
			const folder = project ? this.requireFolder(data.folders, folderQuery, `❌ Folder "${folderQuery}" not found. Create it first: node folders-manager.js add-folder "${folderQuery}"`) : null;
			let r = {result: false};
			if (project && folder) {
				const next = model.applyAction(data, {action: 'assign-project', projectId: project.id, folderId: folder.id});
				this.logger.log(`✅ Project "${project.name}" added to folder "${folder.name}".`);
				r = {next, result: true};
			}
			return r;
		});
	}
	findFolder(folders = [], query) {
		let r = null;
		const qTrim = 'string' === typeof query ? query.trim() : '';
		if (qTrim && Array.isArray(folders)) {
			const qLower = qTrim.toLowerCase();
			const byId = folders.find(f => qTrim === f.id);
			if (byId) {
				r = byId;
			}
			else {
				let pathMatch = null;
				if (qTrim.includes('/')) {
					let parentId = null;
					for (const part of qTrim.split('/').map(p => p.trim().toLowerCase())) {
						pathMatch = folders.find(f => parentId === (f.parentId || null) && part === f.name.toLowerCase()) || null;
						if (!pathMatch) {
							break;
						}
						parentId = pathMatch.id;
					}
				}
				const exact = pathMatch ? null : folders.filter(f => qLower === f.name.toLowerCase());
				r = pathMatch || exact.find(f => null === (f.parentId || null)) || exact[0] || folders.find(f => f.name.toLowerCase().includes(qLower)) || null;
			}
		}
		return r;
	}
	listAll(configPath = this.configPath) {
		const data = this.readConfig(configPath);
		const projectMap = new Map();
		for (const p of [...this.loadAntigravityProjects(), ...Object.keys(data.projectFolderMap || {}).map(pid => ({id: pid, name: pid}))]) {
			if (p.id && model.INTERNAL_PROJECT_ID !== p.id && !projectMap.has(p.id)) {
				projectMap.set(p.id, p);
			}
		}
		const rows = model.buildRows({data, projects: [...projectMap.values()]});
		const directCounts = new Map();
		for (const row of rows) {
			if ('project' === row.kind && row.folderId) {
				directCounts.set(row.folderId, (directCounts.get(row.folderId) || 0) + 1);
			}
		}
		this.logger.log('\n📁 Antigravity 2.0 Folder Hierarchy:\n');
		for (const row of rows) {
			const indent = '    '.repeat(row.depth);
			if ('folder' === row.kind) {
				this.logger.log(`${indent}▾ 📁 ${row.name} [ID: ${row.id}] (${directCounts.get(row.id) || 0} projects)`);
			}
			else if ('project' === row.kind && row.folderId) {
				this.logger.log(`${indent}↳ 📂 ${row.name}`);
			}
			else if ('empty' === row.kind) {
				this.logger.log(`${indent}(empty folder)`);
			}
		}
		const unassigned = rows.filter(row => 'project' === row.kind && !row.folderId);
		if (0 < unassigned.length) {
			this.logger.log(`\n📂 Unassigned projects (at root, ${unassigned.length}):`);
			for (const row of unassigned) {
				this.logger.log(`    ↳ ${row.name}`);
			}
		}
		this.logger.log('');
	}
	listProjects(configPath = this.configPath) {
		const data = this.readConfig(configPath);
		this.logger.log('\n📋 All Antigravity Projects:\n');
		for (const p of this.loadAntigravityProjects().filter(item => model.INTERNAL_PROJECT_ID !== item.id).sort(model.compare)) {
			const fId = data.projectFolderMap[p.id];
			this.logger.log(`- ${p.name.padEnd(38)} | Folder: ${fId ? `📁 ${getFolderPath(fId, data.folders)}` : '— (unassigned)'}`);
		}
		this.logger.log('');
	}
	loadAntigravityProjects() {
		const r = [];
		try {
			if (this.fs.existsSync(this.projectsDir)) {
				for (const f of this.fs.readdirSync(this.projectsDir).filter(name => name.endsWith('.json'))) {
					try {
						const data = JSON.parse(this.fs.readFileSync(path.join(this.projectsDir, f), 'utf8'));
						if (data.id) {
							r.push({id: data.id, name: data.name || 'Untitled Project'});
						}
					}
					catch {}
				}
			}
		}
		catch (err) {
			this.logger.warn('[folders-manager] Could not read Antigravity projects:', err.message);
		}
		return r;
	}
	moveFolder(query, newParentQuery, configPath = this.configPath) {
		return this.mutateConfig(configPath, data => {
			const folder = this.requireFolder(data.folders, query);
			const isRoot = !newParentQuery || 'root' === newParentQuery || 'null' === newParentQuery;
			const parentFolder = folder && !isRoot ? this.requireFolder(data.folders, newParentQuery, `❌ Target parent folder "${newParentQuery}" not found.`) : null;
			let r = {result: false};
			if (folder && (isRoot || parentFolder)) {
				const newParentId = isRoot ? null : parentFolder.id;
				const next = model.applyAction(data, {action: 'move-folder', id: folder.id, newParentId});
				this.logger.log(`✅ Folder "${folder.name}" moved: ${folder.parentId || 'root'} ➔ ${newParentId || 'root'}.`);
				r = {next, result: true};
			}
			return r;
		});
	}
	mutateConfig(configPath, step) {
		const data = this.readConfig(configPath);
		const outcome = step(data);
		if (outcome?.next) {
			this.writeConfig(outcome.next, configPath, {expectedHash: this.revisions.get(data)});
		}
		return outcome?.result;
	}
	readConfig(configPath = this.configPath) {
		let r = {folders: [], projectFolderMap: {}};
		if (this.fs.existsSync(configPath)) {
			const raw = this.fs.readFileSync(configPath, 'utf8');
			r = JSON.parse(raw.replace(/^\uFEFF/, ''));
			this.revisions.set(r, crypto.createHash('sha256').update(raw).digest('hex'));
		}
		return r;
	}
	removeFolder(query, configPath = this.configPath) {
		return this.mutateConfig(configPath, data => {
			const folder = this.requireFolder(data.folders, query);
			let r = {result: false};
			if (folder) {
				const promotedFolders = data.folders.filter(f => folder.id === f.parentId).length;
				const promotedProjects = Object.values(data.projectFolderMap).filter(fId => folder.id === fId).length;
				const next = model.applyAction(data, {action: 'remove-folder', id: folder.id});
				this.logger.log(`✅ Folder "${folder.name}" (${folder.id}) deleted. Promoted subfolders: ${promotedFolders}, projects: ${promotedProjects}.`);
				r = {next, result: true};
			}
			return r;
		});
	}
	renameFolder(query, newName, configPath = this.configPath) {
		return this.mutateConfig(configPath, data => {
			const target = this.requireFolder(data.folders, query);
			const cleanName = String(newName || '').trim();
			let r = {result: false};
			if (target) {
				try {
					const next = model.applyAction(data, {action: 'rename-folder', id: target.id, newName: cleanName});
					this.logger.log(`✅ Folder "${target.name}" renamed to "${cleanName}" (ID: ${target.id}).`);
					r = {next, result: true};
				}
				catch (error) {
					if (!/collision/i.test(error.message)) {
						throw error;
					}
					this.logger.error(`❌ A folder named "${cleanName}" already exists in the same branch.`);
				}
			}
			return r;
		});
	}
	requireFolder(folders, query, message = `❌ Folder "${query}" not found.`) {
		const r = this.findFolder(folders, query);
		if (!r) {
			this.logger.error(message);
		}
		return r;
	}
	requireProject(query) {
		const r = this.resolveProject(query);
		if (!r) {
			this.logger.error(`❌ Project "${query}" not found.`);
		}
		return r;
	}
	resolveFolder(query, configPath = this.configPath) {
		return query ? this.findFolder(this.readConfig(configPath).folders, query) : null;
	}
	resolveProject(query) {
		let r = null;
		if (query) {
			const projects = this.loadAntigravityProjects();
			const qLower = query.toLowerCase().trim();
			const exact = projects.find(p => query === p.id) || projects.find(p => qLower === p.name.toLowerCase());
			if (exact) {
				r = exact;
			}
			else {
				const bySub = projects.filter(p => p.name.toLowerCase().includes(qLower));
				if (1 < bySub.length) {
					this.logger.warn(`Ambiguous project name "${query}". Matches:`, bySub.map(p => `"${p.name}" (${p.id})`));
				}
				r = bySub[0] || {id: query, name: query};
			}
		}
		return r;
	}
	setEnabled(enabled, toolPath = path.join(__dirname, 'tool.json')) {
		const tool = JSON.parse(this.fs.readFileSync(toolPath, 'utf8'));
		tool.enabled = Boolean(enabled);
		writeFileAtomic(toolPath, JSON.stringify(tool, null, '\t') + '\n', {sync: true});
		return tool.enabled;
	}
	unassignProject(projQuery, configPath = this.configPath) {
		return this.mutateConfig(configPath, data => {
			const project = this.requireProject(projQuery);
			const oldFolderId = project ? data.projectFolderMap[project.id] : null;
			let r = {result: false};
			if (project && !oldFolderId) {
				this.logger.log(`ℹ️ Project "${project.name}" is not in any folder (already at root).`);
				r = {result: true};
			}
			else if (project) {
				const oldFolder = data.folders.find(f => oldFolderId === f.id);
				const next = model.applyAction(data, {action: 'unassign-project', projectId: project.id});
				this.logger.log(`✅ Project "${project.name}" removed from folder "${oldFolder?.name || oldFolderId}" (moved to root).`);
				r = {next, result: true};
			}
			return r;
		});
	}
	writeConfig(data, configPath = this.configPath, {expectedHash = this.revisions.get(data)} = {}) {
		this.revisions.set(data, persistConfig(configPath, data, {expectedHash, fs: this.fs}));
	}
}
const persistConfig = (configPath, data, {expectedHash, fs: fileSystem = fs, validate = true} = {}) => {
	if (validate) {
		model.validateConfig(data);
	}
	const raw = fileSystem.existsSync(configPath) ? fileSystem.readFileSync(configPath) : null;
	if (expectedHash && (!raw || expectedHash !== crypto.createHash('sha256').update(raw).digest('hex'))) {
		throw Error('Folders configuration changed concurrently; reload it and retry');
	}
	const prev = raw ? raw.toString('utf8') : '';
	const eol = prev.includes('\r\n') ? '\r\n' : '\n';
	const text = (prev.startsWith('\uFEFF') ? '\uFEFF' : '') + JSON.stringify(data, null, '\t').replace(/\n/g, eol) + (prev.endsWith('\n') ? eol : '');
	writeFileAtomic(configPath, text, {sync: true});
	return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
};
const slugify = name => 'folder-' + name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
const defaultManager = new FoldersCliManager();
const bound = Object.fromEntries([
	'addFolder', 'assignProject', 'listAll', 'listProjects', 'moveFolder', 'readConfig',
	'removeFolder', 'renameFolder', 'resolveFolder', 'resolveProject', 'setEnabled', 'unassignProject', 'writeConfig'
].map(k => [k, (...args) => defaultManager[k](...args)]));
const CLI_COMMANDS = {
	'add-folder': {min: 1, usage: 'add-folder <folder_name> [parent] [color] [configPath]', run: args => bound.addFolder(args[0], args[1], args[2], args[3])},
	assign: {min: 2, usage: 'assign <project_name> <folder_name>', run: args => bound.assignProject(args[0], args[1])},
	disable: {min: 0, run: () => bound.setEnabled(false)},
	enable: {min: 0, run: () => bound.setEnabled(true)},
	list: {min: 0, run: () => bound.listAll()},
	'move-folder': {min: 1, usage: 'move-folder <folder_id_or_name> <new_parent_or_root>', run: args => bound.moveFolder(args[0], args[1] || null)},
	projects: {min: 0, run: () => bound.listProjects()},
	'remove-folder': {min: 1, usage: 'remove-folder <folder_name_or_id>', run: args => bound.removeFolder(args[0])},
	'rename-folder': {min: 2, usage: 'rename-folder <old_name_or_id> <new_name>', run: args => bound.renameFolder(args[0], args[1])},
	unassign: {min: 1, usage: 'unassign <project_name>', run: args => bound.unassignProject(args[0])}
};
if (require.main === module) {
	const [,, cmd, ...args] = process.argv;
	const entry = CLI_COMMANDS[cmd];
	if (entry) {
		if (args.filter(Boolean).length < entry.min) {
			console.error(`Usage: node folders-manager.js ${entry.usage}`);
			process.exit(1);
		}
		entry.run(args);
	}
	else {
		console.log(['Folder management commands:', ...Object.entries(CLI_COMMANDS).map(([name, spec]) => `\tnode folders-manager.js ${spec.usage || name}`)].join('\n'));
		bound.listAll();
	}
}
module.exports = {DEFAULT_CONFIG_PATH, FoldersCliManager, ...bound, getDescendantIds, getFolderPath, persistConfig, validateTree};
