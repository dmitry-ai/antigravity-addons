// undeploy.js — Uninstalls the Project Folders plugin from Antigravity

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TARGET_DIR = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'project-folders');

console.log('[ProjectFolders] Removing plugin from:', TARGET_DIR);

try {
  if (fs.existsSync(TARGET_DIR)) {
    fs.rmSync(TARGET_DIR, { recursive: true, force: true });
    console.log('✅ Plugin successfully removed.');
  } else {
    console.log('ℹ️ Plugin directory does not exist.');
  }
} catch (err) {
  console.error('❌ Error removing plugin:', err.message);
  process.exit(1);
}
