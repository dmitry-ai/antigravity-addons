/**
 * folders-manager.js
 * CLI and API tool to manage folders and project assignments.
 * Usage:
 *   node folders-manager.js list
 *   node folders-manager.js add-folder <id> <name> [color]
 *   node folders-manager.js assign <projectId> <folderId>
 *   node folders-manager.js unassign <projectId>
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, 'folders.json').replace(/\\/g, '/');

function readConfig(configPath = DEFAULT_CONFIG_PATH) {
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  return { folders: [], projectFolderMap: {}, collapsedFolders: [] };
}

function writeConfig(data, configPath = DEFAULT_CONFIG_PATH) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
}

function addFolder(id, name, color = '#3b82f6', configPath = DEFAULT_CONFIG_PATH) {
  const data = readConfig(configPath);
  const existing = data.folders.find(f => f.id === id);
  if (existing) {
    existing.name = name;
    existing.color = color;
  } else {
    data.folders.push({ id, name, parentId: null, color, isExpanded: true });
  }
  writeConfig(data, configPath);
  console.log(`Folder "${name}" (${id}) saved.`);
}

function removeFolder(id, configPath = DEFAULT_CONFIG_PATH) {
  const data = readConfig(configPath);
  data.folders = data.folders.filter(f => f.id !== id);
  for (const [projId, fId] of Object.entries(data.projectFolderMap)) {
    if (fId === id) {
      delete data.projectFolderMap[projId];
    }
  }
  writeConfig(data, configPath);
  console.log(`Folder (${id}) removed.`);
}

function assignProject(projectId, folderId, configPath = DEFAULT_CONFIG_PATH) {
  const data = readConfig(configPath);
  data.projectFolderMap[projectId] = folderId;
  writeConfig(data, configPath);
  console.log(`Project ${projectId} assigned to folder ${folderId}.`);
}

function unassignProject(projectId, configPath = DEFAULT_CONFIG_PATH) {
  const data = readConfig(configPath);
  delete data.projectFolderMap[projectId];
  writeConfig(data, configPath);
  console.log(`Project ${projectId} unassigned.`);
}

function listAll(configPath = DEFAULT_CONFIG_PATH) {
  const data = readConfig(configPath);
  console.log('=== Configured Folders ===');
  data.folders.forEach(f => {
    const projs = Object.entries(data.projectFolderMap)
      .filter(([_, fid]) => fid === f.id)
      .map(([pid]) => pid);
    console.log(`- [${f.id}] ${f.name} (${projs.length} projects)`);
    projs.forEach(pid => console.log(`    ↳ ${pid}`));
  });
}

// CLI handler
if (require.main === module) {
  const [,, cmd, arg1, arg2, arg3] = process.argv;
  switch (cmd) {
    case 'list':
      listAll();
      break;
    case 'add-folder':
      if (!arg1 || !arg2) {
        console.error('Usage: node folders-manager.js add-folder <id> <name> [color]');
        process.exit(1);
      }
      addFolder(arg1, arg2, arg3);
      break;
    case 'remove-folder':
      if (!arg1) {
        console.error('Usage: node folders-manager.js remove-folder <id>');
        process.exit(1);
      }
      removeFolder(arg1);
      break;
    case 'assign':
      if (!arg1 || !arg2) {
        console.error('Usage: node folders-manager.js assign <projectId> <folderId>');
        process.exit(1);
      }
      assignProject(arg1, arg2);
      break;
    case 'unassign':
      if (!arg1) {
        console.error('Usage: node folders-manager.js unassign <projectId>');
        process.exit(1);
      }
      unassignProject(arg1);
      break;
    default:
      console.log('Usage: node folders-manager.js [list|add-folder|remove-folder|assign|unassign]');
      listAll();
  }
}

module.exports = {
  readConfig,
  writeConfig,
  addFolder,
  removeFolder,
  assignProject,
  unassignProject,
  listAll,
  DEFAULT_CONFIG_PATH
};
