/**
 * uninstall-folders.js
 * Safely removes folders hook from bootstrap.js.
 */

const fs = require('fs');
const { BOOTSTRAP_PATH } = require('./install-folders');

function uninstall() {
  if (!fs.existsSync(BOOTSTRAP_PATH)) {
    console.log('[uninstall-folders] Target file not found.');
    return;
  }

  const content = fs.readFileSync(BOOTSTRAP_PATH, 'utf8');
  const lines = content.split('\n');

  const filtered = lines.filter(line => !line.includes('folders-bootstrap'));

  if (filtered.length === lines.length) {
    console.log('[uninstall-folders] Hook was not found in bootstrap.js. Nothing changed.');
    return;
  }

  fs.writeFileSync(BOOTSTRAP_PATH, filtered.join('\n'), 'utf8');
  console.log('[uninstall-folders] Successfully uninstalled folders hook from bootstrap.js.');
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
