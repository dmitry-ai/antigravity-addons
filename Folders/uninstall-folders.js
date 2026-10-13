/**
 * uninstall-folders.js
 * Disables Folders in tool.json; configuration is preserved and a restart is required.
 */
const { setEnabled } = require('./install-folders');
function uninstall() {
	setEnabled(false);
	console.log('[uninstall-folders] Folders отключён в tool.json. Перезапустите Antigravity.');
}
if (require.main === module) {
  try {
    uninstall();
  } catch (err) {
    console.error('[uninstall-folders] Error:', err.message);
    process.exit(1);
  }
}
module.exports = uninstall;
