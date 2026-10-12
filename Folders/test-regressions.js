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
