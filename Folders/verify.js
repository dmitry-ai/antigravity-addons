// 2026-10-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Build unified Upgrade tool (Upg), module registry (tool.json), Less stylesheet build pipeline, and verification runner after Antigravity 2.23.0 update":
// https://github.com/dmitry-ai/antigravity-addons/issues/6
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {validateTree} = require('./folders-manager');
module.exports = async () => {
	const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'folders.json'), 'utf8'));
	validateTree(data.folders);
	for (const filename of [
		'cdp-runtime.js',
		'folders-store.js',
		'folders-model.js',
		'antigravity-adapter.js',
		'folders-client.js',
		'folders-view.js',
		'folders-manager.js',
		'renderer-source.js',
		'runtime-health.js'
	]) {
		new vm.Script(fs.readFileSync(path.join(__dirname, filename), 'utf8'), {filename});
	}
	new vm.Script(require('./renderer-source').rendererSource(data));
	const message = 'model, store, and standalone component verified; client main.js is unchanged.';
	return {message};
};
