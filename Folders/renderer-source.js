// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const filenames = ['folders-model.js', 'antigravity-adapter.js', 'folders-client.js', 'folders-view.js'];
const rendererSource = data => {
	const scripts = filenames.map(filename => fs.readFileSync(path.join(__dirname, filename), 'utf8')).join('\n;\n');
	const version = crypto.createHash('sha256').update(scripts).digest('hex');
	const css = fs.readFileSync(path.join(__dirname, 'folders-view.css'), 'utf8');
	return `(() => {let r;if('/onboarding'===location.pathname||location.pathname.startsWith('/onboarding/')){window.__PROJECT_FOLDERS_VIEW__?.dispose();window.__PROJECT_FOLDERS_CLIENT__?.dispose?.();delete window.__FOLDERS_RUNTIME_VERSION__;r={attached:false,reason:'onboarding'};}else if(${JSON.stringify(version)}===window.__FOLDERS_RUNTIME_VERSION__){r={attached:true};}else if(window.__PROJECT_FOLDERS_CLIENT__&&!window.__PROJECT_FOLDERS_CLIENT__.dispose){window.__PROJECT_FOLDERS_PENDING_UPGRADE__=2;r={attached:false,reason:'legacy-client'};}else if(window.__PROJECT_FOLDERS_CLIENT__?.activeModal||window.__PROJECT_FOLDERS_CLIENT__?.activeMenu||document.querySelector('.folder-rename-input')){r={attached:false,reason:'user-dialog'};}else{window.__PROJECT_FOLDERS_VIEW__?.dispose();window.__PROJECT_FOLDERS_CLIENT__?.dispose?.();window.__FOLDERS_STANDALONE__=true;window.__FOLDERS_STYLE__=${JSON.stringify(css)};window.__PROJECT_FOLDERS_DATA__=${JSON.stringify(data)};\n${scripts}\n;window.__FOLDERS_RUNTIME_VERSION__=${JSON.stringify(version)};r={attached:true};}return r;})()`;
};
module.exports = {rendererSource, filenames};
