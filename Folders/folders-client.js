// 2026-10-12 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Add interactive GUI folder management (folders-client.js), nested parentId hierarchy, drag-and-drop, Windows Explorer sorting, and adaptive Light/Dark menus":
// https://github.com/dmitry-ai/antigravity-addons/issues/4
(function initAntigravityFoldersClient() {
	let r;
	result: {
		if ('undefined' === typeof window || window.__PROJECT_FOLDERS_CLIENT_INITIALIZED__) {
			r = undefined;
			break result;
		}
		window.__PROJECT_FOLDERS_CLIENT_INITIALIZED__ = true;
		const lifetime = new AbortController();
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
				let r;
				result: {
					if (!this.data || !Array.isArray(this.data.folders)) {
						r = '';
						break result;
					}
					const map = new Map(this.data.folders.map(f => [f.id, f]));
					const parts = [];
					let curr = map.get(folderId);
					const seen = new Set();
					while (curr && !seen.has(curr.id)) {
						seen.add(curr.id);
						parts.unshift(curr.name);
						curr = curr.parentId ? map.get(curr.parentId) : null;
					}
					r = parts.join(' / ');
				}
				return r;
			},
			getDescendantIds(folderId) {
				let r;
				result: {
					if (!this.data || !Array.isArray(this.data.folders)) {
						r = new Set();
						break result;
					}
					const childrenMap = new Map();
					for (const f of this.data.folders) {
						const pid = f.parentId || null;
						if (!childrenMap.has(pid)) {
							childrenMap.set(pid, []);
						}
						childrenMap.get(pid).push(f.id);
					}
					const descendants = new Set();
					function collect(id) {
						const children = childrenMap.get(id) || [];
						for (const cid of children) {
							descendants.add(cid);
							collect(cid);
						}
					}
					collect(folderId);
					r = descendants;
				}
				return r;
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
			observer.disconnect();
			observer.observe(root, {childList: true, subtree: true});
			enhanceSidebarElements();
		};
		client.dispose = () => {
			lifetime.abort();
			observer.disconnect();
			if (enhanceFrame) {
				cancelAnimationFrame(enhanceFrame);
			}
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
			document.querySelectorAll('.btn-folder-options.is-active').forEach(b => b.classList.remove('is-active'));
		}
		// 2026-10-18 Dmitrii Fediuk https://github.com/dmitrii-fediuk
		// "Add folder-scoped project creation, 80%-height tree folder picker, multi-window UI injection (4th+ windows), and context-only action menus":
		// https://github.com/dmitry-ai/antigravity-addons/issues/8
		function folderPickerModel(selectedId, excludedIds = new Set()) {
			const folders = (client.data?.folders || []).filter(folder => !excludedIds.has(folder.id));
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
		function appendFolderTree(menu, {selectedId, excludedIds, onSelect}) {
			const {children, expanded} = folderPickerModel(selectedId, excludedIds);
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
		function positionContextMenu(menu) {
			const {x, y} = menu._folderAnchor;
			menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
			menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
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
								const parentHeader = document.querySelector(`[data-testid='section-header'][data-folder-id='${chosenParentId}']`);
								const toggleBtn = parentHeader?.querySelector('h2 button') || parentHeader?.querySelector('button');
								if (toggleBtn && 'false' === toggleBtn.getAttribute('aria-expanded')) {
									toggleBtn.click();
								}
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
		function showProjectContextMenu(e, projectCardEl, projectId, projectName) {
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
			if (window.__PROJECT_FOLDERS_VIEW__) {
				items.push({label: 'Open project', onClick: () => window.__PROJECT_FOLDERS_VIEW__.adapter.navigate({projectId})});
				items.push({label: 'New conversation', onClick: () => window.__PROJECT_FOLDERS_VIEW__.adapter.navigate({projectId})});
				// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
				// "Add Project settings action to project context menu in Folders":
				// https://github.com/dmitry-ai/antigravity-addons/issues/17
				items.push({label: 'Project settings…', onClick: () => window.__PROJECT_FOLDERS_VIEW__.adapter.openProjectSettings(projectId)});
				items.push({label: 'Rename project…', onClick: () => window.__PROJECT_FOLDERS_VIEW__.renameProject(projectId)});
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
			// "Integrate with universal dmitry-ai/harness, format codebase per P.md/P.ES6.md/P.Bash.md, and link source files to GitHub Issues":
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
		function extractFolderInfo(headerEl) {
			let r;
			result: {
				const title = headerEl.getAttribute('data-title') || '';
				if (!title.includes('📁')) {
					r = null;
					break result;
				}
				let fid = headerEl.getAttribute('data-folder-id');
				if (!fid) {
					const parentRow = headerEl.closest('[data-folder-id]');
					if (parentRow) {
						fid = parentRow.getAttribute('data-folder-id');
					}
				}
				if (!fid) {
					const cleanName = title.replace(/^📁\s*/, '').replace(/\s*\(\d+\)$/, '').trim();
					const match = client.data?.folders?.find(f => cleanName.toLowerCase() === f.name.toLowerCase());
					if (match) {
						fid = match.id;
					}
				}
				const cleanName = title.replace(/^📁\s*/, '').replace(/\s*\(\d+\)$/, '').trim();
				r = {folderId: fid, folderName: cleanName};
			}
			return r;
		}
		function extractProjectInfo(cardEl) {
			const labelSpan = cardEl.querySelector('span.truncate') || cardEl.querySelector('span');
			const label = labelSpan ? labelSpan.textContent.trim() : '';
			return {projectId: cardEl.getAttribute('data-project-id'), projectName: label};
		}
		// 2026-10-19 Dmitrii Fediuk https://github.com/dmitrii-fediuk
		// "Restore Folders compatibility with Antigravity 2.25.0 and analyze architectural resilience against renderer bundle changes":
		// https://github.com/dmitry-ai/antigravity-addons/issues/9
		function enhanceSidebarElements() {
			if (!lifetime.signal.aborted && (!window.__FOLDERS_STANDALONE__ || window.__PROJECT_FOLDERS_VIEW__?.root)) {
				const sidebarRoot = window.__PROJECT_FOLDERS_VIEW__?.root || document;
				const mainHeader = sidebarRoot.querySelector("[data-testid='section-header'][data-title='Projects'], [data-testid='section-header'][data-title='Workspaces'], [data-testid='section-header'][data-title*='Project']");
				if (mainHeader) {
					const actionsContainer = mainHeader.querySelector('.group\\/section-header > div:last-child') || mainHeader.querySelector('div:last-child');
					if (actionsContainer && !actionsContainer.querySelector('.btn-create-folder')) {
						const btn = document.createElement('button');
						btn.type = 'button';
						btn.className = 'btn-create-folder';
						btn.title = 'Create new folder (defaults to active folder)';
						btn.setAttribute('aria-label', 'Create new folder');
						btn.innerHTML = '📁<span style="font-size:10px;font-weight:bold;margin-left:1px;">+</span>';
						btn.addEventListener('click', e => {
							e.stopPropagation();
							showCreateFolderDialog();
						});
						actionsContainer.insertBefore(btn, actionsContainer.firstChild);
					}
					if (!mainHeader._foldersDragHooked) {
						mainHeader._foldersDragHooked = true;
						let mainDragCounter = 0;
						mainHeader.addEventListener('dragenter', e => {
							const isProjectDrag = hasDragType(e.dataTransfer, 'application/antigravity-project-id') || !!client.draggedProjectId;
							const isFolderDrag = hasDragType(e.dataTransfer, 'application/antigravity-folder-id') || !!client.draggedFolderId;
							if (isProjectDrag || isFolderDrag) {
								mainDragCounter++;
								mainHeader.classList.add('folder-drop-target');
							}
						});
						mainHeader.addEventListener('dragover', e => {
							let r;
							result: {
								const isProjectDrag = hasDragType(e.dataTransfer, 'application/antigravity-project-id') || !!client.draggedProjectId;
								const isFolderDrag = hasDragType(e.dataTransfer, 'application/antigravity-folder-id') || !!client.draggedFolderId;
								if (!isProjectDrag && !isFolderDrag) {
									r = undefined;
									break result;
								}
								const draggedFolderId = client.draggedFolderId || e.dataTransfer.getData('application/antigravity-folder-id');
								if (isFolderDrag && draggedFolderId) {
									const f = client.getFolder(draggedFolderId);
									if ((f && null === f.parentId) || null) {
										r = undefined;
										break result;
									}
									if (f) {
										const rootSiblings = (client.data?.folders || []).filter(item => null === item.parentId || null);
										if (rootSiblings.some(item => f.id !== item.id && f.name.toLowerCase() === item.name.toLowerCase())) {
											e.dataTransfer.dropEffect = 'none';
											r = undefined;
											break result;
										}
									}
								}
								e.preventDefault();
								e.stopPropagation();
								e.dataTransfer.dropEffect = 'move';
								mainHeader.classList.add('folder-drop-target');
							}
							return r;
						});
						mainHeader.addEventListener('dragleave', () => {
							mainDragCounter--;
							if (0 >= mainDragCounter) {
								mainDragCounter = 0;
								mainHeader.classList.remove('folder-drop-target');
							}
						});
						mainHeader.addEventListener('drop', e => {
							mainDragCounter = 0;
							mainHeader.classList.remove('folder-drop-target');
							e.preventDefault();
							e.stopPropagation();
							const projId = e.dataTransfer.getData('application/antigravity-project-id') || client.draggedProjectId;
							const folderId = e.dataTransfer.getData('application/antigravity-folder-id') || client.draggedFolderId;
							if (projId) {
								client.postAction('unassign-project', {projectId: projId});
							}
							else if (folderId) {
								client.postAction('move-folder', {id: folderId, newParentId: null});
							}
						});
					}
				}
				const folderHeaders = sidebarRoot.querySelectorAll("[data-testid='section-header'][data-title*='📁']");
				folderHeaders.forEach(headerEl => {
					const info = extractFolderInfo(headerEl);
					if (info && info.folderId) {
						headerEl.setAttribute('data-folder-id', info.folderId);
						const innerButton = headerEl.querySelector('h2 button') || headerEl.querySelector('button');
						if (!headerEl._foldersHoverHooked) {
							headerEl._foldersHoverHooked = true;
							headerEl.addEventListener('mouseenter', () => {
								client.hoveredFolderId = info.folderId;
								client.hoveredFolderEl = headerEl;
								client.lastHoveredFolderId = info.folderId;
								client.lastHoveredFolderTime = Date.now();
							});
							headerEl.addEventListener('mouseleave', () => {
								if (info.folderId === client.hoveredFolderId) {
									client.hoveredFolderId = null;
									client.hoveredFolderEl = null;
								}
							});
							headerEl.addEventListener('contextmenu', e => {
								showFolderContextMenu(e, headerEl, info.folderId, client.getFolder(info.folderId)?.name || info.folderName);
							});
						}
						if (!headerEl._foldersClickHooked) {
							headerEl._foldersClickHooked = true;
							headerEl.addEventListener('click', e => {
								if (client.isDragging) {
									e.preventDefault();
									e.stopPropagation();
								}
								else {
									client.lastActiveFolderId = info.folderId;
								}
							}, true);
						}
						let actionsContainer = headerEl.querySelector('.antigravity-folder-actions');
						if (!actionsContainer) {
							const innerHeader = headerEl.querySelector('.group\\/section-header') || headerEl;
							actionsContainer = document.createElement('div');
							actionsContainer.className = 'antigravity-folder-actions';
							innerHeader.appendChild(actionsContainer);
						}
						if (!actionsContainer.querySelector('.btn-folder-add')) {
							const addBtn = document.createElement('button');
							addBtn.type = 'button';
							addBtn.className = 'btn-folder-add';
							const currentFolderName = client.getFolder(info.folderId)?.name || info.folderName;
							addBtn.title = `Create subfolder in “${currentFolderName}”`;
							addBtn.setAttribute('aria-label', `Create subfolder in “${currentFolderName}”`);
							addBtn.innerHTML = '📁<span style="font-size:10px;font-weight:bold;margin-left:1px;">+</span>';
							addBtn.addEventListener('click', e => {
								e.stopPropagation();
								showCreateFolderDialog(null, info.folderId);
							});
							actionsContainer.appendChild(addBtn);
						}
						if (!actionsContainer.querySelector('.btn-folder-options')) {
							const optBtn = document.createElement('button');
							optBtn.type = 'button';
							optBtn.className = 'btn-folder-options';
							optBtn.title = 'Folder options (Subfolder, Move, Rename, Delete)';
							optBtn.setAttribute('aria-label', 'Folder options');
							optBtn.innerHTML = '⋯';
							optBtn.addEventListener('click', e => {
								e.stopPropagation();
								optBtn.classList.add('is-active');
								const rect = optBtn.getBoundingClientRect();
								showFolderContextMenu({
									clientX: rect.left,
									clientY: rect.bottom + 4,
									preventDefault: () => {},
									stopPropagation: () => {}
								}, headerEl, info.folderId, client.getFolder(info.folderId)?.name || info.folderName);
							});
							actionsContainer.appendChild(optBtn);
						}
						const handleFolderPointerDown = e => {
							let r;
							result: {
								if (e.altKey || 0 !== e.button) {
									r = undefined;
									break result;
								}
								if (e.target.closest('.btn-folder-options') || e.target.closest('.btn-folder-add') || e.target.closest('.folder-rename-input') || e.target.closest('input')) {
									r = undefined;
									break result;
								}
								e.stopPropagation();
							}
							return r;
						};
						if (!headerEl._foldersPointerHooked) {
							headerEl._foldersPointerHooked = true;
							headerEl.addEventListener('pointerdown', handleFolderPointerDown);
						}
						if (innerButton && !innerButton._foldersPointerHooked) {
							innerButton._foldersPointerHooked = true;
							innerButton.addEventListener('pointerdown', handleFolderPointerDown);
						}
						headerEl.setAttribute('draggable', 'true');
						if (innerButton) {
							innerButton.setAttribute('draggable', 'true');
						}
						const handleFolderDragStart = e => {
							let r;
							result: {
								if (e.target.closest('.btn-folder-options') || e.target.closest('.btn-folder-add') || e.target.closest('.folder-rename-input') || e.target.closest('input')) {
									e.preventDefault();
									r = undefined;
									break result;
								}
								if (e.altKey) {
									r = undefined;
									break result;
								}
								e.stopPropagation();
								client.isDragging = true;
								client.draggedFolderId = info.folderId;
								client.draggedProjectId = null;
								e.dataTransfer.setData('application/antigravity-folder-id', info.folderId);
								e.dataTransfer.setData('text/plain', info.folderId);
								e.dataTransfer.effectAllowed = 'move';
								headerEl.style.opacity = '0.5';
							}
							return r;
						};
						const handleFolderDragEnd = () => {
							headerEl.style.opacity = '';
							client.draggedFolderId = null;
							client.draggedProjectId = null;
							document.querySelectorAll('.folder-drop-target').forEach(el => el.classList.remove('folder-drop-target'));
							setTimeout(() => {
								client.isDragging = false;
							}, 100);
						};
						if (!headerEl._foldersDragStartHooked) {
							headerEl._foldersDragStartHooked = true;
							headerEl.addEventListener('dragstart', handleFolderDragStart);
							headerEl.addEventListener('dragend', handleFolderDragEnd);
						}
						if (innerButton && !innerButton._foldersDragStartHooked) {
							innerButton._foldersDragStartHooked = true;
							innerButton.addEventListener('dragstart', handleFolderDragStart);
							innerButton.addEventListener('dragend', handleFolderDragEnd);
						}
						if (!headerEl._foldersDropHooked) {
							headerEl._foldersDropHooked = true;
							headerEl._dragCounter = 0;
							headerEl.addEventListener('dragenter', e => {
								let r;
								result: {
									const isProjectDrag = hasDragType(e.dataTransfer, 'application/antigravity-project-id') || !!client.draggedProjectId;
									const isFolderDrag = hasDragType(e.dataTransfer, 'application/antigravity-folder-id') || !!client.draggedFolderId;
									if (!isProjectDrag && !isFolderDrag) {
										r = undefined;
										break result;
									}
									const draggedFolderId = client.draggedFolderId || e.dataTransfer.getData('application/antigravity-folder-id');
									if (isFolderDrag && draggedFolderId) {
										if (info.folderId === draggedFolderId) {
											r = undefined;
											break result;
										}
										const descendants = client.getDescendantIds(draggedFolderId);
										if (descendants.has(info.folderId)) {
											r = undefined;
											break result;
										}
										const df = client.getFolder(draggedFolderId);
										if (df && info.folderId === (df.parentId || null)) {
											r = undefined;
											break result;
										}
									}
									headerEl._dragCounter++;
									headerEl.classList.add('folder-drop-target');
								}
								return r;
							});
							headerEl.addEventListener('dragover', e => {
								let r;
								result: {
									const isProjectDrag = hasDragType(e.dataTransfer, 'application/antigravity-project-id') || !!client.draggedProjectId;
									const isFolderDrag = hasDragType(e.dataTransfer, 'application/antigravity-folder-id') || !!client.draggedFolderId;
									if (!isProjectDrag && !isFolderDrag) {
										r = undefined;
										break result;
									}
									const draggedFolderId = client.draggedFolderId || e.dataTransfer.getData('application/antigravity-folder-id');
									if (isFolderDrag && draggedFolderId) {
										if (info.folderId === draggedFolderId) {
											e.dataTransfer.dropEffect = 'none';
											r = undefined;
											break result;
										}
										const descendants = client.getDescendantIds(draggedFolderId);
										if (descendants.has(info.folderId)) {
											e.dataTransfer.dropEffect = 'none';
											r = undefined;
											break result;
										}
										const df = client.getFolder(draggedFolderId);
										if (df && info.folderId === (df.parentId || null)) {
											e.dataTransfer.dropEffect = 'none';
											r = undefined;
											break result;
										}
										if (df) {
											const targetSiblings = (client.data?.folders || []).filter(f => info.folderId === (f.parentId || null));
											if (targetSiblings.some(f => df.id !== f.id && df.name.toLowerCase() === f.name.toLowerCase())) {
												e.dataTransfer.dropEffect = 'none';
												r = undefined;
												break result;
											}
										}
									}
									e.preventDefault();
									e.stopPropagation();
									e.dataTransfer.dropEffect = 'move';
									headerEl.classList.add('folder-drop-target');
								}
								return r;
							});
							headerEl.addEventListener('dragleave', () => {
								headerEl._dragCounter--;
								if (0 >= headerEl._dragCounter) {
									headerEl._dragCounter = 0;
									headerEl.classList.remove('folder-drop-target');
								}
							});
							headerEl.addEventListener('drop', async e => {
								headerEl._dragCounter = 0;
								headerEl.classList.remove('folder-drop-target');
								e.preventDefault();
								e.stopPropagation();
								const projId = e.dataTransfer.getData('application/antigravity-project-id') || client.draggedProjectId;
								const draggedFolderId = e.dataTransfer.getData('application/antigravity-folder-id') || client.draggedFolderId;
								if (projId) {
									await client.postAction('assign-project', {projectId: projId, folderId: info.folderId});
								}
								else if (draggedFolderId && info.folderId !== draggedFolderId) {
									const descendants = client.getDescendantIds(draggedFolderId);
									if (!descendants.has(info.folderId)) {
										const res = await client.postAction('move-folder', {id: draggedFolderId, newParentId: info.folderId});
										if (res && res.success) {
											const toggleBtn = headerEl.querySelector('h2 button') || headerEl.querySelector('button');
											if (toggleBtn && 'false' === toggleBtn.getAttribute('aria-expanded')) {
												toggleBtn.click();
											}
										}
									}
								}
							});
						}
					}
				});
				const placeholders = sidebarRoot.querySelectorAll("[data-testid='empty-placeholder'], [data-group-id^='folder-']");
				placeholders.forEach(ph => {
					let r;
					result: {
						if (ph._foldersDropHooked) {
							r = undefined;
							break result;
						}
						const groupId = ph.getAttribute('data-group-id') || '';
						let targetFolderId = ph.getAttribute('data-folder-id');
						if (!targetFolderId && groupId.startsWith('folder-')) {
							targetFolderId = groupId.slice(7);
						}
						if (!targetFolderId) {
							r = undefined;
							break result;
						}
						ph._foldersDropHooked = true;
						ph.addEventListener('dragover', e => {
							let r;
							result: {
								const isProjectDrag = hasDragType(e.dataTransfer, 'application/antigravity-project-id') || !!client.draggedProjectId;
								const isFolderDrag = hasDragType(e.dataTransfer, 'application/antigravity-folder-id') || !!client.draggedFolderId;
								if (!isProjectDrag && !isFolderDrag) {
									r = undefined;
									break result;
								}
								const draggedFolderId = client.draggedFolderId || e.dataTransfer.getData('application/antigravity-folder-id');
								if (isFolderDrag && draggedFolderId) {
									if (targetFolderId === draggedFolderId) {
										r = undefined;
										break result;
									}
									const descendants = client.getDescendantIds(draggedFolderId);
									if (descendants.has(targetFolderId)) {
										r = undefined;
										break result;
									}
									const df = client.getFolder(draggedFolderId);
									if (df && targetFolderId === (df.parentId || null)) {
										r = undefined;
										break result;
									}
									if (df) {
										const targetSiblings = (client.data?.folders || []).filter(f => targetFolderId === (f.parentId || null));
										if (targetSiblings.some(f => df.id !== f.id && df.name.toLowerCase() === f.name.toLowerCase())) {
											r = undefined;
											break result;
										}
									}
								}
								e.preventDefault();
								e.stopPropagation();
								e.dataTransfer.dropEffect = 'move';
								ph.classList.add('folder-drop-target');
							}
							return r;
						});
						ph.addEventListener('dragleave', () => {
							ph.classList.remove('folder-drop-target');
						});
						ph.addEventListener('drop', async e => {
							ph.classList.remove('folder-drop-target');
							e.preventDefault();
							e.stopPropagation();
							const projId = e.dataTransfer.getData('application/antigravity-project-id') || client.draggedProjectId;
							const draggedFolderId = e.dataTransfer.getData('application/antigravity-folder-id') || client.draggedFolderId;
							if (projId) {
								await client.postAction('assign-project', {projectId: projId, folderId: targetFolderId});
							}
							else if (draggedFolderId && targetFolderId !== draggedFolderId) {
								const descendants = client.getDescendantIds(draggedFolderId);
								if (!descendants.has(targetFolderId)) {
									const df = client.getFolder(draggedFolderId);
									if (df && targetFolderId !== (df.parentId || null)) {
										const targetSiblings = (client.data?.folders || []).filter(f => targetFolderId === (f.parentId || null));
										if (!targetSiblings.some(f => df.id !== f.id && df.name.toLowerCase() === f.name.toLowerCase())) {
											await client.postAction('move-folder', {id: draggedFolderId, newParentId: targetFolderId});
										}
									}
								}
							}
						});
					}
					return r;
				});
				const projectCards = sidebarRoot.querySelectorAll('button[data-project-card]');
				projectCards.forEach(card => {
					let r;
					result: {
						if (card._foldersProjectHooked) {
							r = undefined;
							break result;
						}
						const info = extractProjectInfo(card);
						if (!info.projectId) {
							r = undefined;
							break result;
						}
						card._foldersProjectHooked = true;
						card.addEventListener('pointerdown', e => {
							if (!e.altKey && 0 === e.button) {
								e.stopPropagation();
							}
						});
						card.addEventListener('dragstart', e => {
							if (e.altKey) {
								e.preventDefault();
							}
						});
						card.setAttribute('draggable', 'true');
						card.addEventListener('dragstart', e => {
							const curInfo = extractProjectInfo(card);
							client.isDragging = true;
							client.draggedProjectId = curInfo.projectId;
							client.draggedFolderId = null;
							e.dataTransfer.setData('application/antigravity-project-id', curInfo.projectId);
							e.dataTransfer.setData('text/plain', curInfo.projectId);
							e.dataTransfer.effectAllowed = 'move';
							card.style.opacity = '0.5';
						});
						card.addEventListener('dragend', () => {
							card.style.opacity = '';
							client.draggedProjectId = null;
							client.draggedFolderId = null;
							document.querySelectorAll('.folder-drop-target').forEach(el => el.classList.remove('folder-drop-target'));
							setTimeout(() => {
								client.isDragging = false;
							}, 100);
						});
						card.addEventListener('click', () => {
							const curInfo = extractProjectInfo(card);
							if (curInfo.projectId) {
								client.lastActiveProjectId = curInfo.projectId;
								client.lastActiveFolderId = client.getProjectFolderId(curInfo.projectId);
							}
						});
						card.addEventListener('contextmenu', e => {
							const curInfo = extractProjectInfo(card);
							showProjectContextMenu(e, card, curInfo.projectId, curInfo.projectName);
						});
					}
					return r;
				});
				const convoRows = sidebarRoot.querySelectorAll("[data-testid^='conversation-row-']");
				convoRows.forEach(row => {
					if (!row._foldersConvoHooked) {
						row._foldersConvoHooked = true;
						row.addEventListener('click', () => {
							const pid = row.closest('[data-group-id]')?.getAttribute('data-group-id');
							if (pid) {
								client.lastActiveProjectId = pid;
								client.lastActiveFolderId = client.getProjectFolderId(pid);
							}
						});
					}
				});
			}
		}
		let enhanceFrame = null;
		const observer = new MutationObserver(() => {
			if (!enhanceFrame) {
				enhanceFrame = requestAnimationFrame(() => {
					enhanceFrame = null;
					enhanceSidebarElements();
				});
			}
		});
		if (!window.__FOLDERS_STANDALONE__) {
			observer.observe(document.documentElement, {childList: true, subtree: true});
		}
		if ('loading' === document.readyState) {
			document.addEventListener('DOMContentLoaded', enhanceSidebarElements, {once: true, signal: lifetime.signal});
		}
		else {
			enhanceSidebarElements();
		}
		console.log('[folders-client] Hierarchical Project Folders UI Controller successfully loaded and active.');
	}
	return r;
})();
