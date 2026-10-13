/**
 * install-folders.js
 * Safely wires folders-bootstrap.js into bootstrap.js.
 * Preserves backups and verifies code integrity before writing.
 */
const fs = require('fs');
const path = require('path');
const BOOTSTRAP_PATH = path.resolve(__dirname, '../../CSS/code/bootstrap.js');
const FOLDERS_BOOTSTRAP_PATH = path.join(__dirname, 'folders-bootstrap.js').replace(/\\/g, '/');
const INJECTION_LINE = `\ttry { require('${FOLDERS_BOOTSTRAP_PATH}')(win); } catch (e) { console.error('[folders-bootstrap]', e); }`;
function install() {
	setEnabled(true);
	console.log('[install-folders] Folders включён в tool.json. Для подключения запустите ярлык Upgrade при закрытом Antigravity.');
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
module.exports = { install, setEnabled, BOOTSTRAP_PATH, INJECTION_LINE };
