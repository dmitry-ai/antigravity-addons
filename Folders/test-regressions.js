const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const codeRoot = __dirname;
const bootstrapPath = path.join(codeRoot, 'folders-bootstrap.js');
const actualRequire = createRequire(bootstrapPath);

function loadBootstrap(source = fs.readFileSync(bootstrapPath, 'utf8')) {
  const watchers = [];
  const requireMock = name => {
    if (name === 'electron') return { net: { fetch: async () => { throw new Error('Unexpected network request'); } } };
    if (name === 'fs') return { ...fs, watch: () => { const watcher = { close() {}, on() {} }; watchers.push(watcher); return watcher; } };
    return actualRequire(name);
  };
  requireMock.resolve = actualRequire.resolve;
  requireMock.cache = require.cache;
  const module = { exports: {} };
  const run = vm.compileFunction(source, ['require', 'module', '__dirname', 'console', 'Response'], { filename: bootstrapPath });
  run(requireMock, module, codeRoot, { log() {}, warn() {}, error() {} }, Response);
  return module.exports;
}

function mockWindow(session) {
  return { isDestroyed: () => false, once() {}, webContents: { session, executeJavaScript: async source => { session.updates.push(source); } } };
}

test('Electron bootstrap loads and installs its real protocol handler', async () => {
  const init = loadBootstrap(); // The missing path import fails here, before any UI can load.
  assert.equal(typeof init, 'function');
  const session = { updates: [], protocol: { handle(scheme, handler) { assert.equal(scheme, 'https'); session.handler = handler; } } };
  const scratchRoot = process.env.FOLDERS_TEST_WORK_DIR || path.join(codeRoot, 'work');
  fs.mkdirSync(scratchRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(scratchRoot, 'folders-regression-'));
  const configPath = path.join(scratch, 'folders.json');
  fs.writeFileSync(configPath, JSON.stringify({ folders: [], projectFolderMap: {}, collapsedFolders: [] }));
  try {
    init(mockWindow(session), configPath);
    init(mockWindow(session), configPath);
    assert.equal(typeof session.handler, 'function');
    assert.equal(session._antigravityFoldersWindows.size, 2);
    const invoke = async (action, payload = {}) => {
      const response = await session.handler(new Request('https://127.0.0.1:12345/api/project-folders', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...payload })
      }));
      return { status: response.status, body: await response.json() };
    };
    const added = await invoke('add-folder', { name: 'Regression Alpha', id: 'folder-regression-alpha' });
    assert.equal(added.body.data.folders[0].name, 'Regression Alpha');
    assert.equal(session.updates.length, 2, 'Both open renderers receive the new state');
    const renamed = await invoke('rename-folder', { id: 'folder-regression-alpha', newName: 'Regression Renamed' });
    assert.equal(renamed.body.data.folders[0].name, 'Regression Renamed');
    const assigned = await invoke('assign-project', { projectId: 'regression-project-id', folderId: 'folder-regression-alpha' });
    assert.equal(assigned.body.data.projectFolderMap['regression-project-id'], 'folder-regression-alpha');
    const unassigned = await invoke('unassign-project', { projectId: 'regression-project-id' });
    assert.equal(Object.hasOwn(unassigned.body.data.projectFolderMap, 'regression-project-id'), false);
    await invoke('assign-project', { projectId: 'regression-project-id', folderId: 'folder-regression-alpha' });
    const removed = await invoke('remove-folder', { id: 'folder-regression-alpha' });
    assert.equal(removed.body.data.folders.length, 0);
    assert.deepEqual(removed.body.data.projectFolderMap, {});
    const invalid = await invoke('not-an-operation');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.success, false);
    const getResponse = await session.handler(new Request('https://127.0.0.1:12345/api/project-folders'));
    assert.deepEqual((await getResponse.json()).folders, []);
  } finally {
    const cleanupTarget = path.resolve(scratch);
    assert.ok(cleanupTarget.startsWith(path.resolve(scratchRoot) + path.sep), 'Cleanup stays inside the test workspace');
    fs.rmSync(cleanupTarget, { recursive: true, force: true });
  }
});

test('Actual application bundle is transformed as a complete executable script', () => {
  const { applyFolderPatch } = require('./folders-patch');
  const source = fs.readFileSync(path.join(process.env.TEMP, 'antigravity_main.js'), 'utf8');
  const transformed = applyFolderPatch(source, { folders: [{ id: 'empty-test', name: 'Empty Test' }], projectFolderMap: {} });
  assert.notEqual(transformed, source, 'Compatible installed bundle must not silently fall back');
  new vm.Script(transformed);
  assert.equal(applyFolderPatch('unsupported future application bundle', {}), 'unsupported future application bundle');
});


