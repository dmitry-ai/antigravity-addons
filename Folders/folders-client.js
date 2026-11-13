// 2026-10-12 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Add interactive GUI folder management (folders-client.js), nested parentId hierarchy, drag-and-drop, Windows Explorer sorting, and adaptive Light/Dark menus":
// https://github.com/dmitry-ai/antigravity-addons/issues/4
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders around standalone v2 architecture, delegated events, UMD test exports, and shared folders-model mutations":
// https://github.com/dmitry-ai/antigravity-addons/issues/24
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decompose enhanceSidebarElements and convert client controller into ES6 classes and methods in Folders/folders-client.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/27
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders UI layer (folders-client.js and folders-view.js) with unified modal builder, direct selection lookup, and removal of non-CDP fallbacks":
// https://github.com/dmitry-ai/antigravity-addons/issues/30
(function(factory) {
	const api = factory();
	if ('object' === typeof module && module.exports) {
		module.exports = api;
	}
	else {
		api.initAntigravityFoldersClient();
	}
})(() => {
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
	function positionContextMenu(menu, viewport = window) {
		const {x, y} = menu._folderAnchor;
		menu.style.left = `${Math.max(8, Math.min(x, viewport.innerWidth - menu.offsetWidth - 8))}px`;
		menu.style.top = `${Math.max(8, Math.min(y, viewport.innerHeight - menu.offsetHeight - 8))}px`;
	}
	// 2026-10-19 Dmitrii Fediuk https://github.com/dmitrii-fediuk
	// "Restore Folders compatibility with Antigravity 2.25.0 and analyze architectural resilience against renderer bundle changes":
	// https://github.com/dmitry-ai/antigravity-addons/issues/9
	class SidebarDragController {
		constructor(client) {
			this.client = client;
			this.activeDropEl = null;
			this.draggedElement = null;
			this.abortController = null;
		}
		bind(root) {
			this.dispose();
			this.abortController = new AbortController();
			const on = (type, listener, capture = false) => root.addEventListener(type, listener, {capture, signal: this.abortController.signal});
			on('click', e => {
				if (this.client.isDragging && e.target.closest?.('[data-folders-row^="folder:"]')) {
					e.preventDefault();
					e.stopPropagation();
				}
			}, true);
			on('pointerdown', e => {
				if (!e.altKey && 0 === e.button && !e.target.closest?.('input, .folder-rename-input') && e.target.closest?.('[data-folders-row^="folder:"], button[data-project-card]')) {
					e.stopPropagation();
				}
			});
			on('dragstart', e => this.startDrag(e));
			on('dragend', () => this.endDrag());
			on('dragover', e => this.handleDragOver(e));
			on('dragleave', e => {
				if (!root.contains(e.relatedTarget) || !this.resolveDropZone(e.relatedTarget)) {
					this.setDropTarget(null);
				}
			});
			on('drop', e => this.executeDrop(e));
		}
		canDropOnTarget(e, targetFolderId) {
			let r;
			result: {
				const isProjectDrag = hasDragType(e?.dataTransfer, 'application/antigravity-project-id') || !!this.client.draggedProjectId;
				const isFolderDrag = hasDragType(e?.dataTransfer, 'application/antigravity-folder-id') || !!this.client.draggedFolderId;
				if (!isProjectDrag && !isFolderDrag) {
					r = {allowed: false, blocked: false};
					break result;
				}
				if (isProjectDrag) {
					r = {allowed: true, blocked: false};
					break result;
				}
				const draggedFolderId = this.client.draggedFolderId || e?.dataTransfer?.getData('application/antigravity-folder-id');
				const df = draggedFolderId ? this.client.getFolder(draggedFolderId) : null;
				if (!df) {
					r = {allowed: false, blocked: false};
					break result;
				}
				const targetParent = targetFolderId || null;
				if (targetParent === df.id || targetParent === (df.parentId || null)) {
					r = {allowed: false, blocked: null !== targetParent};
					break result;
				}
				if (targetParent && this.client.getDescendantIds(df.id).has(targetParent)) {
					r = {allowed: false, blocked: true};
					break result;
				}
				const siblings = (this.client.data?.folders || []).filter(item => targetParent === (item.parentId || null));
				const collision = siblings.some(item => df.id !== item.id && df.name.toLowerCase() === item.name.toLowerCase());
				r = {allowed: !collision, blocked: collision};
			}
			return r;
		}
		dispose() {
			this.abortController?.abort();
			this.abortController = null;
			this.setDropTarget(null);
		}
		endDrag() {
			if (this.draggedElement) {
				this.draggedElement.style.opacity = '';
				this.draggedElement = null;
			}
			this.setDropTarget(null);
			this.client.draggedFolderId = null;
			this.client.draggedProjectId = null;
			setTimeout(() => {
				this.client.isDragging = false;
			}, 100);
		}
		async executeDrop(e) {
			const zone = this.resolveDropZone(e.target);
			this.setDropTarget(null);
			if (zone) {
				e.preventDefault();
				e.stopPropagation();
				const projId = e.dataTransfer?.getData('application/antigravity-project-id') || this.client.draggedProjectId;
				const draggedFolderId = e.dataTransfer?.getData('application/antigravity-folder-id') || this.client.draggedFolderId;
				if (projId) {
					await this.client.postAction(zone.folderId ? 'assign-project' : 'unassign-project', zone.folderId ? {projectId: projId, folderId: zone.folderId} : {projectId: projId});
				}
				else if (draggedFolderId && this.canDropOnTarget(e, zone.folderId).allowed) {
					const res = await this.client.postAction('move-folder', {id: draggedFolderId, newParentId: zone.folderId});
					if (res?.success && zone.folderId) {
						this.client.win?.__PROJECT_FOLDERS_VIEW__?.expandFolder?.(zone.folderId);
					}
				}
			}
		}
		handleDragOver(e) {
			const zone = this.resolveDropZone(e.target);
			if (!zone) {
				this.setDropTarget(null);
			}
			else {
				const check = this.canDropOnTarget(e, zone.folderId);
				if (!check.allowed) {
					this.setDropTarget(null);
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
					this.setDropTarget(zone.el);
				}
			}
		}
		resolveDropZone(target) {
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
		}
		setDropTarget(el) {
			if (el !== this.activeDropEl) {
				this.activeDropEl?.classList.remove('folder-drop-target');
				this.activeDropEl = el;
				this.activeDropEl?.classList.add('folder-drop-target');
			}
		}
		startDrag(e) {
			if (e.altKey || e.target.closest?.('input, .folder-rename-input')) {
				e.preventDefault();
			}
			else {
				const card = e.target.closest?.('button[data-project-card]');
				const folderRow = card ? null : e.target.closest?.('[data-folders-row^="folder:"]');
				if (card?.dataset.projectId) {
					e.stopPropagation();
					this.client.isDragging = true;
					this.client.draggedProjectId = card.dataset.projectId;
					this.client.draggedFolderId = null;
					this.draggedElement = card;
					e.dataTransfer.setData('application/antigravity-project-id', card.dataset.projectId);
					e.dataTransfer.setData('text/plain', card.dataset.projectId);
					e.dataTransfer.effectAllowed = 'move';
					card.style.opacity = '0.5';
				}
				else if (folderRow?.dataset.folderId) {
					e.stopPropagation();
					this.client.isDragging = true;
					this.client.draggedFolderId = folderRow.dataset.folderId;
					this.client.draggedProjectId = null;
					this.draggedElement = folderRow;
					e.dataTransfer.setData('application/antigravity-folder-id', folderRow.dataset.folderId);
					e.dataTransfer.setData('text/plain', folderRow.dataset.folderId);
					e.dataTransfer.effectAllowed = 'move';
					folderRow.style.opacity = '0.5';
				}
			}
		}
	}
	class FoldersClient {
		constructor(win = 'undefined' !== typeof window ? window : undefined) {
			this.win = win;
			this.doc = win?.document || ('undefined' !== typeof document ? document : undefined);
			this.data = win?.__PROJECT_FOLDERS_DATA__ || {folders: [], projectFolderMap: {}};
			this.activeMenu = null;
			this.activeModal = null;
			this.closeActiveModal = null;
			this.hoveredFolderId = null;
			this.hoveredFolderEl = null;
			this.lastHoveredFolderId = null;
			this.lastHoveredFolderTime = 0;
			this.lastActiveFolderId = null;
			this.lastActiveProjectId = null;
			this.draggedFolderId = null;
			this.draggedProjectId = null;
			this.isDragging = false;
			this.lifetime = new AbortController();
			this.rootAbort = null;
			this.drag = new SidebarDragController(this);
			this.ui = {
				openModal: (...args) => this.openModal(...args),
				showCreateFolderDialog: (...args) => this.showCreateFolderDialog(...args),
				showFolderContextMenu: (...args) => this.showFolderContextMenu(...args),
				showProjectContextMenu: (...args) => this.showProjectContextMenu(...args),
				showMoveFolderMenu: (...args) => this.showMoveFolderMenu(...args),
				showContextMenu: (...args) => this.showContextMenu(...args),
				closeContextMenu: () => this.closeContextMenu()
			};
		}
		appendFolderTree(menu, {selectedId, excludedIds, onSelect}) {
			const {children, expanded} = folderPickerModel(this.data?.folders, selectedId, excludedIds);
			const tree = this.doc.createElement('div');
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
							const row = this.createFolderTreeRow({folder, depth, hasChildren, selectedId, expanded, rows, tree, onSelect, render});
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
					positionContextMenu(menu, this.win);
				}
			};
			render();
			menu.appendChild(tree);
		}
		bindGlobalListeners() {
			const listen = (type, listener, capture = false) => this.win.addEventListener(type, listener, {capture, signal: this.lifetime.signal});
			listen('click', e => {
				if (this.activeMenu && !this.activeMenu.contains(e.target)) {
					this.closeContextMenu();
				}
			});
			listen('keydown', e => {
				if ('Escape' === e.key) {
					this.closeContextMenu();
					this.closeModal();
				}
				// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
				// "Integrate with universal dmitry-ai/harness, format codebase per P.md/P.ES6.md, and link source files to GitHub Issues":
				// https://github.com/dmitry-ai/antigravity-addons/issues/16
				else if (('Insert' === e.key || (e.altKey && ('KeyN' === e.code || 'n' === e.key || 'N' === e.key))) && !this.activeModal) {
					const isInput = e.target && ('INPUT' === e.target.tagName || 'TEXTAREA' === e.target.tagName || e.target.isContentEditable);
					if (!isInput) {
						e.preventDefault();
						this.showCreateFolderDialog();
					}
				}
				else if ('F2' === e.key) {
					const focusedHeader = this.doc?.activeElement?.closest('[data-folder-id]');
					const renameHeader = focusedHeader || this.hoveredFolderEl;
					const renameId = focusedHeader?.getAttribute('data-folder-id') || this.hoveredFolderId;
					if (renameHeader && renameId) {
						e.preventDefault();
						const f = this.getFolder(renameId);
						this.startInlineRename(renameHeader, renameId, f?.name);
					}
				}
			}, true);
		}
		bindRoot(root) {
			this.rootAbort?.abort();
			this.rootAbort = new AbortController();
			const on = (type, listener, capture = false) => root.addEventListener(type, listener, {capture, signal: this.rootAbort.signal});
			on('mouseover', e => {
				const folderRow = e.target.closest?.('[data-folders-row^="folder:"]');
				if (folderRow) {
					const fid = folderRow.dataset.folderId;
					this.hoveredFolderId = fid;
					this.hoveredFolderEl = folderRow;
					this.lastHoveredFolderId = fid;
					this.lastHoveredFolderTime = Date.now();
				}
			});
			on('mouseout', e => {
				const folderRow = e.target.closest?.('[data-folders-row^="folder:"]');
				if (folderRow && !folderRow.contains(e.relatedTarget) && folderRow.dataset.folderId === this.hoveredFolderId) {
					this.hoveredFolderId = null;
					this.hoveredFolderEl = null;
				}
			});
			on('contextmenu', e => {
				const card = e.target.closest?.('button[data-project-card]');
				const folderRow = card ? null : e.target.closest?.('[data-folders-row^="folder:"]');
				if (card) {
					this.showProjectContextMenu(e, card, card.dataset.projectId);
				}
				else if (folderRow) {
					const fid = folderRow.dataset.folderId;
					this.showFolderContextMenu(e, folderRow, fid, this.getFolder(fid)?.name || '');
				}
			});
			on('click', e => {
				const card = e.target.closest?.('button[data-project-card]');
				const folderRow = card ? null : e.target.closest?.('[data-folders-row^="folder:"]');
				const convoRow = card || folderRow ? null : e.target.closest?.("[data-testid^='conversation-row-']");
				if (card?.dataset.projectId) {
					this.lastActiveProjectId = card.dataset.projectId;
					this.lastActiveFolderId = this.getProjectFolderId(card.dataset.projectId);
				}
				else if (folderRow?.dataset.folderId) {
					this.lastActiveFolderId = folderRow.dataset.folderId;
				}
				else if (convoRow) {
					const pid = convoRow.closest('[data-group-id]')?.dataset.groupId;
					if (pid) {
						this.lastActiveProjectId = pid;
						this.lastActiveFolderId = this.getProjectFolderId(pid);
					}
				}
			});
			this.drag.bind(root);
		}
		closeContextMenu() {
			this.activeMenu?.remove();
			this.activeMenu = null;
		}
		closeModal() {
			if (this.closeActiveModal) {
				this.closeActiveModal();
			}
			else {
				this.activeModal?.remove();
				this.activeModal = null;
			}
		}
		createFolderTreeRow({folder, depth, hasChildren, selectedId, expanded, rows, tree, onSelect, render}) {
			const row = this.doc.createElement('div');
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
			row.title = this.getFolderPath(folder.id);
			const toggle = this.doc.createElement(hasChildren ? 'button' : 'span');
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
			const icon = this.doc.createElement('span');
			icon.className = 'antigravity-folder-target-icon';
			icon.setAttribute('aria-hidden', 'true');
			icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11H3Z"/></svg>';
			const label = this.doc.createElement('span');
			label.className = 'antigravity-folder-target-label';
			label.textContent = folder.name;
			const check = this.doc.createElement('span');
			check.className = 'antigravity-folder-target-check';
			check.textContent = selectedId === folder.id ? '✓' : '';
			row.append(toggle, icon, label, check);
			row.addEventListener('click', e => {
				e.stopPropagation();
				this.closeContextMenu();
				if (selectedId !== folder.id) {
					onSelect(folder.id);
				}
			});
			row.addEventListener('keydown', e => this.handleTreeRowKeydown(e, {row, folder, hasChildren, expanded, rows, tree, render}));
			return row;
		}
		createMenuItemRow(menu, item, hasTree) {
			const row = this.doc.createElement('div');
			row.className = `antigravity-folder-menu-item ${item.danger ? 'danger' : ''}`;
			row.setAttribute('tabindex', '0');
			row.setAttribute('role', hasTree ? 'button' : 'menuitem');
			const labelSpan = this.doc.createElement('span');
			labelSpan.style.display = 'flex';
			labelSpan.style.alignItems = 'center';
			labelSpan.style.gap = '6px';
			labelSpan.textContent = `${item.icon || ''} ${item.label}`;
			row.appendChild(labelSpan);
			if (item.shortcut) {
				const sc = this.doc.createElement('span');
				sc.className = 'antigravity-folder-menu-shortcut';
				sc.textContent = item.shortcut;
				row.appendChild(sc);
			}
			row.addEventListener('click', e => {
				e.stopPropagation();
				this.closeContextMenu();
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
			return row;
		}
		detectCurrentFolderId() {
			return this.folderFromHover()
				|| this.folderFromFocusedElement()
				|| this.folderFromSelectedConversation()
				|| this.folderFromRememberedSelection();
		}
		dispose() {
			this.lifetime.abort();
			this.rootAbort?.abort();
			this.drag.dispose();
			this.closeContextMenu();
			this.closeModal();
			if (this.win) {
				this.win.__PROJECT_FOLDERS_CLIENT_INITIALIZED__ = false;
				delete this.win.__PROJECT_FOLDERS_CLIENT__;
			}
		}
		element(tag, className, text) {
			const el = this.doc.createElement(tag);
			if (className) {
				el.className = className;
			}
			if (undefined !== text) {
				el.textContent = text;
			}
			return el;
		}
		folderFromFocusedElement() {
			let r = null;
			const activeEl = this.doc?.activeElement;
			if (activeEl) {
				const fHeader = activeEl.closest?.('[data-folder-id]');
				const headerFid = fHeader?.getAttribute('data-folder-id');
				if (headerFid && this.getFolder(headerFid)) {
					r = headerFid;
				}
				else {
					const pCard = activeEl.closest?.('[data-project-card]');
					const cRow = pCard ? null : activeEl.closest?.("[data-testid^='conversation-row-']");
					const pid = pCard ? pCard.getAttribute('data-project-id') : cRow?.closest('[data-group-id]')?.getAttribute('data-group-id');
					const fid = pid ? this.getProjectFolderId(pid) : null;
					if (fid && this.getFolder(fid)) {
						r = fid;
					}
				}
			}
			return r;
		}
		folderFromHover() {
			let r = null;
			if (this.hoveredFolderId && this.getFolder(this.hoveredFolderId)) {
				r = this.hoveredFolderId;
			}
			else if (this.lastHoveredFolderId && 5000 > Date.now() - this.lastHoveredFolderTime && this.getFolder(this.lastHoveredFolderId)) {
				r = this.lastHoveredFolderId;
			}
			return r;
		}
		folderFromRememberedSelection() {
			let r = null;
			if (this.lastActiveFolderId && this.getFolder(this.lastActiveFolderId)) {
				r = this.lastActiveFolderId;
			}
			else if (this.lastActiveProjectId) {
				const fid = this.getProjectFolderId(this.lastActiveProjectId);
				if (fid && this.getFolder(fid)) {
					r = fid;
				}
			}
			return r;
		}
		folderFromSelectedConversation() {
			let r = null;
			const view = this.win?.__PROJECT_FOLDERS_VIEW__;
			const selection = view?.adapter?.selection?.();
			const selectedPid = selection?.projectId
				|| (selection?.conversationId ? view?.state?.summaries?.get?.(selection.conversationId)?.trajectoryMetadata?.projectId : null)
				|| this.doc?.querySelector?.("[data-testid^='conversation-row-'][data-selected='true']")?.closest?.('[data-group-id]')?.getAttribute('data-group-id');
			const fid = selectedPid ? this.getProjectFolderId(selectedPid) : null;
			if (fid && this.getFolder(fid)) {
				r = fid;
			}
			return r;
		}
		getDescendantIds(folderId) {
			const model = this.getModel();
			return model ? model.getDescendantIds(folderId, this.data?.folders) : new Set();
		}
		getFolder(id) {
			return Array.isArray(this.data?.folders) ? this.data.folders.find(f => id === f.id) || null : null;
		}
		getFolderPath(folderId) {
			const model = this.getModel();
			return model ? model.getFolderPath(folderId, this.data?.folders) : '';
		}
		getModel() {
			return this.win?.AntigravityFoldersModel || ('object' === typeof module && module.exports ? require('./folders-model') : null);
		}
		getProjectFolderId(projectId) {
			return this.data?.projectFolderMap?.[projectId] || null;
		}
		handleTreeRowKeydown(e, {row, folder, hasChildren, expanded, rows, tree, render}) {
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
		}
		notifyUpdate(newData) {
			this.data = newData;
			if (this.win) {
				this.win.__PROJECT_FOLDERS_DATA__ = newData;
			}
			this.triggerRerender();
		}
		openModal({ariaLabel, buildBody, onClose, onSubmit, submitLabel = 'Save', title}) {
			this.closeContextMenu();
			let r = null;
			if (!this.activeModal) {
				const overlay = this.element('div', 'antigravity-folder-modal-overlay');
				const form = this.element('form', 'antigravity-folder-modal');
				form.setAttribute('role', 'dialog');
				form.setAttribute('aria-modal', 'true');
				form.setAttribute('aria-label', ariaLabel || title);
				const titleEl = this.element('h3', 'folder-modal-title', title);
				const errorEl = this.element('div', 'fg-dialog-error');
				errorEl.setAttribute('role', 'alert');
				const buttons = this.element('div', 'antigravity-folder-modal-buttons');
				const cancel = this.element('button', 'antigravity-folder-btn secondary btn-cancel', 'Cancel');
				const submit = this.element('button', 'antigravity-folder-btn primary btn-submit', submitLabel);
				cancel.type = 'button';
				submit.type = 'submit';
				buttons.append(cancel, submit);
				form.append(titleEl);
				const focusTarget = buildBody?.({errorEl, form, submit, titleEl});
				form.append(errorEl, buttons);
				overlay.append(form);
				this.doc.body.append(overlay);
				let closed = false;
				const close = () => {
					if (!closed) {
						closed = true;
						if (overlay === this.activeModal) {
							this.activeModal = null;
							this.closeActiveModal = null;
						}
						overlay.remove();
						onClose?.();
						this.triggerRerender();
					}
				};
				this.activeModal = overlay;
				this.closeActiveModal = close;
				cancel.addEventListener('click', close);
				overlay.addEventListener('click', e => {
					if (overlay === e.target) {
						close();
					}
				});
				focusTarget?.focus?.();
				form.addEventListener('submit', async e => {
					e.preventDefault();
					if (!submit.disabled) {
						submit.disabled = true;
						errorEl.textContent = '';
						try {
							const done = await onSubmit({close, errorEl, submit});
							if (false === done) {
								submit.disabled = false;
							}
							else {
								close();
							}
						}
						catch (cause) {
							errorEl.textContent = cause.message;
							submit.disabled = false;
						}
					}
				});
				r = {close, errorEl, form, overlay, submit, titleEl};
			}
			return r;
		}
		populateFolderSelect(select, selectedParentId = null) {
			const {byId, children} = folderPickerModel(this.data?.folders, selectedParentId);
			const rootOption = this.element('option', '', '📁 Root (no parent)');
			rootOption.value = '';
			rootOption.selected = !selectedParentId || !byId.has(selectedParentId);
			select.replaceChildren(rootOption);
			const walk = (parentId, depth) => {
				for (const folder of children.get(parentId) || []) {
					const prefix = 0 < depth ? `${'\u00a0\u00a0'.repeat(depth)}↳ ` : '';
					const option = this.element('option', '', `${prefix}📁 ${folder.name}`);
					option.value = folder.id;
					option.selected = selectedParentId === folder.id;
					select.append(option);
					walk(folder.id, depth + 1);
				}
			};
			walk(null, 0);
		}
		async postAction(action, payload = {}) {
			let r;
			try {
				console.log(`[folders-client] Dispatching action: ${action}`, payload);
				if ('function' !== typeof this.win?.__ANTIGRAVITY_TOOLS_REQUEST__) {
					throw Error('Folder storage bridge is unavailable; run Upg to reconnect');
				}
				const requestBody = {action, ...payload, revision: this.win.__FOLDERS_REVISION__};
				const result = await this.win.__ANTIGRAVITY_TOOLS_REQUEST__('folders', {method: 'POST', body: requestBody});
				if (result.revision) {
					this.win.__FOLDERS_REVISION__ = result.revision;
				}
				if (result.success && result.data) {
					this.notifyUpdate(result.data);
				}
				this.win.__PROJECT_FOLDERS_VIEW__?.reportAction(result.success ? null : result.error || 'Folder action failed');
				r = result;
			}
			catch (err) {
				console.error('[folders-client] Action error:', err);
				this.win?.__PROJECT_FOLDERS_VIEW__?.reportAction(err.message);
				r = {success: false, error: err.message};
			}
			return r;
		}
		showContextMenu(x, y, items, title = '') {
			this.closeContextMenu();
			const menu = this.doc.createElement('div');
			menu._folderAnchor = {x, y};
			const hasTree = items.some(item => item.folderTree);
			menu.className = `antigravity-folder-menu${hasTree ? ' antigravity-folder-picker' : ''}`;
			menu.setAttribute('role', hasTree ? 'dialog' : 'menu');
			if (title) {
				menu.setAttribute('aria-label', title);
				const heading = this.doc.createElement('div');
				heading.className = 'antigravity-folder-menu-title';
				heading.textContent = title;
				menu.appendChild(heading);
			}
			for (const item of items) {
				if (item.folderTree) {
					this.appendFolderTree(menu, item.folderTree);
				}
				else if (item.separator) {
					const sep = this.doc.createElement('div');
					sep.className = 'antigravity-folder-menu-separator';
					menu.appendChild(sep);
				}
				else {
					menu.appendChild(this.createMenuItemRow(menu, item, hasTree));
				}
			}
			this.doc.body.appendChild(menu);
			this.activeMenu = menu;
			positionContextMenu(menu, this.win);
			const focus = menu.querySelector('[role=treeitem][aria-selected=true]') || menu.querySelector('[role=treeitem], [role=menuitem], [role=button]');
			focus?.focus({preventScroll: true});
			if (hasTree) {
				focus?.scrollIntoView({block: 'nearest'});
			}
		}
		showCreateFolderDialog(projectId = null, explicitParentId = undefined) {
			const targetParentId = undefined !== explicitParentId
				? explicitParentId
				: projectId
					? this.getProjectFolderId(projectId) || null
					: this.detectCurrentFolderId();
			const parentFolder = targetParentId ? this.getFolder(targetParentId) : null;
			const titleText = parentFolder ? `Create subfolder in “${parentFolder.name}”` : 'Create new folder';
			let input;
			let select;
			this.openModal({
				title: titleText,
				ariaLabel: titleText,
				submitLabel: 'Create',
				onClose: () => this.doc?.querySelector?.('.btn-create-folder')?.focus?.(),
				buildBody: ({form, titleEl}) => {
					input = this.element('input', 'folder-name-input');
					input.type = 'text';
					input.placeholder = parentFolder ? 'Subfolder name...' : 'Folder name...';
					input.setAttribute('aria-label', 'Folder name');
					select = this.element('select', 'folder-parent-select');
					select.setAttribute('aria-label', 'Location (parent)');
					this.populateFolderSelect(select, targetParentId);
					select.addEventListener('change', () => {
						const curParent = select.value ? this.getFolder(select.value) : null;
						const nextTitle = curParent ? `Create subfolder in “${curParent.name}”` : 'Create new folder';
						titleEl.textContent = nextTitle;
						form.setAttribute('aria-label', nextTitle);
						input.placeholder = curParent ? 'Subfolder name...' : 'Folder name...';
						input.setCustomValidity('');
					});
					input.addEventListener('input', () => input.setCustomValidity(''));
					form.append(
						this.element('label', 'antigravity-folder-label', 'Folder name:'),
						input,
						this.element('label', 'antigravity-folder-label', 'Location (parent):'),
						select
					);
					return input;
				},
				onSubmit: async () => {
					let r = true;
					const val = input.value.trim();
					const chosenParentId = select.value || null;
					const siblings = (this.data?.folders || []).filter(folder => (chosenParentId || null) === (folder.parentId || null));
					if (!val) {
						input.setCustomValidity('Enter a folder name');
						input.reportValidity();
						r = false;
					}
					else if (siblings.some(folder => val.toLowerCase() === folder.name.toLowerCase())) {
						input.setCustomValidity('A folder with this name already exists in this branch');
						input.reportValidity();
						r = false;
					}
					else {
						const result = await this.postAction('add-folder', {name: val, parentId: chosenParentId});
						if (!result.success) {
							input.setCustomValidity(result.error || 'Failed to create folder');
							input.reportValidity();
							r = false;
						}
						else {
							const createdFolder = (result.data?.folders || []).find(f => (chosenParentId || null) === (f.parentId || null) && val.toLowerCase() === f.name.toLowerCase());
							if (createdFolder) {
								this.lastActiveFolderId = createdFolder.id;
								if (projectId) {
									await this.postAction('assign-project', {projectId, folderId: createdFolder.id});
								}
							}
							if (chosenParentId) {
								this.win?.__PROJECT_FOLDERS_VIEW__?.expandFolder?.(chosenParentId);
							}
						}
					}
					return r;
				}
			});
		}
		showFolderContextMenu(e, folderHeaderEl, folderId, folderName) {
			e.preventDefault();
			e.stopPropagation();
			this.showContextMenu(e.clientX, e.clientY, [
				{
					icon: '➕',
					label: 'Create project in this folder…',
					onClick: () => {
						if (!this.win.__PROJECT_FOLDERS_VIEW__) {
							throw Error('Folders view is unavailable; run Upg to reconnect');
						}
						return this.win.__PROJECT_FOLDERS_VIEW__.createProject(folderId);
					}
				},
				{
					icon: '📁➕',
					label: 'Create subfolder…',
					onClick: () => this.showCreateFolderDialog(null, folderId)
				},
				{
					icon: '↗️',
					label: 'Move folder…',
					onClick: () => {
						const rect = folderHeaderEl.getBoundingClientRect();
						this.showMoveFolderMenu({clientX: rect.left + 20, clientY: rect.bottom + 4}, folderId);
					}
				},
				{
					icon: '✏️',
					label: 'Rename folder',
					shortcut: 'F2',
					onClick: () => this.startInlineRename(folderHeaderEl, folderId, folderName)
				},
				{
					icon: '➕',
					label: 'Create new root folder',
					onClick: () => this.showCreateFolderDialog(null, null)
				},
				{separator: true},
				{
					icon: '🗑️',
					label: 'Delete folder',
					danger: true,
					onClick: () => {
						if (this.win.confirm(`Delete folder "${folderName}"? (Subfolders and projects will be promoted one level up)`)) {
							this.postAction('remove-folder', {id: folderId});
						}
					}
				}
			]);
		}
		showMoveFolderMenu(coords, folderId) {
			const folder = this.getFolder(folderId);
			if (folder) {
				const excludedIds = this.getDescendantIds(folderId);
				excludedIds.add(folderId);
				const isRoot = null === folder.parentId;
				this.showContextMenu(coords.clientX, coords.clientY, [
					{
						folderTree: {
							selectedId: folder.parentId,
							excludedIds,
							onSelect: newParentId => this.postAction('move-folder', {id: folderId, newParentId})
						}
					},
					{separator: true},
					{
						icon: isRoot ? '✓' : '↥',
						label: 'To top level',
						onClick: () => {
							if (!isRoot) {
								this.postAction('move-folder', {id: folderId, newParentId: null});
							}
						}
					}
				], 'Move folder');
			}
		}
		showProjectContextMenu(e, _projectCardEl, projectId) {
			openProjectContextMenu(e, projectId, {
				client: this,
				showContextMenu: (...args) => this.showContextMenu(...args),
				showCreateFolderDialog: (...args) => this.showCreateFolderDialog(...args),
				win: this.win
			});
		}
		startInlineRename(folderHeaderEl, folderId, currentName) {
			this.closeContextMenu();
			const h2 = folderHeaderEl?.querySelector('h2');
			const button = h2 ? h2.querySelector('button') || h2 : null;
			const textSpan = button ? button.querySelector('span.truncate') || button.querySelector('span') : null;
			if (textSpan && !folderHeaderEl.querySelector('.folder-rename-input')) {
				const originalText = textSpan.textContent;
				const baseName = currentName || originalText.replace(/^📁\s*/, '').replace(/\s*\(\d+\)$/, '').trim();
				textSpan.style.display = 'none';
				const input = this.doc.createElement('input');
				input.type = 'text';
				input.className = 'folder-rename-input';
				input.value = baseName;
				button.insertBefore(input, textSpan);
				input.focus();
				input.select();
				let finished = false;
				const finish = save => {
					if (!finished) {
						finished = true;
						const newName = input.value.trim();
						input.remove();
						textSpan.style.display = '';
						button.focus?.();
						if (save && newName && baseName !== newName) {
							this.postAction('rename-folder', {id: folderId, newName});
						}
					}
				};
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
				input.addEventListener('blur', () => finish(true));
				input.addEventListener('click', e => e.stopPropagation());
			}
		}
		triggerRerender() {
			this.win?.dispatchEvent(new CustomEvent('antigravity-folders-updated', {detail: this.data}));
		}
	}
	function initAntigravityFoldersClient() {
		let r;
		if ('undefined' !== typeof window && !window.__PROJECT_FOLDERS_CLIENT_INITIALIZED__) {
			window.__PROJECT_FOLDERS_CLIENT_INITIALIZED__ = true;
			console.log('[folders-client] Initializing Hierarchical Project Folders UI Controller...');
			const client = new FoldersClient(window);
			client.bindGlobalListeners();
			window.__PROJECT_FOLDERS_CLIENT__ = client;
			console.log('[folders-client] Hierarchical Project Folders UI Controller successfully loaded and active.');
			r = client;
		}
		return r;
	}
	return {FoldersClient, SidebarDragController, folderPickerModel, hasDragType, initAntigravityFoldersClient, openProjectContextMenu, positionContextMenu};
});
