const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture() {
  const frames = [], dialogs = [], actions = [];
  let changed;
  const window = {__PROJECT_FOLDERS_DATA__: {folders: [{id: 'target', name: 'Work', parentId: null}], projectFolderMap: {}}, addEventListener() {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'folders-client.js'), 'utf8'), {
    window, console: {log() {}, warn() {}},
    document: {readyState: 'loading', documentElement: {}, addEventListener() {}, querySelectorAll: () => dialogs, querySelector: () => null},
    MutationObserver: class {constructor(fn) {changed = fn;} observe() {}},
    requestAnimationFrame: fn => frames.push(fn), alert() {}
  });
  const client = window.__PROJECT_FOLDERS_CLIENT__;
  client.postAction = async (action, payload) => {actions.push({action, ...payload}); return {success: true};};
  client.revealCreatedProject = () => {};
  return {client, dialogs, actions, frame() {frames.splice(0).forEach(fn => fn());}, changed: () => changed()};
}

test('native async creation uses its exact returned ID and chosen folder', async () => {
  const f = fixture();
  await f.client.runProjectCreation('target', async () => {
    await Promise.resolve();
    const context = f.client.captureProjectCreation();
    assert.equal(context.folderId, 'target');
    assert.equal(await f.client.saveCreatedProject(async () => 'native-result', 'native-uuid', context), 'native-result');
  });
  f.frame();
  assert.deepEqual(f.actions, [{action: 'assign-project', projectId: 'native-uuid', folderId: 'target'}]);
  assert.equal(f.client.captureProjectCreation(), null);
});

test('cancelling the wizard cannot assign the next root project', async () => {
  const f = fixture(), dialog = {isConnected: true};
  await f.client.runProjectCreation('target', () => {f.dialogs.push(dialog);});
  f.frame();
  assert.equal(f.client.captureProjectCreation().folderId, 'target');
  dialog.isConnected = false; f.dialogs.length = 0; f.changed();
  assert.equal(f.client.captureProjectCreation(), null);
  await f.client.saveCreatedProject(async () => true, 'root-project', null);
  assert.deepEqual(f.actions, []);
});

test('failed creation assigns nothing and the open wizard can retry', async () => {
  const f = fixture(), dialog = {isConnected: true};
  await f.client.runProjectCreation('target', () => {f.dialogs.push(dialog);}); f.frame();
  await assert.rejects(f.client.saveCreatedProject(async () => {throw Error('native failure');}, 'failed', f.client.captureProjectCreation()), /native failure/);
  assert.deepEqual(f.actions, []);
  await f.client.saveCreatedProject(async () => true, 'retry-id', f.client.captureProjectCreation());
  assert.equal(f.actions[0].projectId, 'retry-id');
});
