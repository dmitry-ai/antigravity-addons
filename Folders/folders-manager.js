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
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {writeFileAtomic} = require('../Upgrade/process-io');
const model = require('./folders-model');
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'folders.json').replace(/\\/g, '/');
const DEFAULT_PROJECTS_DIR = path.join(process.env.USERPROFILE || os.homedir(), '.gemini/config/projects').replace(/\\/g, '/');
const {getDescendantIds, getFolderPath, validateFolders: validateTree} = model;
const slugify = name => 'folder-' + name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
class FoldersCliManager {
	constructor({configPath = DEFAULT_CONFIG_PATH, fs: fileSystem = fs, logger = console, projectsDir = DEFAULT_PROJECTS_DIR} = {}) {
		this.configPath = configPath;
		this.fs = fileSystem;
		this.logger = logger;
		this.projectsDir = projectsDir;
		this.revisions = new WeakMap();
	}
	addFolder(input, parentQuery = null, color = '#10b981', configPath = this.configPath) {
		const isObject = 'object' === typeof input && null !== input;
		const name = String(isObject ? input.name : input).trim();
		const rawParent = isObject ? input.parentId || null : parentQuery;
		const customId = isObject ? input.id || null : null;
		const folderColor = isObject ? input.color || '#10b981' : color || '#10b981';
		const targetConfig = isObject ? parentQuery || this.configPath : configPath;
		return this.mutateConfig(targetConfig, data => {
			let r;
			const parentId = rawParent ? this.findFolder(data.folders, rawParent)?.id || null : null;
			const sibling = data.folders.find(f => parentId === (f.parentId || null) && name.toLowerCase() === f.name.toLowerCase());
			if (sibling) {
				sibling.color = folderColor;
				this.logger.log(`✅ Folder "${name}" (${sibling.id}) under parent "${parentId || 'root'}" updated.`);
				r = {next: data, result: sibling};
			}
			else {
				const baseId = customId || slugify(name);
				let id = baseId;
				let seq = 1;
				while (data.folders.some(f => id === f.id)) {
					id = `${baseId}-${seq++}`;
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
			let r = {result: false};
			const project = this.resolveProject(projQuery);
			const folder = project ? this.findFolder(data.folders, folderQuery) : null;
			if (!project) {
				this.logger.error(`❌ Project "${projQuery}" not found.`);
			}
			else if (!folder) {
				this.logger.error(`❌ Folder "${folderQuery}" not found. Create it first: node folders-manager.js add-folder "${folderQuery}"`);
			}
			else {
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
				if (pathMatch) {
					r = pathMatch;
				}
				else {
					const exact = folders.filter(f => qLower === f.name.toLowerCase());
					r = exact.find(f => null === (f.parentId || null)) || exact[0] || folders.find(f => f.name.toLowerCase().includes(qLower)) || null;
				}
			}
		}
		return r;
	}
	listAll(configPath = this.configPath) {
		const data = this.readConfig(configPath);
		const projectMap = new Map();
		for (const p of this.loadAntigravityProjects()) {
			if (p.id && model.INTERNAL_PROJECT_ID !== p.id && !projectMap.has(p.id)) {
				projectMap.set(p.id, p);
			}
		}
		for (const pid of Object.keys(data.projectFolderMap || {})) {
			if (pid && model.INTERNAL_PROJECT_ID !== pid && !projectMap.has(pid)) {
				projectMap.set(pid, {id: pid, name: pid});
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
		this.loadAntigravityProjects()
			.filter(p => model.INTERNAL_PROJECT_ID !== p.id)
			.sort(model.compare)
			.forEach(p => {
				const fId = data.projectFolderMap[p.id];
				const folderPathStr = fId ? `📁 ${getFolderPath(fId, data.folders)}` : '— (unassigned)';
				this.logger.log(`- ${p.name.padEnd(38)} | Folder: ${folderPathStr}`);
			});
		this.logger.log('');
	}
	loadAntigravityProjects() {
		const r = [];
		try {
			if (this.fs.existsSync(this.projectsDir)) {
				for (const f of this.fs.readdirSync(this.projectsDir)) {
					if (f.endsWith('.json')) {
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
		}
		catch (err) {
			this.logger.warn('[folders-manager] Could not read Antigravity projects:', err.message);
		}
		return r;
	}
	moveFolder(query, newParentQuery, configPath = this.configPath) {
		return this.mutateConfig(configPath, data => {
			let r = {result: false};
			const folder = this.findFolder(data.folders, query);
			const isRoot = !newParentQuery || 'root' === newParentQuery || 'null' === newParentQuery;
			const parentFolder = folder && !isRoot ? this.findFolder(data.folders, newParentQuery) : null;
			if (!folder) {
				this.logger.error(`❌ Folder "${query}" not found.`);
			}
			else if (!isRoot && !parentFolder) {
				this.logger.error(`❌ Target parent folder "${newParentQuery}" not found.`);
			}
			else {
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
			let r = {result: false};
			const folder = this.findFolder(data.folders, query);
			if (!folder) {
				this.logger.error(`❌ Folder "${query}" not found.`);
			}
			else {
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
			let r = {result: false};
			const target = this.findFolder(data.folders, query);
			const cleanName = String(newName || '').trim();
			if (!target) {
				this.logger.error(`❌ Folder "${query}" not found.`);
			}
			else {
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
			let r = {result: false};
			const project = this.resolveProject(projQuery);
			const oldFolderId = project ? data.projectFolderMap[project.id] : null;
			if (!project) {
				this.logger.error(`❌ Project "${projQuery}" not found.`);
			}
			else if (!oldFolderId) {
				this.logger.log(`ℹ️ Project "${project.name}" is not in any folder (already at root).`);
				r = {result: true};
			}
			else {
				const oldFolder = data.folders.find(f => oldFolderId === f.id);
				const next = model.applyAction(data, {action: 'unassign-project', projectId: project.id});
				this.logger.log(`✅ Project "${project.name}" removed from folder "${oldFolder?.name || oldFolderId}" (moved to root).`);
				r = {next, result: true};
			}
			return r;
		});
	}
	writeConfig(data, configPath = this.configPath, {expectedHash = this.revisions.get(data)} = {}) {
		model.validateConfig(data);
		const previousText = this.fs.existsSync(configPath) ? this.fs.readFileSync(configPath, 'utf8') : '';
		const newline = previousText.includes('\r\n') ? '\r\n' : '\n';
		let text = JSON.stringify(data, null, '\t').replace(/\n/g, newline);
		if (previousText.endsWith('\n')) {
			text += newline;
		}
		if (previousText.startsWith('\uFEFF')) {
			text = '\uFEFF' + text;
		}
		writeFileAtomic(configPath, text, {
			sync: true,
			beforeRename: () => {
				if (expectedHash && (!this.fs.existsSync(configPath) || expectedHash !== crypto.createHash('sha256').update(this.fs.readFileSync(configPath)).digest('hex'))) {
					throw Error('Folders configuration changed concurrently; reload it and retry');
				}
			}
		});
		this.revisions.set(data, crypto.createHash('sha256').update(this.fs.readFileSync(configPath)).digest('hex'));
	}
}
const defaultManager = new FoldersCliManager();
const addFolder = (...args) => defaultManager.addFolder(...args);
const assignProject = (...args) => defaultManager.assignProject(...args);
const listAll = (...args) => defaultManager.listAll(...args);
const listProjects = (...args) => defaultManager.listProjects(...args);
const moveFolder = (...args) => defaultManager.moveFolder(...args);
const readConfig = (...args) => defaultManager.readConfig(...args);
const removeFolder = (...args) => defaultManager.removeFolder(...args);
const renameFolder = (...args) => defaultManager.renameFolder(...args);
const resolveFolder = (...args) => defaultManager.resolveFolder(...args);
const resolveProject = (...args) => defaultManager.resolveProject(...args);
const setEnabled = (...args) => defaultManager.setEnabled(...args);
const unassignProject = (...args) => defaultManager.unassignProject(...args);
const writeConfig = (...args) => defaultManager.writeConfig(...args);
const CLI_COMMANDS = {
	'add-folder': {min: 1, usage: 'add-folder <folder_name> [parent] [color] [configPath]', run: args => addFolder(args[0], args[1], args[2], args[3])},
	assign: {min: 2, usage: 'assign <project_name> <folder_name>', run: args => assignProject(args[0], args[1])},
	disable: {min: 0, run: () => setEnabled(false)},
	enable: {min: 0, run: () => setEnabled(true)},
	list: {min: 0, run: () => listAll()},
	'move-folder': {min: 1, usage: 'move-folder <folder_id_or_name> <new_parent_or_root>', run: args => moveFolder(args[0], args[1] || null)},
	projects: {min: 0, run: () => listProjects()},
	'remove-folder': {min: 1, usage: 'remove-folder <folder_name_or_id>', run: args => removeFolder(args[0])},
	'rename-folder': {min: 2, usage: 'rename-folder <old_name_or_id> <new_name>', run: args => renameFolder(args[0], args[1])},
	unassign: {min: 1, usage: 'unassign <project_name>', run: args => unassignProject(args[0])}
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
		console.log([
			'Folder management commands:',
			...Object.entries(CLI_COMMANDS).map(([name, spec]) => `\tnode folders-manager.js ${spec.usage || name}`)
		].join('\n'));
		listAll();
	}
}
module.exports = {
	DEFAULT_CONFIG_PATH,
	FoldersCliManager,
	addFolder,
	assignProject,
	getDescendantIds,
	getFolderPath,
	listAll,
	listProjects,
	moveFolder,
	readConfig,
	removeFolder,
	renameFolder,
	resolveFolder,
	resolveProject,
	setEnabled,
	unassignProject,
	validateTree,
	writeConfig
};
