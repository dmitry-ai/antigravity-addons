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
const test = require('node:test');
const assert = require('node:assert/strict');
const {FolderDialogController, FolderMenuController, FoldersView, SidebarDragController, folderPickerModel, openProjectContextMenu, positionContextMenu} = require('./folders-client');
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
				renameProject() {}
			},
			win: {}
		}
	);
	const settingsItem = items.find(item => 'Project settings…' === item.label);
	assert.ok(settingsItem);
	settingsItem.onClick();
	assert.deepEqual(openedSettings, ['project-id']);
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
	const makeNode = tag => {
		const listeners = new Map();
		const upper = tag.toUpperCase();
		const node = {
			tag: upper,
			className: '',
			textContent: '',
			_value: undefined,
			get value() {
				return undefined !== this._value ? this._value : 'SELECT' === upper ? this.children.find(opt => opt.selected)?.value || '' : '';
			},
			set value(v) {
				this._value = v;
			},
			dataset: {},
			style: {},
			attributes: {},
			children: [],
			isConnected: true,
			offsetWidth: 180,
			offsetHeight: 120,
			append(...items) {
				for (const item of items) {
					if ('object' === typeof item && item) {
						this.children.push(item);
					}
				}
			},
			appendChild(child) {
				this.children.push(child);
				return child;
			},
			replaceChildren(...items) {
				this.children = items.filter(item => 'object' === typeof item && item);
			},
			setAttribute(key, val) {
				this.attributes[key] = String(val);
			},
			addEventListener(type, fn) {
				if (!listeners.has(type)) {
					listeners.set(type, []);
				}
				listeners.get(type).push(fn);
			},
			dispatch(type, event = {}) {
				for (const fn of listeners.get(type) || []) {
					fn({
						preventDefault() {},
						stopPropagation() {},
						target: node,
						...event
					});
				}
			},
			click() {
				this.dispatch('click');
			},
			focus() {
				doc.activeElement = node;
			},
			scrollIntoView() {},
			setCustomValidity(msg) {
				this.validationMessage = msg;
			},
			reportValidity() {},
			remove() {
				this.removed = true;
			},
			querySelectorAll(selector) {
				const out = [];
				const match = el => (selector.includes('treeitem') && 'treeitem' === el.attributes?.role)
					|| (selector.includes('menuitem') && 'menuitem' === el.attributes?.role)
					|| (selector.includes('button') && 'button' === el.attributes?.role);
				const walk = el => {
					for (const child of el.children || []) {
						if (match(child)) {
							out.push(child);
						}
						walk(child);
					}
				};
				walk(this);
				return out;
			},
			querySelector(selector) {
				let r = null;
				if (selector.includes('aria-selected=true')) {
					r = this.querySelectorAll('treeitem').find(el => 'true' === el.attributes['aria-selected']) || null;
				}
				else {
					r = this.querySelectorAll(selector)[0] || null;
				}
				return r;
			}
		};
		return node;
	};
	const doc = {activeElement: null, body: makeNode('body'), createElement: makeNode};
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
