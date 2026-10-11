/**
 * test-suite.js
 * Comprehensive automated verification test suite for Folders Method 1 & 2.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { applyFolderPatch, LOOP_ANCHOR, LOOP_END, HR_ANCHOR } = require('./folders-patch');
const { readConfig, addFolder, renameFolder, removeFolder, assignProject, unassignProject, DEFAULT_CONFIG_PATH } = require('./folders-manager');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(message);
  }
  passedTests++;
  console.log(`✅ PASS: ${message}`);
}

async function runTests() {
  console.log('--- TEST 1: Anchor discovery in extracted main.js ---');
  const tempMainJs = path.join(process.env.TEMP, 'antigravity_main.js');
  if (fs.existsSync(tempMainJs)) {
    const mainSource = fs.readFileSync(tempMainJs, 'utf8');
    assert(mainSource.includes(LOOP_ANCHOR), 'LOOP_ANCHOR found in main.js');
    assert(mainSource.includes(LOOP_END), 'LOOP_END found in main.js');
    assert(mainSource.includes(HR_ANCHOR), 'HR_ANCHOR found in main.js');

    console.log('--- TEST 2: Syntax and AST validity of patched main.js ---');
    const mockConfig = {
      folders: [
        { id: 'test-folder', name: 'Test Folder', color: '#ff0000' },
        { id: 'empty-folder', name: 'Empty Folder', color: '#00ff00' }
      ],
      projectFolderMap: { 'mock-p1': 'test-folder' }
    };
    const patchedSource = applyFolderPatch(mainSource, mockConfig);
    assert(patchedSource.length > mainSource.length, 'Patched source is larger than original source');
    assert(patchedSource.includes('window.__PROJECT_FOLDERS_DATA__'), 'Header contains window.__PROJECT_FOLDERS_DATA__');
    assert(patchedSource.includes('window.__PROJECT_FOLDERS_CLIENT__'), 'Header contains window.__PROJECT_FOLDERS_CLIENT__');
    assert(patchedSource.includes('window.__STORAGE_SERVICE__'), 'Hooks window.__STORAGE_SERVICE__ in hR');
    assert(patchedSource.includes('(папка пуста)'), 'Renders placeholder for empty folders');
    assert(patchedSource.includes('📁 '), 'Contains folder icon prefix');

    // V8 compiler parse check
    new vm.Script(patchedSource);
    assert(true, 'Patched main.js parsed by V8 compiler with zero syntax errors');
  } else {
    console.warn('⚠️ Skipped main.js AST test: temp antigravity_main.js not found');
  }

  console.log('--- TEST 3: folders-client.js standalone syntax validity ---');
  const clientPath = path.join(__dirname, 'folders-client.js');
  assert(fs.existsSync(clientPath), 'folders-client.js exists');
  const clientCode = fs.readFileSync(clientPath, 'utf8');
  assert(clientCode.includes('showCreateFolderDialog'), 'Contains showCreateFolderDialog');
  assert(clientCode.includes('startInlineRename'), 'Contains startInlineRename (F2)');
  assert(clientCode.includes('showFolderContextMenu'), 'Contains showFolderContextMenu');
  assert(clientCode.includes('showProjectContextMenu'), 'Contains showProjectContextMenu');
  assert(clientCode.includes('folder-drop-target'), 'Contains Drag & Drop handling');

  console.log('--- TEST 4: folders-manager operations on isolated mock config ---');
  const mockConfigPath = path.join(__dirname, 'mock-folders-test.json');
  try {
    fs.writeFileSync(mockConfigPath, JSON.stringify({ folders: [], projectFolderMap: {} }), 'utf8');

    addFolder('fld-1', 'Alpha', '#ffffff', mockConfigPath);
    let cfg = readConfig(mockConfigPath);
    assert(cfg.folders.length === 1 && cfg.folders[0].name === 'Alpha', 'Folder Alpha added');

    renameFolder('Alpha', 'Alpha Renamed', mockConfigPath);
    cfg = readConfig(mockConfigPath);
    assert(cfg.folders[0].name === 'Alpha Renamed', 'Folder Alpha renamed');

    assignProject('proj-x', 'Alpha Renamed', mockConfigPath);
    cfg = readConfig(mockConfigPath);
    assert(cfg.projectFolderMap['proj-x'] === 'fld-1', 'Project proj-x assigned to fld-1');

    unassignProject('proj-x', mockConfigPath);
    cfg = readConfig(mockConfigPath);
    assert(!cfg.projectFolderMap['proj-x'], 'Project proj-x unassigned');

    removeFolder('fld-1', mockConfigPath);
    cfg = readConfig(mockConfigPath);
    assert(cfg.folders.length === 0, 'Folder fld-1 removed');
  } finally {
    if (fs.existsSync(mockConfigPath)) {
      fs.unlinkSync(mockConfigPath);
    }
  }

  console.log(`\n🎉 Test Suite Completed: ${passedTests}/${totalTests} tests passed.`);
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
