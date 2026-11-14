// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders around standalone v2 architecture, delegated events, UMD test exports, and shared folders-model mutations":
// https://github.com/dmitry-ai/antigravity-addons/issues/24
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Unify Folders domain validation, tree traversal helpers, store checks, and CLI listing/mutations around folders-model.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/31
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Extract FolderRowBuilder, FolderActionDispatcher, and FoldersCliManager ES6 classes in Folders/folders-model.js and folders-manager.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/42
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders module loader, tree indexer, declarative DOM helper, and CAS store/CLI wrappers":
// https://github.com/dmitry-ai/antigravity-addons/issues/44
const INTERNAL_PROJECT_ID = 'cbe5c5cf-0878-4b4c-abe4-39d46e0b5b40';
const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
class FolderActionDispatcher {
	constructor(original, action) {
		this.data = structuredClone('save-config' === action.action ? action.data : original);
		this.action = action;
	}
	addFolder() {
		if (this.action.parentId) {
			this.findFolder(this.action.parentId);
		}
		this.data.folders.push({id: this.action.id || `folder-${crypto.randomUUID()}`, name: String(this.action.name || '').trim(), parentId: this.action.parentId || null, color: this.action.color || '#10b981'});
	}
	apply() {
		const handlers = {'add-folder': () => this.addFolder(), 'assign-project': () => this.assignProject(), 'move-folder': () => this.moveFolder(), 'remove-folder': () => this.removeFolder(), 'rename-folder': () => this.renameFolder(), 'save-config': () => {}, 'unassign-project': () => this.unassignProject()};
		const handler = handlers[this.action.action];
		if (!handler) {
			throw Error('Unknown folder action');
		}
		handler();
		validateConfig(this.data);
		return this.data;
	}
	assignProject() {
		this.requireProjectId();
		this.findFolder(this.action.folderId);
		this.data.projectFolderMap[this.action.projectId] = this.action.folderId;
	}
	findFolder(id) {
		const r = this.data.folders.find(item => id === item.id);
		if (!r) {
			throw Error(`Folder id not found: ${id}`);
		}
		return r;
	}
	moveFolder() {
		if (this.action.newParentId) {
			this.findFolder(this.action.newParentId);
		}
		this.findFolder(this.action.id).parentId = this.action.newParentId || null;
	}
	removeFolder() {
		const target = this.findFolder(this.action.id);
		const parentId = target.parentId || null;
		for (const item of this.data.folders) {
			if (target.id === item.parentId) {
				item.parentId = parentId;
			}
		}
		for (const [id, assigned] of Object.entries(this.data.projectFolderMap)) {
			if (target.id === assigned) {
				if (!parentId) {
					delete this.data.projectFolderMap[id];
				}
				else {
					this.data.projectFolderMap[id] = parentId;
				}
			}
		}
		this.data.folders = this.data.folders.filter(item => target.id !== item.id);
	}
	renameFolder() {
		this.findFolder(this.action.id).name = String(this.action.newName || '').trim();
	}
	requireProjectId() {
		if ('string' !== typeof this.action.projectId || !this.action.projectId) {
			throw Error('Exact project id is required');
		}
	}
	unassignProject() {
		this.requireProjectId();
		delete this.data.projectFolderMap[this.action.projectId];
	}
}
class FolderRowBuilder {
	constructor({collapsed = new Set(), data, hideOutsideProject = false, hideStandaloneConversations = false, projects, summaries = new Map()}) {
		Object.assign(this, {
			data, projects, summaries, collapsed, hideOutsideProject, hideStandaloneConversations,
			ids: null, children: null, assigned: new Map(), conversations: new Map(), pinned: [],
			projectIds: new Set(), archivedProjectIds: new Set(), activeProjects: new Set(), activeFolders: new Set(), rows: []
		});
	}
	append(map, key, value) {
		if (!map.has(key)) {
			map.set(key, []);
		}
		map.get(key).push(value);
	}
	appendConversationRows(projectId, folderId, depth) {
		for (const {id, summary} of this.conversations.get(projectId) || []) {
			this.rows.push(this.conversationRow({depth, folderId, id, pinned: false, projectId, summary}));
		}
	}
	appendPinnedSection() {
		if (this.pinned.length) {
			this.rows.push({kind: 'section', key: 'pinned', name: 'Pinned conversations', depth: 0});
			for (const {id, summary, projectId} of this.pinned) {
				this.rows.push(this.conversationRow({depth: 0, folderId: this.data.projectFolderMap?.[projectId], id, pinned: true, projectId, summary}));
			}
		}
	}
	appendProjectRows(folderId, depth) {
		for (const project of this.assigned.get(folderId) || []) {
			const key = `project:${project.id}`;
			const expanded = !this.collapsed.has(key);
			this.rows.push({kind: 'project', key, id: project.id, folderId, depth, name: project.name || project.id, expanded, running: this.activeProjects.has(project.id), project});
			if (expanded) {
				this.appendConversationRows(project.id, folderId, depth + 1);
			}
		}
	}
	appendStandaloneSection() {
		if (!this.hideStandaloneConversations && this.conversations.has(null)) {
			this.rows.push({kind: 'section', key: 'standalone', name: 'Conversations', depth: 0});
			this.appendConversationRows(null, null, 0);
		}
	}
	build() {
		this.indexFolders();
		this.indexProjects();
		this.indexSummaries();
		this.sortCollections();
		this.markActiveFolders();
		this.appendPinnedSection();
		this.visitFolder(null, 0);
		this.appendProjectRows(null, 0);
		this.appendStandaloneSection();
		return this.rows;
	}
	conversationRow({depth, folderId, id, pinned, projectId, summary}) {
		return {kind: 'conversation', key: `conversation:${id}`, id, projectId, folderId, depth, name: summaryName(summary), status: summary.status || '', running: active(summary), summary, ...(pinned ? {pinned: true} : {})};
	}
	indexFolders() {
		const {byId, children} = indexTree(this.data.folders, {sort: true, validate: true});
		this.ids = byId;
		this.children = children;
	}
	indexProjects() {
		// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
		// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
		// https://github.com/dmitry-ai/antigravity-addons/issues/12
		for (const project of this.projects) {
			if (!project.id || this.projectIds.has(project.id)) {
				throw Error('Missing or duplicate native project id');
			}
			this.projectIds.add(project.id);
			if (project.archived) {
				this.archivedProjectIds.add(project.id);
			}
			else if (this.isVisibleProject(project)) {
				const folderId = this.data.projectFolderMap?.[project.id];
				this.append(this.assigned, this.ids.has(folderId) ? folderId : null, project);
			}
		}
	}
	indexSummaries() {
		for (const [id, summary] of this.summaries) {
			if (this.isVisibleSummary(id, summary)) {
				const projectId = summaryProject(summary);
				if (active(summary) && projectId) {
					this.activeProjects.add(projectId);
				}
				if (summary.annotations?.pinned) {
					this.pinned.push({id, summary, projectId});
				}
				else {
					this.append(this.conversations, this.projectIds.has(projectId) ? projectId : null, {id, summary});
				}
			}
		}
	}
	isVisibleProject(project) {
		return !project.archived
			&& !(this.hideOutsideProject && 'outside-of-project' === project.id)
			&& !(INTERNAL_PROJECT_ID === project.id && 'project-folders/folders' === project.name);
	}
	isVisibleSummary(id, summary) {
		return !summary.annotations?.archived
			&& !summary.annotations?.isArchived
			&& !summary.trajectoryMetadata?.parentConversationId
			&& !(summary.trajectoryMetadata?.rootConversationId && id !== summary.trajectoryMetadata.rootConversationId)
			&& !this.archivedProjectIds.has(summaryProject(summary));
	}
	markActiveFolders() {
		for (const projectId of this.activeProjects) {
			for (let folder = this.ids.get(this.data.projectFolderMap?.[projectId]); folder; folder = this.ids.get(folder.parentId)) {
				this.activeFolders.add(folder.id);
			}
		}
	}
	sortCollections() {
		for (const list of this.assigned.values()) {
			list.sort(compare);
		}
		for (const list of [this.pinned, ...this.conversations.values()]) {
			list.sort((a, b) => timestamp(b.summary.lastModifiedTime) - timestamp(a.summary.lastModifiedTime) || a.id.localeCompare(b.id));
		}
	}
	visitFolder(parentId, depth) {
		for (const folder of this.children.get(parentId) || []) {
			const key = `folder:${folder.id}`;
			const expanded = !this.collapsed.has(key);
			this.rows.push({kind: 'folder', key, id: folder.id, folderId: folder.id, depth, name: folder.name, expanded, running: this.activeFolders.has(folder.id)});
			if (expanded) {
				this.visitFolder(folder.id, depth + 1);
				this.appendProjectRows(folder.id, depth + 1);
				if (!this.children.has(folder.id) && !this.assigned.has(folder.id)) {
					this.rows.push({kind: 'empty', key: `empty:${folder.id}`, folderId: folder.id, depth: depth + 1, name: '(empty folder)'});
				}
			}
		}
	}
}
const active = summary => !!(summary.hasRunningSubagents || summary.notFullyIdle || summary.hasActiveChildren || /RUNNING|GENERATING|STREAMING|QUEUED|PENDING/.test(summary.status || ''));
const applyAction = (original, action) => new FolderActionDispatcher(original, action).apply();
const applySummaryUpdate = (current, message) => {
	if (!message || 'object' !== typeof message || Array.isArray(message)) {
		throw Error('Invalid conversation stream message');
	}
	if (undefined !== message.updates && (!message.updates || 'object' !== typeof message.updates || Array.isArray(message.updates))) {
		throw Error('Invalid conversation updates');
	}
	if (undefined !== message.deletes && (!Array.isArray(message.deletes) || message.deletes.some(id => 'string' !== typeof id))) {
		throw Error('Invalid conversation deletes');
	}
	if (Object.keys(message).length && undefined === message.updates && undefined === message.deletes) {
		throw Error('Conversation API contract changed: no updates/deletes');
	}
	const r = new Map(current);
	for (const [id, value] of Object.entries(message.updates || {})) {
		if (!id || !value || 'object' !== typeof value || Array.isArray(value)) {
			throw Error('Invalid conversation identity');
		}
		r.set(id, value);
	}
	for (const id of message.deletes || []) {
		r.delete(id);
	}
	return r;
};
const buildRows = options => new FolderRowBuilder(options).build();
const compare = (a, b) => collator.compare(a.name || '', b.name || '') || a.id.localeCompare(b.id);
const getDescendantIds = (folderId, folders = []) => {
	const r = new Set();
	const {children} = indexTree(folders);
	const collect = id => {
		for (const child of children.get(id) || []) {
			if (!r.has(child.id)) {
				r.add(child.id);
				collect(child.id);
			}
		}
	};
	collect(folderId);
	return r;
};
const getFolderPath = (folderId, folders = []) => {
	const parts = [];
	const {byId} = indexTree(folders);
	const seen = new Set();
	for (let curr = byId.get(folderId); curr && !seen.has(curr.id); curr = curr.parentId ? byId.get(curr.parentId) : null) {
		seen.add(curr.id);
		parts.unshift(curr.name);
	}
	return parts.join(' / ');
};
const indexTree = (folders = [], {compare: cmp = compare, excludedIds = null, sort = false, validate = false} = {}) => {
	if (validate && !Array.isArray(folders)) {
		throw Error('folders must be an array');
	}
	const list = Array.isArray(folders) ? (excludedIds ? folders.filter(f => !excludedIds.has(f.id)) : folders) : [];
	const byId = new Map();
	for (const folder of list) {
		if (validate) {
			if ('string' !== typeof folder.id || !folder.id || byId.has(folder.id)) {
				throw Error('Invalid or duplicate folder id');
			}
			if ('string' !== typeof folder.name || !folder.name.trim()) {
				throw Error('Folder name must not be empty');
			}
		}
		byId.set(folder.id, folder);
	}
	const children = new Map();
	const siblings = validate ? new Set() : null;
	for (const folder of list) {
		if (validate) {
			const visited = new Set([folder.id]);
			for (let parent = folder.parentId; parent; parent = byId.get(parent).parentId) {
				if (visited.has(parent)) {
					throw Error('Cycle detected in folder hierarchy');
				}
				if (!byId.has(parent)) {
					throw Error(`Missing parent folder: ${parent}`);
				}
				visited.add(parent);
			}
			const key = JSON.stringify([folder.parentId || null, folder.name.trim().toLowerCase()]);
			if (siblings.has(key)) {
				throw Error('Sibling folder name collision');
			}
			siblings.add(key);
		}
		const parentId = validate ? folder.parentId || null : byId.has(folder.parentId) ? folder.parentId : null;
		if (!children.has(parentId)) {
			children.set(parentId, []);
		}
		children.get(parentId).push(folder);
	}
	if (sort) {
		for (const items of children.values()) {
			items.sort(cmp);
		}
	}
	return {byId, children};
};
const summaryName = summary => summary.annotations?.title || summary.summary || 'New conversation';
const summaryProject = summary => summary.trajectoryMetadata?.projectId || null;
const timestamp = value => 'string' === typeof value
	? Date.parse(value) || 0
	: value && 'object' === typeof value
		? Number(value.seconds || 0) * 1000 + Number(value.nanos || 0) / 1e6
		: 0;
const validateConfig = data => {
	if (!data || 'object' !== typeof data || Array.isArray(data)) {
		throw Error('Invalid folders configuration');
	}
	const ids = validateFolders(data.folders);
	if (!data.projectFolderMap || 'object' !== typeof data.projectFolderMap || Array.isArray(data.projectFolderMap)) {
		throw Error('Invalid projectFolderMap');
	}
	for (const [projectId, folderId] of Object.entries(data.projectFolderMap)) {
		if (!projectId || 'string' !== typeof folderId || !ids.has(folderId)) {
			throw Error(`Invalid folder assignment: ${projectId}`);
		}
	}
	return ids;
};
const validateFolders = folders => indexTree(folders, {validate: true}).byId;
module.exports = {
	FolderActionDispatcher, FolderRowBuilder, INTERNAL_PROJECT_ID,
	active, applyAction, applySummaryUpdate, buildRows, compare,
	getDescendantIds, getFolderPath, indexTree, summaryName, summaryProject, validateConfig, validateFolders
};
