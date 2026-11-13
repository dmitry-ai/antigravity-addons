// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders around standalone v2 architecture, delegated events, UMD test exports, and shared folders-model mutations":
// https://github.com/dmitry-ai/antigravity-addons/issues/24
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
					const response = win.__ANTIGRAVITY_TOOLS_REQUEST__ ? null : await (win.fetch || fetch)('/api/project-folders');
					if (response && !response.ok) {
						throw Error(`Folder storage: HTTP ${response.status}; run Upg to reconnect the loader`);
					}
					const payload = response ? await response.json() : await win.__ANTIGRAVITY_TOOLS_REQUEST__('folders', {method: 'GET'});
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
	function installFoldersView() {
	if ('undefined' !== typeof window && !window.__PROJECT_FOLDERS_VIEW__) {
		const model = window.AntigravityFoldersModel;
		const client = window.__PROJECT_FOLDERS_CLIENT__;
		const state = {
			projects: [],
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
		let root;
		let nativeList;
		let nativePaddingTop;
		let scroll;
		let canvas;
		let timer;
		let paintTimer;
		let disposed = false;
		let storageReady = false;
		let rowHeight = 16;
		let removeStorageListener;
		// 2026-10-30 Dmitrii Fediuk https://github.com/dmitrii-fediuk
		// "Coordinate Folders sidebar mounting with asynchronous shell auth initialization and loading skeleton in A6":
		// https://github.com/dmitry-ai/antigravity-addons/issues/14
		const mountDeadline = Date.now() + 15000;
		const isOnboardingRoute = () => /^\/onboarding(?:\/|$)/.test(location.pathname);
		const isStandaloneRoute = () => /^\/(?:artifact|s|settings-standalone|terminal-standalone)(?:\/|$)/.test(location.pathname);
		const nativeSidebarPending = () => mountDeadline > Date.now() && ((!document.querySelector('[role="navigation"]') && !document.querySelector('.agy-shell')) || !!document.querySelector('[role="navigation"] [data-testid="sidebar-list-skeleton"]'));
		const sizing = new ResizeObserver(() => schedule());
		const storageKey = 'antigravity-folders.v2.collapsed';
		const element = (tag, className, text) => {
			const el = document.createElement(tag);
			if (className) {
				el.className = className;
			}
			if (undefined !== text) {
				el.textContent = text;
			}
			return el;
		};
		const style = element('style');
		style.dataset.foldersViewStyle = '2';
		style.textContent = window.__FOLDERS_STYLE__ || '';
		if (!window.__ANTIGRAVITY_TOOLS_INSPECTOR_STYLES__) {
			document.head.append(style);
		}
		const status = (channel, error) => {
			if (!disposed) {
				if (error) {
					state.errors.set(channel, error);
				}
				else {
					state.errors.delete(channel);
				}
				const viewState = state.errors.size
					? 'error'
					: isOnboardingRoute()
						? 'deferred'
						: isStandaloneRoute() || (state.ready && state.haveSummaries)
							? 'ready'
							: 'loading';
				window.__PROJECT_FOLDERS_STATUS__ = {
					architecture: 2,
					state: viewState,
					...(isOnboardingRoute() ? {reason: [{id: 'folders', reason: 'onboarding'}]} : {}),
					nativeContract: adapter.contract,
					errors: Object.fromEntries(state.errors),
					folders: client.data.folders.length,
					projects: state.projects.length,
					conversations: state.summaries.size
				};
				const message = [...state.errors].map(([key, value]) => `${key}: ${value}`).join('\n');
				const banner = root?.querySelector('.fg-state');
				const bannerText = message ? `Folders — compatibility or connection error. ${message}` : '';
				if (banner && bannerText !== banner.textContent) {
					banner.textContent = bannerText;
				}
				let fault = document.querySelector('.fg-fault');
				if (root?.isConnected || !message) {
					fault?.remove();
				}
				else {
					if (!fault) {
						fault = element('div', 'fg-fault');
						fault.setAttribute('role', 'alert');
						document.body.append(fault);
					}
					const faultText = `Folders: ${message}. Native interface preserved.`;
					if (faultText !== fault.textContent) {
						fault.textContent = faultText;
					}
				}
			}
		};
		const persist = () => {
			if (storageReady) {
				const saved = {collapsed: [...state.collapsed]};
				if (!window.__ANTIGRAVITY_TOOLS_REQUEST__) {
					sessionStorage.setItem(storageKey, JSON.stringify(saved.collapsed));
				}
				else {
					window.__ANTIGRAVITY_TOOLS_REQUEST__('folders', {method: 'SET_VIEW_STATE', body: saved})
						.catch(error => status('view-state', error.message));
				}
			}
		};
		const schedule = () => {
			if (!paintTimer) {
				paintTimer = setTimeout(() => {
					paintTimer = null;
					render();
				}, 40);
			}
		};
		const toggle = row => {
			if (state.collapsed.has(row.key)) {
				state.collapsed.delete(row.key);
			}
			else {
				state.collapsed.add(row.key);
			}
			persist();
			render();
		};
		const adapter = window.AntigravityFoldersAdapter({
			window,
			model,
			onProjects: projects => {
				if (!state.savedView) {
					for (const project of projects) {
						if (!state.knownProjects.has(project.id)) {
							state.collapsed.add(`project:${project.id}`);
						}
					}
				}
				state.knownProjects = new Set(projects.map(project => project.id));
				state.haveProjects = true;
				const revision = JSON.stringify(projects);
				if (revision !== state.projectRevision) {
					state.projects = projects;
					state.projectRevision = revision;
					schedule();
				}
			},
			onSummaries: summaries => {
				state.haveSummaries = true;
				state.summaries = summaries;
				schedule();
			},
			onStatus: status
		});
		const readConfig = createReadConfig({window, model, state, client, status});
		const rowElement = (row, index) => {
			const el = element('div', 'fg-row');
			el.dataset.foldersRow = row.key;
			el.dataset.rowIndex = index;
			el.style.top = `${index * rowHeight}px`;
			el.style.setProperty('--fg-depth', row.depth);
			el.setAttribute('role', 'treeitem');
			el.setAttribute('aria-level', row.depth + 1);
			const selection = adapter.selection();
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
				const collapse = element('button', 'fg-toggle', row.expanded ? '⌄' : '›');
				collapse.setAttribute('aria-label', `${row.expanded ? 'Collapse' : 'Expand'} ${row.name}`);
				collapse.onclick = event => {
					event.stopPropagation();
					toggle(row);
				};
				el.append(collapse);
			}
			if ('folder' === row.kind) {
				el.draggable = true;
				const h2 = element('h2');
				const button = element('button', 'fg-label');
				button.setAttribute('aria-expanded', row.expanded);
				button.append(
					element('span', row.running ? 'fg-icon fg-folder-running' : 'fg-icon', '📁'),
					element('span', 'truncate', row.name)
				);
				button.onclick = () => toggle(row);
				h2.append(button);
				el.append(h2);
			}
			else if ('project' === row.kind) {
				const button = element('button', 'fg-label');
				button.draggable = true;
				button.dataset.projectCard = 'true';
				button.dataset.projectId = row.id;
				if (row.folderId) {
					button.dataset.folderId = row.folderId;
				}
				const icon = element('span', row.running ? 'fg-icon fg-project-running' : 'fg-icon');
				icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 7V5h6l2 2h10v13H3z"/></svg>';
				button.title = 'Project: ' + row.name;
				button.append(icon, element('span', 'truncate', row.name));
				button.onclick = () => adapter.navigate({projectId: row.id});
				el.append(button);
			}
			else if ('conversation' === row.kind) {
				const button = element('button', 'fg-label');
				button.dataset.testid = 'conversation-row-sidebar';
				button.dataset.cascadeId = row.id;
				button.dataset.selected = selection.conversationId === row.id;
				const running = row.running;
				button.append(
					element('span', running ? 'fg-icon fg-running' : 'fg-icon', running ? '●' : row.pinned ? '📌' : '◦'),
					element('span', 'truncate', row.name)
				);
				button.onclick = () => adapter.navigate({projectId: row.projectId, conversationId: row.id});
				el.append(button);
				button.oncontextmenu = event => {
					event.preventDefault();
					event.stopPropagation();
					client.ui.showContextMenu(event.clientX, event.clientY, [
						{label: 'Open conversation', onClick: () => adapter.navigate({projectId: row.projectId, conversationId: row.id})},
						{label: 'Rename…', onClick: () => textDialog('Conversation title', model.summaryName(state.summaries.get(row.id) || row.summary), value => adapter.updateConversation(row.id, {title: value}))},
						{label: row.summary.annotations?.pinned ? 'Unpin' : 'Pin', onClick: () => adapter.updateConversation(row.id, {pinned: !row.summary.annotations?.pinned}).catch(error => status('action', error.message))},
						{label: 'Archive', onClick: () => adapter.updateConversation(row.id, {archived: true, archivalStatusTimestamp: new Date().toISOString()}).catch(error => status('action', error.message))}
					], 'Conversation');
				};
				window.__PROJECT_FOLDERS_CONVO_MAP__ ||= {};
				if (row.projectId) {
					window.__PROJECT_FOLDERS_CONVO_MAP__[row.id] = row.projectId;
				}
			}
			else {
				el.append(element('span', 'empty' === row.kind ? 'fg-empty' : '', row.name));
			}
			return el;
		};
		function render() {
			if (!disposed && root?.isConnected && scroll) {
				if (client.activeMenu || client.activeModal || root.querySelector('.folder-rename-input') || client.isDragging) {
					schedule();
				}
				else {
					try {
						const appearance = getComputedStyle(root);
						rowHeight = parseFloat(appearance.getPropertyValue('--antigravity-tree-row-height')) || 16;
						// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
						// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
						// https://github.com/dmitry-ai/antigravity-addons/issues/12
						const hideOutsideProject = '1' === appearance.getPropertyValue('--antigravity-hide-outside-project').trim();
						const hideStandaloneConversations = '1' === appearance.getPropertyValue('--antigravity-hide-standalone-conversations').trim();
						state.rows = model.buildRows({
							data: client.data,
							projects: state.projects,
							summaries: state.summaries,
							collapsed: state.collapsed,
							hideOutsideProject,
							hideStandaloneConversations
						});
						canvas.style.height = `${state.rows.length * rowHeight}px`;
						const start = Math.max(0, Math.floor(scroll.scrollTop / rowHeight) - 8);
						const end = Math.min(state.rows.length, Math.ceil((scroll.scrollTop + scroll.clientHeight) / rowHeight) + 8);
						const focused = root.contains(document.activeElement) ? document.activeElement : null;
						const focusKey = focused?.closest('[data-folders-row]')?.dataset.foldersRow;
						canvas.replaceChildren(...state.rows.slice(start, end).map((row, offset) => rowElement(row, start + offset)));
						if (focusKey && !focused.isConnected) {
							const row = [...canvas.children].find(el => focusKey === el.dataset.foldersRow);
							row?.querySelector(focused.classList.contains('fg-toggle') ? '.fg-toggle' : '.fg-label')?.focus({preventScroll: true});
						}
						state.ready = true;
						status('tree', null);
					}
					catch (error) {
						status('tree', error.message);
					}
				}
			}
		}
		const mount = () => {
			if (!disposed && !root?.isConnected && state.haveConfig && state.haveProjects) {
				if (isOnboardingRoute() || isStandaloneRoute()) {
					status('mount', null);
				}
				else {
					const matches = [...document.querySelectorAll('[data-testid="conversation-list-sidebar"]')].filter(el => el.closest('[role="navigation"]'));
					if (0 === matches.length && nativeSidebarPending()) {
						status('mount', null);
					}
					else if (1 !== matches.length) {
						status('mount', `Expected one native sidebar, found ${matches.length}`);
					}
					else {
						nativeList = matches[0];
						nativePaddingTop = nativeList.style.paddingTop;
						root = element('section', 'fg-panel');
						root.dataset.foldersRoot = '2';
						root.dataset.testid = 'folders-tree';
						root.setAttribute('aria-label', 'Folders and projects');
						const toolbar = element('div', 'fg-toolbar');
						toolbar.append(element('strong', '', 'Projects'));
						const folderButton = element('button', 'btn-create-folder');
						folderButton.type = 'button';
						folderButton.title = 'Create new folder (defaults to active folder)';
						folderButton.setAttribute('aria-label', 'Create new folder');
						const folderPlus = element('span', '', '+');
						folderPlus.style.cssText = 'font-size:10px;font-weight:bold;margin-left:1px;';
						folderButton.append('📁', folderPlus);
						folderButton.onclick = event => {
							event.stopPropagation();
							client.ui.showCreateFolderDialog();
						};
						const nativeButton = element('button', 'fg-native', '⋯');
						nativeButton.title = 'List view';
						nativeButton.onclick = () => {
							const native = !root.classList.contains('fg-native-mode');
							root.classList.toggle('fg-native-mode', native);
							root.style.bottom = native ? 'auto' : '0';
							scroll.style.display = native ? 'none' : '';
							if (native) {
								nativeList.style.paddingTop = '20px';
								nativeList.style.removeProperty('display');
								nativeList.removeAttribute('aria-hidden');
								nativeButton.title = 'Restore folders';
							}
							else {
								nativeList.style.paddingTop = nativePaddingTop;
								nativeList.style.setProperty('display', 'none', 'important');
								nativeList.setAttribute('aria-hidden', 'true');
								nativeButton.title = 'Show native list';
								render();
							}
						};
						const projectButton = element('button', '', '+');
						projectButton.title = 'Create project';
						projectButton.setAttribute('aria-label', 'Create project');
						projectButton.onclick = () => createProjectDialog(client.detectCurrentFolderId());
						const actions = element('div', 'fg-actions');
						actions.append(folderButton, nativeButton, projectButton);
						toolbar.append(actions);
						const message = element('div', 'fg-state');
						message.setAttribute('role', 'alert');
						scroll = element('div', 'fg-scroll');
						scroll.setAttribute('role', 'tree');
						canvas = element('div', 'fg-canvas');
						scroll.append(canvas);
						scroll.addEventListener('scroll', schedule, {passive: true});
						sizing.observe(scroll);
						root.append(toolbar, message, scroll);
						nativeList.parentElement.append(root);
						nativeList.style.setProperty('display', 'none', 'important');
						nativeList.setAttribute('aria-hidden', 'true');
						root.addEventListener('keydown', event => {
							if (!event.target.matches('input,textarea')) {
								const index = Number(event.target.closest('[data-row-index]')?.dataset.rowIndex);
								if (Number.isInteger(index)) {
									if ('ArrowDown' === event.key || 'ArrowUp' === event.key) {
										event.preventDefault();
										const target = Math.max(0, Math.min(state.rows.length - 1, index + ('ArrowDown' === event.key ? 1 : -1)));
										scroll.scrollTop = target * rowHeight < scroll.scrollTop
											? target * rowHeight
											: (target + 1) * rowHeight > scroll.scrollTop + scroll.clientHeight
												? (target + 1) * rowHeight - scroll.clientHeight
												: scroll.scrollTop;
										render();
										canvas.querySelector(`[data-row-index="${target}"] button`)?.focus({preventScroll: true});
									}
									else if (('ArrowLeft' === event.key || 'ArrowRight' === event.key) && ['folder', 'project'].includes(state.rows[index]?.kind)) {
										event.preventDefault();
										const row = state.rows[index];
										if (row.expanded === ('ArrowLeft' === event.key)) {
											toggle(row);
										}
									}
								}
							}
						});
						view.root = root;
						status('mount', null);
						render();
						client.bindRoot(root);
						if (Number.isFinite(window.__FOLDERS_RESTORE_SCROLL__)) {
							scroll.scrollTop = window.__FOLDERS_RESTORE_SCROLL__;
							delete window.__FOLDERS_RESTORE_SCROLL__;
							render();
						}
					}
				}
			}
		};
		async function createProjectDialog(folderId) {
			client.ui.closeContextMenu();
			if (!client.activeModal) {
				const overlay = element('div', 'antigravity-folder-modal-overlay');
				const dialog = element('form', 'antigravity-folder-modal');
				dialog.setAttribute('role', 'dialog');
				dialog.setAttribute('aria-modal', 'true');
				dialog.setAttribute('aria-label', 'Create project');
				dialog.append(element('h3', '', folderId ? `Create project in “${client.getFolder(folderId)?.name}”` : 'Create project'));
				const name = element('input');
				name.placeholder = 'Project name';
				name.required = true;
				name.setAttribute('aria-label', 'Project name');
				dialog.append(name);
				const pathRow = element('div', 'fg-project-path');
				const directory = element('input');
				directory.placeholder = 'Project directory (optional)';
				directory.setAttribute('aria-label', 'Project directory');
				const browse = element('button', 'antigravity-folder-btn secondary', 'Browse…');
				browse.type = 'button';
				browse.onclick = async () => {
					try {
						const result = await window.dialog.showOpenDialog();
						if (result) {
							directory.value = 'string' === typeof result ? result : Array.isArray(result) ? result[0] || '' : result.filePaths?.[0] || '';
						}
					}
					catch (cause) {
						error.textContent = cause.message;
					}
				};
				pathRow.append(directory, browse);
				dialog.append(pathRow);
				const error = element('div', 'fg-dialog-error');
				error.setAttribute('role', 'alert');
				dialog.append(error);
				const buttons = element('div', 'antigravity-folder-modal-buttons');
				const cancel = element('button', 'antigravity-folder-btn secondary', 'Cancel');
				const submit = element('button', 'antigravity-folder-btn primary', 'Create');
				cancel.type = 'button';
				submit.type = 'submit';
				const close = () => {
					overlay.remove();
					if (overlay === client.activeModal) {
						client.activeModal = null;
					}
					schedule();
				};
				cancel.onclick = close;
				buttons.append(cancel, submit);
				dialog.append(buttons);
				overlay.append(dialog);
				document.body.append(overlay);
				client.activeModal = overlay;
				name.focus();
				let createdId;
				const requestId = crypto.randomUUID();
				dialog.onsubmit = async event => {
					event.preventDefault();
					if (!submit.disabled) {
						submit.disabled = true;
						error.textContent = '';
						try {
							if (!createdId) {
								const resources = directory.value.trim()
									? [{folderUri: new URL('file:///' + directory.value.trim().replace(/\\/g, '/')).href}]
									: [];
								createdId = await adapter.createProject({id: requestId, name: name.value, resources});
							}
							if (folderId) {
								const assignment = await client.postAction('assign-project', {projectId: createdId, folderId});
								if (!assignment.success) {
									throw Error(`Project ${createdId} created, but folder was not assigned: ${assignment.error}`);
								}
							}
							close();
							view.reveal(createdId, folderId);
							adapter.navigate({projectId: createdId});
						}
						catch (cause) {
							error.textContent = cause.message;
							submit.disabled = false;
						}
					}
				};
			}
		}
		function textDialog(title, initialValue, submitAction) {
			client.ui.closeContextMenu();
			if (!client.activeModal) {
				const overlay = element('div', 'antigravity-folder-modal-overlay');
				const form = element('form', 'antigravity-folder-modal');
				form.setAttribute('role', 'dialog');
				form.setAttribute('aria-label', title);
				const input = element('input');
				input.value = initialValue;
				input.required = true;
				input.setAttribute('aria-label', title);
				const error = element('div', 'fg-dialog-error');
				const buttons = element('div', 'antigravity-folder-modal-buttons');
				const cancel = element('button', 'antigravity-folder-btn secondary', 'Cancel');
				const submit = element('button', 'antigravity-folder-btn primary', 'Save');
				cancel.type = 'button';
				submit.type = 'submit';
				const close = () => {
					overlay.remove();
					if (overlay === client.activeModal) {
						client.activeModal = null;
					}
					schedule();
				};
				cancel.onclick = close;
				buttons.append(cancel, submit);
				form.append(element('h3', '', title), input, error, buttons);
				overlay.append(form);
				document.body.append(overlay);
				client.activeModal = overlay;
				input.focus();
				input.select();
				form.onsubmit = async event => {
					event.preventDefault();
					if (!submit.disabled) {
						submit.disabled = true;
						try {
							await submitAction(input.value.trim());
							close();
						}
						catch (cause) {
							error.textContent = cause.message;
							submit.disabled = false;
						}
					}
				};
			}
		}
		const view = {
			root: null,
			adapter,
			state,
			createProject: createProjectDialog,
			renameProject(id) {
				const project = state.projects.find(item => id === item.id);
				if (project) {
					textDialog('Project name', project.name, async name => {
						await adapter.rpc('UpdateProject', {project: {...project, name}});
						await adapter.readProjects();
					});
				}
			},
			expandFolder(folderId) {
				if (folderId && state.collapsed.delete(`folder:${folderId}`)) {
					persist();
					render();
				}
			},
			reveal(projectId, folderId) {
				for (let folder = client.getFolder(folderId); folder; folder = client.getFolder(folder.parentId)) {
					state.collapsed.delete(`folder:${folder.id}`);
				}
				state.collapsed.delete(`project:${projectId}`);
				persist();
				render();
				const index = state.rows.findIndex(row => `project:${projectId}` === row.key);
				if (0 <= index) {
					scroll.scrollTop = index * rowHeight;
					render();
				}
			},
			inspect() {
				return {
					...window.__PROJECT_FOLDERS_STATUS__,
					rowCount: state.rows.length,
					renderedRows: canvas?.children.length || 0,
					collapsed: [...state.collapsed]
				};
			},
			reportAction(error) {
				status('action', error);
			},
			refresh: render,
			dispose() {
				if (scroll) {
					window.__FOLDERS_RESTORE_SCROLL__ = scroll.scrollTop;
				}
				disposed = true;
				clearInterval(timer);
				clearTimeout(paintTimer);
				observer.disconnect();
				sizing.disconnect();
				removeStorageListener?.();
				adapter.dispose();
				root?.remove();
				style.remove();
				if (nativeList) {
					nativeList.style.paddingTop = nativePaddingTop;
					nativeList.style.removeProperty('display');
					nativeList.removeAttribute('aria-hidden');
				}
				window.removeEventListener('antigravity-folders-updated', schedule);
				window.removeEventListener('popstate', schedule);
				delete window.__PROJECT_FOLDERS_VIEW__;
			}
		};
		window.__PROJECT_FOLDERS_VIEW__ = view;
		window.addEventListener('antigravity-folders-updated', schedule);
		window.addEventListener('popstate', schedule);
		const observer = new MutationObserver(() => {
			if (!root?.isConnected) {
				mount();
			}
		});
		observer.observe(document.documentElement, {childList: true, subtree: true});
		(async () => {
			try {
				const saved = window.__ANTIGRAVITY_TOOLS_REQUEST__
					? await window.__ANTIGRAVITY_TOOLS_REQUEST__('folders', {method: 'GET_VIEW_STATE'})
					: {collapsed: sessionStorage.getItem(storageKey) ? JSON.parse(sessionStorage.getItem(storageKey)) : undefined};
				const items = undefined === saved.collapsed && window.nativeStorage?.getItems ? await window.nativeStorage.getItems() : {};
				const value = undefined === saved.collapsed ? undefined : JSON.stringify(saved.collapsed);
				if (undefined !== value) {
					const collapsed = JSON.parse(value);
					if (!Array.isArray(collapsed) || collapsed.some(key => 'string' !== typeof key)) {
						throw Error('Invalid saved folder view state');
					}
					state.collapsed = new Set(collapsed);
					state.savedView = true;
				}
				else {
					for (const project of state.projects) {
						state.collapsed.add(`project:${project.id}`);
					}
					const legacy = JSON.parse(items.sidebar_collapsed_section_headers || '[]');
					const closed = Array.isArray(legacy) ? new Set(legacy) : new Set(Object.keys(legacy).filter(key => legacy[key]));
					for (const folder of client.data.folders) {
						if (closed.has(`folder-${folder.id}`)) {
							state.collapsed.add(`folder:${folder.id}`);
						}
					}
				}
				const changed = event => {
					try {
						const values = event.detail.collapsed;
						if (!Array.isArray(values) || values.some(key => 'string' !== typeof key)) {
							throw Error('Invalid saved folder state');
						}
						state.collapsed = new Set(values);
						state.savedView = true;
						schedule();
					}
					catch (error) {
						status('view-state', error.message);
					}
				};
				window.addEventListener('antigravity-folders-view-state', changed);
				removeStorageListener = () => window.removeEventListener('antigravity-folders-view-state', changed);
				storageReady = true;
				status('view-state', null);
			}
			catch (error) {
				status('view-state', error.message);
			}
			try {
				await readConfig();
				await adapter.start();
				mount();
			}
			catch (error) {
				status('startup', error.message);
			}
			timer = setInterval(() => {
				readConfig().catch(error => status('folders', error.message));
				if (!root?.isConnected) {
					mount();
				}
			}, 2000);
		})();
	}
	}
	return {createReadConfig, installFoldersView};
});
