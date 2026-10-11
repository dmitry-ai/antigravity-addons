/**
 * install-folders.js
 * Safely wires folders-bootstrap.js into bootstrap.js.
 * Preserves backups and verifies code integrity before writing.
 */

const fs = require('fs');
const path = require('path');

const BOOTSTRAP_PATH = 'C:/work/research/provision/code/Software/Google/AI/Antigravity/ꙮ/2026/10/11/1 - UI/code/bootstrap.js';
const FOLDERS_BOOTSTRAP_PATH = path.join(__dirname, 'folders-bootstrap.js').replace(/\\/g, '/');

const INJECTION_LINE = `\ttry { require('${FOLDERS_BOOTSTRAP_PATH}')(win); } catch (e) { console.error('[folders-bootstrap]', e); }`;

function install() {
  if (!fs.existsSync(BOOTSTRAP_PATH)) {
    throw new Error(`Target bootstrap file not found at: ${BOOTSTRAP_PATH}`);
  }

  const content = fs.readFileSync(BOOTSTRAP_PATH, 'utf8');

  if (content.includes('folders-bootstrap')) {
    console.log('[install-folders] Already installed in bootstrap.js.');
    return;
  }

  const anchor = 'module.exports = win => {';
  const idx = content.indexOf(anchor);

  if (idx === -1) {
    throw new Error(`Anchor "${anchor}" not found in ${BOOTSTRAP_PATH}`);
  }

  // Backup
  fs.writeFileSync(`${BOOTSTRAP_PATH}.bak`, content, 'utf8');

  const modified = content.replace(anchor, `${anchor}\n${INJECTION_LINE}`);
  fs.writeFileSync(BOOTSTRAP_PATH, modified, 'utf8');

  console.log('[install-folders] Successfully installed folders hook into bootstrap.js.');
  console.log('Backup saved at:', `${BOOTSTRAP_PATH}.bak`);
}

if (require.main === module) {
  try {
    install();
  } catch (err) {
    console.error('[install-folders] Error:', err.message);
    process.exit(1);
  }
}

module.exports = { install, BOOTSTRAP_PATH, INJECTION_LINE };
