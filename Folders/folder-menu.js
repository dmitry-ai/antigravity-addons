// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Extract FolderMenuController and FolderDialogController ES6 classes from FoldersView in Folders/folders-client.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/39
(factory => {
	const api = factory();
	if ('object' === typeof module && module.exports) {
		module.exports = api;
	}
	if ('undefined' !== typeof window) {
		window.AntigravityFolderMenu = api;
	}
})(() => {
	const defaultModel = 'undefined' !== typeof window && window.AntigravityFoldersModel
		? window.AntigravityFoldersModel
		: 'object' === typeof module && module.exports
			? require('./folders-model')
			: null;
	const folderPickerModel = (foldersSource, selectedId, excludedIds = new Set(), model = defaultModel) => {
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
			siblings.sort(model.compare);
		}
		const expanded = new Set();
		let folder = byId.get(selectedId);
		while (folder && !expanded.has(folder.id)) {
			expanded.add(folder.id);
			folder = byId.get(folder.parentId);
		}
		return {byId, children, expanded};
	};
	const openProjectContextMenu = (e, projectId, {showContextMenu, showCreateFolderDialog, view, win = 'undefined' !== typeof window ? window : undefined} = {}) => {
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
			items.push({label: 'Project settings…', onClick: () => activeView.adapter.openProjectSettings(projectId)});
			items.push({label: 'Rename project…', onClick: () => (activeView.dialogs ? activeView.dialogs.openRenameProject(projectId) : activeView.renameProject(projectId))});
			items.push({separator: true});
		}
		items.push({
			icon: '➕',
			label: 'Create folder…',
			onClick: () => (showCreateFolderDialog || (id => activeView.dialogs ? activeView.dialogs.openCreateFolder(id) : activeView.showCreateFolderDialog(id)))(projectId)
		});
		if (currentFolderId) {
			items.push({
				icon: '↥',
				label: 'Remove from folder',
				onClick: () => activeView.postAction('unassign-project', {projectId})
			});
		}
		(showContextMenu || ((...args) => activeView.menus ? activeView.menus.show(...args) : activeView.showContextMenu(...args)))(e.clientX, e.clientY, items, 'Move project');
	};
	const positionContextMenu = (menu, viewport = window) => {
		const {x, y} = menu._folderAnchor;
		menu.style.left = `${Math.max(8, Math.min(x, viewport.innerWidth - menu.offsetWidth - 8))}px`;
		menu.style.top = `${Math.max(8, Math.min(y, viewport.innerHeight - menu.offsetHeight - 8))}px`;
	};
	class FolderMenuController {
		constructor(view) {
			this.view = view;
			this.activeMenu = null;
		}
		appendFolderTree(menu, {selectedId, excludedIds, onSelect}) {
			const {children, expanded} = folderPickerModel(this.view.data?.folders, selectedId, excludedIds, this.view.model);
			const tree = this.view.element('div', 'antigravity-folder-targets');
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
					this.position(menu);
				}
			};
			render();
			menu.appendChild(tree);
		}
		close() {
			this.activeMenu?.remove();
			this.activeMenu = null;
		}
		createFolderTreeRow({folder, depth, hasChildren, selectedId, expanded, rows, tree, onSelect, render}) {
			const row = this.view.element('div', 'antigravity-folder-target');
			row.dataset.folderTarget = folder.id;
			row.setAttribute('role', 'treeitem');
			row.setAttribute('aria-level', depth + 1);
			row.setAttribute('aria-selected', selectedId === folder.id);
			if (hasChildren) {
				row.setAttribute('aria-expanded', expanded.has(folder.id));
			}
			row.tabIndex = -1;
			row.style.paddingInlineStart = `${4 + depth * 14}px`;
			row.title = this.view.model.getFolderPath(folder.id, this.view.data?.folders);
			const toggle = this.view.element(hasChildren ? 'button' : 'span', 'antigravity-folder-target-toggle');
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
			const icon = this.view.element('span', 'antigravity-folder-target-icon');
			icon.setAttribute('aria-hidden', 'true');
			icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11H3Z"/></svg>';
			const label = this.view.element('span', 'antigravity-folder-target-label', folder.name);
			const check = this.view.element('span', 'antigravity-folder-target-check', selectedId === folder.id ? '✓' : '');
			row.append(toggle, icon, label, check);
			row.addEventListener('click', e => {
				e.stopPropagation();
				this.close();
				if (selectedId !== folder.id) {
					onSelect(folder.id);
				}
			});
			row.addEventListener('keydown', e => this.handleTreeRowKeydown(e, {row, folder, hasChildren, expanded, rows, tree, render}));
			return row;
		}
		createMenuItemRow(menu, item, hasTree) {
			const row = this.view.element('div', `antigravity-folder-menu-item ${item.danger ? 'danger' : ''}`);
			row.setAttribute('tabindex', '0');
			row.setAttribute('role', hasTree ? 'button' : 'menuitem');
			const labelSpan = this.view.element('span', '', `${item.icon || ''} ${item.label}`);
			labelSpan.style.cssText = 'display:flex;align-items:center;gap:6px;';
			row.appendChild(labelSpan);
			if (item.shortcut) {
				row.appendChild(this.view.element('span', 'antigravity-folder-menu-shortcut', item.shortcut));
			}
			row.addEventListener('click', e => {
				e.stopPropagation();
				this.close();
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
		openConversationMenu(event, row) {
			event.preventDefault();
			event.stopPropagation();
			this.show(event.clientX, event.clientY, [
				{label: 'Open conversation', onClick: () => this.view.adapter.navigate({projectId: row.projectId, conversationId: row.id})},
				{label: 'Rename…', onClick: () => this.view.dialogs.openText('Conversation title', this.view.model.summaryName(this.view.state.summaries.get(row.id) || row.summary), value => this.view.adapter.updateConversation(row.id, {title: value}))},
				{label: row.summary.annotations?.pinned ? 'Unpin' : 'Pin', onClick: () => this.view.adapter.updateConversation(row.id, {pinned: !row.summary.annotations?.pinned}).catch(error => this.view.updateStatus('action', error.message))},
				{label: 'Archive', onClick: () => this.view.adapter.updateConversation(row.id, {archived: true, archivalStatusTimestamp: new Date().toISOString()}).catch(error => this.view.updateStatus('action', error.message))}
			], 'Conversation');
		}
		openFolderMenu(e, folderHeaderEl, folderId, folderName) {
			e.preventDefault();
			e.stopPropagation();
			this.show(e.clientX, e.clientY, [
				{icon: '➕', label: 'Create project in this folder…', onClick: () => this.view.dialogs.openCreateProject(folderId)},
				{icon: '📁➕', label: 'Create subfolder…', onClick: () => this.view.dialogs.openCreateFolder(null, folderId)},
				{
					icon: '↗️',
					label: 'Move folder…',
					onClick: () => {
						const rect = folderHeaderEl.getBoundingClientRect();
						this.openMoveFolderMenu({clientX: rect.left + 20, clientY: rect.bottom + 4}, folderId);
					}
				},
				{icon: '✏️', label: 'Rename folder', shortcut: 'F2', onClick: () => this.view.dialogs.openRenameFolder(folderId)},
				{icon: '➕', label: 'Create new root folder', onClick: () => this.view.dialogs.openCreateFolder(null, null)},
				{separator: true},
				{
					icon: '🗑️',
					label: 'Delete folder',
					danger: true,
					onClick: () => {
						if (this.view.win.confirm(`Delete folder "${folderName}"? (Subfolders and projects will be promoted one level up)`)) {
							this.view.postAction('remove-folder', {id: folderId});
						}
					}
				}
			]);
		}
		openMoveFolderMenu(coords, folderId) {
			const folder = this.view.getFolder(folderId);
			if (folder) {
				const excludedIds = this.view.model.getDescendantIds(folderId, this.view.data?.folders);
				excludedIds.add(folderId);
				const isRoot = null === folder.parentId;
				this.show(coords.clientX, coords.clientY, [
					{
						folderTree: {
							selectedId: folder.parentId,
							excludedIds,
							onSelect: newParentId => this.view.postAction('move-folder', {id: folderId, newParentId})
						}
					},
					{separator: true},
					{
						icon: isRoot ? '✓' : '↥',
						label: 'To top level',
						onClick: () => {
							if (!isRoot) {
								this.view.postAction('move-folder', {id: folderId, newParentId: null});
							}
						}
					}
				], 'Move folder');
			}
		}
		openProjectMenu(e, projectId) {
			openProjectContextMenu(e, projectId, {
				showContextMenu: (...args) => this.show(...args),
				showCreateFolderDialog: id => this.view.dialogs.openCreateFolder(id),
				view: this.view,
				win: this.view.win
			});
		}
		position(menu) {
			positionContextMenu(menu, this.view.win);
		}
		show(x, y, items, title = '') {
			this.close();
			const hasTree = items.some(item => item.folderTree);
			const menu = this.view.element('div', `antigravity-folder-menu${hasTree ? ' antigravity-folder-picker' : ''}`);
			menu._folderAnchor = {x, y};
			menu.setAttribute('role', hasTree ? 'dialog' : 'menu');
			if (title) {
				menu.setAttribute('aria-label', title);
				menu.appendChild(this.view.element('div', 'antigravity-folder-menu-title', title));
			}
			for (const item of items) {
				if (item.folderTree) {
					this.appendFolderTree(menu, item.folderTree);
				}
				else if (item.separator) {
					menu.appendChild(this.view.element('div', 'antigravity-folder-menu-separator'));
				}
				else {
					menu.appendChild(this.createMenuItemRow(menu, item, hasTree));
				}
			}
			this.view.doc.body.appendChild(menu);
			this.activeMenu = menu;
			this.position(menu);
			const focus = menu.querySelector('[role=treeitem][aria-selected=true]') || menu.querySelector('[role=treeitem], [role=menuitem], [role=button]');
			focus?.focus({preventScroll: true});
			if (hasTree) {
				focus?.scrollIntoView({block: 'nearest'});
			}
		}
	}
	return {FolderMenuController, folderPickerModel, openProjectContextMenu, positionContextMenu};
});
