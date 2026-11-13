// 2026-10-18 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Add folder-scoped project creation, 80%-height tree folder picker, multi-window UI injection (4th+ windows), and context-only action menus":
// https://github.com/dmitry-ai/antigravity-addons/issues/8
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders around standalone v2 architecture, delegated events, UMD test exports, and shared folders-model mutations":
// https://github.com/dmitry-ai/antigravity-addons/issues/24
const test = require('node:test');
const assert = require('node:assert/strict');
const {folderPickerModel, openProjectContextMenu, positionContextMenu} = require('./folders-client');
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
	const client = {getProjectFolderId: () => 'month', postAction: (...args) => actions.push(args)};
	openProjectContextMenu(
		{preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1},
		'project-id',
		{
			client,
			showContextMenu: (_x, _y, value, label) => {
				items = value;
				title = label;
			},
			showCreateFolderDialog: () => {},
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
			client,
			showContextMenu: (_x, _y, value) => {
				items = value;
			},
			showCreateFolderDialog: () => {},
			win: {
				__PROJECT_FOLDERS_VIEW__: {
					adapter: {
						navigate() {},
						openProjectSettings: id => openedSettings.push(id)
					},
					renameProject() {}
				}
			}
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
