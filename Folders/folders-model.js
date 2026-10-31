// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
(function(factory) {
	const api = factory();
	if ('object' === typeof module && module.exports) {
		module.exports = api;
	}
	else {
		window.AntigravityFoldersModel = api;
	}
})(() => {
	const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
	const compare = (a, b) => collator.compare(a.name || '', b.name || '') || a.id.localeCompare(b.id);
	const active = summary => !!(summary.hasRunningSubagents || summary.notFullyIdle || summary.hasActiveChildren || /RUNNING|GENERATING|STREAMING|QUEUED|PENDING/.test(summary.status || ''));
	const timestamp = value => 'string' === typeof value
		? Date.parse(value) || 0
		: value && 'object' === typeof value
			? Number(value.seconds || 0) * 1000 + Number(value.nanos || 0) / 1e6
			: 0;
	const validateFolders = folders => {
		if (!Array.isArray(folders)) {
			throw Error('folders must be an array');
		}
		const ids = new Map();
		for (const folder of folders) {
			if ('string' !== typeof folder.id || !folder.id || ids.has(folder.id)) {
				throw Error('Invalid or duplicate folder id');
			}
			if ('string' !== typeof folder.name || !folder.name.trim()) {
				throw Error('Folder name must not be empty');
			}
			ids.set(folder.id, folder);
		}
		const siblings = new Set();
		for (const folder of folders) {
			const visited = new Set([folder.id]);
			let parent = folder.parentId;
			while (parent) {
				if (visited.has(parent)) {
					throw Error('Cycle detected in folder hierarchy');
				}
				if (!ids.has(parent)) {
					throw Error(`Missing parent folder: ${parent}`);
				}
				visited.add(parent);
				parent = ids.get(parent).parentId;
			}
			const key = JSON.stringify([folder.parentId || null, folder.name.trim().toLowerCase()]);
			if (siblings.has(key)) {
				throw Error('Sibling folder name collision');
			}
			siblings.add(key);
		}
		return ids;
	};
	const summaryProject = summary => summary.trajectoryMetadata?.projectId || null;
	const applyAction = (original, action) => {
		const data = structuredClone('save-config' === action.action ? action.data : original);
		const folder = id => {
			const result = data.folders.find(item => id === item.id);
			if (!result) {
				throw Error(`Folder id not found: ${id}`);
			}
			return result;
		};
		switch (action.action) {
			case 'add-folder':
				if (action.parentId) {
					folder(action.parentId);
				}
				data.folders.push({
					id: action.id || `folder-${crypto.randomUUID()}`,
					name: String(action.name || '').trim(),
					parentId: action.parentId || null,
					color: action.color || '#10b981'
				});
				break;
			case 'rename-folder':
				folder(action.id).name = String(action.newName || '').trim();
				break;
			case 'move-folder':
				if (action.newParentId) {
					folder(action.newParentId);
				}
				folder(action.id).parentId = action.newParentId || null;
				break;
			case 'remove-folder': {
				const target = folder(action.id);
				const parentId = target.parentId || null;
				for (const item of data.folders) {
					if (target.id === item.parentId) {
						item.parentId = parentId;
					}
				}
				for (const [id, assigned] of Object.entries(data.projectFolderMap)) {
					if (target.id === assigned) {
						if (!parentId) {
							delete data.projectFolderMap[id];
						}
						else {
							data.projectFolderMap[id] = parentId;
						}
					}
				}
				data.folders = data.folders.filter(item => target.id !== item.id);
				break;
			}
			case 'assign-project':
				if ('string' !== typeof action.projectId || !action.projectId) {
					throw Error('Exact project id is required');
				}
				folder(action.folderId);
				data.projectFolderMap[action.projectId] = action.folderId;
				break;
			case 'unassign-project':
				if ('string' !== typeof action.projectId || !action.projectId) {
					throw Error('Exact project id is required');
				}
				delete data.projectFolderMap[action.projectId];
				break;
			case 'save-config':
				break;
			default:
				throw Error('Unknown folder action');
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
		return data;
	};
	const summaryName = summary => summary.annotations?.title || summary.summary || 'New conversation';
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
		const result = new Map(current);
		for (const [id, value] of Object.entries(message.updates || {})) {
			if (!id || !value || 'object' !== typeof value || Array.isArray(value)) {
				throw Error('Invalid conversation identity');
			}
			result.set(id, value);
		}
		for (const id of message.deletes || []) {
			result.delete(id);
		}
		return result;
	};
	const buildRows = ({
		data,
		projects,
		summaries = new Map(),
		collapsed = new Set(),
		hideOutsideProject = false,
		hideStandaloneConversations = false
	}) => {
		const ids = validateFolders(data.folders);
		const children = new Map();
		const assigned = new Map();
		const conversations = new Map();
		const pinned = [];
		const activeProjects = new Set();
		const activeFolders = new Set();
		const append = (map, key, value) => {
			if (!map.has(key)) {
				map.set(key, []);
			}
			map.get(key).push(value);
		};
		for (const folder of data.folders) {
			append(children, folder.parentId || null, folder);
		}
		const projectIds = new Set();
		const archivedProjectIds = new Set();
		// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
		// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
		// https://github.com/dmitry-ai/antigravity-addons/issues/12
		for (const project of projects) {
			if (!project.id || projectIds.has(project.id)) {
				throw Error('Missing or duplicate native project id');
			}
			projectIds.add(project.id);
			if (project.archived) {
				archivedProjectIds.add(project.id);
				continue;
			}
			if (hideOutsideProject && 'outside-of-project' === project.id) {
				continue;
			}
			if ('cbe5c5cf-0878-4b4c-abe4-39d46e0b5b40' === project.id && 'project-folders/folders' === project.name) {
				continue;
			}
			const folderId = data.projectFolderMap?.[project.id];
			append(assigned, ids.has(folderId) ? folderId : null, project);
		}
		for (const [id, summary] of summaries) {
			if (summary.annotations?.archived || summary.annotations?.isArchived || summary.trajectoryMetadata?.parentConversationId || (summary.trajectoryMetadata?.rootConversationId && id !== summary.trajectoryMetadata.rootConversationId)) {
				continue;
			}
			const projectId = summaryProject(summary);
			if (archivedProjectIds.has(projectId)) {
				continue;
			}
			if (active(summary) && projectId) {
				activeProjects.add(projectId);
			}
			if (summary.annotations?.pinned) {
				pinned.push({id, summary, projectId});
				continue;
			}
			append(conversations, projectIds.has(projectId) ? projectId : null, {id, summary});
		}
		for (const list of [...children.values(), ...assigned.values()]) {
			list.sort(compare);
		}
		for (const list of [pinned, ...conversations.values()]) {
			list.sort((a, b) => timestamp(b.summary.lastModifiedTime) - timestamp(a.summary.lastModifiedTime) || a.id.localeCompare(b.id));
		}
		for (const projectId of activeProjects) {
			for (let folder = ids.get(data.projectFolderMap?.[projectId]); folder; folder = ids.get(folder.parentId)) {
				activeFolders.add(folder.id);
			}
		}
		const rows = [];
		if (pinned.length) {
			rows.push({kind: 'section', key: 'pinned', name: 'Pinned conversations', depth: 0});
			for (const {id, summary, projectId} of pinned) {
				rows.push({
					kind: 'conversation',
					key: `conversation:${id}`,
					id,
					summary,
					projectId,
					folderId: data.projectFolderMap?.[projectId],
					depth: 0,
					name: summaryName(summary),
					status: summary.status || '',
					running: active(summary),
					pinned: true
				});
			}
		}
		const conversationRows = (projectId, folderId, depth) => {
			for (const {id, summary} of conversations.get(projectId) || []) {
				rows.push({
					kind: 'conversation',
					key: `conversation:${id}`,
					id,
					projectId,
					folderId,
					depth,
					name: summaryName(summary),
					status: summary.status || '',
					running: active(summary),
					summary
				});
			}
		};
		const projectRows = (folderId, depth) => {
			for (const project of assigned.get(folderId) || []) {
				const key = `project:${project.id}`;
				rows.push({
					kind: 'project',
					key,
					id: project.id,
					folderId,
					depth,
					name: project.name || project.id,
					expanded: !collapsed.has(key),
					running: activeProjects.has(project.id),
					project
				});
				if (!collapsed.has(key)) {
					conversationRows(project.id, folderId, depth + 1);
				}
			}
		};
		const visit = (parentId, depth) => {
			for (const folder of children.get(parentId) || []) {
				const key = `folder:${folder.id}`;
				rows.push({
					kind: 'folder',
					key,
					id: folder.id,
					folderId: folder.id,
					depth,
					name: folder.name,
					expanded: !collapsed.has(key),
					running: activeFolders.has(folder.id)
				});
				if (!collapsed.has(key)) {
					visit(folder.id, depth + 1);
					projectRows(folder.id, depth + 1);
					if (!children.has(folder.id) && !assigned.has(folder.id)) {
						rows.push({
							kind: 'empty',
							key: `empty:${folder.id}`,
							folderId: folder.id,
							depth: depth + 1,
							name: '(empty folder)'
						});
					}
				}
			}
		};
		visit(null, 0);
		projectRows(null, 0);
		if (!hideStandaloneConversations && conversations.has(null)) {
			rows.push({kind: 'section', key: 'standalone', name: 'Conversations', depth: 0});
			conversationRows(null, null, 0);
		}
		return rows;
	};
	return {compare, validateFolders, applyAction, applySummaryUpdate, buildRows, summaryProject, summaryName, active};
});
