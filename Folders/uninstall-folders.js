// 2026-10-12 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement left-sidebar project folders (Folders), CLI manager, installer scripts, and remove right-panel sidecar prototype":
// https://github.com/dmitry-ai/antigravity-addons/issues/3
const {setEnabled} = require('./install-folders');
function uninstall() {
	setEnabled(false);
	console.log('[uninstall-folders] Folders disabled in tool.json. Run Upg; data is preserved, and closing Antigravity is not required.');
}
if (require.main === module) {
	try {
		uninstall();
	}
	catch (err) {
		console.error('[uninstall-folders] Error:', err.message);
		process.exit(1);
	}
}
module.exports = uninstall;
