/**
 * uninstall-folders.js
 * Disables Folders in tool.json; Upg reconnects Tools without restarting Antigravity.
 */
const { setEnabled } = require('./install-folders');
function uninstall() {
	setEnabled(false);
	console.log('[uninstall-folders] Folders отключён в tool.json. Запустите Upg; данные сохраняются, Antigravity закрывать не требуется.');
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
