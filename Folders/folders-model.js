(function(factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else window.AntigravityFoldersModel = api;
})(() => {
	const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
	const compare = (a, b) => collator.compare(a.name || '', b.name || '') || a.id.localeCompare(b.id);
	const active = summary => !!(summary.hasRunningSubagents || summary.notFullyIdle || summary.hasActiveChildren || /RUNNING|GENERATING|STREAMING|QUEUED|PENDING/.test(summary.status || ''));
	const timestamp = value => typeof value === 'string' ? Date.parse(value) || 0 : value && typeof value === 'object' ? Number(value.seconds || 0) * 1000 + Number(value.nanos || 0) / 1e6 : 0;
	const validateFolders = folders => {
		if (!Array.isArray(folders)) throw Error('folders must be an array');
		const ids = new Map();
		for (const folder of folders) {
			if (typeof folder.id !== 'string' || !folder.id || ids.has(folder.id)) throw Error('Invalid or duplicate folder id');
			if (typeof folder.name !== 'string' || !folder.name.trim()) throw Error('Folder name must not be empty');
			ids.set(folder.id, folder);
		}
		const siblings = new Set();
		for (const folder of folders) {
			const visited = new Set([folder.id]);
			let parent = folder.parentId;
			while (parent) {
				if (visited.has(parent)) throw Error('Cycle detected in folder hierarchy');
				if (!ids.has(parent)) throw Error(`Missing parent folder: ${parent}`);
				visited.add(parent); parent = ids.get(parent).parentId;
			}
			const key = JSON.stringify([folder.parentId || null, folder.name.trim().toLowerCase()]);
			if (siblings.has(key)) throw Error('Sibling folder name collision');
			siblings.add(key);
		}
		return ids;
	};
	const summaryProject = summary => summary.trajectoryMetadata?.projectId || null;
	const applyAction = (original, action) => {
		const data = structuredClone(action.action === 'save-config' ? action.data : original);
		const folder = id => { const result = data.folders.find(item => item.id === id); if (!result) throw Error(`Folder id not found: ${id}`); return result; };
		switch (action.action) {
			case 'add-folder':
				if (action.parentId) folder(action.parentId);
				data.folders.push({id: action.id || `folder-${crypto.randomUUID()}`, name: String(action.name || '').trim(), parentId: action.parentId || null, color: action.color || '#10b981'}); break;
			case 'rename-folder': folder(action.id).name = String(action.newName || '').trim(); break;
			case 'move-folder': if (action.newParentId) folder(action.newParentId); folder(action.id).parentId = action.newParentId || null; break;
			case 'remove-folder': {
				const target = folder(action.id), parentId = target.parentId || null;
				for (const item of data.folders) if (item.parentId === target.id) item.parentId = parentId;
				for (const [id, assigned] of Object.entries(data.projectFolderMap)) if (assigned === target.id) { if (parentId) data.projectFolderMap[id] = parentId; else delete data.projectFolderMap[id]; }
				data.folders = data.folders.filter(item => item.id !== target.id); break;
			}
			case 'assign-project':
				if (typeof action.projectId !== 'string' || !action.projectId) throw Error('Exact project id is required');
				folder(action.folderId); data.projectFolderMap[action.projectId] = action.folderId; break;
			case 'unassign-project':
				if (typeof action.projectId !== 'string' || !action.projectId) throw Error('Exact project id is required');
				delete data.projectFolderMap[action.projectId]; break;
			case 'save-config': break;
			default: throw Error('Unknown folder action');
		}
		const ids = validateFolders(data.folders);
		if (!data.projectFolderMap || typeof data.projectFolderMap !== 'object' || Array.isArray(data.projectFolderMap)) throw Error('Invalid projectFolderMap');
		for (const [projectId, folderId] of Object.entries(data.projectFolderMap)) if (!projectId || typeof folderId !== 'string' || !ids.has(folderId)) throw Error(`Invalid folder assignment: ${projectId}`);
		return data;
	};
	const summaryName = summary => summary.annotations?.title || summary.summary || 'Новый разговор';
	const applySummaryUpdate = (current, message) => {
		if (!message || typeof message !== 'object' || Array.isArray(message)) throw Error('Invalid conversation stream message');
		if (message.updates !== undefined && (!message.updates || typeof message.updates !== 'object' || Array.isArray(message.updates))) throw Error('Invalid conversation updates');
		if (message.deletes !== undefined && (!Array.isArray(message.deletes) || message.deletes.some(id => typeof id !== 'string'))) throw Error('Invalid conversation deletes');
		if (Object.keys(message).length && message.updates === undefined && message.deletes === undefined) throw Error('Conversation API contract changed: no updates/deletes');
		const result = new Map(current);
		for (const [id, value] of Object.entries(message.updates || {})) {
			if (!id || !value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid conversation identity');
			result.set(id, value);
		}
		for (const id of message.deletes || []) result.delete(id);
		return result;
	};
	const buildRows = ({data, projects, summaries = new Map(), collapsed = new Set()}) => {
		const ids = validateFolders(data.folders);
		const children = new Map(), assigned = new Map(), conversations = new Map(), pinned = [], activeProjects = new Set(), activeFolders = new Set();
		const append = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
		for (const folder of data.folders) append(children, folder.parentId || null, folder);
		const projectIds = new Set(), archivedProjectIds = new Set();
		for (const project of projects) {
			if (!project.id || projectIds.has(project.id)) throw Error('Missing or duplicate native project id');
			projectIds.add(project.id);
			if (project.archived) { archivedProjectIds.add(project.id); continue; }
			if (project.id === 'cbe5c5cf-0878-4b4c-abe4-39d46e0b5b40' && project.name === 'project-folders/folders') continue;
			const folderId = data.projectFolderMap?.[project.id];
			append(assigned, ids.has(folderId) ? folderId : null, project);
		}
		for (const [id, summary] of summaries) {
			if (summary.annotations?.archived || summary.annotations?.isArchived || summary.trajectoryMetadata?.parentConversationId) continue;
			const projectId = summaryProject(summary);
			if (archivedProjectIds.has(projectId)) continue;
			if (active(summary) && projectId) activeProjects.add(projectId);
			if (summary.annotations?.pinned) {pinned.push({id, summary, projectId}); continue;}
			append(conversations, projectIds.has(projectId) ? projectId : null, {id, summary});
		}
		for (const list of [...children.values(), ...assigned.values()]) list.sort(compare);
		for (const list of [pinned, ...conversations.values()]) list.sort((a, b) => timestamp(b.summary.lastModifiedTime) - timestamp(a.summary.lastModifiedTime) || a.id.localeCompare(b.id));
		for (const projectId of activeProjects) for (let folder = ids.get(data.projectFolderMap?.[projectId]); folder; folder = ids.get(folder.parentId)) activeFolders.add(folder.id);
		const rows = [];
		if (pinned.length) {
			rows.push({kind: 'section', key: 'pinned', name: 'Закреплённые разговоры', depth: 0});
			for (const {id, summary, projectId} of pinned) rows.push({kind: 'conversation', key: `conversation:${id}`, id, summary, projectId, folderId: data.projectFolderMap?.[projectId], depth: 0, name: summaryName(summary), status: summary.status || '', running: active(summary), pinned: true});
		}
		const conversationRows = (projectId, folderId, depth) => {
			for (const {id, summary} of conversations.get(projectId) || []) rows.push({kind: 'conversation', key: `conversation:${id}`, id, projectId, folderId, depth, name: summaryName(summary), status: summary.status || '', running: active(summary), summary});
		};
		const projectRows = (folderId, depth) => {
			for (const project of assigned.get(folderId) || []) {
				const key = `project:${project.id}`;
				rows.push({kind: 'project', key, id: project.id, folderId, depth, name: project.name || project.id, expanded: !collapsed.has(key), running: activeProjects.has(project.id), project});
				if (!collapsed.has(key)) conversationRows(project.id, folderId, depth + 1);
			}
		};
		const visit = (parentId, depth) => {
			for (const folder of children.get(parentId) || []) {
				const key = `folder:${folder.id}`;
				rows.push({kind: 'folder', key, id: folder.id, folderId: folder.id, depth, name: folder.name, expanded: !collapsed.has(key), running: activeFolders.has(folder.id)});
				if (!collapsed.has(key)) {
					visit(folder.id, depth + 1); projectRows(folder.id, depth + 1);
					if (!children.has(folder.id) && !assigned.has(folder.id)) rows.push({kind: 'empty', key: `empty:${folder.id}`, folderId: folder.id, depth: depth + 1, name: '(папка пуста)'});
				}
			}
		};
		visit(null, 0); projectRows(null, 0);
		if (conversations.has(null)) {
			rows.push({kind: 'section', key: 'standalone', name: 'Conversations', depth: 0});
			conversationRows(null, null, 0);
		}
		return rows;
	};
	return {compare, validateFolders, applyAction, applySummaryUpdate, buildRows, summaryProject, summaryName, active};
});