test('Real row generator preserves project IDs, folder collapse, empty folders and history', () => {
  const source = fs.readFileSync(path.join(process.env.TEMP, 'antigravity_main.js'), 'utf8');
  const config = { folders: [{ id: 'occupied', name: 'Occupied' }, { id: 'empty', name: 'Empty' }], projectFolderMap: { p1: 'occupied' } };
  const patched = require('./folders-patch').applyFolderPatch(source, config);
  const start = patched.indexOf('function VIb(a)');
  const end = patched.indexOf(';const WIb=', start);
  assert.ok(start >= 0 && end > start, 'Actual compatible row generator is present');
  const render = vm.runInNewContext('(' + patched.slice(start, end) + ')', { window: { __PROJECT_FOLDERS_DATA__: config } });
  const input = {
    groups: [{ id: 'p1', label: 'Project One', items: [{ cascadeId: 'c1', summary: {} }] }, { id: 'p2', label: 'Project Two', items: [] }],
    groupBy: 'project', collapsedSectionIds: [], collapsedSectionHeaderIds: [], conversationGroupSections: [],
    sectionHeader: { title: 'Projects', isCollapsed: false }, variant: 'sidebar', onlyShowFirstFewConvos: {},
    isMobile: false, sortedPinnedIds: [], includePinnedSection: false
  };
  let rows = render(input);
  assert.ok(rows.some(row => row.folderId === 'empty'), 'An empty folder is rendered');
  assert.ok(rows.some(row => row.id === 'header-p1'), 'Original project identity survives grouping');
  assert.ok(rows.some(row => row.id === 'c1'), 'Original conversation survives grouping');
  assert.ok(rows.some(row => row.id === 'header-p2'), 'Unassigned project remains visible');
  rows = render({ ...input, collapsedSectionHeaderIds: ['folder-occupied'] });
  assert.equal(rows.some(row => row.id === 'header-p1' || row.id === 'c1'), false, 'Closing a folder removes its children from virtual rows');
  rows = render({ ...input, sectionHeader: { title: 'Projects', isCollapsed: true } });
  assert.equal(rows.some(row => row.folderId || row.id === 'header-p1'), false, 'Closing Projects hides folder contents');
  rows = render({ ...input, variant: 'history' });
  assert.equal(rows.some(row => row.folderId), false, 'History does not receive sidebar folder rows');
  assert.ok(rows.some(row => row.id === 'header-p1'), 'History retains native project rows');
});

