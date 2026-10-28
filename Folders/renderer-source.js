const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const filenames = ['folders-model.js', 'antigravity-adapter.js', 'folders-client.js', 'folders-view.js'];
const rendererSource = data => {
	const scripts = filenames.map(filename => fs.readFileSync(path.join(__dirname, filename), 'utf8')).join('\n;\n');
	const version = crypto.createHash('sha256').update(scripts).digest('hex');
	const css = fs.readFileSync(path.join(__dirname, 'folders-view.css'), 'utf8');
	return `(() => {if(window.__FOLDERS_RUNTIME_VERSION__===${JSON.stringify(version)})return {attached:true};if(window.__PROJECT_FOLDERS_CLIENT__&&!window.__PROJECT_FOLDERS_CLIENT__.dispose){window.__PROJECT_FOLDERS_PENDING_UPGRADE__=2;return {attached:false,reason:'legacy-client'};}if(window.__PROJECT_FOLDERS_CLIENT__?.activeModal||window.__PROJECT_FOLDERS_CLIENT__?.activeMenu||document.querySelector('.folder-rename-input'))return {attached:false,reason:'user-dialog'};window.__PROJECT_FOLDERS_VIEW__?.dispose();window.__PROJECT_FOLDERS_CLIENT__?.dispose?.();window.__FOLDERS_STANDALONE__=true;window.__FOLDERS_STYLE__=${JSON.stringify(css)};window.__PROJECT_FOLDERS_DATA__=${JSON.stringify(data)};\n${scripts}\n;window.__FOLDERS_RUNTIME_VERSION__=${JSON.stringify(version)};return {attached:true};})()`;
};
module.exports = {rendererSource, filenames};
