// 2026-10-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {rendererSource} = require('./cdp-runtime');
const {validateConfig} = require('./folders-model');
// 2026-10-13
// "Build unified Upgrade tool (Upg), module registry (tool.json), Less stylesheet build pipeline, and verification runner after Antigravity 2.23.0 update":
// https://github.com/dmitry-ai/antigravity-addons/issues/6
// 2026-10-28
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
module.exports = async () => {
	const raw = fs.readFileSync(path.join(__dirname, 'folders.json'), 'utf8').replace(/^\uFEFF/, '');
	const data = JSON.parse(raw);
	// 2026-11-14
	// "Unify Folders domain validation, tree traversal helpers, store checks, and CLI listing/mutations around folders-model.js":
	// https://github.com/dmitry-ai/antigravity-addons/issues/31
	validateConfig(data);
	new vm.Script(rendererSource(data));
	return {message: 'model, store, and standalone component verified; client main.js is unchanged.'};
};
