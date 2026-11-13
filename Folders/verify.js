// 2026-10-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Build unified Upgrade tool (Upg), module registry (tool.json), Less stylesheet build pipeline, and verification runner after Antigravity 2.23.0 update":
// https://github.com/dmitry-ai/antigravity-addons/issues/6
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Merge Folders browser UI layer (folders-client.js + folders-view.js) and purge dead v1 Less selectors":
// https://github.com/dmitry-ai/antigravity-addons/issues/34
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Unify Folders domain validation, tree traversal helpers, store checks, and CLI listing/mutations around folders-model.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/31
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {rendererSource} = require('./cdp-runtime');
const {validateConfig} = require('./folders-model');
module.exports = async () => {
	const raw = fs.readFileSync(path.join(__dirname, 'folders.json'), 'utf8').replace(/^\uFEFF/, '');
	const data = JSON.parse(raw);
	validateConfig(data);
	new vm.Script(rendererSource(data));
	return {message: 'model, store, and standalone component verified; client main.js is unchanged.'};
};
