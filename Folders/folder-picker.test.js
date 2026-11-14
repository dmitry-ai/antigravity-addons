// 2026-10-18 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Add folder-scoped project creation, 80%-height tree folder picker, multi-window UI injection (4th+ windows), and context-only action menus":
// https://github.com/dmitry-ai/antigravity-addons/issues/8
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
// "Unify Folders domain validation, tree traversal helpers, store checks, and CLI listing/mutations around folders-model.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/31
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Extract FolderMenuController and FolderDialogController ES6 classes from FoldersView in Folders/folders-client.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/39
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decompose Folders/folders-client.js into FolderStorageClient, FolderTreeRenderer, and folder-drag.js, narrow MutationObserver, and stop idle polling":
// https://github.com/dmitry-ai/antigravity-addons/issues/46
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Unify temporary directory fixtures and CDP/Electron/Connect-RPC test mocks across Upgrade, Multi-Account, and Folders":
// https://github.com/dmitry-ai/antigravity-addons/issues/37
const test = require('node:test');
const assert = require('node:assert/strict');
const {createMockDocument} = require('../Upgrade/test-helpers');
const {FolderDialogController} = require('./folder-dialogs');
const {SidebarDragController, hasDragType} = require('./folder-drag');
const {FolderMenuController, folderPickerModel, openProjectContextMenu, positionContextMenu} = require('./folder-menu');
const clientExports = require('./folders-client');
const {FolderStorageClient, FolderTreeRenderer, FoldersView} = clientExports;
const folders = [
	{id: 'root', name: 'Work', parentId: null},
	{id: 'initial', name: 'Initial', parentId: 'root'},
	{id: 'year', name: '2026', parentId: 'initial'},
	{id: 'month', name: '10', parentId: 'year'},
	{id: 'proposals', name: 'Proposals', parentId: 'root'},
	{id: 'ten', name: '10', parentId: 'proposals'},
	{id: 'two', name: '2', parentId: 'proposals'}
];
const modelFor = (selectedId, excludedIds) => folderPickerModel(folders, selectedId, excludedIds);
test('picker expands the current branch and leaves unrelated branches collapsed', () => {
	const model = modelFor('month');
	assert.deepEqual([...model.expanded], ['month', 'year', 'initial', 'root']);
	assert.equal(model.expanded.has('proposals'), false);
	assert.deepEqual(model.children.get('proposals').map(folder => folder.id), ['two', 'ten']);
});
test('folder move excludes itself and descendants without losing the current parent', () => {
	const model = modelFor('root', new Set(['initial', 'year', 'month']));
	assert.equal(model.byId.has('initial'), false);
	assert.equal(model.byId.has('month'), false);
	assert.equal(model.byId.has('root'), true);
	assert.deepEqual(model.children.get('root').map(folder => folder.id), ['proposals']);
});
test('project picker sends exact target IDs and keeps the current folder separate', () => {
	const actions = [];
	let items;
	let title;
	const view = {getProjectFolderId: () => 'month', postAction: (...args) => actions.push(args)};
	openProjectContextMenu(
		{preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1},
		'project-id',
		{
			showContextMenu: (_x, _y, value, label) => {
				items = value;
				title = label;
			},
			showCreateFolderDialog: () => {},
			view,
			win: {}
		}
	);
	assert.equal(title, 'Move project');
	assert.equal(items[0].folderTree.selectedId, 'month');
	assert.equal(actions.length, 0, 'Opening a picker changes no assignments');
	items[0].folderTree.onSelect('ten');
	assert.deepEqual(actions, [['assign-project', {projectId: 'project-id', folderId: 'ten'}]]);
	assert.equal(items.some(item => /Into folder/.test(item.label ?? '')), false, 'No repeated path labels');
	// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
	// "Add Project settings action to project context menu in Folders":
	// https://github.com/dmitry-ai/antigravity-addons/issues/17
	const openedSettings = [];
	const renamedProjects = [];
	openProjectContextMenu(
		{preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1},
		'project-id',
		{
			showContextMenu: (_x, _y, value) => {
				items = value;
			},
			showCreateFolderDialog: () => {},
			view: {
				...view,
				adapter: {
					navigate() {},
					openProjectSettings: id => openedSettings.push(id)
				},
				dialogs: {
					openRenameProject: id => renamedProjects.push(id)
				}
			},
			win: {}
		}
	);
	const settingsItem = items.find(item => 'Project settings…' === item.label);
	assert.ok(settingsItem);
	settingsItem.onClick();
	assert.deepEqual(openedSettings, ['project-id']);
	items.find(item => 'Rename project…' === item.label).onClick();
	assert.deepEqual(renamedProjects, ['project-id']);
});
test('growing a menu near the lower-right corner keeps it inside the viewport', () => {
	const menu = {_folderAnchor: {x: 299, y: 461}, offsetWidth: 250, offsetHeight: 230, style: {}};
	const viewport = {innerWidth: 300, innerHeight: 462};
	positionContextMenu(menu, viewport);
	assert.equal(menu.style.left, '42px');
	assert.equal(menu.style.top, '224px');
	menu.offsetHeight = 350;
	positionContextMenu(menu, viewport);
	assert.equal(menu.style.top, '104px', 'Expanded tree must move up, rather than leave the window');
});
test('SidebarDragController validates cycle drops, sibling collisions, and valid folder/project drops', () => {
	const view = new FoldersView({__PROJECT_FOLDERS_DATA__: {folders, projectFolderMap: {p1: 'proposals'}}});
	const drag = new SidebarDragController(view);
	view.draggedFolderId = 'initial';
	assert.deepEqual(drag.canDropOnTarget({}, 'year'), {allowed: false, blocked: true});
	assert.deepEqual(drag.canDropOnTarget({}, 'root'), {allowed: false, blocked: true});
	assert.deepEqual(drag.canDropOnTarget({}, 'proposals'), {allowed: true, blocked: false});
	view.draggedFolderId = 'ten';
	assert.deepEqual(drag.canDropOnTarget({}, 'year'), {allowed: false, blocked: true});
	view.draggedFolderId = null;
	view.draggedProjectId = 'p1';
	assert.deepEqual(drag.canDropOnTarget({}, 'year'), {allowed: true, blocked: false});
	view.dispose();
});
test('FoldersView detectCurrentFolderId resolves hover, active conversation selection, and remembered selection in priority order', async () => {
	const summaries = new Map([['c-active', {trajectoryMetadata: {projectId: 'p2'}}]]);
	let currentSelection = {projectId: null, conversationId: 'c-active'};
	const view = new FoldersView({
		__PROJECT_FOLDERS_DATA__: {folders, projectFolderMap: {p1: 'proposals', p2: 'year'}},
		__PROJECT_FOLDERS_VIEW__: {
			adapter: {selection: () => currentSelection},
			state: {summaries},
			reportAction() {}
		}
	});
	view.lastActiveProjectId = 'p1';
	assert.equal(view.detectCurrentFolderId(), 'year');
	currentSelection = {projectId: null, conversationId: null};
	assert.equal(view.detectCurrentFolderId(), 'proposals');
	view.lastActiveFolderId = 'two';
	assert.equal(view.detectCurrentFolderId(), 'two');
	view.hoveredFolderId = 'month';
	assert.equal(view.detectCurrentFolderId(), 'month');
	const res = await view.postAction('add-folder', {name: 'NoBridge'});
	assert.equal(res.success, false);
	assert.match(res.error, /Folder storage bridge is unavailable/);
	view.dispose();
});
test('FolderMenuController and FolderDialogController manage menu ARIA navigation, modal lifecycle, and FoldersView proxy getters in Node', async () => {
	const doc = createMockDocument();
	const posted = [];
	const win = {
		innerWidth: 640,
		innerHeight: 480,
		__PROJECT_FOLDERS_DATA__: {folders, projectFolderMap: {p1: 'proposals'}},
		__ANTIGRAVITY_TOOLS_REQUEST__: async (_tool, message) => {
			posted.push(message.body);
			return {
				success: true,
				revision: 'rev-2',
				data: {
					folders: [...folders, {id: 'created', name: message.body.name || 'Sub', parentId: message.body.parentId || null}],
					projectFolderMap: {p1: 'proposals'}
				}
			};
		}
	};
	const view = new FoldersView(win, {document: doc, adapter: {dispose() {}, selection: () => ({})}});
	assert.ok(view.menus instanceof FolderMenuController);
	assert.ok(view.dialogs instanceof FolderDialogController);
	assert.equal(view.activeMenu, null);
	assert.equal(view.activeModal, null);
	let picked = null;
	view.menus.show(120, 80, [{folderTree: {selectedId: 'proposals', onSelect: id => {
		picked = id;
	}}}], 'Move project');
	assert.equal(view.activeMenu, view.menus.activeMenu);
	const itemsBefore = view.activeMenu.querySelectorAll('treeitem');
	const proposalsRow = itemsBefore.find(el => 'proposals' === el.dataset.folderTarget);
	proposalsRow.dispatch('keydown', {key: 'ArrowRight'});
	const twoRow = view.activeMenu.querySelectorAll('treeitem').find(el => 'two' === el.dataset.folderTarget);
	assert.ok(twoRow);
	twoRow.dispatch('keydown', {key: 'Enter'});
	assert.equal(picked, 'two');
	assert.equal(view.activeMenu, null);
	view.dialogs.openCreateFolder('p1');
	assert.equal(view.activeModal, view.dialogs.activeModal);
	const form = view.activeModal.children[0];
	const nameInput = form.children.find(el => 'folder-name-input' === el.className);
	nameInput.value = 'Archive';
	form.dispatch('submit');
	await new Promise(resolve => setImmediate(resolve));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(posted[0].action, 'add-folder');
	assert.equal(posted[0].parentId, 'proposals');
	assert.equal(posted[1].action, 'assign-project');
	assert.equal(posted[1].folderId, 'created');
	assert.equal(view.activeModal, null);
	view.dispose();
});
test('FolderStorageClient, FolderTreeRenderer, narrowed MutationObserver, and folders-client exports exclude dead polling and re-exports', async () => {
	assert.deepEqual(Object.keys(clientExports).sort(), ['FolderStorageClient', 'FolderTreeRenderer', 'FoldersView', 'createReadConfig', 'installFoldersView']);
	assert.equal('refresh' in FoldersView.prototype, false);
	assert.equal(hasDragType({types: ['application/antigravity-folder-id']}, 'application/antigravity-folder-id'), true);
	const observed = [];
	class FakeObserver {
		disconnect() {
			observed.length = 0;
		}
		observe(target, options) {
			observed.push({target, options});
		}
	}
	const doc = createMockDocument();
	const {documentElement} = doc;
	const nav = doc.createElement('nav');
	nav.setAttribute('role', 'navigation');
	doc.body.append(nav);
	const nativeList = doc.createElement('div');
	nativeList.dataset.testid = 'conversation-list-sidebar';
	nav.append(nativeList);
	let getCount = 0;
	const win = {
		MutationObserver: FakeObserver,
		location: {pathname: '/'},
		getComputedStyle: () => ({getPropertyValue: () => ''}),
		__PROJECT_FOLDERS_DATA__: {folders, projectFolderMap: {}},
		__ANTIGRAVITY_TOOLS_REQUEST__: async (_tool, message) => {
			if ('GET' === message.method) {
				getCount++;
			}
			return 'GET_VIEW_STATE' === message.method ? {schemaVersion: 1} : {schemaVersion: 2, revision: 'r1', data: {folders, projectFolderMap: {}}};
		}
	};
	const view = new FoldersView(win, {
		document: doc,
		adapter: {
			contract: 'antigravity-local-rpc-v2',
			dispose() {},
			selection: () => ({}),
			start: async () => {
				view.handleProjects([{id: 'p1', name: 'One'}]);
			}
		}
	});
	assert.ok(view.storage instanceof FolderStorageClient);
	assert.ok(view.renderer instanceof FolderTreeRenderer);
	await view.start();
	assert.equal(getCount, 1);
	assert.equal(view.observedSubtree, false);
	assert.equal(observed.some(entry => entry.target === documentElement), false);
	assert.equal(observed.every(entry => !entry.options.subtree), true);
	nativeList.isConnected = false;
	view.unmountDetached();
	view.retargetObserver();
	assert.equal(view.observedSubtree, true);
	assert.equal(observed.length, 1);
	assert.equal(observed[0].target, documentElement);
	assert.equal(observed[0].options.subtree, true);
	view.dispose();
});
