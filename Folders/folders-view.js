// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders around standalone v2 architecture, delegated events, UMD test exports, and shared folders-model mutations":
// https://github.com/dmitry-ai/antigravity-addons/issues/24
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders UI layer (folders-client.js and folders-view.js) with unified modal builder, direct selection lookup, and removal of non-CDP fallbacks":
// https://github.com/dmitry-ai/antigravity-addons/issues/30
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decompose installFoldersView into ES6 class FoldersView in Folders/folders-view.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/28
(function(factory) {
	const api = factory();
	if ('object' === typeof module && module.exports) {
		module.exports = api;
	}
	else {
		api.installFoldersView();
	}
})(() => {
	// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
	// "Add Project settings action to project context menu in Folders":
	// https://github.com/dmitry-ai/antigravity-addons/issues/17
	const createReadConfig = ({window: win, model, state, client, status}) => {
		let configPromise = null;
		return () => {
			if (!configPromise) {
				configPromise = (async () => {
					if ('function' !== typeof win?.__ANTIGRAVITY_TOOLS_REQUEST__) {
						throw Error('Folder storage bridge is unavailable; run Upg to reconnect');
					}
					const payload = await win.__ANTIGRAVITY_TOOLS_REQUEST__('folders', {method: 'GET'});
					if (payload.error) {
						throw Error(payload.error);
					}
					const data = 2 === payload.schemaVersion ? payload.data : payload;
					model.validateFolders(data.folders);
					state.haveConfig = true;
					if (payload.revision) {
						win.__FOLDERS_REVISION__ = payload.revision;
					}
					const revision = payload.revision || JSON.stringify(data);
					if (revision !== state.revision) {
						state.revision = revision;
						client.notifyUpdate(data);
					}
					status('folders', null);
				})().finally(() => {
					configPromise = null;
				});
			}
			return configPromise;
		};
	};
	class FoldersView {
		constructor(win = 'undefined' !== typeof window ? window : undefined, options = {}) {
			this.win = win;
			this.doc = options.document || win?.document || ('undefined' !== typeof document ? document : undefined);
			this.model = options.model || win?.AntigravityFoldersModel;
			this.client = options.client || win?.__PROJECT_FOLDERS_CLIENT__;
			this.state = {
				projects: [],
				projectRevision: '',
				summaries: new Map(),
				collapsed: new Set(),
				rows: [],
				errors: new Map(),
				revision: '',
				ready: false,
				haveConfig: false,
				haveProjects: false,
				haveSummaries: false,
				savedView: false,
				knownProjects: new Set()
			};
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
			this.observer = null;
			this.style = null;
			// 2026-10-30 Dmitrii Fediuk https://github.com/dmitrii-fediuk
			// "Coordinate Folders sidebar mounting with asynchronous shell auth initialization and loading skeleton in A6":
			// https://github.com/dmitry-ai/antigravity-addons/issues/14
			this.mountDeadline = Date.now() + 15000;
			const ResizeObserverCtor = options.ResizeObserver || win?.ResizeObserver || ('undefined' !== typeof ResizeObserver ? ResizeObserver : null);
			this.sizing = 'function' === typeof ResizeObserverCtor ? new ResizeObserverCtor(() => this.schedule()) : null;
			this.adapter = options.adapter || win.AntigravityFoldersAdapter({
				window: win,
				model: this.model,
				onProjects: projects => this.handleProjects(projects),
				onSummaries: summaries => this.handleSummaries(summaries),
				onStatus: (channel, error) => this.updateStatus(channel, error)
			});
			this.readConfig = createReadConfig({
				window: win,
				model: this.model,
				state: this.state,
				client: this.client,
				status: (channel, error) => this.updateStatus(channel, error)
			});
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
				this.client.ui.showCreateFolderDialog();
			};
			const nativeButton = this.element('button', 'fg-native', '⋯');
			nativeButton.title = 'List view';
			nativeButton.onclick = () => this.toggleNativeMode(nativeButton);
			const projectButton = this.element('button', '', '+');
			projectButton.title = 'Create project';
			projectButton.setAttribute('aria-label', 'Create project');
			projectButton.onclick = () => this.createProject(this.client.detectCurrentFolderId());
			const actions = this.element('div', 'fg-actions');
			actions.append(folderButton, nativeButton, projectButton);
			toolbar.append(actions);
			return toolbar;
		}
		createProject(folderId) {
			let createdId;
			let directory;
			let name;
			const requestId = crypto.randomUUID();
			this.client.ui.openModal({
				title: folderId ? `Create project in “${this.client.getFolder(folderId)?.name}”` : 'Create project',
				ariaLabel: 'Create project',
				submitLabel: 'Create',
				onClose: () => this.schedule(),
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
						const assignment = await this.client.postAction('assign-project', {projectId: createdId, folderId});
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
		dispose() {
			if (this.scroll && this.win) {
				this.win.__FOLDERS_RESTORE_SCROLL__ = this.scroll.scrollTop;
			}
			this.disposed = true;
			clearInterval(this.timer);
			clearTimeout(this.paintTimer);
			this.lifetime.abort();
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
			return this.client.element(tag, className, text);
		}
		expandFolder(folderId) {
			if (folderId && this.state.collapsed.delete(`folder:${folderId}`)) {
				this.persist();
				this.render();
			}
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
						this.client.bindRoot(this.root);
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
		openConversationMenu(event, row) {
			event.preventDefault();
			event.stopPropagation();
			this.client.ui.showContextMenu(event.clientX, event.clientY, [
				{label: 'Open conversation', onClick: () => this.adapter.navigate({projectId: row.projectId, conversationId: row.id})},
				{label: 'Rename…', onClick: () => this.openTextDialog('Conversation title', this.model.summaryName(this.state.summaries.get(row.id) || row.summary), value => this.adapter.updateConversation(row.id, {title: value}))},
				{label: row.summary.annotations?.pinned ? 'Unpin' : 'Pin', onClick: () => this.adapter.updateConversation(row.id, {pinned: !row.summary.annotations?.pinned}).catch(error => this.updateStatus('action', error.message))},
				{label: 'Archive', onClick: () => this.adapter.updateConversation(row.id, {archived: true, archivalStatusTimestamp: new Date().toISOString()}).catch(error => this.updateStatus('action', error.message))}
			], 'Conversation');
		}
		openTextDialog(title, initialValue, submitAction) {
			let input;
			const modal = this.client.ui.openModal({
				title,
				ariaLabel: title,
				submitLabel: 'Save',
				onClose: () => this.schedule(),
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
		refresh() {
			this.render();
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
				if (this.client.activeMenu || this.client.activeModal || this.root.querySelector('.folder-rename-input') || this.client.isDragging) {
					this.schedule();
				}
				else {
					try {
						const appearance = this.win.getComputedStyle(this.root);
						this.rowHeight = parseFloat(appearance.getPropertyValue('--antigravity-tree-row-height')) || 16;
						// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
						// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
						// https://github.com/dmitry-ai/antigravity-addons/issues/12
						const hideOutsideProject = '1' === appearance.getPropertyValue('--antigravity-hide-outside-project').trim();
						const hideStandaloneConversations = '1' === appearance.getPropertyValue('--antigravity-hide-standalone-conversations').trim();
						this.state.rows = this.model.buildRows({
							data: this.client.data,
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
				el.dataset.folderDepth = row.depth;
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
			for (let folder = this.client.getFolder(folderId); folder; folder = this.client.getFolder(folder.parentId)) {
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
		async start() {
			this.style = this.element('style');
			this.style.dataset.foldersViewStyle = '2';
			this.style.textContent = this.win?.__FOLDERS_STYLE__ || '';
			if (!this.win?.__ANTIGRAVITY_TOOLS_INSPECTOR_STYLES__) {
				this.doc?.head?.append(this.style);
			}
			this.win?.addEventListener?.('antigravity-folders-updated', () => this.schedule(), {signal: this.lifetime.signal});
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
						nativeContract: this.adapter.contract,
						errors: Object.fromEntries(this.state.errors),
						folders: this.client.data.folders.length,
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
	function installFoldersView() {
		let r;
		if ('undefined' !== typeof window && !window.__PROJECT_FOLDERS_VIEW__) {
			const view = new FoldersView(window);
			window.__PROJECT_FOLDERS_VIEW__ = view;
			view.start();
			r = view;
		}
		return r;
	}
	return {FoldersView, createReadConfig, installFoldersView};
});
