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
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Merge Folders browser UI layer (folders-client.js + folders-view.js) and purge dead v1 Less selectors":
// https://github.com/dmitry-ai/antigravity-addons/issues/34
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Unify Folders domain validation, tree traversal helpers, store checks, and CLI listing/mutations around folders-model.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/31
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Fix GET_VIEW_STATE persistence, synchronize Folders revisions, throttle runtime.json writes, and exclude data from runtimeVersion()":
// https://github.com/dmitry-ai/antigravity-addons/issues/38
(factory => {
	const api = factory();
	if ('object' === typeof module && module.exports) {
		module.exports = api;
	}
	else {
		api.installFoldersView();
	}
})(() => {
	const defaultModel = 'undefined' !== typeof window && window.AntigravityFoldersModel
		? window.AntigravityFoldersModel
		: 'object' === typeof module && module.exports
			? require('./folders-model')
			: null;
	const createReadConfig = ({window: win, model = defaultModel, state, view, onUpdate = (data, revision) => view?.notifyUpdate?.(data, revision), status}) => {
		let configPromise = null;
		return () => {
			if (!configPromise) {
				configPromise = (async () => {
					if ('function' !== typeof win?.__ANTIGRAVITY_TOOLS_REQUEST__) {
						throw Error('Folder storage bridge is unavailable; run Upg to reconnect');
					}
					const knownRevision = state.revision;
					const payload = await win.__ANTIGRAVITY_TOOLS_REQUEST__('folders', knownRevision ? {method: 'GET', knownRevision} : {method: 'GET'});
					if (payload.error) {
						throw Error(payload.error);
					}
					if (payload.notModified) {
						state.haveConfig = true;
						if (payload.revision) {
							state.revision = payload.revision;
							win.__FOLDERS_REVISION__ = payload.revision;
						}
					}
					else {
						const data = 2 === payload.schemaVersion ? payload.data : payload;
						model.validateConfig(data);
						state.haveConfig = true;
						if (payload.revision) {
							win.__FOLDERS_REVISION__ = payload.revision;
						}
						const revision = payload.revision || JSON.stringify(data);
						if (revision !== state.revision) {
							onUpdate(data, payload.revision || '');
							state.revision = revision;
						}
					}
					status('folders', null);
				})().finally(() => {
					configPromise = null;
				});
			}
			return configPromise;
		};
	};
	// 2026-10-18 Dmitrii Fediuk https://github.com/dmitrii-fediuk
	// "Add folder-scoped project creation, 80%-height tree folder picker, multi-window UI injection (4th+ windows), and context-only action menus":
	// https://github.com/dmitry-ai/antigravity-addons/issues/8
	const folderPickerModel = (foldersSource, selectedId, excludedIds = new Set()) => {
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
			siblings.sort(defaultModel.compare);
		}
		const expanded = new Set();
		let folder = byId.get(selectedId);
		while (folder && !expanded.has(folder.id)) {
			expanded.add(folder.id);
			folder = byId.get(folder.parentId);
		}
		return {byId, children, expanded};
	};
	const hasDragType = (dataTransfer, type) => Array.from(dataTransfer?.types || []).includes(type);
	const installFoldersView = () => {
		let r;
		if ('undefined' !== typeof window && !window.__PROJECT_FOLDERS_VIEW__) {
			const view = new FoldersView(window);
			view.bindGlobalListeners();
			window.__PROJECT_FOLDERS_VIEW__ = view;
			view.start();
			r = view;
		}
		return r;
	};
	const openProjectContextMenu = (e, projectId, {showContextMenu, showCreateFolderDialog, view, win = 'undefined' !== typeof window ? window : undefined}) => {
		e.preventDefault();
		e.stopPropagation();
		const activeView = view || win?.__PROJECT_FOLDERS_VIEW__;
		const currentFolderId = activeView.getProjectFolderId(projectId);
		const items = [
			{
				folderTree: {
					selectedId: currentFolderId,
					onSelect: folderId => activeView.postAction('assign-project', {projectId, folderId})
				}
			},
			{separator: true}
		];
		if (activeView?.adapter) {
			items.push({label: 'Open project', onClick: () => activeView.adapter.navigate({projectId})});
			items.push({label: 'New conversation', onClick: () => activeView.adapter.navigate({projectId})});
			// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
			// "Add Project settings action to project context menu in Folders":
			// https://github.com/dmitry-ai/antigravity-addons/issues/17
			items.push({label: 'Project settings…', onClick: () => activeView.adapter.openProjectSettings(projectId)});
			items.push({label: 'Rename project…', onClick: () => activeView.renameProject(projectId)});
			items.push({separator: true});
		}
		items.push({
			icon: '➕',
			label: 'Create folder…',
			onClick: () => (showCreateFolderDialog || (id => activeView.showCreateFolderDialog(id)))(projectId)
		});
		if (currentFolderId) {
			items.push({
				icon: '↥',
				label: 'Remove from folder',
				onClick: () => activeView.postAction('unassign-project', {projectId})
			});
		}
		(showContextMenu || ((...args) => activeView.showContextMenu(...args)))(e.clientX, e.clientY, items, 'Move project');
	};
	const positionContextMenu = (menu, viewport = window) => {
		const {x, y} = menu._folderAnchor;
		menu.style.left = `${Math.max(8, Math.min(x, viewport.innerWidth - menu.offsetWidth - 8))}px`;
		menu.style.top = `${Math.max(8, Math.min(y, viewport.innerHeight - menu.offsetHeight - 8))}px`;
	};
	// 2026-10-19 Dmitrii Fediuk https://github.com/dmitrii-fediuk
	// "Restore Folders compatibility with Antigravity 2.25.0 and analyze architectural resilience against renderer bundle changes":
	// https://github.com/dmitry-ai/antigravity-addons/issues/9
	class SidebarDragController {
		constructor(view) {
			this.view = view;
			this.activeDropEl = null;
			this.draggedElement = null;
			this.abortController = null;
		}
		bind(root) {
			this.dispose();
			this.abortController = new AbortController();
			const on = (type, listener, capture = false) => root.addEventListener(type, listener, {capture, signal: this.abortController.signal});
			on('click', e => {
				if (this.view.isDragging && e.target.closest?.('[data-folders-row^="folder:"]')) {
					e.preventDefault();
					e.stopPropagation();
				}
			}, true);
			on('pointerdown', e => {
				if (!e.altKey && 0 === e.button && !e.target.closest?.('input') && e.target.closest?.('[data-folders-row^="folder:"], button[data-project-card]')) {
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
			let r = {allowed: false, blocked: false};
			const isProjectDrag = hasDragType(e?.dataTransfer, 'application/antigravity-project-id') || !!this.view.draggedProjectId;
			const isFolderDrag = hasDragType(e?.dataTransfer, 'application/antigravity-folder-id') || !!this.view.draggedFolderId;
			if (isProjectDrag) {
				r = {allowed: true, blocked: false};
			}
			else if (isFolderDrag) {
				const draggedFolderId = this.view.draggedFolderId || e?.dataTransfer?.getData('application/antigravity-folder-id');
				const df = draggedFolderId ? this.view.getFolder(draggedFolderId) : null;
				if (df) {
					const targetParent = targetFolderId || null;
					if (targetParent === df.id || targetParent === (df.parentId || null)) {
						r = {allowed: false, blocked: null !== targetParent};
					}
					else {
						try {
							this.view.model.applyAction(this.view.data, {action: 'move-folder', id: df.id, newParentId: targetParent});
							r = {allowed: true, blocked: false};
						}
						catch {
							r = {allowed: false, blocked: true};
						}
					}
				}
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
			this.view.draggedFolderId = null;
			this.view.draggedProjectId = null;
			setTimeout(() => {
				this.view.isDragging = false;
			}, 100);
		}
		async executeDrop(e) {
			const zone = this.resolveDropZone(e.target);
			this.setDropTarget(null);
			if (zone) {
				e.preventDefault();
				e.stopPropagation();
				const projId = e.dataTransfer?.getData('application/antigravity-project-id') || this.view.draggedProjectId;
				const draggedFolderId = e.dataTransfer?.getData('application/antigravity-folder-id') || this.view.draggedFolderId;
				if (projId) {
					await this.view.postAction(zone.folderId ? 'assign-project' : 'unassign-project', zone.folderId ? {projectId: projId, folderId: zone.folderId} : {projectId: projId});
				}
				else if (draggedFolderId && this.canDropOnTarget(e, zone.folderId).allowed) {
					const res = await this.view.postAction('move-folder', {id: draggedFolderId, newParentId: zone.folderId});
					if (res?.success && zone.folderId) {
						this.view.expandFolder(zone.folderId);
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
			if (e.altKey || e.target.closest?.('input')) {
				e.preventDefault();
			}
			else {
				const card = e.target.closest?.('button[data-project-card]');
				const folderRow = card ? null : e.target.closest?.('[data-folders-row^="folder:"]');
				const el = card?.dataset.projectId ? card : folderRow?.dataset.folderId ? folderRow : null;
				if (el) {
					const isProject = el === card;
					const id = isProject ? card.dataset.projectId : folderRow.dataset.folderId;
					e.stopPropagation();
					this.view.isDragging = true;
					this.view.draggedProjectId = isProject ? id : null;
					this.view.draggedFolderId = isProject ? null : id;
					this.draggedElement = el;
					e.dataTransfer.setData(isProject ? 'application/antigravity-project-id' : 'application/antigravity-folder-id', id);
					e.dataTransfer.setData('text/plain', id);
					e.dataTransfer.effectAllowed = 'move';
					el.style.opacity = '0.5';
				}
			}
		}
	}
	class FoldersView {
		constructor(win = 'undefined' !== typeof window ? window : undefined, options = {}) {
			this.win = win;
			this.doc = options.document || win?.document || ('undefined' !== typeof document ? document : undefined);
			this.model = options.model || win?.AntigravityFoldersModel || defaultModel;
			const initialData = options.data || win?.__PROJECT_FOLDERS_DATA__;
			this.data = initialData || {folders: [], projectFolderMap: {}};
			this.state = {
				projects: [],
				projectRevision: '',
				summaries: options.summaries || win?.__PROJECT_FOLDERS_VIEW__?.state?.summaries || new Map(),
				collapsed: new Set(),
				rows: [],
				errors: new Map(),
				revision: initialData ? win?.__FOLDERS_REVISION__ || '' : '',
				ready: false,
				haveConfig: false,
				haveProjects: false,
				haveSummaries: false,
				savedView: false,
				knownProjects: new Set()
			};
			this.activeMenu = null;
			this.activeModal = null;
			this.closeActiveModal = null;
			this.hoveredFolderId = null;
			this.lastHoveredFolderId = null;
			this.lastHoveredFolderTime = 0;
			this.lastActiveFolderId = null;
			this.lastActiveProjectId = null;
			this.draggedFolderId = null;
			this.draggedProjectId = null;
			this.isDragging = false;
			this.root = null;
			this.nativeList = null;
			this.nativePaddingTop = '';
			this.scroll = null;
			this.canvas = null;
			this.timer = null;
			this.paintTimer = null;
			this.disposed = false;
			this.storageReady = false;
			this.rowHeight = 16;
			this.lifetime = new AbortController();
			this.rootAbort = null;
			this.observer = null;
			this.style = null;
			this.mountDeadline = Date.now() + 15000;
			this.drag = new SidebarDragController(this);
			const ResizeObserverCtor = options.ResizeObserver || win?.ResizeObserver || ('undefined' !== typeof ResizeObserver ? ResizeObserver : null);
			this.sizing = 'function' === typeof ResizeObserverCtor ? new ResizeObserverCtor(() => this.schedule()) : null;
			this.adapter = options.adapter
				|| ('function' === typeof win?.AntigravityFoldersAdapter
					? win.AntigravityFoldersAdapter({
						window: win,
						model: this.model,
						onProjects: projects => this.handleProjects(projects),
						onSummaries: summaries => this.handleSummaries(summaries),
						onStatus: (channel, error) => this.updateStatus(channel, error)
					})
					: win?.__PROJECT_FOLDERS_VIEW__?.adapter || null);
			this.readConfig = createReadConfig({
				window: win,
				model: this.model,
				state: this.state,
				onUpdate: (data, revision) => this.notifyUpdate(data, revision),
				status: (channel, error) => this.updateStatus(channel, error)
			});
		}
		appendFolderTree(menu, {selectedId, excludedIds, onSelect}) {
			const {children, expanded} = folderPickerModel(this.data?.folders, selectedId, excludedIds);
			const tree = this.element('div', 'antigravity-folder-targets');
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
				else if ('F2' === e.key && !this.activeModal) {
					const renameId = this.doc?.activeElement?.closest?.('[data-folder-id]')?.getAttribute('data-folder-id') || this.hoveredFolderId;
					if (renameId && this.getFolder(renameId)) {
						e.preventDefault();
						this.renameFolder(renameId);
					}
				}
			}, true);
		}
		bindRoot(root) {
			this.rootAbort?.abort();
			this.rootAbort = new AbortController();
			const on = (type, listener, capture = false) => root.addEventListener(type, listener, {capture, signal: this.rootAbort.signal});
			on('mouseover', e => {
				const fid = e.target.closest?.('[data-folders-row^="folder:"]')?.dataset.folderId;
				if (fid) {
					this.hoveredFolderId = fid;
					this.lastHoveredFolderId = fid;
					this.lastHoveredFolderTime = Date.now();
				}
			});
			on('mouseout', e => {
				const folderRow = e.target.closest?.('[data-folders-row^="folder:"]');
				if (folderRow && !folderRow.contains(e.relatedTarget) && folderRow.dataset.folderId === this.hoveredFolderId) {
					this.hoveredFolderId = null;
				}
			});
			on('contextmenu', e => {
				const card = e.target.closest?.('button[data-project-card]');
				const folderRow = card ? null : e.target.closest?.('[data-folders-row^="folder:"]');
				if (card) {
					openProjectContextMenu(e, card.dataset.projectId, {view: this, win: this.win});
				}
				else if (folderRow) {
					const fid = folderRow.dataset.folderId;
					this.showFolderContextMenu(e, folderRow, fid, this.getFolder(fid)?.name || '');
				}
			});
			on('click', e => {
				const card = e.target.closest?.('button[data-project-card]');
				const folderRow = card ? null : e.target.closest?.('[data-folders-row^="folder:"]');
				const pid = card?.dataset.projectId || (!folderRow ? e.target.closest?.("[data-testid^='conversation-row-']")?.closest('[data-group-id]')?.dataset.groupId : null);
				if (pid) {
					this.lastActiveProjectId = pid;
					this.lastActiveFolderId = this.getProjectFolderId(pid);
				}
				else if (folderRow?.dataset.folderId) {
					this.lastActiveFolderId = folderRow.dataset.folderId;
				}
			});
			this.drag.bind(root);
		}
		buildToolbar() {
			const toolbar = this.element('div', 'fg-toolbar');
			toolbar.append(this.element('strong', '', 'Projects'));
			const folderButton = this.element('button', 'btn-create-folder');
			folderButton.type = 'button';
			folderButton.title = 'Create new folder (defaults to active folder)';
			folderButton.setAttribute('aria-label', 'Create new folder');
			const folderPlus = this.element('span', '', '+');
			folderPlus.style.cssText = 'font-size:10px;font-weight:bold;margin-left:1px;';
			folderButton.append('📁', folderPlus);
			folderButton.onclick = event => {
				event.stopPropagation();
				this.showCreateFolderDialog();
			};
			const nativeButton = this.element('button', 'fg-native', '⋯');
			nativeButton.title = 'List view';
			nativeButton.onclick = () => this.toggleNativeMode(nativeButton);
			const projectButton = this.element('button', '', '+');
			projectButton.title = 'Create project';
			projectButton.setAttribute('aria-label', 'Create project');
			projectButton.onclick = () => this.createProject(this.detectCurrentFolderId());
			const actions = this.element('div', 'fg-actions');
			actions.append(folderButton, nativeButton, projectButton);
			toolbar.append(actions);
			return toolbar;
		}
		closeContextMenu() {
			this.activeMenu?.remove();
			this.activeMenu = null;
		}
		closeModal() {
			this.closeActiveModal?.();
		}
		createFolderTreeRow({folder, depth, hasChildren, selectedId, expanded, rows, tree, onSelect, render}) {
			const row = this.element('div', 'antigravity-folder-target');
			row.dataset.folderTarget = folder.id;
			row.setAttribute('role', 'treeitem');
			row.setAttribute('aria-level', depth + 1);
			row.setAttribute('aria-selected', selectedId === folder.id);
			if (hasChildren) {
				row.setAttribute('aria-expanded', expanded.has(folder.id));
			}
			row.tabIndex = -1;
			row.style.paddingInlineStart = `${4 + depth * 14}px`;
			row.title = this.model.getFolderPath(folder.id, this.data?.folders);
			const toggle = this.element(hasChildren ? 'button' : 'span', 'antigravity-folder-target-toggle');
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
			const icon = this.element('span', 'antigravity-folder-target-icon');
			icon.setAttribute('aria-hidden', 'true');
			icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11H3Z"/></svg>';
			const label = this.element('span', 'antigravity-folder-target-label', folder.name);
			const check = this.element('span', 'antigravity-folder-target-check', selectedId === folder.id ? '✓' : '');
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
			const row = this.element('div', `antigravity-folder-menu-item ${item.danger ? 'danger' : ''}`);
			row.setAttribute('tabindex', '0');
			row.setAttribute('role', hasTree ? 'button' : 'menuitem');
			const labelSpan = this.element('span', '', `${item.icon || ''} ${item.label}`);
			labelSpan.style.cssText = 'display:flex;align-items:center;gap:6px;';
			row.appendChild(labelSpan);
			if (item.shortcut) {
				row.appendChild(this.element('span', 'antigravity-folder-menu-shortcut', item.shortcut));
			}
			row.addEventListener('click', e => {
				e.stopPropagation();
				this.closeContextMenu();
				item.onClick?.();
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
		createProject(folderId) {
			let createdId;
			let directory;
			let name;
			const requestId = crypto.randomUUID();
			this.openModal({
				title: folderId ? `Create project in “${this.getFolder(folderId)?.name}”` : 'Create project',
				ariaLabel: 'Create project',
				submitLabel: 'Create',
				buildBody: ({errorEl, form}) => {
					name = this.element('input');
					name.placeholder = 'Project name';
					name.required = true;
					name.setAttribute('aria-label', 'Project name');
					const pathRow = this.element('div', 'fg-project-path');
					directory = this.element('input');
					directory.placeholder = 'Project directory (optional)';
					directory.setAttribute('aria-label', 'Project directory');
					const browse = this.element('button', 'antigravity-folder-btn secondary', 'Browse…');
					browse.type = 'button';
					browse.onclick = async () => {
						try {
							const result = await this.win.dialog.showOpenDialog();
							if (result) {
								directory.value = 'string' === typeof result ? result : Array.isArray(result) ? result[0] || '' : result.filePaths?.[0] || '';
							}
						}
						catch (cause) {
							errorEl.textContent = cause.message;
						}
					};
					pathRow.append(directory, browse);
					form.append(name, pathRow);
					return name;
				},
				onSubmit: async ({close}) => {
					if (!createdId) {
						const resources = directory.value.trim()
							? [{folderUri: new URL('file:///' + directory.value.trim().replace(/\\/g, '/')).href}]
							: [];
						createdId = await this.adapter.createProject({id: requestId, name: name.value, resources});
					}
					if (folderId) {
						const assignment = await this.postAction('assign-project', {projectId: createdId, folderId});
						if (!assignment.success) {
							throw Error(`Project ${createdId} created, but folder was not assigned: ${assignment.error}`);
						}
					}
					close();
					this.reveal(createdId, folderId);
					this.adapter.navigate({projectId: createdId});
				}
			});
		}
		detectCurrentFolderId() {
			const valid = id => id && this.getFolder(id) ? id : null;
			const projectFolder = pid => valid(pid ? this.getProjectFolderId(pid) : null);
			const activeEl = this.doc?.activeElement;
			const pCard = activeEl?.closest?.('[data-project-card]');
			const cRow = activeEl && !pCard ? activeEl.closest?.("[data-testid^='conversation-row-']") : null;
			const focusedFolder = valid(activeEl?.closest?.('[data-folder-id]')?.getAttribute('data-folder-id'))
				|| projectFolder(pCard ? pCard.getAttribute('data-project-id') : cRow?.closest('[data-group-id]')?.getAttribute('data-group-id'));
			const selection = this.adapter?.selection?.();
			const selectedPid = selection?.projectId
				|| (selection?.conversationId ? this.state.summaries.get(selection.conversationId)?.trajectoryMetadata?.projectId : null)
				|| this.doc?.querySelector?.("[data-testid^='conversation-row-'][data-selected='true']")?.closest?.('[data-group-id]')?.getAttribute('data-group-id');
			const hoverFolder = valid(this.hoveredFolderId) || (5000 > Date.now() - this.lastHoveredFolderTime ? valid(this.lastHoveredFolderId) : null);
			return hoverFolder
				|| focusedFolder
				|| projectFolder(selectedPid)
				|| valid(this.lastActiveFolderId)
				|| projectFolder(this.lastActiveProjectId);
		}
		dispose() {
			if (this.scroll && this.win) {
				this.win.__FOLDERS_RESTORE_SCROLL__ = this.scroll.scrollTop;
			}
			this.disposed = true;
			clearInterval(this.timer);
			clearTimeout(this.paintTimer);
			this.lifetime.abort();
			this.rootAbort?.abort();
			this.drag.dispose();
			this.closeContextMenu();
			this.closeModal();
			this.observer?.disconnect();
			this.sizing?.disconnect();
			this.adapter?.dispose?.();
			this.root?.remove();
			this.style?.remove();
			if (this.nativeList) {
				this.nativeList.style.paddingTop = this.nativePaddingTop;
				this.nativeList.style.removeProperty('display');
				this.nativeList.removeAttribute('aria-hidden');
			}
			if (this === this.win?.__PROJECT_FOLDERS_VIEW__) {
				delete this.win.__PROJECT_FOLDERS_VIEW__;
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
		expandFolder(folderId) {
			if (folderId && this.state.collapsed.delete(`folder:${folderId}`)) {
				this.persist();
				this.render();
			}
		}
		getFolder(id) {
			return Array.isArray(this.data?.folders) ? this.data.folders.find(f => id === f.id) || null : null;
		}
		getProjectFolderId(projectId) {
			return this.data?.projectFolderMap?.[projectId] || null;
		}
		handleKeydown(event) {
			if (!event.target.matches('input,textarea')) {
				const index = Number(event.target.closest('[data-row-index]')?.dataset.rowIndex);
				if (Number.isInteger(index)) {
					if (('ArrowLeft' === event.key || 'ArrowRight' === event.key) && ['folder', 'project'].includes(this.state.rows[index]?.kind)) {
						event.preventDefault();
						const row = this.state.rows[index];
						if (row.expanded === ('ArrowLeft' === event.key)) {
							this.toggle(row);
						}
					}
					else if ('ArrowDown' === event.key || 'ArrowUp' === event.key) {
						event.preventDefault();
						const target = Math.max(0, Math.min(this.state.rows.length - 1, index + ('ArrowDown' === event.key ? 1 : -1)));
						this.scroll.scrollTop = target * this.rowHeight < this.scroll.scrollTop
							? target * this.rowHeight
							: (target + 1) * this.rowHeight > this.scroll.scrollTop + this.scroll.clientHeight
								? (target + 1) * this.rowHeight - this.scroll.clientHeight
								: this.scroll.scrollTop;
						this.render();
						this.canvas.querySelector(`[data-row-index="${target}"] button`)?.focus({preventScroll: true});
					}
				}
			}
		}
		handleProjects(projects) {
			if (!this.state.savedView) {
				for (const project of projects) {
					if (!this.state.knownProjects.has(project.id)) {
						this.state.collapsed.add(`project:${project.id}`);
					}
				}
			}
			this.state.knownProjects = new Set(projects.map(project => project.id));
			this.state.haveProjects = true;
			const revision = JSON.stringify(projects);
			if (revision !== this.state.projectRevision) {
				this.state.projects = projects;
				this.state.projectRevision = revision;
				this.schedule();
			}
		}
		handleSummaries(summaries) {
			this.state.haveSummaries = true;
			this.state.summaries = summaries;
			this.schedule();
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
					if (!expanded.has(folder.id) || !hasChildren) {
						target = rows.get(folder.parentId);
					}
					else {
						expanded.delete(folder.id);
						render(folder.id);
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
		handleViewStateChange(event) {
			try {
				const values = event.detail.collapsed;
				if (!Array.isArray(values) || values.some(key => 'string' !== typeof key)) {
					throw Error('Invalid saved folder state');
				}
				this.state.collapsed = new Set(values);
				this.state.savedView = true;
				this.schedule();
			}
			catch (error) {
				this.updateStatus('view-state', error.message);
			}
		}
		inspect() {
			return {
				...this.win?.__PROJECT_FOLDERS_STATUS__,
				rowCount: this.state.rows.length,
				renderedRows: this.canvas?.children.length || 0,
				collapsed: [...this.state.collapsed]
			};
		}
		isOnboardingRoute() {
			return /^\/onboarding(?:\/|$)/.test(this.win?.location?.pathname || '');
		}
		isStandaloneRoute() {
			return /^\/(?:artifact|s|settings-standalone|terminal-standalone)(?:\/|$)/.test(this.win?.location?.pathname || '');
		}
		async loadViewState() {
			const saved = 'function' === typeof this.win?.__ANTIGRAVITY_TOOLS_REQUEST__
				? await this.win.__ANTIGRAVITY_TOOLS_REQUEST__('folders', {method: 'GET_VIEW_STATE'})
				: {};
			if (undefined === saved?.collapsed) {
				for (const project of this.state.projects) {
					this.state.collapsed.add(`project:${project.id}`);
				}
			}
			else {
				if (!Array.isArray(saved.collapsed) || saved.collapsed.some(key => 'string' !== typeof key)) {
					throw Error('Invalid saved folder view state');
				}
				this.state.collapsed = new Set(saved.collapsed);
				this.state.savedView = true;
			}
			this.win?.addEventListener?.('antigravity-folders-view-state', event => this.handleViewStateChange(event), {signal: this.lifetime.signal});
			this.storageReady = true;
			this.updateStatus('view-state', null);
		}
		mount() {
			if (!this.disposed && !this.root?.isConnected && this.state.haveConfig && this.state.haveProjects) {
				if (this.isOnboardingRoute() || this.isStandaloneRoute()) {
					this.updateStatus('mount', null);
				}
				else {
					const matches = [...this.doc.querySelectorAll('[data-testid="conversation-list-sidebar"]')].filter(el => el.closest('[role="navigation"]'));
					if (0 === matches.length && this.nativeSidebarPending()) {
						this.updateStatus('mount', null);
					}
					else if (1 !== matches.length) {
						this.updateStatus('mount', `Expected one native sidebar, found ${matches.length}`);
					}
					else {
						this.nativeList = matches[0];
						this.nativePaddingTop = this.nativeList.style.paddingTop;
						this.root = this.element('section', 'fg-panel');
						this.root.dataset.foldersRoot = '2';
						this.root.dataset.testid = 'folders-tree';
						this.root.setAttribute('aria-label', 'Folders and projects');
						const message = this.element('div', 'fg-state');
						message.setAttribute('role', 'alert');
						this.scroll = this.element('div', 'fg-scroll');
						this.scroll.setAttribute('role', 'tree');
						this.canvas = this.element('div', 'fg-canvas');
						this.scroll.append(this.canvas);
						this.scroll.addEventListener('scroll', () => this.schedule(), {passive: true});
						this.sizing?.observe(this.scroll);
						this.root.append(this.buildToolbar(), message, this.scroll);
						this.nativeList.parentElement.append(this.root);
						this.nativeList.style.setProperty('display', 'none', 'important');
						this.nativeList.setAttribute('aria-hidden', 'true');
						this.root.addEventListener('keydown', event => this.handleKeydown(event));
						this.updateStatus('mount', null);
						this.render();
						this.bindRoot(this.root);
						if (Number.isFinite(this.win?.__FOLDERS_RESTORE_SCROLL__)) {
							this.scroll.scrollTop = this.win.__FOLDERS_RESTORE_SCROLL__;
							delete this.win.__FOLDERS_RESTORE_SCROLL__;
							this.render();
						}
					}
				}
			}
		}
		nativeSidebarPending() {
			return this.mountDeadline > Date.now() && ((!this.doc.querySelector('[role="navigation"]') && !this.doc.querySelector('.agy-shell')) || !!this.doc.querySelector('[role="navigation"] [data-testid="sidebar-list-skeleton"]'));
		}
		notifyUpdate(newData, revision = '') {
			const alreadyApplied = Boolean(revision && revision === this.state.revision);
			this.data = newData;
			this.state.haveConfig = true;
			const nextRevision = revision || this.win?.__FOLDERS_REVISION__ || '';
			if (nextRevision) {
				this.state.revision = nextRevision;
			}
			if (this.win) {
				this.win.__PROJECT_FOLDERS_DATA__ = newData;
				if (revision) {
					this.win.__FOLDERS_REVISION__ = revision;
				}
			}
			if (!alreadyApplied) {
				this.schedule();
			}
		}
		openConversationMenu(event, row) {
			event.preventDefault();
			event.stopPropagation();
			this.showContextMenu(event.clientX, event.clientY, [
				{label: 'Open conversation', onClick: () => this.adapter.navigate({projectId: row.projectId, conversationId: row.id})},
				{label: 'Rename…', onClick: () => this.openTextDialog('Conversation title', this.model.summaryName(this.state.summaries.get(row.id) || row.summary), value => this.adapter.updateConversation(row.id, {title: value}))},
				{label: row.summary.annotations?.pinned ? 'Unpin' : 'Pin', onClick: () => this.adapter.updateConversation(row.id, {pinned: !row.summary.annotations?.pinned}).catch(error => this.updateStatus('action', error.message))},
				{label: 'Archive', onClick: () => this.adapter.updateConversation(row.id, {archived: true, archivalStatusTimestamp: new Date().toISOString()}).catch(error => this.updateStatus('action', error.message))}
			], 'Conversation');
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
						this.schedule();
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
		openTextDialog(title, initialValue, submitAction) {
			let input;
			const modal = this.openModal({
				title,
				ariaLabel: title,
				submitLabel: 'Save',
				buildBody: ({form}) => {
					input = this.element('input');
					input.value = initialValue;
					input.required = true;
					input.setAttribute('aria-label', title);
					form.append(input);
					return input;
				},
				onSubmit: () => submitAction(input.value.trim())
			});
			if (modal) {
				input.select();
			}
		}
		persist() {
			if (this.storageReady && 'function' === typeof this.win?.__ANTIGRAVITY_TOOLS_REQUEST__) {
				this.win.__ANTIGRAVITY_TOOLS_REQUEST__('folders', {method: 'SET_VIEW_STATE', body: {collapsed: [...this.state.collapsed]}})
					.catch(error => this.updateStatus('view-state', error.message));
			}
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
				if ('function' !== typeof this.win?.__ANTIGRAVITY_TOOLS_REQUEST__) {
					throw Error('Folder storage bridge is unavailable; run Upg to reconnect');
				}
				const result = await this.win.__ANTIGRAVITY_TOOLS_REQUEST__('folders', {
					method: 'POST',
					body: {action, ...payload, revision: this.state.revision || this.win.__FOLDERS_REVISION__}
				});
				if (result.revision) {
					this.win.__FOLDERS_REVISION__ = result.revision;
				}
				if (result.success && result.data && (!result.revision || result.revision !== this.state.revision)) {
					this.notifyUpdate(result.data, result.revision || '');
				}
				this.reportAction(result.success ? null : result.error || 'Folder action failed');
				r = result;
			}
			catch (err) {
				this.reportAction(err.message);
				r = {success: false, error: err.message};
			}
			return r;
		}
		refresh() {
			this.render();
		}
		renameFolder(folderId) {
			const folder = this.getFolder(folderId);
			if (folder) {
				this.openTextDialog('Folder name', folder.name, async newName => {
					if (newName && folder.name !== newName) {
						const res = await this.postAction('rename-folder', {id: folderId, newName});
						if (!res.success) {
							throw Error(res.error || 'Failed to rename folder');
						}
					}
				});
			}
		}
		renameProject(id) {
			const project = this.state.projects.find(item => id === item.id);
			if (project) {
				this.openTextDialog('Project name', project.name, async name => {
					await this.adapter.rpc('UpdateProject', {project: {...project, name}});
					await this.adapter.readProjects();
				});
			}
		}
		render() {
			if (!this.disposed && this.root?.isConnected && this.scroll) {
				if (this.activeMenu || this.activeModal || this.isDragging) {
					this.schedule();
				}
				else {
					try {
						const appearance = this.win.getComputedStyle(this.root);
						this.rowHeight = parseFloat(appearance.getPropertyValue('--antigravity-tree-row-height')) || 16;
						const hideOutsideProject = '1' === appearance.getPropertyValue('--antigravity-hide-outside-project').trim();
						const hideStandaloneConversations = '1' === appearance.getPropertyValue('--antigravity-hide-standalone-conversations').trim();
						this.state.rows = this.model.buildRows({
							data: this.data,
							projects: this.state.projects,
							summaries: this.state.summaries,
							collapsed: this.state.collapsed,
							hideOutsideProject,
							hideStandaloneConversations
						});
						this.canvas.style.height = `${this.state.rows.length * this.rowHeight}px`;
						const start = Math.max(0, Math.floor(this.scroll.scrollTop / this.rowHeight) - 8);
						const end = Math.min(this.state.rows.length, Math.ceil((this.scroll.scrollTop + this.scroll.clientHeight) / this.rowHeight) + 8);
						const focused = this.root.contains(this.doc.activeElement) ? this.doc.activeElement : null;
						const focusKey = focused?.closest('[data-folders-row]')?.dataset.foldersRow;
						this.canvas.replaceChildren(...this.state.rows.slice(start, end).map((row, offset) => this.renderRow(row, start + offset)));
						if (focusKey && !focused.isConnected) {
							const row = [...this.canvas.children].find(el => focusKey === el.dataset.foldersRow);
							row?.querySelector(focused.classList.contains('fg-toggle') ? '.fg-toggle' : '.fg-label')?.focus({preventScroll: true});
						}
						this.state.ready = true;
						this.updateStatus('tree', null);
					}
					catch (error) {
						this.updateStatus('tree', error.message);
					}
				}
			}
		}
		renderConversationRow(el, row, selection) {
			const button = this.element('button', 'fg-label');
			button.dataset.testid = 'conversation-row-sidebar';
			button.dataset.cascadeId = row.id;
			button.dataset.selected = selection.conversationId === row.id;
			const running = row.running;
			button.append(
				this.element('span', running ? 'fg-icon fg-running' : 'fg-icon', running ? '●' : row.pinned ? '📌' : '◦'),
				this.element('span', 'truncate', row.name)
			);
			button.onclick = () => this.adapter.navigate({projectId: row.projectId, conversationId: row.id});
			button.oncontextmenu = event => this.openConversationMenu(event, row);
			el.append(button);
		}
		renderFolderRow(el, row) {
			el.draggable = true;
			const h2 = this.element('h2');
			const button = this.element('button', 'fg-label');
			button.setAttribute('aria-expanded', row.expanded);
			button.append(
				this.element('span', row.running ? 'fg-icon fg-folder-running' : 'fg-icon', '📁'),
				this.element('span', 'truncate', row.name)
			);
			button.onclick = () => this.toggle(row);
			h2.append(button);
			el.append(h2);
		}
		renderProjectRow(el, row) {
			const button = this.element('button', 'fg-label');
			button.draggable = true;
			button.dataset.projectCard = 'true';
			button.dataset.projectId = row.id;
			if (row.folderId) {
				button.dataset.folderId = row.folderId;
			}
			const icon = this.element('span', row.running ? 'fg-icon fg-project-running' : 'fg-icon');
			icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 7V5h6l2 2h10v13H3z"/></svg>';
			button.title = 'Project: ' + row.name;
			button.append(icon, this.element('span', 'truncate', row.name));
			button.onclick = () => this.adapter.navigate({projectId: row.id});
			el.append(button);
		}
		renderRow(row, index) {
			const el = this.element('div', 'fg-row');
			el.dataset.foldersRow = row.key;
			el.dataset.rowIndex = index;
			el.style.top = `${index * this.rowHeight}px`;
			el.style.setProperty('--fg-depth', row.depth);
			el.setAttribute('role', 'treeitem');
			el.setAttribute('aria-level', row.depth + 1);
			const selection = this.adapter.selection();
			if (('conversation' === row.kind && selection.conversationId === row.id) || ('project' === row.kind && !selection.conversationId && selection.projectId === row.id)) {
				el.setAttribute('aria-selected', 'true');
			}
			if (row.folderId) {
				el.dataset.folderId = row.folderId;
			}
			if (row.projectId) {
				el.dataset.groupId = row.projectId;
			}
			if ('folder' === row.kind || 'project' === row.kind) {
				el.setAttribute('aria-expanded', row.expanded);
				const collapse = this.element('button', 'fg-toggle', row.expanded ? '⌄' : '›');
				collapse.setAttribute('aria-label', `${row.expanded ? 'Collapse' : 'Expand'} ${row.name}`);
				collapse.onclick = event => {
					event.stopPropagation();
					this.toggle(row);
				};
				el.append(collapse);
			}
			if ('folder' === row.kind) {
				this.renderFolderRow(el, row);
			}
			else if ('project' === row.kind) {
				this.renderProjectRow(el, row);
			}
			else if ('conversation' === row.kind) {
				this.renderConversationRow(el, row, selection);
			}
			else {
				el.append(this.element('span', 'empty' === row.kind ? 'fg-empty' : '', row.name));
			}
			return el;
		}
		reportAction(error) {
			this.updateStatus('action', error);
		}
		reveal(projectId, folderId) {
			for (let folder = this.getFolder(folderId); folder; folder = this.getFolder(folder.parentId)) {
				this.state.collapsed.delete(`folder:${folder.id}`);
			}
			this.state.collapsed.delete(`project:${projectId}`);
			this.persist();
			this.render();
			const index = this.state.rows.findIndex(row => `project:${projectId}` === row.key);
			if (0 <= index && this.scroll) {
				this.scroll.scrollTop = index * this.rowHeight;
				this.render();
			}
		}
		schedule() {
			if (!this.paintTimer) {
				this.paintTimer = setTimeout(() => {
					this.paintTimer = null;
					this.render();
				}, 40);
			}
		}
		showContextMenu(x, y, items, title = '') {
			this.closeContextMenu();
			const hasTree = items.some(item => item.folderTree);
			const menu = this.element('div', `antigravity-folder-menu${hasTree ? ' antigravity-folder-picker' : ''}`);
			menu._folderAnchor = {x, y};
			menu.setAttribute('role', hasTree ? 'dialog' : 'menu');
			if (title) {
				menu.setAttribute('aria-label', title);
				menu.appendChild(this.element('div', 'antigravity-folder-menu-title', title));
			}
			for (const item of items) {
				if (item.folderTree) {
					this.appendFolderTree(menu, item.folderTree);
				}
				else if (item.separator) {
					menu.appendChild(this.element('div', 'antigravity-folder-menu-separator'));
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
					let r = false;
					const val = input.value.trim();
					const chosenParentId = select.value || null;
					try {
						this.model.applyAction(this.data, {action: 'add-folder', name: val, parentId: chosenParentId});
						const result = await this.postAction('add-folder', {name: val, parentId: chosenParentId});
						if (!result.success) {
							throw Error(result.error || 'Failed to create folder');
						}
						const createdFolder = (result.data?.folders || []).find(f => (chosenParentId || null) === (f.parentId || null) && val.toLowerCase() === f.name.toLowerCase());
						if (createdFolder) {
							this.lastActiveFolderId = createdFolder.id;
							if (projectId) {
								await this.postAction('assign-project', {projectId, folderId: createdFolder.id});
							}
						}
						if (chosenParentId) {
							this.expandFolder(chosenParentId);
						}
						r = true;
					}
					catch (cause) {
						input.setCustomValidity(cause.message);
						input.reportValidity();
					}
					return r;
				}
			});
		}
		showFolderContextMenu(e, folderHeaderEl, folderId, folderName) {
			e.preventDefault();
			e.stopPropagation();
			this.showContextMenu(e.clientX, e.clientY, [
				{icon: '➕', label: 'Create project in this folder…', onClick: () => this.createProject(folderId)},
				{icon: '📁➕', label: 'Create subfolder…', onClick: () => this.showCreateFolderDialog(null, folderId)},
				{
					icon: '↗️',
					label: 'Move folder…',
					onClick: () => {
						const rect = folderHeaderEl.getBoundingClientRect();
						this.showMoveFolderMenu({clientX: rect.left + 20, clientY: rect.bottom + 4}, folderId);
					}
				},
				{icon: '✏️', label: 'Rename folder', shortcut: 'F2', onClick: () => this.renameFolder(folderId)},
				{icon: '➕', label: 'Create new root folder', onClick: () => this.showCreateFolderDialog(null, null)},
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
				const excludedIds = this.model.getDescendantIds(folderId, this.data?.folders);
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
		async start() {
			this.style = this.element('style');
			this.style.dataset.foldersViewStyle = '2';
			this.style.textContent = this.win?.__FOLDERS_STYLE__ || '';
			if (!this.win?.__ANTIGRAVITY_TOOLS_INSPECTOR_STYLES__) {
				this.doc?.head?.append(this.style);
			}
			this.win?.addEventListener?.('popstate', () => this.schedule(), {signal: this.lifetime.signal});
			const MutationObserverCtor = this.win?.MutationObserver || ('undefined' !== typeof MutationObserver ? MutationObserver : null);
			if ('function' === typeof MutationObserverCtor && this.doc?.documentElement) {
				this.observer = new MutationObserverCtor(() => {
					if (!this.root?.isConnected) {
						this.mount();
					}
				});
				this.observer.observe(this.doc.documentElement, {childList: true, subtree: true});
			}
			try {
				await this.loadViewState();
			}
			catch (error) {
				this.updateStatus('view-state', error.message);
			}
			try {
				await this.readConfig();
				await this.adapter.start();
				this.mount();
			}
			catch (error) {
				this.updateStatus('startup', error.message);
			}
			if (!this.disposed) {
				this.timer = setInterval(() => {
					this.readConfig().catch(error => this.updateStatus('folders', error.message));
					if (!this.root?.isConnected) {
						this.mount();
					}
				}, 2000);
			}
		}
		toggle(row) {
			if (this.state.collapsed.has(row.key)) {
				this.state.collapsed.delete(row.key);
			}
			else {
				this.state.collapsed.add(row.key);
			}
			this.persist();
			this.render();
		}
		toggleNativeMode(nativeButton) {
			const native = !this.root.classList.contains('fg-native-mode');
			this.root.classList.toggle('fg-native-mode', native);
			this.root.style.bottom = native ? 'auto' : '0';
			this.scroll.style.display = native ? 'none' : '';
			if (native) {
				this.nativeList.style.paddingTop = '20px';
				this.nativeList.style.removeProperty('display');
				this.nativeList.removeAttribute('aria-hidden');
				nativeButton.title = 'Restore folders';
			}
			else {
				this.nativeList.style.paddingTop = this.nativePaddingTop;
				this.nativeList.style.setProperty('display', 'none', 'important');
				this.nativeList.setAttribute('aria-hidden', 'true');
				nativeButton.title = 'Show native list';
				this.render();
			}
		}
		updateStatus(channel, error) {
			if (!this.disposed) {
				if (error) {
					this.state.errors.set(channel, error);
				}
				else {
					this.state.errors.delete(channel);
				}
				const viewState = this.state.errors.size
					? 'error'
					: this.isOnboardingRoute()
						? 'deferred'
						: this.isStandaloneRoute() || (this.state.ready && this.state.haveSummaries)
							? 'ready'
							: 'loading';
				if (this.win) {
					this.win.__PROJECT_FOLDERS_STATUS__ = {
						architecture: 2,
						state: viewState,
						...(this.isOnboardingRoute() ? {reason: [{id: 'folders', reason: 'onboarding'}]} : {}),
						nativeContract: this.adapter?.contract,
						errors: Object.fromEntries(this.state.errors),
						folders: (this.data?.folders || []).length,
						projects: this.state.projects.length,
						conversations: this.state.summaries.size
					};
				}
				const message = [...this.state.errors].map(([key, value]) => `${key}: ${value}`).join('\n');
				const banner = this.root?.querySelector('.fg-state');
				const bannerText = message ? `Folders — compatibility or connection error. ${message}` : '';
				if (banner && bannerText !== banner.textContent) {
					banner.textContent = bannerText;
				}
				let fault = this.doc?.querySelector?.('.fg-fault');
				if (this.root?.isConnected || !message) {
					fault?.remove();
				}
				else if (this.doc?.body) {
					if (!fault) {
						fault = this.element('div', 'fg-fault');
						fault.setAttribute('role', 'alert');
						this.doc.body.append(fault);
					}
					const faultText = `Folders: ${message}. Native interface preserved.`;
					if (faultText !== fault.textContent) {
						fault.textContent = faultText;
					}
				}
			}
		}
	}
	return {FoldersView, SidebarDragController, createReadConfig, folderPickerModel, hasDragType, installFoldersView, openProjectContextMenu, positionContextMenu};
});
