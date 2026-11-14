// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Extract FolderMenuController and FolderDialogController ES6 classes from FoldersView in Folders/folders-client.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/39
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decompose Folders/folders-client.js into FolderStorageClient, FolderTreeRenderer, and folder-drag.js, narrow MutationObserver, and stop idle polling":
// https://github.com/dmitry-ai/antigravity-addons/issues/46
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders module loader, tree indexer, declarative DOM helper, and CAS store/CLI wrappers":
// https://github.com/dmitry-ai/antigravity-addons/issues/44
const defaultModel = require('./folders-model');
class FolderMenuController {
	constructor(view) {
		this.view = view;
		this.activeMenu = null;
	}
	appendFolderTree(menu, {selectedId, excludedIds, onSelect}) {
		const {children, expanded} = folderPickerModel(this.view.data?.folders, selectedId, excludedIds, this.view.model);
		const tree = this.view.element('div', 'antigravity-folder-targets', undefined, {attrs: {role: 'tree', 'aria-label': 'Folders'}});
		const render = (focusId = null) => {
			tree.replaceChildren();
			const rows = new Map();
			const visit = (parentId, depth, seen = new Set()) => {
				for (const folder of children.get(parentId) || []) {
					if (!seen.has(folder.id)) {
						const branch = new Set(seen).add(folder.id);
						const row = this.createFolderTreeRow({folder, depth, hasChildren: !!children.get(folder.id)?.length, selectedId, expanded, rows, tree, onSelect, render});
						rows.set(folder.id, row);
						tree.append(row);
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
		menu.append(tree);
	}
	close() {
		this.activeMenu?.remove();
		this.activeMenu = null;
	}
	createFolderTreeRow({folder, depth, hasChildren, selectedId, expanded, rows, tree, onSelect, render}) {
		const isExpanded = expanded.has(folder.id);
		const toggle = this.view.element(hasChildren ? 'button' : 'span', 'antigravity-folder-target-toggle', hasChildren ? (isExpanded ? '▾' : '▸') : undefined, hasChildren ? {
			attrs: {'aria-label': `${isExpanded ? 'Collapse' : 'Expand'} ${folder.name}`},
			on: {click: e => (e.stopPropagation(), expanded.has(folder.id) ? expanded.delete(folder.id) : expanded.add(folder.id), render(folder.id))},
			props: {tabIndex: -1, type: 'button'}
		} : undefined);
		const icon = this.view.element('span', 'antigravity-folder-target-icon', undefined, {attrs: {'aria-hidden': 'true'}, html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11H3Z"/></svg>'});
		const row = this.view.element('div', 'antigravity-folder-target', undefined, {
			attrs: {role: 'treeitem', 'aria-level': depth + 1, 'aria-selected': selectedId === folder.id, ...(hasChildren ? {'aria-expanded': isExpanded} : {})},
			children: [toggle, icon, this.view.element('span', 'antigravity-folder-target-label', folder.name), this.view.element('span', 'antigravity-folder-target-check', selectedId === folder.id ? '✓' : '')],
			dataset: {folderTarget: folder.id},
			on: {
				click: e => (e.stopPropagation(), this.close(), selectedId !== folder.id && onSelect(folder.id)),
				keydown: e => this.handleTreeRowKeydown(e, {row, folder, hasChildren, expanded, rows, tree, render})
			},
			props: {tabIndex: -1, title: this.view.model.getFolderPath(folder.id, this.view.data?.folders)},
			style: {paddingInlineStart: `${4 + depth * 14}px`}
		});
		return row;
	}
	createMenuItemRow(menu, item, hasTree) {
		const row = this.view.element('div', `antigravity-folder-menu-item ${item.danger ? 'danger' : ''}`, undefined, {
			attrs: {tabindex: '0', role: hasTree ? 'button' : 'menuitem'},
			children: [
				this.view.element('span', '', `${item.icon || ''} ${item.label}`, {style: {cssText: 'display:flex;align-items:center;gap:6px;'}}),
				...(item.shortcut ? [this.view.element('span', 'antigravity-folder-menu-shortcut', item.shortcut)] : [])
			],
			on: {
				click: e => (e.stopPropagation(), this.close(), item.onClick?.()),
				keydown: e => {
					if ('Enter' === e.key || ' ' === e.key) {
						e.preventDefault();
						row.click();
					}
					else if ('ArrowDown' === e.key || 'ArrowUp' === e.key) {
						e.preventDefault();
						const list = Array.from(menu.querySelectorAll('[role=treeitem], [role=menuitem], [role=button]'));
						list[(list.indexOf(row) + ('ArrowDown' === e.key ? 1 : -1) + list.length) % list.length]?.focus();
					}
				}
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
			const navTargets = {ArrowDown: visible[index + 1], ArrowUp: visible[index - 1], Home: visible[0], End: visible.at(-1)};
			let handled = e.key in navTargets;
			let target = navTargets[e.key];
			if (!handled && 'ArrowRight' === e.key && hasChildren) {
				handled = true;
				expanded.has(folder.id) ? (target = visible[index + 1]) : (expanded.add(folder.id), render(folder.id));
			}
			else if (!handled && 'ArrowLeft' === e.key) {
				handled = true;
				!expanded.has(folder.id) || !hasChildren ? (target = rows.get(folder.parentId)) : (expanded.delete(folder.id), render(folder.id));
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
			{icon: '↗️', label: 'Move folder…', onClick: () => {
				const rect = folderHeaderEl.getBoundingClientRect();
				this.openMoveFolderMenu({clientX: rect.left + 20, clientY: rect.bottom + 4}, folderId);
			}},
			{icon: '✏️', label: 'Rename folder', shortcut: 'F2', onClick: () => this.view.dialogs.openRenameFolder(folderId)},
			{icon: '➕', label: 'Create new root folder', onClick: () => this.view.dialogs.openCreateFolder(null, null)},
			{separator: true},
			{icon: '🗑️', label: 'Delete folder', danger: true, onClick: () => this.view.win.confirm(`Delete folder "${folderName}"? (Subfolders and projects will be promoted one level up)`) && this.view.postAction('remove-folder', {id: folderId})}
		]);
	}
	openMoveFolderMenu(coords, folderId) {
		const folder = this.view.getFolder(folderId);
		if (folder) {
			const excludedIds = this.view.model.getDescendantIds(folderId, this.view.data?.folders).add(folderId);
			const isRoot = null === folder.parentId;
			this.show(coords.clientX, coords.clientY, [
				{folderTree: {selectedId: folder.parentId, excludedIds, onSelect: newParentId => this.view.postAction('move-folder', {id: folderId, newParentId})}},
				{separator: true},
				{icon: isRoot ? '✓' : '↥', label: 'To top level', onClick: () => !isRoot && this.view.postAction('move-folder', {id: folderId, newParentId: null})}
			], 'Move folder');
		}
	}
	openProjectMenu(e, projectId) {
		openProjectContextMenu(e, projectId, {showContextMenu: (...args) => this.show(...args), showCreateFolderDialog: id => this.view.dialogs.openCreateFolder(id), view: this.view, win: this.view.win});
	}
	position(menu) {
		positionContextMenu(menu, this.view.win);
	}
	show(x, y, items, title = '') {
		this.close();
		const hasTree = items.some(item => item.folderTree);
		const menu = this.view.element('div', `antigravity-folder-menu${hasTree ? ' antigravity-folder-picker' : ''}`, undefined, {
			attrs: {role: hasTree ? 'dialog' : 'menu', ...(title ? {'aria-label': title} : {})},
			children: title ? [this.view.element('div', 'antigravity-folder-menu-title', title)] : [],
			props: {_folderAnchor: {x, y}}
		});
		for (const item of items) {
			item.folderTree
				? this.appendFolderTree(menu, item.folderTree)
				: menu.append(item.separator ? this.view.element('div', 'antigravity-folder-menu-separator') : this.createMenuItemRow(menu, item, hasTree));
		}
		this.view.doc.body.append(menu);
		this.activeMenu = menu;
		this.position(menu);
		const focus = menu.querySelector('[role=treeitem][aria-selected=true]') || menu.querySelector('[role=treeitem], [role=menuitem], [role=button]');
		focus?.focus({preventScroll: true});
		if (hasTree) {
			focus?.scrollIntoView({block: 'nearest'});
		}
	}
}
const folderPickerModel = (foldersSource, selectedId, excludedIds = new Set(), model = defaultModel) => {
	const raw = Array.isArray(foldersSource) ? foldersSource : foldersSource?.data?.folders || foldersSource?.folders || [];
	const {byId, children} = (model?.indexTree || defaultModel.indexTree)(raw, {compare: model?.compare, excludedIds, sort: true});
	const expanded = new Set();
	for (let folder = byId.get(selectedId); folder && !expanded.has(folder.id); folder = byId.get(folder.parentId)) {
		expanded.add(folder.id);
	}
	return {byId, children, expanded};
};
const openProjectContextMenu = (e, projectId, {showContextMenu, showCreateFolderDialog, view, win = 'undefined' !== typeof window ? window : undefined} = {}) => {
	e.preventDefault();
	e.stopPropagation();
	const activeView = view || win?.__PROJECT_FOLDERS_VIEW__;
	const currentFolderId = activeView.getProjectFolderId(projectId);
	const items = [{folderTree: {selectedId: currentFolderId, onSelect: folderId => activeView.postAction('assign-project', {projectId, folderId})}}, {separator: true}];
	if (activeView?.adapter) {
		items.push(
			{label: 'Open project', onClick: () => activeView.adapter.navigate({projectId})},
			{label: 'New conversation', onClick: () => activeView.adapter.navigate({projectId})},
			{label: 'Project settings…', onClick: () => activeView.adapter.openProjectSettings(projectId)},
			{label: 'Rename project…', onClick: () => activeView.dialogs.openRenameProject(projectId)},
			{separator: true}
		);
	}
	items.push({icon: '➕', label: 'Create folder…', onClick: () => (showCreateFolderDialog || (id => activeView.dialogs.openCreateFolder(id)))(projectId)});
	if (currentFolderId) {
		items.push({icon: '↥', label: 'Remove from folder', onClick: () => activeView.postAction('unassign-project', {projectId})});
	}
	(showContextMenu || ((...args) => activeView.menus.show(...args)))(e.clientX, e.clientY, items, 'Move project');
};
const positionContextMenu = (menu, viewport = window) => {
	const {x, y} = menu._folderAnchor;
	menu.style.left = `${Math.max(8, Math.min(x, viewport.innerWidth - menu.offsetWidth - 8))}px`;
	menu.style.top = `${Math.max(8, Math.min(y, viewport.innerHeight - menu.offsetHeight - 8))}px`;
};
module.exports = {FolderMenuController, folderPickerModel, openProjectContextMenu, positionContextMenu};
