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

  // Deep project is rendered with correct depth (folder depth 2 + 1 = 3)
  assert.ok(rows.some(r => r.id === 'header-p-deep'), 'Deep project rendered inside its folder');
  const deepProject = rows.find(r => r.id === 'header-p-deep');
  assert.equal(deepProject.folderDepth, 3, 'Deep project has depth 3 (inside folder of depth 2)');
  assert.equal(deepProject.folderId, 'f-deep', 'Deep project has folderId f-deep');

  // Deep conversation inherits project folder depth
  const deepConvo = rows.find(r => r.id === 'c-deep');
  assert.ok(deepConvo, 'Deep conversation is rendered');
  assert.equal(deepConvo.folderDepth, 3, 'Deep conversation inherits project folder depth 3');
  assert.equal(deepConvo.folderId, 'f-deep', 'Deep conversation has folderId f-deep');

  // Unassigned project is rendered at root level (depth 0)
  assert.ok(rows.some(r => r.id === 'header-p-unassigned'), 'Unassigned project rendered in root');
  const unassignedProject = rows.find(r => r.id === 'header-p-unassigned');
  assert.equal(unassignedProject.folderDepth, 0, 'Unassigned project has depth 0');

  // 2. Collapse f-root: NOTHING inside the tree should render, and p-deep MUST NOT leak into root!
  rows = render({ ...input, collapsedSectionHeaderIds: ['folder-f-root'] });
  assert.ok(rows.some(r => r.folderId === 'f-root'), 'Root folder header still rendered');
  assert.equal(rows.some(r => r.folderId === 'f-sub'), false, 'Subfolder hidden when root collapsed');
  assert.equal(rows.some(r => r.folderId === 'f-deep'), false, 'Deep folder hidden when root collapsed');
  assert.equal(rows.some(r => r.id === 'header-p-deep'), false, 'Assigned project hidden when ancestor collapsed');
  assert.ok(rows.some(r => r.id === 'header-p-unassigned'), 'Unassigned project still visible in root');
});

