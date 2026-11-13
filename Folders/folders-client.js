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
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Extract FolderMenuController and FolderDialogController ES6 classes from FoldersView in Folders/folders-client.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/39
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace Less build pipeline and tracked CSS/style.css with native Chromium CSS concatenated in memory":
// https://github.com/dmitry-ai/antigravity-addons/issues/43
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decompose Folders/folders-client.js into FolderStorageClient, FolderTreeRenderer, and folder-drag.js, narrow MutationObserver, and stop idle polling":
// https://github.com/dmitry-ai/antigravity-addons/issues/46
(factory => {
	const api = factory();
	if ('object' === typeof module && module.exports) {
		module.exports = api;
	}
	else {
		api.installFoldersView();
	}
})(() => {
	const defaultDialogs = 'undefined' !== typeof window && window.AntigravityFolderDialogs
		? window.AntigravityFolderDialogs
		: 'object' === typeof module && module.exports
			? require('./folder-dialogs')
			: null;
	const defaultDrag = 'undefined' !== typeof window && window.AntigravityFolderDrag
		? window.AntigravityFolderDrag
		: 'object' === typeof module && module.exports
			? require('./folder-drag')
			: null;
	const defaultMenu = 'undefined' !== typeof window && window.AntigravityFolderMenu
		? window.AntigravityFolderMenu
		: 'object' === typeof module && module.exports
			? require('./folder-menu')
			: null;
	const defaultModel = 'undefined' !== typeof window && window.AntigravityFoldersModel
		? window.AntigravityFoldersModel
		: 'object' === typeof module && module.exports
			? require('./folders-model')
			: null;
	const {FolderDialogController} = defaultDialogs;
	const {SidebarDragController} = defaultDrag;
	// 2026-10-18 Dmitrii Fediuk https://github.com/dmitrii-fediuk
	// "Add folder-scoped project creation, 80%-height tree folder picker, multi-window UI injection (4th+ windows), and context-only action menus":
	// https://github.com/dmitry-ai/antigravity-addons/issues/8
	// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
	// "Add Project settings action to project context menu in Folders":
	// https://github.com/dmitry-ai/antigravity-addons/issues/17
	const {FolderMenuController} = defaultMenu;
	// 2026-10-19 Dmitrii Fediuk https://github.com/dmitrii-fediuk
	// "Restore Folders compatibility with Antigravity 2.25.0 and analyze architectural resilience against renderer bundle changes":
	// https://github.com/dmitry-ai/antigravity-addons/issues/9
	class FolderStorageClient {
		constructor({model = defaultModel, onActionError = () => {}, onSchedule = () => {}, onStatus = () => {}, onUpdate = () => {}, state, window: win}) {
			this.win = win;
			this.model = model;
			this.state = state;
			this.onActionError = onActionError;
			this.onSchedule = onSchedule;
			this.onStatus = onStatus;
			this.onUpdate = onUpdate;
			this.configPromise = null;
			this.ready = false;
		}
		applyPayload(payload) {
			if (payload.error) {
				throw Error(payload.error);
			}
			if (payload.notModified) {
				this.state.haveConfig = true;
				if (payload.revision) {
					this.state.revision = payload.revision;
					this.win.__FOLDERS_REVISION__ = payload.revision;
				}
			}
			else {
				const data = 2 === payload.schemaVersion ? payload.data : payload;
				this.model.validateConfig(data);
				this.state.haveConfig = true;
				if (payload.revision) {
					this.win.__FOLDERS_REVISION__ = payload.revision;
				}
				const revision = payload.revision || JSON.stringify(data);
				if (revision !== this.state.revision) {
					this.onUpdate(data, payload.revision || '');
					this.state.revision = revision;
				}
			}
			this.onStatus('folders', null);
		}
		applyUpdate(view, newData, revision = '') {
			const alreadyApplied = Boolean(revision && revision === this.state.revision);
			view.data = newData;
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
				view.schedule();
			}
		}
		handleViewStateEvent(event) {
			try {
				const values = event.detail.collapsed;
				if (!Array.isArray(values) || values.some(key => 'string' !== typeof key)) {
					throw Error('Invalid saved folder state');
				}
				this.state.collapsed = new Set(values);
				this.state.savedView = true;
				this.onSchedule();
			}
			catch (error) {
				this.onStatus('view-state', error.message);
			}
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
			this.ready = true;
			this.onStatus('view-state', null);
		}
		persistViewState() {
			if (this.ready && 'function' === typeof this.win?.__ANTIGRAVITY_TOOLS_REQUEST__) {
				this.win.__ANTIGRAVITY_TOOLS_REQUEST__('folders', {method: 'SET_VIEW_STATE', body: {collapsed: [...this.state.collapsed]}})
					.catch(error => this.onStatus('view-state', error.message));
			}
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
					this.onUpdate(result.data, result.revision || '');
				}
				this.onActionError(result.success ? null : result.error || 'Folder action failed');
				r = result;
			}
			catch (err) {
				this.onActionError(err.message);
				r = {success: false, error: err.message};
			}
			return r;
		}
		readConfig() {
			if (!this.configPromise) {
				this.configPromise = (async () => {
					if ('function' !== typeof this.win?.__ANTIGRAVITY_TOOLS_REQUEST__) {
						throw Error('Folder storage bridge is unavailable; run Upg to reconnect');
					}
					const knownRevision = this.state.revision;
					const payload = await this.win.__ANTIGRAVITY_TOOLS_REQUEST__('folders', knownRevision ? {method: 'GET', knownRevision} : {method: 'GET'});
					this.applyPayload(payload);
				})().finally(() => {
					this.configPromise = null;
				});
			}
			return this.configPromise;
		}
	}
	class FolderTreeRenderer {
		constructor(view) {
			this.view = view;
		}
		bindRoot(root) {
			const v = this.view;
			v.rootAbort?.abort();
			v.rootAbort = new AbortController();
			const on = (type, listener, capture = false) => root.addEventListener(type, listener, {capture, signal: v.rootAbort.signal});
			on('mouseover', e => {
				const fid = e.target.closest?.('[data-folders-row^="folder:"]')?.dataset.folderId;
				if (fid) {
					v.hoveredFolderId = fid;
					v.lastHoveredFolderId = fid;
					v.lastHoveredFolderTime = Date.now();
				}
			});
			on('mouseout', e => {
				const folderRow = e.target.closest?.('[data-folders-row^="folder:"]');
				if (folderRow && !folderRow.contains(e.relatedTarget) && folderRow.dataset.folderId === v.hoveredFolderId) {
					v.hoveredFolderId = null;
				}
			});
			on('contextmenu', e => {
				const card = e.target.closest?.('button[data-project-card]');
				const folderRow = card ? null : e.target.closest?.('[data-folders-row^="folder:"]');
				if (card) {
					v.menus.openProjectMenu(e, card.dataset.projectId);
				}
				else if (folderRow) {
					const fid = folderRow.dataset.folderId;
					v.menus.openFolderMenu(e, folderRow, fid, v.getFolder(fid)?.name || '');
				}
			});
			on('click', e => {
				const card = e.target.closest?.('button[data-project-card]');
				const folderRow = card ? null : e.target.closest?.('[data-folders-row^="folder:"]');
				const pid = card?.dataset.projectId || (!folderRow ? e.target.closest?.("[data-testid^='conversation-row-']")?.closest('[data-group-id]')?.dataset.groupId : null);
				if (folderRow?.dataset.folderId) {
					v.lastActiveFolderId = folderRow.dataset.folderId;
				}
				else if (pid) {
					v.lastActiveProjectId = pid;
					v.lastActiveFolderId = v.getProjectFolderId(pid);
				}
			});
			v.drag.bind(root);
		}
		buildPanel(nativeList) {
			const v = this.view;
			v.nativeList = nativeList;
			v.nativePaddingTop = nativeList.style.paddingTop;
			v.root = v.element('section', 'fg-panel');
			v.root.dataset.foldersRoot = '2';
			v.root.dataset.testid = 'folders-tree';
			v.root.setAttribute('aria-label', 'Folders and projects');
			const message = v.element('div', 'fg-state');
			message.setAttribute('role', 'alert');
			v.scroll = v.element('div', 'fg-scroll');
			v.scroll.setAttribute('role', 'tree');
			v.canvas = v.element('div', 'fg-canvas');
			v.scroll.append(v.canvas);
			v.scroll.addEventListener('scroll', () => v.schedule(), {passive: true});
			v.sizing?.observe(v.scroll);
			v.root.append(this.buildToolbar(), message, v.scroll);
			nativeList.parentElement.append(v.root);
			this.hideNativeSidebar();
			v.root.addEventListener('keydown', event => this.handleKeydown(event));
			v.retargetObserver();
			v.updateStatus('mount', null);
			this.render();
			this.bindRoot(v.root);
			if (Number.isFinite(v.win?.__FOLDERS_RESTORE_SCROLL__)) {
				v.scroll.scrollTop = v.win.__FOLDERS_RESTORE_SCROLL__;
				delete v.win.__FOLDERS_RESTORE_SCROLL__;
				this.render();
			}
		}
		buildToolbar() {
			const v = this.view;
			const toolbar = v.element('div', 'fg-toolbar');
			toolbar.append(v.element('strong', '', 'Projects'));
			const folderButton = v.element('button', 'btn-create-folder');
			folderButton.type = 'button';
			folderButton.title = 'Create new folder (defaults to active folder)';
			folderButton.setAttribute('aria-label', 'Create new folder');
			const folderPlus = v.element('span', '', '+');
			folderPlus.style.cssText = 'font-size:10px;font-weight:bold;margin-left:1px;';
			folderButton.append('📁', folderPlus);
			folderButton.onclick = event => {
				event.stopPropagation();
				v.dialogs.openCreateFolder();
			};
			const nativeButton = v.element('button', 'fg-native', '⋯');
			nativeButton.title = 'List view';
			nativeButton.onclick = () => this.toggleNativeMode(nativeButton);
			const projectButton = v.element('button', '', '+');
			projectButton.title = 'Create project';
			projectButton.setAttribute('aria-label', 'Create project');
			projectButton.onclick = () => v.dialogs.openCreateProject(v.detectCurrentFolderId());
			const actions = v.element('div', 'fg-actions');
			actions.append(folderButton, nativeButton, projectButton);
			toolbar.append(actions);
			return toolbar;
		}
		computeVisibleRange(totalRows) {
			const {rowHeight, scroll} = this.view;
			return {
				start: Math.max(0, Math.floor(scroll.scrollTop / rowHeight) - 8),
				end: Math.min(totalRows, Math.ceil((scroll.scrollTop + scroll.clientHeight) / rowHeight) + 8)
			};
		}
		detectCurrentFolderId() {
			const v = this.view;
			const valid = id => id && v.getFolder(id) ? id : null;
			const projectFolder = pid => valid(pid ? v.getProjectFolderId(pid) : null);
			const activeEl = v.doc?.activeElement;
			const pCard = activeEl?.closest?.('[data-project-card]');
			const cRow = activeEl && !pCard ? activeEl.closest?.("[data-testid^='conversation-row-']") : null;
			const focusedFolder = valid(activeEl?.closest?.('[data-folder-id]')?.getAttribute('data-folder-id'))
				|| projectFolder(pCard ? pCard.getAttribute('data-project-id') : cRow?.closest('[data-group-id]')?.getAttribute('data-group-id'));
			const selection = v.adapter?.selection?.();
			const selectedPid = selection?.projectId
				|| (selection?.conversationId ? v.state.summaries.get(selection.conversationId)?.trajectoryMetadata?.projectId : null)
				|| v.doc?.querySelector?.("[data-testid^='conversation-row-'][data-selected='true']")?.closest?.('[data-group-id]')?.getAttribute('data-group-id');
			const hoverFolder = valid(v.hoveredFolderId) || (5000 > Date.now() - v.lastHoveredFolderTime ? valid(v.lastHoveredFolderId) : null);
			return hoverFolder || focusedFolder || projectFolder(selectedPid) || valid(v.lastActiveFolderId) || projectFolder(v.lastActiveProjectId);
		}
		handleKeydown(event) {
			const v = this.view;
			if (!event.target.matches('input,textarea')) {
				const index = Number(event.target.closest('[data-row-index]')?.dataset.rowIndex);
				if (Number.isInteger(index)) {
					if (('ArrowLeft' === event.key || 'ArrowRight' === event.key) && ['folder', 'project'].includes(v.state.rows[index]?.kind)) {
						event.preventDefault();
						const row = v.state.rows[index];
						if (row.expanded === ('ArrowLeft' === event.key)) {
							v.toggle(row);
						}
					}
					else if ('ArrowDown' === event.key || 'ArrowUp' === event.key) {
						event.preventDefault();
						const target = Math.max(0, Math.min(v.state.rows.length - 1, index + ('ArrowDown' === event.key ? 1 : -1)));
						v.scroll.scrollTop = target * v.rowHeight < v.scroll.scrollTop
							? target * v.rowHeight
							: (target + 1) * v.rowHeight > v.scroll.scrollTop + v.scroll.clientHeight
								? (target + 1) * v.rowHeight - v.scroll.clientHeight
								: v.scroll.scrollTop;
						this.render();
						v.canvas.querySelector(`[data-row-index="${target}"] button`)?.focus({preventScroll: true});
					}
				}
			}
		}
		hideNativeSidebar() {
			if (this.view.nativeList) {
				this.view.nativeList.style.paddingTop = this.view.nativePaddingTop;
				this.view.nativeList.style.setProperty('display', 'none', 'important');
				this.view.nativeList.setAttribute('aria-hidden', 'true');
			}
		}
		render() {
			const v = this.view;
			if (!v.disposed && v.root?.isConnected && v.scroll) {
				if (v.activeMenu || v.activeModal || v.isDragging) {
					v.schedule();
				}
				else {
					try {
						const appearance = v.win.getComputedStyle(v.root);
						v.rowHeight = parseFloat(appearance.getPropertyValue('--antigravity-tree-row-height')) || 16;
						v.state.rows = v.model.buildRows({
							data: v.data,
							projects: v.state.projects,
							summaries: v.state.summaries,
							collapsed: v.state.collapsed,
							hideOutsideProject: '1' === appearance.getPropertyValue('--antigravity-hide-outside-project').trim(),
							hideStandaloneConversations: '1' === appearance.getPropertyValue('--antigravity-hide-standalone-conversations').trim()
						});
						v.canvas.style.height = `${v.state.rows.length * v.rowHeight}px`;
						const {start, end} = this.computeVisibleRange(v.state.rows.length);
						const focused = v.root.contains(v.doc.activeElement) ? v.doc.activeElement : null;
						const focusKey = focused?.closest('[data-folders-row]')?.dataset.foldersRow;
						v.canvas.replaceChildren(...v.state.rows.slice(start, end).map((row, offset) => this.renderRow(row, start + offset)));
						this.restoreFocus(focused, focusKey);
						v.state.ready = true;
						v.updateStatus('tree', null);
					}
					catch (error) {
						v.updateStatus('tree', error.message);
					}
				}
			}
		}
		renderConversationRow(el, row, selection) {
			const v = this.view;
			const button = v.element('button', 'fg-label');
			button.dataset.testid = 'conversation-row-sidebar';
			button.dataset.cascadeId = row.id;
			button.dataset.selected = selection.conversationId === row.id;
			const running = row.running;
			button.append(
				v.element('span', running ? 'fg-icon fg-running' : 'fg-icon', running ? '●' : row.pinned ? '📌' : '◦'),
				v.element('span', 'truncate', row.name)
			);
			button.onclick = () => v.adapter.navigate({projectId: row.projectId, conversationId: row.id});
			button.oncontextmenu = event => v.menus.openConversationMenu(event, row);
			el.append(button);
		}
		renderFolderRow(el, row) {
			const v = this.view;
			el.draggable = true;
			const h2 = v.element('h2');
			const button = v.element('button', 'fg-label');
			button.setAttribute('aria-expanded', row.expanded);
			button.append(
				v.element('span', row.running ? 'fg-icon fg-folder-running' : 'fg-icon', '📁'),
				v.element('span', 'truncate', row.name)
			);
			button.onclick = () => v.toggle(row);
			h2.append(button);
			el.append(h2);
		}
		renderProjectRow(el, row) {
			const v = this.view;
			const button = v.element('button', 'fg-label');
			button.draggable = true;
			button.dataset.projectCard = 'true';
			button.dataset.projectId = row.id;
			if (row.folderId) {
				button.dataset.folderId = row.folderId;
			}
			const icon = v.element('span', row.running ? 'fg-icon fg-project-running' : 'fg-icon');
			icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 7V5h6l2 2h10v13H3z"/></svg>';
			button.title = 'Project: ' + row.name;
			button.append(icon, v.element('span', 'truncate', row.name));
			button.onclick = () => v.adapter.navigate({projectId: row.id});
			el.append(button);
		}
		renderRow(row, index) {
			const v = this.view;
			const el = v.element('div', 'fg-row');
			el.dataset.foldersRow = row.key;
			el.dataset.rowIndex = index;
			el.style.top = `${index * v.rowHeight}px`;
			el.style.setProperty('--fg-depth', row.depth);
			el.setAttribute('role', 'treeitem');
			el.setAttribute('aria-level', row.depth + 1);
			const selection = v.adapter.selection();
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
				const collapse = v.element('button', 'fg-toggle', row.expanded ? '⌄' : '›');
				collapse.setAttribute('aria-label', `${row.expanded ? 'Collapse' : 'Expand'} ${row.name}`);
				collapse.onclick = event => {
					event.stopPropagation();
					v.toggle(row);
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
				el.append(v.element('span', 'empty' === row.kind ? 'fg-empty' : '', row.name));
			}
			return el;
		}
		restoreFocus(focused, focusKey) {
			if (focusKey && focused && !focused.isConnected) {
				const row = [...this.view.canvas.children].find(el => focusKey === el.dataset.foldersRow);
				row?.querySelector(focused.classList.contains('fg-toggle') ? '.fg-toggle' : '.fg-label')?.focus({preventScroll: true});
			}
		}
		restoreNativeSidebar(paddingTop = this.view.nativePaddingTop) {
			if (this.view.nativeList) {
				this.view.nativeList.style.paddingTop = paddingTop;
				this.view.nativeList.style.removeProperty('display');
				this.view.nativeList.removeAttribute('aria-hidden');
			}
		}
		reveal(projectId, folderId) {
			const v = this.view;
			for (let folder = v.getFolder(folderId); folder; folder = v.getFolder(folder.parentId)) {
				v.state.collapsed.delete(`folder:${folder.id}`);
			}
			v.state.collapsed.delete(`project:${projectId}`);
			v.persist();
			this.render();
			const index = v.state.rows.findIndex(row => `project:${projectId}` === row.key);
			if (0 <= index && v.scroll) {
				v.scroll.scrollTop = index * v.rowHeight;
				this.render();
			}
		}
		syncFaultBanner(message) {
			const v = this.view;
			const banner = v.root?.querySelector('.fg-state');
			const bannerText = message ? `Folders — compatibility or connection error. ${message}` : '';
			if (banner && bannerText !== banner.textContent) {
				banner.textContent = bannerText;
			}
			let fault = v.doc?.querySelector?.('.fg-fault');
			if (v.root?.isConnected || !message) {
				fault?.remove();
			}
			else if (v.doc?.body) {
				if (!fault) {
					fault = v.element('div', 'fg-fault');
					fault.setAttribute('role', 'alert');
					v.doc.body.append(fault);
				}
				const faultText = `Folders: ${message}. Native interface preserved.`;
				if (faultText !== fault.textContent) {
					fault.textContent = faultText;
				}
			}
		}
		toggleNativeMode(nativeButton) {
			const v = this.view;
			const native = !v.root.classList.contains('fg-native-mode');
			v.root.classList.toggle('fg-native-mode', native);
			v.root.style.bottom = native ? 'auto' : '0';
			v.scroll.style.display = native ? 'none' : '';
			if (native) {
				this.restoreNativeSidebar('20px');
				nativeButton.title = 'Restore folders';
			}
			else {
				this.hideNativeSidebar();
				nativeButton.title = 'Show native list';
				this.render();
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
				projects: [], projectRevision: '', collapsed: new Set(), rows: [], knownProjects: new Set(),
				summaries: options.summaries || win?.__PROJECT_FOLDERS_VIEW__?.state?.summaries || new Map(),
				errors: new Map(win?.__FOLDERS_CONFIG_ERROR__ ? [['action', win.__FOLDERS_CONFIG_ERROR__]] : []),
				revision: initialData ? win?.__FOLDERS_REVISION__ || '' : '',
				ready: false, haveConfig: false, haveProjects: false, haveSummaries: false, savedView: false
			};
			Object.assign(this, {
				hoveredFolderId: null, lastHoveredFolderId: null, lastHoveredFolderTime: 0,
				lastActiveFolderId: null, lastActiveProjectId: null, draggedFolderId: null, draggedProjectId: null,
				isDragging: false, root: null, nativeList: null, nativePaddingTop: '', scroll: null, canvas: null,
				paintTimer: null, disposed: false, rowHeight: 16, lifetime: new AbortController(),
				rootAbort: null, observer: null, observedSubtree: false, mountDeadline: Date.now() + 15000
			});
			this.drag = new (win?.AntigravityFolderDrag?.SidebarDragController || SidebarDragController)(this);
			this.menus = new (win?.AntigravityFolderMenu?.FolderMenuController || FolderMenuController)(this);
			this.dialogs = new (win?.AntigravityFolderDialogs?.FolderDialogController || FolderDialogController)(this);
			this.renderer = new FolderTreeRenderer(this);
			this.storage = new FolderStorageClient({
				window: win,
				model: this.model,
				state: this.state,
				onActionError: error => this.reportAction(error),
				onSchedule: () => this.schedule(),
				onStatus: (channel, error) => this.updateStatus(channel, error),
				onUpdate: (data, revision) => this.notifyUpdate(data, revision)
			});
			const ResizeObserverCtor = options.ResizeObserver || win?.ResizeObserver || ('undefined' !== typeof ResizeObserver ? ResizeObserver : null);
			this.sizing = 'function' === typeof ResizeObserverCtor ? new ResizeObserverCtor(() => this.schedule()) : null;
			this.adapter = options.adapter || ('function' === typeof win?.AntigravityFoldersAdapter
				? win.AntigravityFoldersAdapter({
					window: win,
					model: this.model,
					onProjects: projects => this.handleProjects(projects),
					onSummaries: summaries => this.handleSummaries(summaries),
					onStatus: (channel, error) => this.updateStatus(channel, error)
				})
				: win?.__PROJECT_FOLDERS_VIEW__?.adapter || null);
		}
		get activeMenu() {
			return this.menus.activeMenu;
		}
		get activeModal() {
			return this.dialogs.activeModal;
		}
		get storageReady() {
			return this.storage.ready;
		}
		set storageReady(value) {
			this.storage.ready = Boolean(value);
		}
		bindGlobalListeners() {
			const listen = (type, listener, capture = false) => this.win.addEventListener(type, listener, {capture, signal: this.lifetime.signal});
			listen('click', e => {
				if (this.activeMenu && !this.activeMenu.contains(e.target)) {
					this.menus.close();
				}
			});
			listen('keydown', e => {
				if ('Escape' === e.key) {
					this.menus.close();
					this.dialogs.close();
				}
				// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
				// "Integrate with universal dmitry-ai/harness, format codebase per P.md/P.ES6.md, and link source files to GitHub Issues":
				// https://github.com/dmitry-ai/antigravity-addons/issues/16
				else if (('Insert' === e.key || (e.altKey && ('KeyN' === e.code || 'n' === e.key || 'N' === e.key))) && !this.activeModal) {
					const isInput = e.target && ('INPUT' === e.target.tagName || 'TEXTAREA' === e.target.tagName || e.target.isContentEditable);
					if (!isInput) {
						e.preventDefault();
						this.dialogs.openCreateFolder();
					}
				}
				else if ('F2' === e.key && !this.activeModal) {
					const renameId = this.doc?.activeElement?.closest?.('[data-folder-id]')?.getAttribute('data-folder-id') || this.hoveredFolderId;
					if (renameId && this.getFolder(renameId)) {
						e.preventDefault();
						this.dialogs.openRenameFolder(renameId);
					}
				}
			}, true);
		}
		detectCurrentFolderId() {
			return this.renderer.detectCurrentFolderId();
		}
		dispose() {
			if (this.scroll && this.win) {
				this.win.__FOLDERS_RESTORE_SCROLL__ = this.scroll.scrollTop;
			}
			this.disposed = true;
			clearTimeout(this.paintTimer);
			this.lifetime.abort();
			this.rootAbort?.abort();
			this.drag.dispose();
			this.menus.close();
			this.dialogs.close();
			this.observer?.disconnect();
			this.sizing?.disconnect();
			this.adapter?.dispose?.();
			this.root?.remove();
			this.renderer.restoreNativeSidebar();
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
			if (projects !== this.state.projects) {
				const revision = JSON.stringify(projects);
				if (revision !== this.state.projectRevision) {
					this.state.projects = projects;
					this.state.projectRevision = revision;
					this.schedule();
				}
			}
		}
		handleSummaries(summaries) {
			this.state.haveSummaries = true;
			this.state.summaries = summaries;
			this.schedule();
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
			await this.storage.loadViewState();
			this.win?.addEventListener?.('antigravity-folders-view-state', event => this.storage.handleViewStateEvent(event), {signal: this.lifetime.signal});
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
						this.renderer.buildPanel(matches[0]);
					}
				}
			}
		}
		nativeSidebarPending() {
			return this.mountDeadline > Date.now() && ((!this.doc.querySelector('[role="navigation"]') && !this.doc.querySelector('.agy-shell')) || !!this.doc.querySelector('[role="navigation"] [data-testid="sidebar-list-skeleton"]'));
		}
		notifyUpdate(newData, revision = '') {
			this.storage.applyUpdate(this, newData, revision);
		}
		persist() {
			this.storage.persistViewState();
		}
		postAction(action, payload = {}) {
			return this.storage.postAction(action, payload);
		}
		readConfig() {
			return this.storage.readConfig();
		}
		render() {
			this.renderer.render();
		}
		reportAction(error) {
			this.updateStatus('action', error);
		}
		retargetObserver() {
			if (this.observer && this.doc?.documentElement) {
				this.observer.disconnect();
				if (!this.root?.isConnected || !this.nativeList?.isConnected || !this.nativeList.parentElement) {
					this.observer.observe(this.doc.documentElement, {childList: true, subtree: true});
					this.observedSubtree = true;
				}
				else {
					for (let node = this.nativeList.parentElement; node && node !== this.doc.documentElement; node = node.parentElement) {
						this.observer.observe(node, {childList: true});
					}
					this.observedSubtree = false;
				}
			}
		}
		reveal(projectId, folderId) {
			this.renderer.reveal(projectId, folderId);
		}
		schedule() {
			if (!this.paintTimer) {
				this.paintTimer = setTimeout(() => {
					this.paintTimer = null;
					this.render();
				}, 40);
			}
		}
		async start() {
			this.win?.addEventListener?.('popstate', () => this.schedule(), {signal: this.lifetime.signal});
			const MutationObserverCtor = this.win?.MutationObserver || ('undefined' !== typeof MutationObserver ? MutationObserver : null);
			if ('function' === typeof MutationObserverCtor && this.doc?.documentElement) {
				this.observer = new MutationObserverCtor(() => {
					if (!this.root?.isConnected || !this.nativeList?.isConnected) {
						this.unmountDetached();
						this.retargetObserver();
						this.mount();
					}
				});
				this.retargetObserver();
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
		unmountDetached() {
			if (this.root && (!this.root.isConnected || !this.nativeList?.isConnected)) {
				this.sizing?.unobserve?.(this.scroll);
				this.root.remove();
				this.root = null;
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
				this.renderer.syncFaultBanner([...this.state.errors].map(([key, value]) => `${key}: ${value}`).join('\n'));
			}
		}
	}
	const createReadConfig = ({model = defaultModel, onUpdate, state, status, view, window: win}) => {
		const client = new FolderStorageClient({
			model,
			onStatus: status,
			onUpdate: onUpdate || ((data, revision) => view?.notifyUpdate?.(data, revision)),
			state,
			window: win
		});
		return () => client.readConfig();
	};
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
	return {FolderStorageClient, FolderTreeRenderer, FoldersView, createReadConfig, installFoldersView};
});