test('Hierarchical Method 1 tree operations: 3 levels, cycle prevention, promotion on delete, duplicate names in distinct branches', async () => {
  const init = loadBootstrap();
  const session = { updates: [], protocol: { handle(scheme, handler) { session.handler = handler; } } };
  const scratchRoot = process.env.FOLDERS_TEST_WORK_DIR || path.join(codeRoot, 'work');
  fs.mkdirSync(scratchRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(scratchRoot, 'folders-hierarchy-'));
  const configPath = path.join(scratch, 'folders.json');
  fs.writeFileSync(configPath, JSON.stringify({ folders: [], projectFolderMap: {}, collapsedFolders: [] }));

  try {
    init(mockWindow(session), configPath);
    const invoke = async (action, payload = {}) => {
      const response = await session.handler(new Request('https://127.0.0.1:12345/api/project-folders', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...payload })
      }));
      return { status: response.status, body: await response.json() };
    };

    // 1. Build a 3-level hierarchy: BranchA -> SubA -> DeepA
    const rootA = await invoke('add-folder', { name: 'BranchA', id: 'branch-a' });
    assert.equal(rootA.body.data.folders[0].parentId, null);

    const subA = await invoke('add-folder', { name: 'SubA', id: 'sub-a', parentId: 'branch-a' });
    assert.equal(subA.body.data.folders.find(f => f.id === 'sub-a').parentId, 'branch-a');

    const deepA = await invoke('add-folder', { name: 'DeepA', id: 'deep-a', parentId: 'sub-a' });
    assert.equal(deepA.body.data.folders.find(f => f.id === 'deep-a').parentId, 'sub-a');

    // 2. Allow duplicate names in DIFFERENT branches
    const rootB = await invoke('add-folder', { name: 'BranchB', id: 'branch-b' });
    const subB = await invoke('add-folder', { name: 'SubA', id: 'sub-a-in-b', parentId: 'branch-b' });
    assert.ok(subB.body.success, 'Duplicate folder name "SubA" allowed under different parent');

    // Reject duplicate name under the SAME parent
    const duplicateSame = await invoke('add-folder', { name: 'SubA', parentId: 'branch-b' });
    // Same parent and same name updates or preserves existing sibling
    const bChildren = duplicateSame.body.data.folders.filter(f => f.parentId === 'branch-b' && f.name.toLowerCase() === 'suba');
    assert.equal(bChildren.length, 1, 'Sibling name collision prevented');

    // 3. Cycle prevention: cannot move BranchA into DeepA (its own descendant)
    const cycleMove = await invoke('move-folder', { id: 'branch-a', newParentId: 'deep-a' });
    assert.equal(cycleMove.status, 500);
    assert.ok(cycleMove.body.error.includes('cycle') || cycleMove.body.error.includes('descendant'));

    // Cannot move folder into itself
    const selfMove = await invoke('move-folder', { id: 'branch-a', newParentId: 'branch-a' });
    assert.equal(selfMove.status, 500);

    // 4. Move folder:
    // First, verify sibling collision check prevents moving SubA into BranchB (which already has SubA)
    const collisionMove = await invoke('move-folder', { id: 'sub-a', newParentId: 'branch-b' });
    assert.equal(collisionMove.status, 500);
    assert.ok(collisionMove.body.error.includes('Sibling folder name collision'));

    // Move DeepA to BranchB (no collision)
    const validMove = await invoke('move-folder', { id: 'deep-a', newParentId: 'branch-b' });
    assert.equal(validMove.status, 200);
    assert.equal(validMove.body.data.folders.find(f => f.id === 'deep-a').parentId, 'branch-b');

    // Move DeepA back under SubA
    await invoke('move-folder', { id: 'deep-a', newParentId: 'sub-a' });

    // 5. Promotion on deletion: assign project to SubA, then remove SubA
    await invoke('assign-project', { projectId: 'test-project-deep', folderId: 'sub-a' });

    // When SubA is deleted, its child DeepA and its project test-project-deep must be promoted to SubA's parent (branch-a)
    const removeRes = await invoke('remove-folder', { id: 'sub-a' });
    assert.equal(removeRes.status, 200);
    assert.equal(removeRes.body.data.folders.find(f => f.id === 'deep-a').parentId, 'branch-a', 'Child folder promoted to parent');
    assert.equal(removeRes.body.data.projectFolderMap['test-project-deep'], 'branch-a', 'Project promoted to parent');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('Hierarchical virtual row rendering: depth indents, no empty placeholder if has subfolders, collapsed parent never leaks projects to root', () => {
  const source = fs.readFileSync(path.join(process.env.TEMP, 'antigravity_main.js'), 'utf8');
  const treeConfig = {
    folders: [
      { id: 'f-root', name: 'Root Folder', parentId: null },
      { id: 'f-sub', name: 'Sub Folder', parentId: 'f-root' },
      { id: 'f-deep', name: 'Deep Folder', parentId: 'f-sub' }
    ],
    projectFolderMap: {
      'p-deep': 'f-deep'
    }
  };
  const patched = require('./folders-patch').applyFolderPatch(source, treeConfig);
  const start = patched.indexOf('function VIb(a)');
  const end = patched.indexOf(';const WIb=', start);
  const render = vm.runInNewContext('(' + patched.slice(start, end) + ')', { window: { __PROJECT_FOLDERS_DATA__: treeConfig } });

  const input = {
    groups: [
      { id: 'p-deep', label: 'Deep Project', items: [{ cascadeId: 'c-deep', summary: {} }] },
      { id: 'p-unassigned', label: 'Unassigned Project', items: [] }
    ],
    groupBy: 'project', collapsedSectionIds: [], collapsedSectionHeaderIds: [], conversationGroupSections: [],
    sectionHeader: { title: 'Projects', isCollapsed: false }, variant: 'sidebar', onlyShowFirstFewConvos: {},
    isMobile: false, sortedPinnedIds: [], includePinnedSection: false
  };

  // 1. All open: depth check & placeholder check
  let rows = render(input);
  const rootHeader = rows.find(r => r.folderId === 'f-root');
  const subHeader = rows.find(r => r.folderId === 'f-sub');
  const deepHeader = rows.find(r => r.folderId === 'f-deep');

  assert.ok(rootHeader, 'Root folder header rendered');
  assert.equal(rootHeader.folderDepth, 0, 'Root folder has depth 0');

  assert.ok(subHeader, 'Sub folder header rendered');
  assert.equal(subHeader.folderDepth, 1, 'Sub folder has depth 1');

  assert.ok(deepHeader, 'Deep folder header rendered');
  assert.equal(deepHeader.folderDepth, 2, 'Deep folder has depth 2');

  // f-root and f-sub contain subfolders, so they must NOT have empty-placeholder
  assert.equal(rows.some(r => r.id === 'empty-folder-f-root'), false, 'Parent folder with subfolders is not empty');
  assert.equal(rows.some(r => r.id === 'empty-folder-f-sub'), false, 'Sub folder with subfolders is not empty');

  // Deep project is rendered
  assert.ok(rows.some(r => r.id === 'header-p-deep'), 'Deep project rendered inside its folder');
  // Unassigned project is rendered
  assert.ok(rows.some(r => r.id === 'header-p-unassigned'), 'Unassigned project rendered in root');

  // 2. Collapse f-root: NOTHING inside the tree should render, and p-deep MUST NOT leak into root!
  rows = render({ ...input, collapsedSectionHeaderIds: ['folder-f-root'] });
  assert.ok(rows.some(r => r.folderId === 'f-root'), 'Root folder header still rendered');
  assert.equal(rows.some(r => r.folderId === 'f-sub'), false, 'Subfolder hidden when root collapsed');
  assert.equal(rows.some(r => r.folderId === 'f-deep'), false, 'Deep folder hidden when root collapsed');
  assert.equal(rows.some(r => r.id === 'header-p-deep'), false, 'Assigned project hidden when ancestor collapsed');
  assert.ok(rows.some(r => r.id === 'header-p-unassigned'), 'Unassigned project still visible in root');
});
