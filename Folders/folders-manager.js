// 2026-10-12 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement left-sidebar project folders (Folders), CLI manager, installer scripts, and remove right-panel sidecar prototype":
// https://github.com/dmitry-ai/antigravity-addons/issues/3
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders around standalone v2 architecture, delegated events, UMD test exports, and shared folders-model mutations":
// https://github.com/dmitry-ai/antigravity-addons/issues/24
const fs = require('fs');
const os = require('node:os');
const path = require('path');
const crypto = require('node:crypto');
const model = require('./folders-model');
const revisions = new WeakMap();
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'folders.json').replace(/\\/g, '/');
const PROJECTS_DIR = path.join(process.env.USERPROFILE || os.homedir(), '.gemini/config/projects').replace(/\\/g, '/');
function loadAntigravityProjects() {
	const r = [];
	try {
		if (fs.existsSync(PROJECTS_DIR)) {
			const files = fs.readdirSync(PROJECTS_DIR);
			for (const f of files) {
				if (f.endsWith('.json')) {
					try {
						const data = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8'));
						if (data.id) {
							r.push({
								id: data.id,
								name: data.name || 'Untitled Project'
							});
						}
					}
					catch (_) {}
				}
			}
		}
	}
	catch (err) {
		console.warn('[folders-manager] Could not read Antigravity projects:', err.message);
	}
	return r;
}
function resolveProject(query) {
	let r;
	result: {
		if (!query) {
			r = null;
			break result;
		}
		const projects = loadAntigravityProjects();
		const qLower = query.toLowerCase().trim();
		const byId = projects.find(p => query === p.id);
		if (byId) {
			r = byId;
			break result;
		}
		const byExactName = projects.find(p => qLower === p.name.toLowerCase());
		if (byExactName) {
			r = byExactName;
			break result;
		}
		const bySub = projects.filter(p => p.name.toLowerCase().includes(qLower));
		if (1 === bySub.length) {
			r = bySub[0];
			break result;
		}
		if (1 < bySub.length) {
			console.warn(`Ambiguous project name "${query}". Matches:`, bySub.map(p => `"${p.name}" (${p.id})`));
			r = bySub[0];
			break result;
		}
		r = {id: query, name: query};
	}
	return r;
}
function readConfig(configPath = DEFAULT_CONFIG_PATH) {
	let r;
	result: {
		if (fs.existsSync(configPath)) {
			const raw = fs.readFileSync(configPath, 'utf8');
			r = JSON.parse(raw.replace(/^\uFEFF/, ''));
			revisions.set(r, crypto.createHash('sha256').update(raw).digest('hex'));
			break result;
		}
		r = {folders: [], projectFolderMap: {}, collapsedFolders: []};
	}
	return r;
}
// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
function writeConfig(data, configPath = DEFAULT_CONFIG_PATH, {expectedHash = revisions.get(data)} = {}) {
	validateTree(data.folders);
	const dir = path.dirname(configPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, {recursive: true});
	}
	const temporary = path.join(dir, `.${path.basename(configPath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
	try {
		const previousText = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
		const newline = previousText.includes('\r\n') ? '\r\n' : '\n';
		let text = JSON.stringify(data, null, '\t').replace(/\n/g, newline);
		if (previousText.endsWith('\n')) {
			text += newline;
		}
		if (previousText.startsWith('\uFEFF')) {
			text = '\uFEFF' + text;
		}
		const descriptor = fs.openSync(temporary, 'wx');
		try {
			fs.writeFileSync(descriptor, text);
			fs.fsyncSync(descriptor);
		}
		finally {
			fs.closeSync(descriptor);
		}
		if (expectedHash && (!fs.existsSync(configPath) || expectedHash !== crypto.createHash('sha256').update(fs.readFileSync(configPath)).digest('hex'))) {
			throw Error('Folders configuration changed concurrently; reload it and retry');
		}
		fs.renameSync(temporary, configPath);
		revisions.set(data, crypto.createHash('sha256').update(fs.readFileSync(configPath)).digest('hex'));
	}
	finally {
		fs.rmSync(temporary, {force: true});
	}
}
function validateTree(folders) {
	return model.validateFolders(folders);
}
// 2026-10-12 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Add interactive GUI folder management (folders-client.js), nested parentId hierarchy, drag-and-drop, Windows Explorer sorting, and adaptive Light/Dark menus":
// https://github.com/dmitry-ai/antigravity-addons/issues/4
function getDescendantIds(folderId, folders) {
	return model.getDescendantIds(folderId, folders);
}
function getFolderPath(folderId, folders) {
	return model.getFolderPath(folderId, folders);
}
function resolveFolder(query, configPath = DEFAULT_CONFIG_PATH) {
	let r;
	result: {
		if (!query) {
			r = null;
			break result;
		}
		const data = readConfig(configPath);
		const qTrim = query.trim();
		const qLower = qTrim.toLowerCase();
		const byId = data.folders.find(f => qTrim === f.id);
		if (byId) {
			r = byId;
			break result;
		}
		if (qTrim.includes('/')) {
			const pathParts = qTrim.split('/').map(p => p.trim().toLowerCase());
			let currentParentId = null;
			let currentMatch = null;
			for (const part of pathParts) {
				currentMatch = data.folders.find(f => currentParentId === (f.parentId || null) && part === f.name.toLowerCase());
				if (!currentMatch) {
					break;
				}
				currentParentId = currentMatch.id;
			}
			if (currentMatch) {
				r = currentMatch;
				break result;
			}
		}
		const byExactName = data.folders.filter(f => qLower === f.name.toLowerCase());
		if (1 === byExactName.length) {
			r = byExactName[0];
			break result;
		}
		if (1 < byExactName.length) {
			r = byExactName.find(f => null === f.parentId) || byExactName[0];
			break result;
		}
		const bySub = data.folders.filter(f => f.name.toLowerCase().includes(qLower));
		if (1 <= bySub.length) {
			r = bySub[0];
			break result;
		}
		r = null;
	}
	return r;
}
// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Integrate with universal dmitry-ai/harness, format codebase per P.md/P.ES6.md/P.Bash.md, and link source files to GitHub Issues":
// https://github.com/dmitry-ai/antigravity-addons/issues/16
function slugify(name) {
	return 'folder-' + name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}
function addFolder(arg1, arg2 = null, arg3 = null, arg4 = '#10b981', configPath = DEFAULT_CONFIG_PATH) {
	let r;
	result: {
		let name;
		let parentId = null;
		let customId = null;
		let color = '#10b981';
		let targetConfig = DEFAULT_CONFIG_PATH;
		if ('object' === typeof arg1 && null !== arg1) {
			name = arg1.name;
			parentId = arg1.parentId || null;
			customId = arg1.id || null;
			color = arg1.color || '#10b981';
			targetConfig = arg2 || DEFAULT_CONFIG_PATH;
		}
		else if ('string' === typeof arg1 && (arg1.startsWith('fld-') || arg1.startsWith('folder-')) && 'string' === typeof arg2) {
			customId = arg1;
			name = arg2;
			color = 'string' === typeof arg3 ? arg3 : '#10b981';
			targetConfig = 'string' === typeof arg4 ? arg4 : DEFAULT_CONFIG_PATH;
		}
		else {
			name = arg1;
			if ('string' === typeof arg2) {
				const data = readConfig(configPath);
				if (data.folders.some(f => arg2 === f.id)) {
					parentId = arg2;
				}
				else if (arg2.startsWith('fld-') || arg2.startsWith('folder-')) {
					customId = arg2;
				}
				else {
					parentId = arg2;
				}
			}
			if ('string' === typeof arg3) {
				if (arg3.startsWith('#')) {
					color = arg3;
				}
				else {
					customId = arg3;
				}
			}
			if ('string' === typeof arg4 && !arg4.startsWith('#')) {
				targetConfig = arg4;
			}
			else if ('string' === typeof configPath) {
				targetConfig = configPath;
			}
		}
		const data = readConfig(targetConfig);
		if (!parentId) {
			parentId = null;
		}
		else {
			const parentFolder = data.folders.find(f => parentId === f.id || parentId.toLowerCase() === f.name.toLowerCase());
			parentId = parentFolder ? parentFolder.id : null;
		}
		const sibling = data.folders.find(f => parentId === (f.parentId || null) && name.toLowerCase() === f.name.toLowerCase());
		if (sibling) {
			sibling.color = color;
			writeConfig(data, targetConfig);
			console.log(`✅ Folder "${name}" (${sibling.id}) under parent "${parentId || 'root'}" updated.`);
			r = sibling;
			break result;
		}
		let id = customId || slugify(name);
		let idCounter = 1;
		while (data.folders.some(f => id === f.id)) {
			id = `${customId || slugify(name)}-${idCounter++}`;
		}
		const next = model.applyAction(data, {action: 'add-folder', id, name, parentId, color, isExpanded: true});
		writeConfig(next, targetConfig, {expectedHash: revisions.get(data)});
		console.log(`✅ Created folder "${name}" (ID: ${id}, Parent: ${parentId || 'root'}).`);
		r = next.folders.find(f => id === f.id);
	}
	return r;
}
function renameFolder(query, newName, configPath = DEFAULT_CONFIG_PATH) {
	let r;
	result: {
		const data = readConfig(configPath);
		const target = resolveFolder(query, configPath);
		if (!target) {
			console.error(`❌ Folder "${query}" not found.`);
			r = false;
			break result;
		}
		const cleanName = newName.trim();
		const collision = data.folders.find(f => target.id !== f.id && (target.parentId || null) === (f.parentId || null) && cleanName.toLowerCase() === f.name.toLowerCase());
		if (collision) {
			console.error(`❌ A folder named "${cleanName}" already exists in the same branch.`);
			r = false;
			break result;
		}
		const next = model.applyAction(data, {action: 'rename-folder', id: target.id, newName: cleanName});
		writeConfig(next, configPath, {expectedHash: revisions.get(data)});
		console.log(`✅ Folder "${target.name}" renamed to "${cleanName}" (ID: ${target.id}).`);
		r = true;
	}
	return r;
}
function moveFolder(query, newParentQuery, configPath = DEFAULT_CONFIG_PATH) {
	let r;
	result: {
		const data = readConfig(configPath);
		const folder = resolveFolder(query, configPath);
		if (!folder) {
			console.error(`❌ Folder "${query}" not found.`);
			r = false;
			break result;
		}
		let newParentId = null;
		if (newParentQuery && 'root' !== newParentQuery && 'null' !== newParentQuery) {
			const parentFolder = resolveFolder(newParentQuery, configPath);
			if (!parentFolder) {
				console.error(`❌ Target parent folder "${newParentQuery}" not found.`);
				r = false;
				break result;
			}
			newParentId = parentFolder.id;
		}
		if (newParentId === folder.id) {
			console.error(`❌ Cannot move folder "${folder.name}" into itself.`);
			throw new Error('Cannot move folder into itself');
		}
		if (getDescendantIds(folder.id, data.folders).has(newParentId)) {
			console.error(`❌ Cannot move folder "${folder.name}" into its own subfolder (cycle detected).`);
			throw new Error('Cannot move folder into its own descendant (cycle detected)');
		}
		const collision = data.folders.find(f => folder.id !== f.id && newParentId === (f.parentId || null) && folder.name.toLowerCase() === f.name.toLowerCase());
		if (collision) {
			console.error(`❌ Target folder already contains an item named "${folder.name}".`);
			throw new Error(`Sibling folder name collision in destination: "${folder.name}"`);
		}
		const next = model.applyAction(data, {action: 'move-folder', id: folder.id, newParentId});
		writeConfig(next, configPath, {expectedHash: revisions.get(data)});
		console.log(`✅ Folder "${folder.name}" moved: ${folder.parentId || 'root'} ➔ ${newParentId || 'root'}.`);
		r = true;
	}
	return r;
}
function removeFolder(query, configPath = DEFAULT_CONFIG_PATH) {
	let r;
	result: {
		const data = readConfig(configPath);
		const folder = resolveFolder(query, configPath);
		if (!folder) {
			console.error(`❌ Folder "${query}" not found.`);
			r = false;
			break result;
		}
		const id = folder.id;
		const promotedFoldersCount = data.folders.filter(f => id === f.parentId).length;
		const promotedProjectsCount = Object.values(data.projectFolderMap).filter(fId => id === fId).length;
		const next = model.applyAction(data, {action: 'remove-folder', id});
		writeConfig(next, configPath, {expectedHash: revisions.get(data)});
		console.log(`✅ Folder "${folder.name}" (${id}) deleted. Promoted subfolders: ${promotedFoldersCount}, projects: ${promotedProjectsCount}.`);
		r = true;
	}
	return r;
}
function assignProject(projQuery, folderQuery, configPath = DEFAULT_CONFIG_PATH) {
	let r;
	result: {
		const project = resolveProject(projQuery);
		if (!project) {
			console.error(`❌ Project "${projQuery}" not found.`);
			r = false;
			break result;
		}
		const folder = resolveFolder(folderQuery, configPath);
		if (!folder) {
			console.error(`❌ Folder "${folderQuery}" not found. Create it first: node folders-manager.js add-folder "${folderQuery}"`);
			r = false;
			break result;
		}
		const data = readConfig(configPath);
		const next = model.applyAction(data, {action: 'assign-project', projectId: project.id, folderId: folder.id});
		writeConfig(next, configPath, {expectedHash: revisions.get(data)});
		console.log(`✅ Project "${project.name}" added to folder "${folder.name}".`);
		r = true;
	}
	return r;
}
function unassignProject(projQuery, configPath = DEFAULT_CONFIG_PATH) {
	let r;
	result: {
		const project = resolveProject(projQuery);
		if (!project) {
			console.error(`❌ Project "${projQuery}" not found.`);
			r = false;
			break result;
		}
		const data = readConfig(configPath);
		if (!data.projectFolderMap[project.id]) {
			console.log(`ℹ️ Project "${project.name}" is not in any folder (already at root).`);
			r = true;
			break result;
		}
		const oldFolderId = data.projectFolderMap[project.id];
		const oldFolder = data.folders.find(f => oldFolderId === f.id);
		const next = model.applyAction(data, {action: 'unassign-project', projectId: project.id});
		writeConfig(next, configPath, {expectedHash: revisions.get(data)});
		console.log(`✅ Project "${project.name}" removed from folder "${oldFolder?.name || oldFolderId}" (moved to root).`);
		r = true;
	}
	return r;
}
function listAll(configPath = DEFAULT_CONFIG_PATH) {
	const data = readConfig(configPath);
	const allProjects = loadAntigravityProjects();
	const projMap = new Map(allProjects.map(p => [p.id, p.name]));
	const childrenMap = new Map();
	for (const f of data.folders) {
		const pid = f.parentId || null;
		if (!childrenMap.has(pid)) {
			childrenMap.set(pid, []);
		}
		childrenMap.get(pid).push(f);
	}
	const projectsInFolder = new Map();
	for (const [pid, fid] of Object.entries(data.projectFolderMap)) {
		if (!projectsInFolder.has(fid)) {
			projectsInFolder.set(fid, []);
		}
		projectsInFolder.get(fid).push({id: pid, name: projMap.get(pid) || pid});
	}
	console.log('\n📁 Antigravity 2.0 Folder Hierarchy:\n');
	function printBranch(folder, depth = 0) {
		const indent = '    '.repeat(depth);
		const projs = (projectsInFolder.get(folder.id) || []).slice().sort(model.compare);
		const subs = (childrenMap.get(folder.id) || []).slice().sort(model.compare);
		console.log(`${indent}▾ 📁 ${folder.name} [ID: ${folder.id}] (${projs.length} projects)`);
		for (const sub of subs) {
			printBranch(sub, depth + 1);
		}
		for (const p of projs) {
			console.log(`${indent}    ↳ 📂 ${p.name}`);
		}
		if (0 === projs.length && 0 === subs.length) {
			console.log(`${indent}    (empty folder)`);
		}
	}
	const roots = (childrenMap.get(null) || []).slice().sort(model.compare);
	for (const rootFolder of roots) {
		printBranch(rootFolder, 0);
	}
	const assigned = new Set(Object.keys(data.projectFolderMap));
	const unassigned = allProjects
		.filter(p => !assigned.has(p.id) && model.INTERNAL_PROJECT_ID !== p.id)
		.sort(model.compare);
	if (0 < unassigned.length) {
		console.log(`\n📂 Unassigned projects (at root, ${unassigned.length}):`);
		unassigned.forEach(p => console.log(`    ↳ ${p.name}`));
	}
	console.log('');
}
function listProjects(configPath = DEFAULT_CONFIG_PATH) {
	const data = readConfig(configPath);
	const allProjects = loadAntigravityProjects();
	console.log('\n📋 All Antigravity Projects:\n');
	allProjects
		.filter(p => model.INTERNAL_PROJECT_ID !== p.id)
		.sort(model.compare)
		.forEach(p => {
			const fId = data.projectFolderMap[p.id];
			const folderPathStr = fId ? `📁 ${getFolderPath(fId, data.folders)}` : '— (unassigned)';
			console.log(`- ${p.name.padEnd(38)} | Folder: ${folderPathStr}`);
		});
	console.log('');
}
if (require.main === module) {
	const [,, cmd, arg1, arg2, arg3, arg4] = process.argv;
	switch (cmd) {
		case 'list':
			listAll();
			break;
		case 'projects':
			listProjects();
			break;
		case 'add-folder':
			if (!arg1) {
				console.error('Usage: node folders-manager.js add-folder <folder_name> [parentId] [id-or-color] [configPath]');
				process.exit(1);
			}
			addFolder(arg1, arg2, arg3, arg4);
			break;
		case 'rename-folder':
			if (!arg1 || !arg2) {
				console.error('Usage: node folders-manager.js rename-folder <old_name_or_id> <new_name>');
				process.exit(1);
			}
			renameFolder(arg1, arg2);
			break;
		case 'move-folder':
			if (!arg1) {
				console.error('Usage: node folders-manager.js move-folder <folder_id_or_name> <new_parent_or_root>');
				process.exit(1);
			}
			moveFolder(arg1, arg2 || null);
			break;
		case 'remove-folder':
			if (!arg1) {
				console.error('Usage: node folders-manager.js remove-folder <folder_name_or_id>');
				process.exit(1);
			}
			removeFolder(arg1);
			break;
		case 'assign':
			if (!arg1 || !arg2) {
				console.error('Usage: node folders-manager.js assign <project_name> <folder_name>');
				process.exit(1);
			}
			assignProject(arg1, arg2);
			break;
		case 'unassign':
			if (!arg1) {
				console.error('Usage: node folders-manager.js unassign <project_name>');
				process.exit(1);
			}
			unassignProject(arg1);
			break;
		default:
			console.log([
				'Folder management commands (Method 1: Hierarchical folders):',
				'\tnode folders-manager.js list                         - Show folder and project tree',
				'\tnode folders-manager.js projects                     - List all Antigravity projects',
				'\tnode folders-manager.js add-folder <name> [parent]   - Create folder (or subfolder in [parent])',
				'\tnode folders-manager.js rename-folder <folder> <name> - Rename folder',
				'\tnode folders-manager.js move-folder <folder> <target> - Move folder to another parent (or root)',
				'\tnode folders-manager.js remove-folder <folder>       - Delete folder (subfolders and projects are promoted)',
				'\tnode folders-manager.js assign <project> <folder>    - Assign project to folder',
				'\tnode folders-manager.js unassign <project>           - Remove project from folder (return to root)'
			].join('\n'));
			listAll();
	}
}
module.exports = {
	readConfig,
	writeConfig,
	validateTree,
	getDescendantIds,
	getFolderPath,
	addFolder,
	renameFolder,
	moveFolder,
	removeFolder,
	assignProject,
	unassignProject,
	resolveProject,
	resolveFolder,
	listAll,
	listProjects,
	DEFAULT_CONFIG_PATH
};
