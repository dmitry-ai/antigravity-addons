// 2026-10-12 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement left-sidebar project folders (Folders), CLI manager, installer scripts, and remove right-panel sidecar prototype":
// https://github.com/dmitry-ai/antigravity-addons/issues/3
const fs = require('fs');
const path = require('path');
function install() {
	setEnabled(true);
	console.log('[install-folders] Folders enabled in tool.json. Run Upg; closing Antigravity is not required.');
}
function setEnabled(enabled) {
	const filename = path.join(__dirname, 'tool.json');
	const content = fs.readFileSync(filename, 'utf8');
	const tool = JSON.parse(content);
	tool.enabled = enabled;
	fs.writeFileSync(filename, JSON.stringify(tool, null, '\t') + '\n');
}
if (require.main === module) {
	try {
		install();
	}
	catch (err) {
		console.error('[install-folders] Error:', err.message);
		process.exit(1);
	}
}
module.exports = {install, setEnabled};
