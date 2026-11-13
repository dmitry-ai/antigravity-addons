// 2026-10-12 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Add interactive GUI folder management (folders-client.js), nested parentId hierarchy, drag-and-drop, Windows Explorer sorting, and adaptive Light/Dark menus":
// https://github.com/dmitry-ai/antigravity-addons/issues/4
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders around standalone v2 architecture, delegated events, UMD test exports, and shared folders-model mutations":
// https://github.com/dmitry-ai/antigravity-addons/issues/24
(function(factory) {
	const api = factory();
	if ('object' === typeof module && module.exports) {
		module.exports = api;
	}
	else {
		api.initAntigravityFoldersClient();
	}
})(() => {
	function hasDragType(dataTransfer, type) {
		let r;
		result: {
			if (!dataTransfer || !dataTransfer.types) {
				r = false;
				break result;
			}
			if ('function' === typeof dataTransfer.types.includes) {
				r = dataTransfer.types.includes(type);
				break result;
			}
			if ('function' === typeof dataTransfer.types.contains) {
				r = dataTransfer.types.contains(type);
				break result;
			}
			try {
				r = Array.from(dataTransfer.types).includes(type);
			}
			catch (_) {
				r = false;
			}
		}
		return r;
	}
	// 2026-10-18 Dmitrii Fediuk https://github.com/dmitrii-fediuk
	// "Add folder-scoped project creation, 80%-height tree folder picker, multi-window UI injection (4th+ windows), and context-only action menus":
	// https://github.com/dmitry-ai/antigravity-addons/issues/8
	function folderPickerModel(foldersSource, selectedId, excludedIds = new Set()) {
		const raw = Array.isArray(foldersSource) ? foldersSource : foldersSource?.data?.folders || foldersSource?.folders || [];
		const folders = raw.filter(folder => !excludedIds.has(folder.id));
		const byId = new Map(folders.map(folder => [folder.id, folder]));
		const children = new Map();
		for (const folder of folders) {
			const parentId = byId.has(folder.parentId) ? folder.parentId : null;
			if (!children.has(parentId)) {
				children.set(parentId, []);
			}
			children.get(parentId).push(folder);
		}
		for (const siblings of children.values()) {
			siblings.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}) || a.id.localeCompare(b.id));
		}
		const expanded = new Set();
		let folder = byId.get(selectedId);
		while (folder && !expanded.has(folder.id)) {
			expanded.add(folder.id);
			folder = byId.get(folder.parentId);
		}
		return {byId, children, expanded};
	}
	function positionContextMenu(menu, viewport = window) {
		const {x, y} = menu._folderAnchor;
		menu.style.left = `${Math.max(8, Math.min(x, viewport.innerWidth - menu.offsetWidth - 8))}px`;
		menu.style.top = `${Math.max(8, Math.min(y, viewport.innerHeight - menu.offsetHeight - 8))}px`;
	}
	function openProjectContextMenu(e, projectId, {client, showContextMenu, showCreateFolderDialog, win = 'undefined' !== typeof window ? window : undefined}) {
		e.preventDefault();
		e.stopPropagation();
		const currentFolderId = client.getProjectFolderId(projectId);
		const items = [
			{
				folderTree: {
					selectedId: currentFolderId,
					onSelect: folderId => client.postAction('assign-project', {projectId, folderId})
				}
			},
			{separator: true}
		];
		if (win?.__PROJECT_FOLDERS_VIEW__) {
			items.push({label: 'Open project', onClick: () => win.__PROJECT_FOLDERS_VIEW__.adapter.navigate({projectId})});
			items.push({label: 'New conversation', onClick: () => win.__PROJECT_FOLDERS_VIEW__.adapter.navigate({projectId})});
			// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
			// "Add Project settings action to project context menu in Folders":
			// https://github.com/dmitry-ai/antigravity-addons/issues/17
			items.push({label: 'Project settings…', onClick: () => win.__PROJECT_FOLDERS_VIEW__.adapter.openProjectSettings(projectId)});
			items.push({label: 'Rename project…', onClick: () => win.__PROJECT_FOLDERS_VIEW__.renameProject(projectId)});
			items.push({separator: true});
		}
		items.push({
			icon: '➕',
			label: 'Create folder…',
			onClick: () => {
				showCreateFolderDialog(projectId);
			}
		});
		if (currentFolderId) {
			items.push({
				icon: '↥',
				label: 'Remove from folder',
				onClick: () => {
					client.postAction('unassign-project', {projectId});
				}
			});
		}
		showContextMenu(e.clientX, e.clientY, items, 'Move project');
	}
	function initAntigravityFoldersClient() {
	let r;
	result: {
		if ('undefined' === typeof window || window.__PROJECT_FOLDERS_CLIENT_INITIALIZED__) {
			r = undefined;
			break result;
		}
		window.__PROJECT_FOLDERS_CLIENT_INITIALIZED__ = true;
		const lifetime = new AbortController();
		let rootAbort = null;
		const listen = (type, listener, capture = false) => window.addEventListener(type, listener, {capture, signal: lifetime.signal});
		console.log('[folders-client] Initializing Hierarchical Project Folders UI Controller...');
		function escapeHtml(str) {
			let r;
			result: {
				if (!str) {
					r = '';
					break result;
				}
				r = String(str)
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;')
					.replace(/"/g, '&quot;');
			}
			return r;
		}
		const client = {
			data: window.__PROJECT_FOLDERS_DATA__ || {folders: [], projectFolderMap: {}},
			activeMenu: null,
			activeModal: null,
			hoveredFolderId: null,
			hoveredFolderEl: null,
			lastHoveredFolderId: null,
			lastHoveredFolderTime: 0,
			lastActiveFolderId: null,
			lastActiveProjectId: null,
			draggedFolderId: null,
			draggedProjectId: null,
			isDragging: false,
			// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
			// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
			// https://github.com/dmitry-ai/antigravity-addons/issues/10
			revealCreatedProject(projectId, folderId) {
				let r;
				if (window.__PROJECT_FOLDERS_VIEW__) {
					r = window.__PROJECT_FOLDERS_VIEW__.reveal(projectId, folderId);
				}
				else {
					let folder = this.getFolder(folderId);
					while (folder) {
						const header = document.querySelector(`[data-testid="section-header"][data-folder-id="${CSS.escape(folder.id)}"]`);
						if ('true' === header?.getAttribute('data-collapsed')) {
							header.querySelector('h2 button')?.click();
						}
						folder = this.getFolder(folder.parentId);
					}
					requestAnimationFrame(() => {
						const card = document.querySelector(`button[data-project-id="${CSS.escape(projectId)}"]`);
						card?.scrollIntoView({block: 'nearest'});
					});
				}
				return r;
			},
			async postAction(action, payload = {}) {
				let r;
				result: {
					try {
						console.log(`[folders-client] Dispatching action: ${action}`, payload);
						const requestBody = {action, ...payload, revision: window.__FOLDERS_REVISION__};
						const res = window.__ANTIGRAVITY_TOOLS_REQUEST__
							? null
							: await fetch('/api/project-folders', {
								method: 'POST',
								headers: {'content-type': 'application/json'},
								body: JSON.stringify(requestBody)
							});
						const result = window.__ANTIGRAVITY_TOOLS_REQUEST__
							? await window.__ANTIGRAVITY_TOOLS_REQUEST__('folders', {method: 'POST', body: requestBody})
							: await res.json();
						if (result.revision) {
							window.__FOLDERS_REVISION__ = result.revision;
						}
						if (result.success && result.data) {
							this.notifyUpdate(result.data);
						}
						window.__PROJECT_FOLDERS_VIEW__?.reportAction(result.success ? null : result.error || 'Folder action failed');
						r = result;
					}
					catch (err) {
						console.error('[folders-client] Action error:', err);
						window.__PROJECT_FOLDERS_VIEW__?.reportAction(err.message);
						r = {success: false, error: err.message};
					}
				}
				return r;
			},
			notifyUpdate(newData) {
				this.data = newData;
				window.__PROJECT_FOLDERS_DATA__ = newData;
				this.triggerRerender();
			},
			triggerRerender() {
				window.dispatchEvent(new CustomEvent('antigravity-folders-updated', {detail: this.data}));
			},
			getFolder(id) {
				let r;
				result: {
					if (!this.data || !Array.isArray(this.data.folders)) {
						r = null;
						break result;
					}
					r = this.data.folders.find(f => id === f.id) || null;
				}
				return r;
			},
			getProjectFolderId(projectId) {
				return this.data?.projectFolderMap?.[projectId] || null;
			},
			getFolderPath(folderId) {
				return window.AntigravityFoldersModel.getFolderPath(folderId, this.data?.folders);
			},
			getDescendantIds(folderId) {
				return window.AntigravityFoldersModel.getDescendantIds(folderId, this.data?.folders);
			},
			detectCurrentFolderId() {
				let r;
				result: {
					if (this.hoveredFolderId && this.getFolder(this.hoveredFolderId)) {
						r = this.hoveredFolderId;
						break result;
					}
					if (this.lastHoveredFolderId && 5000 > Date.now() - this.lastHoveredFolderTime && this.getFolder(this.lastHoveredFolderId)) {
						r = this.lastHoveredFolderId;
						break result;
					}
					const activeEl = 'undefined' !== typeof document ? document.activeElement : null;
					if (activeEl) {
						const fHeader = activeEl.closest?.('[data-folder-id]');
						if (fHeader) {
							const fid = fHeader.getAttribute('data-folder-id');
							if (fid && this.getFolder(fid)) {
								r = fid;
								break result;
							}
						}
						const pCard = activeEl.closest?.('[data-project-card]');
						if (pCard) {
							const pid = pCard.getAttribute('data-project-id');
							const fid = this.getProjectFolderId(pid);
							if (fid && this.getFolder(fid)) {
								r = fid;
								break result;
							}
						}
						const cRow = activeEl.closest?.("[data-testid^='conversation-row-']");
						if (cRow) {
							const pid = cRow.closest('[data-group-id]')?.getAttribute('data-group-id');
							if (pid) {
								const fid = this.getProjectFolderId(pid);
								if (fid && this.getFolder(fid)) {
									r = fid;
									break result;
								}
							}
						}
					}
					if ('undefined' !== typeof document) {
						const selectedConvo = document.querySelector("[data-testid='conversation-row-sidebar'][data-selected='true'], [data-testid^='conversation-row-'][data-selected='true']");
						if (selectedConvo) {
							const pid = selectedConvo.closest('[data-group-id]')?.getAttribute('data-group-id');
							if (pid) {
								const fid = this.getProjectFolderId(pid);
								if (fid && this.getFolder(fid)) {
									r = fid;
									break result;
								}
							}
							const cascadeId = selectedConvo.getAttribute('data-cascade-id');
							if (cascadeId && 'undefined' !== typeof window && window.__PROJECT_FOLDERS_CONVO_MAP__?.[cascadeId]) {
								const convoPid = window.__PROJECT_FOLDERS_CONVO_MAP__[cascadeId];
								const fid = this.getProjectFolderId(convoPid);
								if (fid && this.getFolder(fid)) {
									r = fid;
									break result;
								}
							}
							const rowWrapper = selectedConvo.closest('[data-index]');
							if (rowWrapper) {
								let curr = rowWrapper.previousElementSibling;
								while (curr) {
									const card = curr.querySelector('button[data-project-card]');
									if (card) {
										const pId = card.getAttribute('data-project-id');
										const fId = this.getProjectFolderId(pId);
										if (fId && this.getFolder(fId)) {
											r = fId;
											break result;
										}
										break;
									}
									const fHead = curr.querySelector('[data-folder-id]');
									if (fHead) {
										const fId = fHead.getAttribute('data-folder-id');
										if (fId && this.getFolder(fId)) {
											r = fId;
											break result;
										}
									}
									curr = curr.previousElementSibling;
								}
							}
						}
						const activeConvoView = document.querySelector("[data-testid='conversation-view'][data-cascade-id]");
						if (activeConvoView) {
							const activeCascadeId = activeConvoView.getAttribute('data-cascade-id');
							if (activeCascadeId && 'undefined' !== typeof window && window.__PROJECT_FOLDERS_CONVO_MAP__?.[activeCascadeId]) {
								const pId = window.__PROJECT_FOLDERS_CONVO_MAP__[activeCascadeId];
								const fId = this.getProjectFolderId(pId);
								if (fId && this.getFolder(fId)) {
									r = fId;
									break result;
								}
							}
						}
					}
					if (this.lastActiveFolderId && this.getFolder(this.lastActiveFolderId)) {
						r = this.lastActiveFolderId;
						break result;
					}
					if (this.lastActiveProjectId) {
						const fid = this.getProjectFolderId(this.lastActiveProjectId);
						if (fid && this.getFolder(fid)) {
							r = fid;
							break result;
						}
					}
					r = null;
				}
				return r;
			},
			buildFolderSelectOptions(selectedParentId = null) {
				const folders = this.data?.folders || [];
				const childrenMap = new Map();
				for (const f of folders) {
					const pid = f.parentId || null;
					if (!childrenMap.has(pid)) {
						childrenMap.set(pid, []);
					}
					childrenMap.get(pid).push(f);
				}
				const options = [];
				const isRootSelected = !selectedParentId || !this.getFolder(selectedParentId);
				options.push(`<option value="" ${isRootSelected ? 'selected' : ''}>📁 Root (no parent)</option>`);
				const walk = (parentId, depth) => {
					const list = (childrenMap.get(parentId) || []).slice().sort((a, b) => {
						const cmp = (a?.name || '').localeCompare(b?.name || '', undefined, {numeric: true, sensitivity: 'base'});
						return 0 !== cmp ? cmp : (a?.id || '').localeCompare(b?.id || '');
					});
					for (const f of list) {
						const isSelected = selectedParentId === f.id;
						const prefix = 0 < depth ? `${'&nbsp;&nbsp;'.repeat(depth)}↳ ` : '';
						options.push(`<option value="${escapeHtml(f.id)}" ${isSelected ? 'selected' : ''}>${prefix}📁 ${escapeHtml(f.name)}</option>`);
						walk(f.id, depth + 1);
					}
				};
				walk(null, 0);
				return options.join('');
			}
		};
		client.ui = {
			showCreateFolderDialog,
			showFolderContextMenu,
			showProjectContextMenu,
			showMoveFolderMenu,
			showContextMenu,
			closeContextMenu
		};
		client.bindRoot = root => {
			rootAbort?.abort();
			rootAbort = new AbortController();
			const on = (type, listener, capture = false) => root.addEventListener(type, listener, {capture, signal: rootAbort.signal});
			let activeDropEl = null;
			let draggedElement = null;
			const setDropTarget = el => {
				if (el !== activeDropEl) {
					activeDropEl?.classList.remove('folder-drop-target');
					activeDropEl = el;
					activeDropEl?.classList.add('folder-drop-target');
				}
			};
			const resolveDropZone = target => {
				const el = target && 1 === target.nodeType ? target : target?.parentElement;
				const toolbar = el?.closest('.fg-toolbar');
				const folderRow = toolbar ? null : el?.closest('[data-folders-row^="folder:"]');
				const emptyRow = toolbar || folderRow ? null : el?.closest('[data-folders-row^="empty:"]');
				return toolbar
					? {el: toolbar, folderId: null}
					: folderRow
						? {el: folderRow, folderId: folderRow.dataset.folderId}
						: emptyRow
							? {el: emptyRow, folderId: emptyRow.dataset.folderId}
							: null;
			};
			const canDropOnTarget = (e, targetFolderId) => {
				let r;
				result: {
					const isProjectDrag = hasDragType(e.dataTransfer, 'application/antigravity-project-id') || !!client.draggedProjectId;
					const isFolderDrag = hasDragType(e.dataTransfer, 'application/antigravity-folder-id') || !!client.draggedFolderId;
					if (!isProjectDrag && !isFolderDrag) {
						r = {allowed: false, blocked: false};
						break result;
					}
					if (isProjectDrag) {
						r = {allowed: true, blocked: false};
						break result;
					}
					const draggedFolderId = client.draggedFolderId || e.dataTransfer?.getData('application/antigravity-folder-id');
					const df = draggedFolderId ? client.getFolder(draggedFolderId) : null;
					if (!df) {
						r = {allowed: false, blocked: false};
						break result;
					}
					const targetParent = targetFolderId || null;
					if (targetParent === df.id || targetParent === (df.parentId || null)) {
						r = {allowed: false, blocked: null !== targetParent};
						break result;
					}
					if (targetParent && client.getDescendantIds(df.id).has(targetParent)) {
						r = {allowed: false, blocked: true};
						break result;
					}
					const siblings = (client.data?.folders || []).filter(item => targetParent === (item.parentId || null));
					const collision = siblings.some(item => df.id !== item.id && df.name.toLowerCase() === item.name.toLowerCase());
					r = {allowed: !collision, blocked: collision};
				}
				return r;
			};
			on('mouseover', e => {
				const folderRow = e.target.closest?.('[data-folders-row^="folder:"]');
				if (folderRow) {
					const fid = folderRow.dataset.folderId;
					client.hoveredFolderId = fid;
					client.hoveredFolderEl = folderRow;
					client.lastHoveredFolderId = fid;
					client.lastHoveredFolderTime = Date.now();
				}
			});
			on('mouseout', e => {
				const folderRow = e.target.closest?.('[data-folders-row^="folder:"]');
				if (folderRow && !folderRow.contains(e.relatedTarget) && folderRow.dataset.folderId === client.hoveredFolderId) {
					client.hoveredFolderId = null;
					client.hoveredFolderEl = null;
				}
			});
			on('contextmenu', e => {
				const card = e.target.closest?.('button[data-project-card]');
				const folderRow = card ? null : e.target.closest?.('[data-folders-row^="folder:"]');
				if (card) {
					showProjectContextMenu(e, card, card.dataset.projectId, card.textContent.trim());
				}
				else if (folderRow) {
					const fid = folderRow.dataset.folderId;
					showFolderContextMenu(e, folderRow, fid, client.getFolder(fid)?.name || '');
				}
			});
			on('click', e => {
				if (client.isDragging && e.target.closest?.('[data-folders-row^="folder:"]')) {
					e.preventDefault();
					e.stopPropagation();
				}
			}, true);
			on('click', e => {
				const card = e.target.closest?.('button[data-project-card]');
				const folderRow = card ? null : e.target.closest?.('[data-folders-row^="folder:"]');
				const convoRow = card || folderRow ? null : e.target.closest?.("[data-testid^='conversation-row-']");
				if (card?.dataset.projectId) {
					client.lastActiveProjectId = card.dataset.projectId;
					client.lastActiveFolderId = client.getProjectFolderId(card.dataset.projectId);
				}
				else if (folderRow?.dataset.folderId) {
					client.lastActiveFolderId = folderRow.dataset.folderId;
				}
				else if (convoRow) {
					const pid = convoRow.closest('[data-group-id]')?.dataset.groupId;
					if (pid) {
						client.lastActiveProjectId = pid;
						client.lastActiveFolderId = client.getProjectFolderId(pid);
					}
				}
			});
			on('pointerdown', e => {
				if (!e.altKey && 0 === e.button && !e.target.closest?.('input, .folder-rename-input') && e.target.closest?.('[data-folders-row^="folder:"], button[data-project-card]')) {
					e.stopPropagation();
				}
			});
			on('dragstart', e => {
				if (e.altKey || e.target.closest?.('input, .folder-rename-input')) {
					e.preventDefault();
				}
				else {
					const card = e.target.closest?.('button[data-project-card]');
					const folderRow = card ? null : e.target.closest?.('[data-folders-row^="folder:"]');
					if (card?.dataset.projectId) {
						e.stopPropagation();
						client.isDragging = true;
						client.draggedProjectId = card.dataset.projectId;
						client.draggedFolderId = null;
						draggedElement = card;
						e.dataTransfer.setData('application/antigravity-project-id', card.dataset.projectId);
						e.dataTransfer.setData('text/plain', card.dataset.projectId);
						e.dataTransfer.effectAllowed = 'move';
						card.style.opacity = '0.5';
					}
					else if (folderRow?.dataset.folderId) {
						e.stopPropagation();
						client.isDragging = true;
						client.draggedFolderId = folderRow.dataset.folderId;
						client.draggedProjectId = null;
						draggedElement = folderRow;
						e.dataTransfer.setData('application/antigravity-folder-id', folderRow.dataset.folderId);
						e.dataTransfer.setData('text/plain', folderRow.dataset.folderId);
						e.dataTransfer.effectAllowed = 'move';
						folderRow.style.opacity = '0.5';
					}
				}
			});
			on('dragend', () => {
				if (draggedElement) {
					draggedElement.style.opacity = '';
					draggedElement = null;
				}
				setDropTarget(null);
				client.draggedFolderId = null;
				client.draggedProjectId = null;
				setTimeout(() => {
					client.isDragging = false;
				}, 100);
			});
			on('dragover', e => {
				const zone = resolveDropZone(e.target);
				if (!zone) {
					setDropTarget(null);
				}
				else {
					const check = canDropOnTarget(e, zone.folderId);
					if (!check.allowed) {
						setDropTarget(null);
						if (check.blocked && e.dataTransfer) {
							e.dataTransfer.dropEffect = 'none';
						}
					}
					else {
						e.preventDefault();
						e.stopPropagation();
						if (e.dataTransfer) {
							e.dataTransfer.dropEffect = 'move';
						}
						setDropTarget(zone.el);
					}
				}
			});
			on('dragleave', e => {
				if (!root.contains(e.relatedTarget) || !resolveDropZone(e.relatedTarget)) {
					setDropTarget(null);
				}
			});
			on('drop', async e => {
				const zone = resolveDropZone(e.target);
				setDropTarget(null);
				if (zone) {
					e.preventDefault();
					e.stopPropagation();
					const projId = e.dataTransfer?.getData('application/antigravity-project-id') || client.draggedProjectId;
					const draggedFolderId = e.dataTransfer?.getData('application/antigravity-folder-id') || client.draggedFolderId;
					if (projId) {
						await client.postAction(zone.folderId ? 'assign-project' : 'unassign-project', zone.folderId ? {projectId: projId, folderId: zone.folderId} : {projectId: projId});
					}
					else if (draggedFolderId && canDropOnTarget(e, zone.folderId).allowed) {
						const res = await client.postAction('move-folder', {id: draggedFolderId, newParentId: zone.folderId});
						if (res?.success && zone.folderId) {
							window.__PROJECT_FOLDERS_VIEW__?.expandFolder?.(zone.folderId);
						}
					}
				}
			});
		};
		client.dispose = () => {
			lifetime.abort();
			rootAbort?.abort();
			closeContextMenu();
			client.activeModal?.remove();
			window.__PROJECT_FOLDERS_CLIENT_INITIALIZED__ = false;
			delete window.__PROJECT_FOLDERS_CLIENT__;
		};
		window.__PROJECT_FOLDERS_CLIENT__ = client;
		function closeContextMenu() {
			if (client.activeMenu && client.activeMenu.parentNode) {
				client.activeMenu.parentNode.removeChild(client.activeMenu);
			}
			client.activeMenu = null;
		}
		function appendFolderTree(menu, {selectedId, excludedIds, onSelect}) {
			const {children, expanded} = folderPickerModel(client.data?.folders, selectedId, excludedIds);
			const tree = document.createElement('div');
			tree.className = 'antigravity-folder-targets';
			tree.setAttribute('role', 'tree');
			tree.setAttribute('aria-label', 'Folders');
			const render = (focusId = null) => {
				tree.replaceChildren();
				const rows = new Map();
				const visit = (parentId, depth, seen = new Set()) => {
					for (const folder of children.get(parentId) || []) {
						if (!seen.has(folder.id)) {
							const branch = new Set(seen).add(folder.id);
							const hasChildren = !!children.get(folder.id)?.length;
							const row = document.createElement('div');
							row.className = 'antigravity-folder-target';
							row.dataset.folderTarget = folder.id;
							row.setAttribute('role', 'treeitem');
							row.setAttribute('aria-level', depth + 1);
							row.setAttribute('aria-selected', selectedId === folder.id);
							if (hasChildren) {
								row.setAttribute('aria-expanded', expanded.has(folder.id));
							}
							row.tabIndex = -1;
							row.style.paddingInlineStart = `${4 + depth * 14}px`;
							row.title = client.getFolderPath(folder.id);
							const toggle = document.createElement(hasChildren ? 'button' : 'span');
							toggle.className = 'antigravity-folder-target-toggle';
							if (hasChildren) {
								toggle.type = 'button';
								toggle.tabIndex = -1;
								toggle.textContent = expanded.has(folder.id) ? '▾' : '▸';
								toggle.setAttribute('aria-label', `${expanded.has(folder.id) ? 'Collapse' : 'Expand'} ${folder.name}`);
								toggle.addEventListener('click', e => {
									e.stopPropagation();
									if (expanded.has(folder.id)) {
										expanded.delete(folder.id);
									}
									else {
										expanded.add(folder.id);
									}
									render(folder.id);
								});
							}
							const icon = document.createElement('span');
							icon.className = 'antigravity-folder-target-icon';
							icon.setAttribute('aria-hidden', 'true');
							icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11H3Z"/></svg>';
							const label = document.createElement('span');
							label.className = 'antigravity-folder-target-label';
							label.textContent = folder.name;
							const check = document.createElement('span');
							check.className = 'antigravity-folder-target-check';
							check.textContent = selectedId === folder.id ? '✓' : '';
							row.append(toggle, icon, label, check);
							row.addEventListener('click', e => {
								e.stopPropagation();
								closeContextMenu();
								if (selectedId !== folder.id) {
									onSelect(folder.id);
								}
							});
							row.addEventListener('keydown', e => {
								const visible = [...tree.querySelectorAll('[role=treeitem]')];
								const index = visible.indexOf(row);
								if ('Enter' === e.key || ' ' === e.key) {
									e.preventDefault();
									e.stopPropagation();
									row.click();
								}
								else {
									let handled = true;
									let target;
									if ('ArrowDown' === e.key) {
										target = visible[index + 1];
									}
									else if ('ArrowUp' === e.key) {
										target = visible[index - 1];
									}
									else if ('Home' === e.key) {
										target = visible[0];
									}
									else if ('End' === e.key) {
										target = visible.at(-1);
									}
									else if ('ArrowRight' === e.key && hasChildren) {
										if (expanded.has(folder.id)) {
											target = visible[index + 1];
										}
										else {
											expanded.add(folder.id);
											render(folder.id);
										}
									}
									else if ('ArrowLeft' === e.key) {
										if (expanded.has(folder.id) && hasChildren) {
											expanded.delete(folder.id);
											render(folder.id);
										}
										else {
											target = rows.get(folder.parentId);
										}
									}
									else {
										handled = false;
									}
									if (handled) {
										e.preventDefault();
										e.stopPropagation();
										target?.focus();
									}
								}
							});
							rows.set(folder.id, row);
							tree.appendChild(row);
							if (expanded.has(folder.id)) {
								visit(folder.id, depth + 1, branch);
							}
						}
					}
				};
				visit(null, 0);
				const active = rows.get(focusId) || rows.get(selectedId) || rows.values().next().value;
				if (active) {
					active.tabIndex = 0;
					if (focusId) {
						active.focus({preventScroll: true});
					}
				}
				if (menu.isConnected) {
					positionContextMenu(menu);
				}
			};
			render();
			menu.appendChild(tree);
		}
		function showContextMenu(x, y, items, title = '') {
			closeContextMenu();
			const menu = document.createElement('div');
			menu._folderAnchor = {x, y};
			const hasTree = items.some(item => item.folderTree);
			menu.className = `antigravity-folder-menu${hasTree ? ' antigravity-folder-picker' : ''}`;
			menu.setAttribute('role', hasTree ? 'dialog' : 'menu');
			if (title) {
				menu.setAttribute('aria-label', title);
				const heading = document.createElement('div');
				heading.className = 'antigravity-folder-menu-title';
				heading.textContent = title;
				menu.appendChild(heading);
			}
			items.forEach(item => {
				if (item.folderTree) {
					appendFolderTree(menu, item.folderTree);
				}
				else if (item.separator) {
					const sep = document.createElement('div');
					sep.className = 'antigravity-folder-menu-separator';
					menu.appendChild(sep);
				}
				else {
					const row = document.createElement('div');
					row.className = `antigravity-folder-menu-item ${item.danger ? 'danger' : ''}`;
					row.setAttribute('tabindex', '0');
					row.setAttribute('role', hasTree ? 'button' : 'menuitem');
					const labelSpan = document.createElement('span');
					labelSpan.style.display = 'flex';
					labelSpan.style.alignItems = 'center';
					labelSpan.style.gap = '6px';
					labelSpan.textContent = `${item.icon || ''} ${item.label}`;
					row.appendChild(labelSpan);
					if (item.shortcut) {
						const sc = document.createElement('span');
						sc.className = 'antigravity-folder-menu-shortcut';
						sc.textContent = item.shortcut;
						row.appendChild(sc);
					}
					row.addEventListener('click', e => {
						e.stopPropagation();
						closeContextMenu();
						if ('function' === typeof item.onClick) {
							item.onClick();
						}
					});
					row.addEventListener('keydown', e => {
						if ('Enter' === e.key || ' ' === e.key) {
							e.preventDefault();
							row.click();
						}
						else if ('ArrowDown' === e.key || 'ArrowUp' === e.key) {
							e.preventDefault();
							const rows = Array.from(menu.querySelectorAll('[role=treeitem], [role=menuitem], [role=button]'));
							const index = rows.indexOf(row);
							rows[(index + ('ArrowDown' === e.key ? 1 : -1) + rows.length) % rows.length]?.focus();
						}
					});
					menu.appendChild(row);
				}
			});
			document.body.appendChild(menu);
			client.activeMenu = menu;
			positionContextMenu(menu);
			const focus = menu.querySelector('[role=treeitem][aria-selected=true]') || menu.querySelector('[role=treeitem], [role=menuitem], [role=button]');
			focus?.focus({preventScroll: true});
			if (hasTree) {
				focus?.scrollIntoView({block: 'nearest'});
			}
		}
		function showCreateFolderDialog(projectId = null, explicitParentId = undefined) {
			closeContextMenu();
			if (!client.activeModal) {
				let targetParentId = explicitParentId;
				if (undefined === targetParentId) {
					targetParentId = projectId ? client.getProjectFolderId(projectId) || null : client.detectCurrentFolderId();
				}
				const parentFolder = targetParentId ? client.getFolder(targetParentId) : null;
				const parentNameSafe = parentFolder ? escapeHtml(parentFolder.name) : '';
				const titleText = parentFolder ? `Create subfolder in “${parentNameSafe}”` : 'Create new folder';
				const overlay = document.createElement('div');
				overlay.className = 'antigravity-folder-modal-overlay';
				const modal = document.createElement('div');
				modal.className = 'antigravity-folder-modal';
				modal.setAttribute('role', 'dialog');
				modal.setAttribute('aria-modal', 'true');
				modal.setAttribute('aria-label', parentFolder ? `Create subfolder in “${parentFolder.name}”` : 'Create new folder');
				modal.innerHTML = [
					`<h3 class="folder-modal-title">${titleText}</h3>`,
					'<label class="antigravity-folder-label">Folder name:</label>',
					`<input type="text" class="folder-name-input" placeholder="${parentFolder ? 'Subfolder name...' : 'Folder name...'}" />`,
					'<label class="antigravity-folder-label">Location (parent):</label>',
					`<select class="folder-parent-select">${client.buildFolderSelectOptions(targetParentId)}</select>`,
					'<div class="antigravity-folder-modal-buttons">',
					'<button type="button" class="antigravity-folder-btn secondary btn-cancel">Cancel</button>',
					'<button type="button" class="antigravity-folder-btn primary btn-submit">Create</button>',
					'</div>'
				].join('');
				overlay.appendChild(modal);
				document.body.appendChild(overlay);
				client.activeModal = overlay;
				const titleEl = modal.querySelector('.folder-modal-title');
				const input = modal.querySelector('input.folder-name-input');
				const select = modal.querySelector('select.folder-parent-select');
				const btnCancel = modal.querySelector('.btn-cancel');
				const btnSubmit = modal.querySelector('.btn-submit');
				select.addEventListener('change', () => {
					const curParentId = select.value || null;
					const curParent = curParentId ? client.getFolder(curParentId) : null;
					titleEl.textContent = curParent ? `Create subfolder in “${curParent.name}”` : 'Create new folder';
					input.placeholder = curParent ? 'Subfolder name...' : 'Folder name...';
					input.setCustomValidity('');
				});
				input.focus();
				function closeModal() {
					if (overlay.parentNode) {
						overlay.parentNode.removeChild(overlay);
					}
					client.activeModal = null;
					document.querySelector('.btn-create-folder')?.focus();
				}
				async function submit() {
					let r;
					result: {
						if (btnSubmit.disabled) {
							r = undefined;
							break result;
						}
						const val = input.value.trim();
						if (!val) {
							input.setCustomValidity('Enter a folder name');
							input.reportValidity();
							r = undefined;
							break result;
						}
						const chosenParentId = select.value || null;
						const siblings = (client.data?.folders || []).filter(folder => (chosenParentId || null) === (folder.parentId || null));
						if (siblings.some(folder => val.toLowerCase() === folder.name.toLowerCase())) {
							input.setCustomValidity('A folder with this name already exists in this branch');
							input.reportValidity();
							r = undefined;
							break result;
						}
						btnSubmit.disabled = true;
						const result = await client.postAction('add-folder', {name: val, parentId: chosenParentId});
						if (!result.success) {
							btnSubmit.disabled = false;
							input.setCustomValidity(result.error || 'Failed to create folder');
							input.reportValidity();
						}
						else {
							const createdFolder = (result.data?.folders || []).find(f => (chosenParentId || null) === (f.parentId || null) && val.toLowerCase() === f.name.toLowerCase());
							if (createdFolder) {
								client.lastActiveFolderId = createdFolder.id;
								if (projectId) {
									await client.postAction('assign-project', {projectId, folderId: createdFolder.id});
								}
							}
							if (chosenParentId) {
								window.__PROJECT_FOLDERS_VIEW__?.expandFolder?.(chosenParentId);
							}
							closeModal();
						}
					}
					return r;
				}
				input.addEventListener('input', () => input.setCustomValidity(''));
				btnCancel.addEventListener('click', closeModal);
				btnSubmit.addEventListener('click', submit);
				input.addEventListener('keydown', e => {
					if ('Enter' === e.key) {
						e.preventDefault();
						submit();
					}
					else if ('Escape' === e.key) {
						e.preventDefault();
						closeModal();
					}
				});
				overlay.addEventListener('click', e => {
					if (overlay === e.target) {
						closeModal();
					}
				});
			}
		}
		function showMoveFolderMenu(coords, folderId) {
			const folder = client.getFolder(folderId);
			if (folder) {
				const excludedIds = client.getDescendantIds(folderId);
				excludedIds.add(folderId);
				const isRoot = null === folder.parentId;
				showContextMenu(coords.clientX, coords.clientY, [
					{
						folderTree: {
							selectedId: folder.parentId,
							excludedIds,
							onSelect: newParentId => client.postAction('move-folder', {id: folderId, newParentId})
						}
					},
					{separator: true},
					{
						icon: isRoot ? '✓' : '↥',
						label: 'To top level',
						onClick: () => {
							if (!isRoot) {
								client.postAction('move-folder', {id: folderId, newParentId: null});
							}
						}
					}
				], 'Move folder');
			}
		}
		function startInlineRename(folderHeaderEl, folderId, currentName) {
			let r;
			result: {
				closeContextMenu();
				if (!folderHeaderEl) {
					r = undefined;
					break result;
				}
				const h2 = folderHeaderEl.querySelector('h2');
				if (!h2) {
					r = undefined;
					break result;
				}
				const button = h2.querySelector('button') || h2;
				const textSpan = button.querySelector('span.truncate') || button.querySelector('span');
				if (!textSpan || folderHeaderEl.querySelector('.folder-rename-input')) {
					r = undefined;
					break result;
				}
				const originalText = textSpan.textContent;
				const baseName = currentName || originalText.replace(/^📁\s*/, '').replace(/\s*\(\d+\)$/, '').trim();
				textSpan.style.display = 'none';
				const input = document.createElement('input');
				input.type = 'text';
				input.className = 'folder-rename-input';
				input.value = baseName;
				button.insertBefore(input, textSpan);
				input.focus();
				input.select();
				let finished = false;
				function finish(save) {
					if (!finished) {
						finished = true;
						const newName = input.value.trim();
						if (input.parentNode) {
							input.parentNode.removeChild(input);
						}
						textSpan.style.display = '';
						button.focus?.();
						if (save && newName && baseName !== newName) {
							client.postAction('rename-folder', {id: folderId, newName});
						}
					}
				}
				input.addEventListener('keydown', e => {
					e.stopPropagation();
					if ('Enter' === e.key) {
						e.preventDefault();
						finish(true);
					}
					else if ('Escape' === e.key) {
						e.preventDefault();
						finish(false);
					}
				});
				input.addEventListener('blur', () => {
					finish(true);
				});
				input.addEventListener('click', e => {
					e.stopPropagation();
				});
			}
			return r;
		}
		function showFolderContextMenu(e, folderHeaderEl, folderId, folderName) {
			e.preventDefault();
			e.stopPropagation();
			showContextMenu(e.clientX, e.clientY, [
				{
					icon: '➕',
					label: 'Create project in this folder…',
					onClick: () => {
						if (!window.__PROJECT_FOLDERS_VIEW__) {
							throw Error('Folders view is unavailable; run Upg to reconnect');
						}
						return window.__PROJECT_FOLDERS_VIEW__.createProject(folderId);
					}
				},
				{
					icon: '📁➕',
					label: 'Create subfolder…',
					onClick: () => showCreateFolderDialog(null, folderId)
				},
				{
					icon: '↗️',
					label: 'Move folder…',
					onClick: () => {
						const rect = folderHeaderEl.getBoundingClientRect();
						showMoveFolderMenu({clientX: rect.left + 20, clientY: rect.bottom + 4}, folderId);
					}
				},
				{
					icon: '✏️',
					label: 'Rename folder',
					shortcut: 'F2',
					onClick: () => startInlineRename(folderHeaderEl, folderId, folderName)
				},
				{
					icon: '➕',
					label: 'Create new root folder',
					onClick: () => showCreateFolderDialog(null, null)
				},
				{separator: true},
				{
					icon: '🗑️',
					label: 'Delete folder',
					danger: true,
					onClick: () => {
						if (confirm(`Delete folder "${folderName}"? (Subfolders and projects will be promoted one level up)`)) {
							client.postAction('remove-folder', {id: folderId});
						}
					}
				}
			]);
		}
		function showProjectContextMenu(e, _projectCardEl, projectId) {
			openProjectContextMenu(e, projectId, {client, showContextMenu, showCreateFolderDialog, win: window});
		}
		listen('click', e => {
			if (client.activeMenu && !client.activeMenu.contains(e.target)) {
				closeContextMenu();
			}
		});
		listen('keydown', e => {
			if ('Escape' === e.key) {
				closeContextMenu();
				if (client.activeModal) {
					if (client.activeModal.parentNode) {
						client.activeModal.parentNode.removeChild(client.activeModal);
					}
					client.activeModal = null;
				}
			}
			// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
			// "Integrate with universal dmitry-ai/harness, format codebase per P.md/P.ES6.md, and link source files to GitHub Issues":
			// https://github.com/dmitry-ai/antigravity-addons/issues/16
			else if (('Insert' === e.key || (e.altKey && ('KeyN' === e.code || 'n' === e.key || 'N' === e.key))) && !client.activeModal) {
				const isInput = e.target && ('INPUT' === e.target.tagName || 'TEXTAREA' === e.target.tagName || e.target.isContentEditable);
				if (!isInput) {
					e.preventDefault();
					showCreateFolderDialog();
				}
			}
			else if ('F2' === e.key) {
				const focusedHeader = document.activeElement?.closest('[data-folder-id]');
				const renameHeader = focusedHeader || client.hoveredFolderEl;
				const renameId = focusedHeader?.getAttribute('data-folder-id') || client.hoveredFolderId;
				if (renameHeader && renameId) {
					e.preventDefault();
					const f = client.getFolder(renameId);
					startInlineRename(renameHeader, renameId, f?.name);
				}
			}
		}, true);
		// 2026-10-19 Dmitrii Fediuk https://github.com/dmitrii-fediuk
		// "Restore Folders compatibility with Antigravity 2.25.0 and analyze architectural resilience against renderer bundle changes":
		// https://github.com/dmitry-ai/antigravity-addons/issues/9
		console.log('[folders-client] Hierarchical Project Folders UI Controller successfully loaded and active.');
	}
	return r;
	}
	return {folderPickerModel, hasDragType, initAntigravityFoldersClient, openProjectContextMenu, positionContextMenu};
});
