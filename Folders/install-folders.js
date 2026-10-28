/**
 * install-folders.js
 * Enables Folders in its Upgrade tool.json manifest.
 * Preserves the previous manifest in tool.json.bak; does not patch app.asar.
 */
const fs = require('fs');
const path = require('path');
function install() {
	setEnabled(true);
	console.log('[install-folders] Folders включён в tool.json. Запустите Upg; закрывать Antigravity не требуется.');
}
function setEnabled(enabled) {
	const filename = path.join(__dirname, 'tool.json');
	const content = fs.readFileSync(filename, 'utf8');
	const tool = JSON.parse(content);
  // Backup
	fs.writeFileSync(`${filename}.bak`, content, 'utf8');
	tool.enabled = enabled;
	fs.writeFileSync(filename, JSON.stringify(tool, null, '\t') + '\n');
}
if (require.main === module) {
  try {
    install();
  } catch (err) {
    console.error('[install-folders] Error:', err.message);
    process.exit(1);
  }
}
module.exports = {install, setEnabled};
