// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace Less build pipeline and tracked CSS/style.css with native Chromium CSS concatenated in memory":
// https://github.com/dmitry-ai/antigravity-addons/issues/43
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Unify temporary directory fixtures and CDP/Electron/Connect-RPC test mocks across Upgrade, Multi-Account, and Folders":
// https://github.com/dmitry-ai/antigravity-addons/issues/37
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {discover} = require('./registry');
const {createTempDir} = require('./test-helpers');
const {parseArguments} = require('./upgrade');
const fixture = context => {
	const root = createTempDir(context, 'antigravity-registry-');
	const add = (name, manifest) => {
		const r = path.join(root, name);
		fs.mkdirSync(r, {recursive: true});
		fs.writeFileSync(path.join(r, 'cdp.js'), 'module.exports=()=>({})');
		fs.writeFileSync(path.join(r, 'helper.js'), 'module.exports={}');
		fs.writeFileSync(path.join(r, 'tool.json'), JSON.stringify({schemaVersion: 1, cdp: 'cdp.js', ...manifest}));
		return r;
	};
	return {root, add};
};
test('CDP registry discovers added modules, respects dependencies, and resolves declared Node files', context => {
	const {root, add} = fixture(context);
	const folderCode = add('Folders', {id: 'folders', order: 1, dependsOn: ['css'], runtimeFiles: ['helper.js']});
	add('CSS', {id: 'css', order: 10});
	add('Disabled', {id: 'disabled', enabled: false});
	const tools = discover(root);
	assert.deepEqual(tools.map(tool => tool.id), ['css', 'folders']);
	assert.deepEqual(tools[1].runtimeFiles, [path.join(folderCode, 'helper.js')]);
});
test('Invalid CDP manifests, missing dependencies, duplicate IDs, and escaped paths fail before loading', context => {
	for (const manifest of [
		{id: 'folders', dependsOn: ['missing']},
		{id: 'folders', entry: 'helper.js'},
		{id: 'folders', cdp: 'missing.js'},
		{id: 'folders', runtimeFiles: ['../outside.js']}
	]) {
		const {root, add} = fixture(context);
		add('Folders', manifest);
		assert.throws(() => discover(root));
	}
	const {root, add} = fixture(context);
	add('A', {id: 'same'});
	add('B', {id: 'same'});
	assert.throws(() => discover(root), /id/);
});
test('The CDP CLI accepts current modes and rejects ambiguous or retired archive options', () => {
	assert.deepEqual(parseArguments([]), {mode: 'apply'});
	for (const mode of ['check', 'dry-run', 'restore', 'help']) {
		assert.deepEqual(parseArguments(['--' + mode]), {mode});
	}
	assert.throws(() => parseArguments(['--check', '--restore']), /one mode/);
	assert.throws(() => parseArguments(['--app-dir', 'C:/unused']), /Unknown argument/);
	assert.throws(() => parseArguments(['--bundle', 'unused.js']), /Unknown argument/);
});
test('Native CSS runtime concatenates modular stylesheets in memory with zero Less runtime dependencies', () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
	assert.equal(pkg.dependencies, undefined);
	const cssRuntime = require('../CSS/cdp-runtime');
	const css = cssRuntime.styleSheet();
	assert.match(css, /--antigravity-tree-row-height:\s*16px/);
	assert.match(css, /\.antigravity-folder-picker/);
	assert.match(css, /\[data-testid='conversation-view'\]/);
	const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
	assert.equal(/^\s*\/\//m.test(withoutComments), false);
	assert.equal(/@tree-/.test(withoutComments), false);
	assert.equal(Object.keys(require.cache).some(key => /[\\/]node_modules[\\/]less[\\/]/.test(key)), false);
});