test('Folder drag-and-drop: folder-to-folder reparenting, cycle avoidance, sibling collision rejection, and root unnesting', async () => {
  const init = loadBootstrap();
  const session = { updates: [], protocol: { handle(scheme, handler) { session.handler = handler; } } };
  const scratchRoot = process.env.FOLDERS_TEST_WORK_DIR || path.join(codeRoot, 'work');
  fs.mkdirSync(scratchRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(scratchRoot, 'folders-dnd-'));
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

    // Create 2 root folders
    await invoke('add-folder', { name: 'SourceFolder', id: 'fld-src' });
    await invoke('add-folder', { name: 'TargetFolder', id: 'fld-dst' });

    // Drag SourceFolder into TargetFolder
    const moveRes = await invoke('move-folder', { id: 'fld-src', newParentId: 'fld-dst' });
    assert.equal(moveRes.status, 200);
    assert.equal(moveRes.body.data.folders.find(f => f.id === 'fld-src').parentId, 'fld-dst');

    // Create child inside SourceFolder: SourceChild
    await invoke('add-folder', { name: 'SourceChild', id: 'fld-child', parentId: 'fld-src' });

    // Cycle check: cannot drag SourceFolder into its child SourceChild
    const cycleRes = await invoke('move-folder', { id: 'fld-src', newParentId: 'fld-child' });
    assert.equal(cycleRes.status, 500);

    // Self check: cannot drag folder into itself
    const selfRes = await invoke('move-folder', { id: 'fld-src', newParentId: 'fld-src' });
    assert.equal(selfRes.status, 500);

    // Sibling collision check: create folder named "CollisionFolder" in root, and another inside TargetFolder
    await invoke('add-folder', { name: 'CollisionFolder', id: 'fld-col-root' });
    await invoke('add-folder', { name: 'CollisionFolder', id: 'fld-col-dst', parentId: 'fld-dst' });
    // Moving root CollisionFolder into TargetFolder must fail due to sibling collision
    const colMove = await invoke('move-folder', { id: 'fld-col-root', newParentId: 'fld-dst' });
    assert.equal(colMove.status, 500);
    assert.ok(colMove.body.error.includes('Sibling folder name collision'));

    // Drag SourceFolder back to root (as when dropping onto Projects main header)
    const rootRes = await invoke('move-folder', { id: 'fld-src', newParentId: null });
    assert.equal(rootRes.status, 200);
    assert.equal(rootRes.body.data.folders.find(f => f.id === 'fld-src').parentId, null);
    // SourceChild still belongs to SourceFolder
    assert.equal(rootRes.body.data.folders.find(f => f.id === 'fld-child').parentId, 'fld-src');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('Client controller: active/current folder detection, parent dropdown hierarchy generation, and drag-drop DOM event setup', async () => {
  const clientSource = fs.readFileSync(path.join(codeRoot, 'folders-client.js'), 'utf8');

  // Set up mock DOM
  const elements = [];
  function createMockElement(tag, attrs = {}) {
    const classListSet = new Set();
    let classNameStr = attrs.class || attrs.className || '';
    if (classNameStr) {
      classNameStr.split(/\s+/).filter(Boolean).forEach(c => classListSet.add(c));
    }
    const el = {
      tagName: tag.toUpperCase(),
      attributes: { ...attrs },
      children: [],
      parentNode: null,
      style: {},
      classList: classListSet,
      listeners: {},
      getAttribute(k) { return this.attributes[k] ?? null; },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      removeAttribute(k) { delete this.attributes[k]; },
      closest(sel) {
        if (this.matches(sel)) return this;
        return this.parentNode?.closest ? this.parentNode.closest(sel) : null;
      },
      querySelector(sel) {
        for (const c of this.children) {
          if (c.matches && c.matches(sel)) return c;
          const found = c.querySelector?.(sel);
          if (found) return found;
        }
        return null;
      },
      querySelectorAll(sel) {
        const results = [];
        for (const c of this.children) {
          if (c.matches && c.matches(sel)) results.push(c);
          if (c.querySelectorAll) results.push(...c.querySelectorAll(sel));
        }
        return results;
      },
      matches(selector) {
        const parts = selector.split(',').map(s => s.trim());
        return parts.some(sel => {
          if (sel.includes(' > ')) {
            const sub = sel.split(' > ');
            const childSel = sub[sub.length - 1];
            const parentSel = sub.slice(0, -1).join(' > ');
            if (!this.matches(childSel)) return false;
            return this.parentNode ? this.parentNode.matches(parentSel) : false;
          }

          if (sel.includes(' ')) {
            const sub = sel.split(/\s+/);
            const childSel = sub[sub.length - 1];
            const ancestorSel = sub.slice(0, -1).join(' ');
            if (!this.matches(childSel)) return false;
            let p = this.parentNode;
            while (p) {
              if (p.matches(ancestorSel)) return true;
              p = p.parentNode;
            }
            return false;
          }

          if (sel.includes(':last-child')) {
            const baseSel = sel.replace(/:last-child/g, '');
            if (this.parentNode) {
              const siblings = this.parentNode.children;
              if (siblings[siblings.length - 1] !== this) return false;
            }
            if (baseSel && !this.matches(baseSel)) return false;
            return true;
          }

          const tagMatch = sel.match(/^[a-zA-Z0-9]+/);
          if (tagMatch && this.tagName !== tagMatch[0].toUpperCase()) return false;

          const classMatches = sel.match(/\.([a-zA-Z0-9_/-]+|group\\\/section-header)/g);
          if (classMatches) {
            for (const cm of classMatches) {
              const cleanCls = cm.slice(1).replace(/\\/g, '');
              if (!this.classList.has(cleanCls)) return false;
            }
          }

          const attrMatches = sel.matchAll(/\[([a-zA-Z0-9_-]+)(?:([*^$]?=)(?:'([^']*)'|"([^"]*)"|([^\]]*)))?\]/g);
          for (const m of attrMatches) {
            const attr = m[1];
            const op = m[2];
            const val = m[3] ?? m[4] ?? m[5];
            const actualVal = this.getAttribute(attr);
            if (actualVal === null || actualVal === undefined) return false;
            if (op === '=') { if (actualVal !== val) return false; }
            else if (op === '*=') { if (!actualVal.includes(val)) return false; }
            else if (op === '^=') { if (!actualVal.startsWith(val)) return false; }
          }
          return true;
        });
      },
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) {
          this.children.splice(idx, 1);
          child.parentNode = null;
        }
        return child;
      },
      insertBefore(child, before) {
        child.parentNode = this;
        const idx = this.children.indexOf(before);
        if (idx >= 0) this.children.splice(idx, 0, child);
        else this.children.push(child);
        return child;
      },
      addEventListener(evt, fn) {
        if (!this.listeners[evt]) this.listeners[evt] = [];
        this.listeners[evt].push(fn);
      },
      dispatchEvent(evt) {
        for (const fn of this.listeners[evt.type] || []) fn(evt);
      },
      click() {
        this.dispatchEvent({ type: 'click', target: this, stopPropagation() {} });
      },
      focus() {
        mockDoc.activeElement = this;
      }
    };
    let _innerHTML = '';
    Object.defineProperty(el, 'innerHTML', {
      get() { return _innerHTML; },
      set(html) {
        _innerHTML = String(html);
        el.children = [];
        const tagRegex = /<([a-zA-Z0-9]+)([^>]*)>(?:([\s\S]*?)<\/\1>)?/g;
        let m;
        while ((m = tagRegex.exec(_innerHTML)) !== null) {
          const tagName = m[1];
          const rawAttrs = m[2];
          const inner = m[3] || '';
          const child = createMockElement(tagName);
          const attrRegex = /([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?/g;
          let am;
          while ((am = attrRegex.exec(rawAttrs)) !== null) {
            const k = am[1];
            const v = am[2] ?? '';
            if (k === 'class' || k === 'className') child.className = v;
            else child.setAttribute(k, v);
          }
          const trimmed = inner.trim();
          if (trimmed.startsWith('<')) {
            child.innerHTML = trimmed;
          } else if (trimmed) {
            child.textContent = trimmed;
          }
          if (tagName.toUpperCase() === 'OPTION' && rawAttrs.includes('selected')) {
            el.value = child.getAttribute('value') || '';
          }
          child.focus = function() { mockDoc.activeElement = this; };
          child.setCustomValidity = function() {};
          child.reportValidity = function() {};
          child.select = function() {};
          el.appendChild(child);
        }
      }
    });
    Object.defineProperty(el, 'className', {
      get() { return classNameStr; },
      set(val) {
        classNameStr = String(val);
        classListSet.clear();
        classNameStr.split(/\s+/).filter(Boolean).forEach(c => classListSet.add(c));
      }
    });
    el.classList.add = function(c) { Set.prototype.add.call(classListSet, c); classNameStr = Array.from(classListSet).join(' '); };
    el.classList.remove = function(c) { Set.prototype.delete.call(classListSet, c); classNameStr = Array.from(classListSet).join(' '); };
    el.classList.contains = function(c) { return Set.prototype.has.call(classListSet, c); };
    elements.push(el);
    return el;
  }

  const initialData = {
    folders: [
      { id: 'f-work', name: 'Work', parentId: null },
      { id: 'f-nested', name: 'Nested2026', parentId: 'f-work' }
    ],
    projectFolderMap: {
      'proj-nested': 'f-nested',
      'proj-work': 'f-work'
    }
  };

  const docBody = createMockElement('body');
  const mockWindow = {
    __PROJECT_FOLDERS_DATA__: initialData,
    addEventListener(evt, fn) { docBody.addEventListener(evt, fn); },
    removeEventListener() {},
    dispatchEvent() {}
  };

  const mockDoc = {
    activeElement: null,
    body: docBody,
    documentElement: docBody,
    querySelector(sel) { return docBody.querySelector(sel); },
    querySelectorAll(sel) { return docBody.querySelectorAll(sel); },
    createElement(tag) { return createMockElement(tag); },
    addEventListener(evt, fn) { docBody.addEventListener(evt, fn); }
  };

  let mutationCb = null;
  const context = {
    window: mockWindow,
    document: mockDoc,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    MutationObserver: class {
      constructor(cb) { mutationCb = cb; }
      observe() {}
      disconnect() {}
    },
    CustomEvent: class {
      constructor(type, init) { this.type = type; this.detail = init?.detail; }
    }
  };

  vm.createContext(context);
  vm.runInContext(clientSource, context);

  const client = mockWindow.__PROJECT_FOLDERS_CLIENT__;
  assert.ok(client, 'Client controller initialized');

  // 1. Test buildFolderSelectOptions DFS rendering & indentation
  const optionsHtml = client.buildFolderSelectOptions('f-nested');
  assert.ok(optionsHtml.includes('value=""'), 'Contains root option');
  assert.ok(optionsHtml.includes('value="f-work"'), 'Contains parent folder');
  assert.ok(optionsHtml.includes('value="f-nested" selected'), 'Contains nested folder selected');
  assert.ok(optionsHtml.includes('↳ 📁 Nested2026'), 'Contains child indentation');

  // 2. Test detectCurrentFolderId(): Hovered folder
  assert.equal(client.detectCurrentFolderId(), null, 'Defaults to null when idle');
  client.hoveredFolderId = 'f-nested';
  assert.equal(client.detectCurrentFolderId(), 'f-nested', 'Detects hovered folder');
  client.hoveredFolderId = null;

  // 3. Test detectCurrentFolderId(): Last active folder
  client.lastActiveFolderId = 'f-work';
  assert.equal(client.detectCurrentFolderId(), 'f-work', 'Detects last active folder');
  client.lastActiveFolderId = null;

  // 4. Test detectCurrentFolderId(): Last active project's folder
  client.lastActiveProjectId = 'proj-nested';
  assert.equal(client.detectCurrentFolderId(), 'f-nested', 'Detects folder of active project');
  client.lastActiveProjectId = null;

  // 5. Test detectCurrentFolderId(): Active selected conversation in DOM
  const convoRowWrapper = createMockElement('div', { 'data-index': '5', 'data-group-id': 'proj-nested' });
  const convoRow = createMockElement('div', { 'data-testid': 'conversation-row-sidebar', 'data-selected': 'true' });
  convoRowWrapper.appendChild(convoRow);
  docBody.appendChild(convoRowWrapper);

  assert.equal(client.detectCurrentFolderId(), 'f-nested', 'Detects current folder from active conversation in sidebar');
  convoRow.setAttribute('data-selected', 'false');

  // 6. Test detectCurrentFolderId(): Active conversation in main view via __PROJECT_FOLDERS_CONVO_MAP__
  mockWindow.__PROJECT_FOLDERS_CONVO_MAP__ = { 'cascade-active-999': 'proj-nested' };
  const mainConvoView = createMockElement('div', { 'data-testid': 'conversation-view', 'data-cascade-id': 'cascade-active-999' });
  docBody.appendChild(mainConvoView);
  assert.equal(client.detectCurrentFolderId(), 'f-nested', 'Detects active folder via main view conversation cascadeId');
  docBody.removeChild(mainConvoView);

  // 7. Test cycle prevention check
  const descendants = client.getDescendantIds('f-work');
  assert.ok(descendants.has('f-nested'), 'f-nested is descendant of f-work');
  assert.equal(descendants.has('f-work'), false, 'folder is not its own descendant');

  // 8. DOM Enhancement & Drag-and-Drop Event Verification
  const mainHeader = createMockElement('div', { 'data-testid': 'section-header', 'data-title': 'Projects' });
  const mainHeaderInner = createMockElement('div');
  mainHeaderInner.classList.add('group/section-header');
  const mainHeaderActions = createMockElement('div');
  mainHeaderInner.appendChild(mainHeaderActions);
  mainHeader.appendChild(mainHeaderInner);
  docBody.appendChild(mainHeader);

  const folderHeaderWork = createMockElement('div', { 'data-testid': 'section-header', 'data-title': '📁 Work', 'data-folder-id': 'f-work' });
  const folderH2Work = createMockElement('h2');
  const folderBtnWork = createMockElement('button', { 'aria-expanded': 'true' });
  folderH2Work.appendChild(folderBtnWork);
  folderHeaderWork.appendChild(folderH2Work);
  docBody.appendChild(folderHeaderWork);

  const folderHeaderNested = createMockElement('div', { 'data-testid': 'section-header', 'data-title': '📁 Nested2026', 'data-folder-id': 'f-nested' });
  const folderH2Nested = createMockElement('h2');
  const folderBtnNested = createMockElement('button', { 'aria-expanded': 'false' });
  folderH2Nested.appendChild(folderBtnNested);
  folderHeaderNested.appendChild(folderH2Nested);
  docBody.appendChild(folderHeaderNested);

  const emptyPlaceholder = createMockElement('div', { 'data-testid': 'empty-placeholder', 'data-folder-id': 'f-work' });
  docBody.appendChild(emptyPlaceholder);

  // Trigger DOM enhancement
  mutationCb();

  const createBtn = mainHeader.querySelector('.btn-create-folder');
  assert.ok(createBtn, 'Create folder button injected into main Projects header');
  const addBtn = folderHeaderWork.querySelector('.btn-folder-add');
  assert.ok(addBtn, 'Add subfolder button injected into folder header');
  const optBtn = folderHeaderWork.querySelector('.btn-folder-options');
  assert.ok(optBtn, 'Folder options button injected into folder header');
  assert.equal(folderHeaderWork.getAttribute('draggable'), 'true', 'Folder header is draggable');
  assert.equal(folderBtnWork.getAttribute('draggable'), 'true', 'Folder inner button is draggable');

  // 9. Pointerdown stopPropagation
  let pointerPropagationStopped = false;
  folderBtnWork.dispatchEvent({
    type: 'pointerdown',
    button: 0,
    target: folderBtnWork,
    stopPropagation() { pointerPropagationStopped = true; }
  });
  assert.equal(pointerPropagationStopped, true, 'pointerdown stops propagation to prevent pan interception');

  // 10. Dragstart event
  const dataTransferStore = {};
  const mockDataTransfer = {
    types: ['application/antigravity-folder-id', 'text/plain'],
    setData(k, v) { dataTransferStore[k] = v; },
    getData(k) { return dataTransferStore[k]; }
  };
  let dragPropagationStopped = false;
  folderBtnNested.dispatchEvent({
    type: 'dragstart',
    target: folderBtnNested,
    dataTransfer: mockDataTransfer,
    stopPropagation() { dragPropagationStopped = true; }
  });
  assert.equal(client.isDragging, true, 'Client isDragging is true');
  assert.equal(client.draggedFolderId, 'f-nested', 'Client draggedFolderId is set');
  assert.equal(dataTransferStore['application/antigravity-folder-id'], 'f-nested');
  assert.equal(folderHeaderNested.style.opacity, '0.5', 'Opacity set to 0.5 on dragstart');

  // 11. Dragover validations: self drop & cycle drop rejected
  folderHeaderNested.dispatchEvent({
    type: 'dragover',
    target: folderHeaderNested,
    dataTransfer: { ...mockDataTransfer, dropEffect: 'move' },
    preventDefault() {},
    stopPropagation() {}
  });
  assert.equal(folderHeaderNested.classList.contains('folder-drop-target'), false, 'Cannot drop folder into itself');

  // Cycle check: drag f-work over f-nested (its child)
  client.draggedFolderId = 'f-work';
  folderHeaderNested.dispatchEvent({
    type: 'dragover',
    target: folderHeaderNested,
    dataTransfer: { ...mockDataTransfer, dropEffect: 'move' },
    preventDefault() {},
    stopPropagation() {}
  });
  assert.equal(folderHeaderNested.classList.contains('folder-drop-target'), false, 'Cannot drop folder into its descendant (cycle prevention)');

  // 12. Valid dragenter/dragover & counter pattern
  client.data.folders.push({ id: 'f-target', name: 'Target Branch', parentId: null });
  const folderHeaderTarget = createMockElement('div', { 'data-testid': 'section-header', 'data-title': '📁 Target Branch', 'data-folder-id': 'f-target' });
  const folderH2Target = createMockElement('h2');
  const folderBtnTarget = createMockElement('button', { 'aria-expanded': 'false' });
  let expandedClicked = false;
  folderBtnTarget.addEventListener('click', () => { expandedClicked = true; });
  folderH2Target.appendChild(folderBtnTarget);
  folderHeaderTarget.appendChild(folderH2Target);
  docBody.appendChild(folderHeaderTarget);
  mutationCb();

  client.draggedFolderId = 'f-nested';
  let targetDropEffect = '';
  folderHeaderTarget.dispatchEvent({
    type: 'dragenter',
    target: folderHeaderTarget,
    dataTransfer: mockDataTransfer,
    preventDefault() {},
    stopPropagation() {}
  });
  assert.ok(folderHeaderTarget.classList.contains('folder-drop-target'), 'Target folder highlighted on dragenter');

  folderHeaderTarget.dispatchEvent({
    type: 'dragover',
    target: folderHeaderTarget,
    dataTransfer: { ...mockDataTransfer, set dropEffect(v) { targetDropEffect = v; }, get dropEffect() { return targetDropEffect; } },
    preventDefault() {},
    stopPropagation() {}
  });
  assert.equal(targetDropEffect, 'move', 'Valid dragover sets dropEffect to move');

  // Dragleave counter pattern
  folderHeaderTarget.dispatchEvent({ type: 'dragenter', target: folderHeaderTarget, dataTransfer: mockDataTransfer, preventDefault() {}, stopPropagation() {} });
  folderHeaderTarget.dispatchEvent({ type: 'dragleave', target: folderHeaderTarget });
  assert.ok(folderHeaderTarget.classList.contains('folder-drop-target'), 'Target folder still highlighted because count > 0');
  folderHeaderTarget.dispatchEvent({ type: 'dragleave', target: folderHeaderTarget });
  folderHeaderTarget.dispatchEvent({ type: 'dragleave', target: folderHeaderTarget });
  assert.equal(folderHeaderTarget.classList.contains('folder-drop-target'), false, 'Target folder highlight removed when count reaches 0');

  // 13. Drop event reparenting and auto-expansion
  const recordedActions = [];
  client.postAction = async (action, payload) => {
    recordedActions.push({ action, payload });
    return { success: true, data: client.data };
  };

  folderHeaderTarget.dispatchEvent({
    type: 'drop',
    target: folderHeaderTarget,
    dataTransfer: mockDataTransfer,
    preventDefault() {},
    stopPropagation() {}
  });
  await new Promise(r => setTimeout(r, 10));

  const moveCall = recordedActions.find(a => a.action === 'move-folder');
  assert.ok(moveCall, 'move-folder dispatched on drop');
  assert.equal(moveCall.payload.id, 'f-nested');
  assert.equal(moveCall.payload.newParentId, 'f-target');
  assert.equal(expandedClicked, true, 'Collapsed parent folder auto-expanded on drop');

  // 14. Drop on Empty Placeholder
  client.draggedFolderId = 'f-target';
  mockDataTransfer.setData('application/antigravity-folder-id', 'f-target');
  emptyPlaceholder.dispatchEvent({
    type: 'drop',
    target: emptyPlaceholder,
    dataTransfer: mockDataTransfer,
    preventDefault() {},
    stopPropagation() {}
  });
  await new Promise(r => setTimeout(r, 10));
  const placeholderMoveCall = recordedActions.find(a => a.action === 'move-folder' && a.payload.id === 'f-target' && a.payload.newParentId === 'f-work');
  assert.ok(placeholderMoveCall, 'move-folder dispatched when dropping on empty placeholder');

  // 15. Drop on Main Projects Header (Un-nest to root)
  client.draggedFolderId = 'f-nested';
  mockDataTransfer.setData('application/antigravity-folder-id', 'f-nested');
  mainHeader.dispatchEvent({
    type: 'drop',
    target: mainHeader,
    dataTransfer: mockDataTransfer,
    preventDefault() {},
    stopPropagation() {}
  });
  await new Promise(r => setTimeout(r, 10));
  const unnestCall = recordedActions.find(a => a.action === 'move-folder' && a.payload.id === 'f-nested' && a.payload.newParentId === null);
  assert.ok(unnestCall, 'move-folder to root dispatched when dropping on main Projects header');

  // 16. Contextual Folder Creation
  client.hoveredFolderId = 'f-target';
  createBtn.click();
  assert.ok(client.activeModal, 'Modal dialog opened on create button click');
  const cancelBtn = client.activeModal.querySelector('.btn-cancel');
  cancelBtn.click();
  assert.equal(client.activeModal, null, 'Cancel closed modal');

  // 17. Alt+N / Escape shortcuts
  docBody.dispatchEvent({ type: 'keydown', key: 'n', altKey: true, target: docBody, preventDefault() {} });
  assert.ok(client.activeModal, 'Modal opened via Alt+N shortcut');
  docBody.dispatchEvent({ type: 'keydown', key: 'Escape', target: docBody });
  assert.equal(client.activeModal, null, 'Modal closed via Escape shortcut');
});

test('Comprehensive multi-level tree hierarchy: projects, subfolders, conversation rows, and placeholders receive exact scalable depth attributes', () => {
  const source = fs.readFileSync(path.join(process.env.TEMP, 'antigravity_main.js'), 'utf8');
  const treeConfig = {
    folders: [
      { id: 'f-upwork', name: 'Upwork', parentId: null },
      { id: 'f-2026', name: '2026', parentId: 'f-upwork' },
      { id: 'f-empty', name: 'Empty Month', parentId: 'f-2026' },
      { id: 'f-10', name: '10', parentId: 'f-2026' },
      { id: 'f-clients', name: 'Клиенты', parentId: null },
      { id: 'f-internal', name: 'Внутренние', parentId: null }
    ],
    projectFolderMap: {
      'p-prop': 'f-upwork',
      'p-upw': 'f-upwork',
      'p-up10': 'f-10'
    }
  };

  const { applyFolderPatch } = require('./folders-patch');
  const patched = applyFolderPatch(source, treeConfig);

  // 1. Bundle AST and DOM attribute verification
  assert.ok(patched.includes('"data-project-card":!0,"data-project-id":c,"data-folder-id":a?.folderId,"data-folder-depth":a?.folderDepth'),
    'Project card DOM receives data-folder-id and data-folder-depth');
  assert.ok(patched.includes('"data-testid":"empty-placeholder","data-folder-id":T.folderId,"data-folder-depth":T.folderDepth'),
    'Empty placeholder DOM receives data-folder-id and data-folder-depth');
  assert.ok(patched.includes('"data-group-id":T.groupId,"data-folder-id":T.folderId,"data-folder-depth":T.folderDepth'),
    'Virtual row container receives data-folder-depth');

  // 2. Execute VIb row generator with full multi-level input
  const start = patched.indexOf('function VIb(a)');
  const end = patched.indexOf(';const WIb=', start);
  const render = vm.runInNewContext('(' + patched.slice(start, end) + ')', { window: { __PROJECT_FOLDERS_DATA__: treeConfig } });

  const input = {
    groups: [
      { id: 'p-prop', label: 'Upwork Proposals', items: [{ cascadeId: 'c-prop-1', summary: {} }] },
      { id: 'p-upw', label: 'Upwork', items: [] },
      { id: 'p-up10', label: 'U.P - 2026-10-11 - howa...', items: [{ cascadeId: 'c-up10-1', summary: {} }] },
      { id: 'p-unassigned', label: 'Standalone Project', items: [] }
    ],
    groupBy: 'project', collapsedSectionIds: [], collapsedSectionHeaderIds: [], conversationGroupSections: [],
    sectionHeader: { title: 'Projects', isCollapsed: false }, variant: 'sidebar', onlyShowFirstFewConvos: {},
    isMobile: false, sortedPinnedIds: [], includePinnedSection: false
  };

  const rows = render(input);

  // Verify Root Folder: Upwork (depth 0, clean title without number count)
  const upworkHeader = rows.find(r => r.folderId === 'f-upwork' && r.type === 'section-header');
  assert.ok(upworkHeader, 'Upwork folder header exists');
  assert.equal(upworkHeader.folderDepth, 0, 'Upwork folder has depth 0');
  assert.equal(upworkHeader.title, '📁 Upwork', 'Upwork folder title is clean without number count');

  // Verify Direct Projects in Upwork: Upwork Proposals and Upwork (depth 1)
  const propHeader = rows.find(r => r.id === 'header-p-prop');
  assert.ok(propHeader, 'Upwork Proposals project exists');
  assert.equal(propHeader.folderDepth, 1, 'Upwork Proposals has depth 1');
  assert.equal(propHeader.folderId, 'f-upwork', 'Upwork Proposals belongs to f-upwork');

  const propConvo = rows.find(r => r.id === 'c-prop-1');
  assert.ok(propConvo, 'Upwork Proposals conversation exists');
  assert.equal(propConvo.folderDepth, 1, 'Upwork Proposals conversation inherits depth 1');

  const upwHeader = rows.find(r => r.id === 'header-p-upw');
  assert.ok(upwHeader, 'Upwork project exists');
  assert.equal(upwHeader.folderDepth, 1, 'Upwork project has depth 1');
  assert.equal(upwHeader.folderId, 'f-upwork', 'Upwork project belongs to f-upwork');

  // Verify Subfolder Level 1: 2026 (depth 1, clean title)
  const f2026Header = rows.find(r => r.folderId === 'f-2026' && r.type === 'section-header');
  assert.ok(f2026Header, '2026 subfolder header exists');
  assert.equal(f2026Header.folderDepth, 1, '2026 subfolder has depth 1');
  assert.equal(f2026Header.title, '📁 2026', '2026 subfolder title is clean without number count');

  // Verify Empty Subfolder inside 2026: Empty Month (depth 2 for header, depth 3 for placeholder)
  const fEmptyHeader = rows.find(r => r.folderId === 'f-empty' && r.type === 'section-header');
  assert.ok(fEmptyHeader, 'Empty Month subfolder header exists');
  assert.equal(fEmptyHeader.folderDepth, 2, 'Empty Month subfolder header has depth 2');
  assert.equal(fEmptyHeader.title, '📁 Empty Month', 'Empty Month subfolder title is clean without number count');

  const emptyPlaceholder = rows.find(r => r.id === 'empty-folder-f-empty');
  assert.ok(emptyPlaceholder, 'Empty placeholder exists for empty folder');
  assert.equal(emptyPlaceholder.folderDepth, 3, 'Empty placeholder has depth 3 (indented inside depth 2 folder)');
  assert.equal(emptyPlaceholder.label, '(папка пуста)');

  // Verify Subfolder Level 2: 10 (depth 2, clean title)
  const f10Header = rows.find(r => r.folderId === 'f-10' && r.type === 'section-header');
  assert.ok(f10Header, '10 subfolder header exists');
  assert.equal(f10Header.folderDepth, 2, '10 subfolder has depth 2');
  assert.equal(f10Header.title, '📁 10', '10 subfolder title is clean without number count');

  // Verify Project inside Subfolder 10: U.P - 2026-10-11 - howa... (depth 3!)
  const up10Header = rows.find(r => r.id === 'header-p-up10');
  assert.ok(up10Header, 'U.P project exists');
  assert.equal(up10Header.folderDepth, 3, 'U.P project in folder 10 has depth 3 (NOT flattened to 1)');
  assert.equal(up10Header.folderId, 'f-10', 'U.P project belongs to folder 10');

  const up10Convo = rows.find(r => r.id === 'c-up10-1');
  assert.ok(up10Convo, 'U.P conversation exists');
  assert.equal(up10Convo.folderDepth, 3, 'U.P conversation inherits depth 3');
  assert.equal(up10Convo.folderId, 'f-10', 'U.P conversation belongs to folder 10');

  // Verify Other Root Folders: Клиенты and Внутренние (depth 0, clean titles)
  const clientsHeader = rows.find(r => r.folderId === 'f-clients');
  assert.ok(clientsHeader, 'Клиенты folder header exists');
  assert.equal(clientsHeader.folderDepth, 0, 'Клиенты has depth 0');
  assert.equal(clientsHeader.title, '📁 Клиенты', 'Клиенты folder title is clean without number count');

  const internalHeader = rows.find(r => r.folderId === 'f-internal');
  assert.ok(internalHeader, 'Внутренние folder header exists');
  assert.equal(internalHeader.folderDepth, 0, 'Внутренние has depth 0');
  assert.equal(internalHeader.title, '📁 Внутренние', 'Внутренние folder title is clean without number count');

  // Verify Unassigned Project at Root (depth 0)
  const unassignedHeader = rows.find(r => r.id === 'header-p-unassigned');
  assert.ok(unassignedHeader, 'Unassigned project exists');
  assert.equal(unassignedHeader.folderDepth, 0, 'Unassigned project has depth 0');

  // 3. Verify CSS rules structure and geometry alignment
  const css = fs.readFileSync(path.join(__dirname, '../../CSS/code/style.css'), 'utf8');
  assert.ok(css.includes('--folder-indent-unit: 14px'), 'CSS defines indent unit');
  assert.ok(css.includes('> div.w-full.h-full'), 'CSS resets outer conversation container padding');
  assert.ok(css.includes(':not(.h-full):not(:has([data-testid]))'), 'CSS isolates See All pagination button');
  assert.ok(css.includes("button[data-project-card][data-folder-depth]"), 'CSS targets project cards by depth');
  assert.ok(css.includes("[data-testid='empty-placeholder'][data-folder-depth]"), 'CSS targets empty placeholders by depth');
  assert.ok(css.includes(".group\\/section-header[data-folder-id]"), 'CSS targets folder headers systematically');
  assert.ok(css.includes("button[data-project-card][data-folder-depth='3']"), 'CSS includes explicit depth 3 rule for nested projects');

  // 4. Geometry and visual hierarchy assertions
  // Inline CSS custom property injection for infinite tree depth scalability
  assert.ok(patched.includes('--folder-depth":T.folderDepth'), 'Virtual row container sets --folder-depth in inline style');

  // Chevron expand arrow rules for consistent visibility
  assert.ok(css.includes("opacity: 0.45 !important"), 'Folder chevron is subtly visible in all states');
  assert.ok(css.includes("opacity: 0.85 !important"), 'Folder chevron brightens on hover');

  // Exact icon alignment: folder header base 8px matches project icon (4px padding + 4px offset in 24px icon box)
  assert.ok(css.includes("calc(8px + var(--folder-depth"), 'Folder header base padding 8px matches project icon position');
  assert.ok(css.includes("calc(4px + var(--folder-depth"), 'Project card base padding 4px');

  // Exact text alignment: conversation rows & placeholders align with project title at 30px base
  assert.ok(css.includes("calc(30px + var(--folder-depth"), 'Conversation rows and placeholders align with project title (30px base)');
  assert.ok(css.includes("calc(22px + var(--folder-depth"), 'See all container base 22px + 8px button aligns with 30px text');

  // Depth mapping covers up to depth 12
  assert.ok(css.includes("[data-folder-depth='12']"), 'CSS custom property mapping scales up to depth 12');
});

test('Windows Explorer alphabetical natural sorting: folders at all hierarchy levels, select options, and context menus', () => {
  const source = fs.readFileSync(path.join(process.env.TEMP, 'antigravity_main.js'), 'utf8');

  // Input folders in deliberately shuffled, non-alphabetical order
  const shuffledConfig = {
    folders: [
      { id: 'f-clients', name: 'Клиенты', parentId: null },
      { id: 'f-archive', name: '02 Archive', parentId: null },
      { id: 'f-internal', name: 'Внутренние', parentId: null },
      { id: 'f-active', name: '01 Active', parentId: null },
      { id: 'f-ten', name: '10 Reports', parentId: null },
      { id: 'f-upwork', name: 'Upwork', parentId: null },
      // Subfolders in f-ten in scrambled numeric order
      { id: 'sub-19', name: '19', parentId: 'f-ten' },
      { id: 'sub-09', name: '09', parentId: 'f-ten' },
      { id: 'sub-2', name: '2', parentId: 'f-ten' },
      { id: 'sub-10', name: '10', parentId: 'f-ten' },
      { id: 'sub-1', name: '1', parentId: 'f-ten' }
    ],
    projectFolderMap: {
      'p-active': 'f-active',
      'p-sub1': 'sub-1'
    }
  };

  const { applyFolderPatch } = require('./folders-patch');
  const patched = applyFolderPatch(source, shuffledConfig);

  const start = patched.indexOf('function VIb(a)');
  const end = patched.indexOf(';const WIb=', start);
  const render = vm.runInNewContext('(' + patched.slice(start, end) + ')', { window: { __PROJECT_FOLDERS_DATA__: shuffledConfig } });

  const input = {
    groups: [
      { id: 'p-active', label: 'Active Project', items: [] },
      { id: 'p-sub1', label: 'Sub 1 Project', items: [] }
    ],
    groupBy: 'project', collapsedSectionIds: [], collapsedSectionHeaderIds: [], conversationGroupSections: [],
    sectionHeader: { title: 'Projects', isCollapsed: false }, variant: 'sidebar', onlyShowFirstFewConvos: {},
    isMobile: false, sortedPinnedIds: [], includePinnedSection: false
  };

  const rows = render(input);

  // 1. Verify root-level folders are sorted in natural Windows Explorer order:
  // Numbers (01, 02, 10) -> Latin (Upwork) -> Cyrillic (Внутренние before Клиенты)
  const rootFolderRows = [...rows.filter(r => r.type === 'section-header' && r.folderDepth === 0)];
  const rootNames = rootFolderRows.map(r => r.folderName);
  assert.deepEqual(rootNames, [
    '01 Active',
    '02 Archive',
    '10 Reports',
    'Upwork',
    'Внутренние',
    'Клиенты'
  ], 'Root folders must follow Windows Explorer natural alphabetical sort');

  // 2. Verify subfolders under "10 Reports" are sorted in natural numeric order:
  // "1", "2", "09", "10", "19"
  const subFolderRows = [...rows.filter(r => r.type === 'section-header' && r.folderDepth === 1 && r.id.startsWith('section-folder-sub-'))];
  const subNames = subFolderRows.map(r => r.folderName);
  assert.deepEqual(subNames, [
    '1',
    '2',
    '09',
    '10',
    '19'
  ], 'Subfolders must follow Windows Explorer natural numeric sort (1, 2, 09, 10, 19)');

  // 3. Verify client controller buildFolderSelectOptions sorting
  const clientSource = fs.readFileSync(path.join(__dirname, 'folders-client.js'), 'utf8');
  const mockWin = { __PROJECT_FOLDERS_DATA__: shuffledConfig, addEventListener() {}, document: { addEventListener() {} } };
  const ctx = {
    window: mockWin,
    document: { documentElement: {}, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ style: {}, classList: { add() {} } }) },
    MutationObserver: class { observe() {} disconnect() {} },
    console: { log() {}, warn() {}, error() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(clientSource, ctx);

  const client = mockWin.__PROJECT_FOLDERS_CLIENT__;
  assert.ok(client, 'Folders client initialized');
  const selectHtml = client.buildFolderSelectOptions();

  // Root options order in HTML
  const rootMatch = [...selectHtml.matchAll(/value="([^"]+)"\s*>📁 ([^<]+)<\/option>/g)].map(m => m[2]);
  assert.deepEqual(rootMatch, [
    '01 Active',
    '02 Archive',
    '10 Reports',
    'Upwork',
    'Внутренние',
    'Клиенты'
  ], 'Dropdown options must list root folders in Windows Explorer natural order');
});


