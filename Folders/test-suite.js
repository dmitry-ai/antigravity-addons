/**
 * test-suite.js
 * Comprehensive automated verification test suite for Folders Method 1.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { applyFolderPatch, LOOP_ANCHOR, LOOP_END } = require('./folders-patch');
const { readConfig, addFolder, removeFolder, assignProject, unassignProject, DEFAULT_CONFIG_PATH } = require('./folders-manager');

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

    console.log('--- TEST 2: Syntax and AST validity of patched main.js ---');
    const mockConfig = {
      folders: [{ id: 'test-folder', name: 'Test Folder', color: '#ff0000' }],
      projectFolderMap: { 'mock-p1': 'test-folder' }
    };
    const patchedSource = applyFolderPatch(mainSource, mockConfig);
    assert(patchedSource.length > mainSource.length, 'Patched source is larger than original source');
    assert(patchedSource.includes('window.__PROJECT_FOLDERS_DATA__'), 'Header contains window.__PROJECT_FOLDERS_DATA__');
    assert(patchedSource.includes('📁 '), 'Contains folder icon prefix');

    // V8 compiler parse check
    new vm.Script(patchedSource);
    assert(true, 'Patched main.js parsed by V8 compiler with zero syntax errors');
  } else {
    console.warn('⚠️ Skipped main.js AST test: temp antigravity_main.js not found');
  }

  console.log('--- TEST 3: folders-manager operations on isolated mock config ---');
  const mockConfigPath = path.join(__dirname, 'mock-folders-test.json');
  try {
    fs.writeFileSync(mockConfigPath, JSON.stringify({ folders: [], projectFolderMap: {} }), 'utf8');

    addFolder('fld-1', 'Alpha', '#ffffff', mockConfigPath);
    let cfg = readConfig(mockConfigPath);
    assert(cfg.folders.length === 1 && cfg.folders[0].name === 'Alpha', 'Folder Alpha added');

    assignProject('proj-x', 'fld-1', mockConfigPath);
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
