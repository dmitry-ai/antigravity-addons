// deploy.js — Installs/updates the Project Folders plugin in Antigravity

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET_DIR = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'project-folders');

console.log('[ProjectFolders] Deploying plugin...');
console.log('Source:', HERE);
console.log('Target:', TARGET_DIR);

try {
  // Ensure target directory exists
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  // Copy files with overwrite (works even if process is running in directory)
  fs.cpSync(HERE, TARGET_DIR, {
    recursive: true,
    force: true,
    filter: (src) => {
      const base = path.basename(src);
      // Skip git or local temp data
      return base !== '.git' && base !== '.data' && base !== 'node_modules';
    }
  });

  console.log('✅ Plugin successfully deployed to:', TARGET_DIR);
  console.log('\nДля активации в Antigravity:');
  console.log('1. Откройте панель "Customizations" (в левом сайдбаре снизу) -> вкладка "Installed".');
  console.log('2. Убедитесь, что переключатель у плагина "Project Folders" включен.');
  console.log('3. В любом диалоге в правом верхнем углу нажмите меню "⋮" -> Extensions -> выберите "Project Folders".');
} catch (err) {
  console.error('❌ Deployment error:', err.message);
  process.exit(1);
}
