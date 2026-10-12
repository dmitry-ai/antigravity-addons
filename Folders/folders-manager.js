/**
 * folders-manager.js
 * CLI and API tool to manage hierarchical folders and project assignments in Antigravity 2.0.
 * Implements Method 1 from res/16.md: Parent References tree model.
 *
 * Supports:
 * - Arbitrary nesting depths via `parentId`
 * - Same folder names in different branches
 * - Cycle prevention and validation
 * - Promotion of subfolders and projects to parent on folder deletion
 * - Tree traversal, resolution by path, ID, or name
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, 'folders.json').replace(/\\/g, '/');
const PROJECTS_DIR = path.join(process.env.USERPROFILE || 'C:/Users/dfedi', '.gemini/config/projects').replace(/\\/g, '/');

/**
 * Loads all known projects from Antigravity config directory.
 * @returns {Array<{ id: string, name: string }>}
 */
function loadAntigravityProjects() {
  const projects = [];
  try {
    if (fs.existsSync(PROJECTS_DIR)) {
      const files = fs.readdirSync(PROJECTS_DIR);
      for (const f of files) {
        if (f.endsWith('.json')) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8'));
            if (data.id) {
              projects.push({
                id: data.id,
                name: data.name || 'Untitled Project'
              });
            }
          } catch (_) {}
        }
      }
    }
  } catch (err) {
    console.warn('[folders-manager] Could not read Antigravity projects:', err.message);
  }
  return projects;
}

/**
 * Finds a project by ID or by name (case-insensitive partial match).
 * @param {string} query
 * @returns {{ id: string, name: string } | null}
 */
function resolveProject(query) {
  if (!query) return null;
  const projects = loadAntigravityProjects();
  const qLower = query.toLowerCase().trim();

  // 1. Exact ID match
  const byId = projects.find(p => p.id === query);
  if (byId) return byId;

  // 2. Exact Name match (case-insensitive)
  const byExactName = projects.find(p => p.name.toLowerCase() === qLower);
  if (byExactName) return byExactName;

  // 3. Substring match
  const bySub = projects.filter(p => p.name.toLowerCase().includes(qLower));
  if (bySub.length === 1) return bySub[0];
  if (bySub.length > 1) {
    console.warn(`Ambiguous project name "${query}". Matches:`, bySub.map(p => `"${p.name}" (${p.id})`));
    return bySub[0];
  }

  // Fallback: assume raw ID was passed
  return { id: query, name: query };
}

function readConfig(configPath = DEFAULT_CONFIG_PATH) {
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  return { folders: [], projectFolderMap: {}, collapsedFolders: [] };
}

function writeConfig(data, configPath = DEFAULT_CONFIG_PATH) {
  validateTree(data.folders);
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Validates the folder tree structure:
 * 1. All IDs must be unique strings.
 * 2. Every parentId must be null or reference an existing folder.
 * 3. No cycles (walking up parentId never revisits a node).
 * 4. Siblings under the same parent must have unique names (case-insensitive).
 */
function validateTree(folders) {
  if (!Array.isArray(folders)) {
    throw new Error('folders must be an array');
  }

  const idMap = new Map();
  for (const f of folders) {
    if (!f.id || typeof f.id !== 'string') {
      throw new Error(`Invalid folder id: ${JSON.stringify(f.id)}`);
    }
    if (idMap.has(f.id)) {
      throw new Error(`Duplicate folder ID: "${f.id}"`);
    }
    idMap.set(f.id, f);
  }

  // Check parent references & cycles
  for (const f of folders) {
    if (f.parentId !== null && f.parentId !== undefined) {
      if (!idMap.has(f.parentId)) {
        throw new Error(`Folder "${f.name}" (${f.id}) references non-existent parentId: "${f.parentId}"`);
      }

      // Check for cycles by walking up ancestor chain
      const visited = new Set([f.id]);
      let curr = f;
      while (curr.parentId) {
        if (visited.has(curr.parentId)) {
          throw new Error(`Cycle detected in folder hierarchy involving "${f.name}" (${f.id})`);
        }
        visited.add(curr.parentId);
        curr = idMap.get(curr.parentId);
        if (!curr) break;
      }
    }
  }

  // Check sibling name uniqueness
  const siblingGroups = new Map();
  for (const f of folders) {
    const parentKey = f.parentId || '__root__';
    if (!siblingGroups.has(parentKey)) {
      siblingGroups.set(parentKey, new Set());
    }
    const nameLower = (f.name || '').trim().toLowerCase();
    const group = siblingGroups.get(parentKey);
    if (group.has(nameLower)) {
      throw new Error(`Sibling folder name collision under parent "${f.parentId}": "${f.name}"`);
    }
    group.add(nameLower);
  }
}

/**
 * Returns a Set of all descendant IDs for a given folder.
 */
function getDescendantIds(folderId, folders) {
  const childrenMap = new Map();
  for (const f of folders) {
    const pid = f.parentId || null;
    if (!childrenMap.has(pid)) childrenMap.set(pid, []);
    childrenMap.get(pid).push(f.id);
  }

  const descendants = new Set();
  function collect(id) {
    const children = childrenMap.get(id) || [];
    for (const cid of children) {
      descendants.add(cid);
      collect(cid);
    }
  }
  collect(folderId);
  return descendants;
}

/**
 * Computes human-readable breadcrumb path for a folder (e.g. "Upwork / 2026").
 */
function getFolderPath(folderId, folders) {
  const map = new Map(folders.map(f => [f.id, f]));
  const parts = [];
  let curr = map.get(folderId);
  const seen = new Set();
  while (curr && !seen.has(curr.id)) {
    seen.add(curr.id);
    parts.unshift(curr.name);
    curr = curr.parentId ? map.get(curr.parentId) : null;
  }
  return parts.join(' / ');
}

/**
 * Finds a folder by ID, exact name, or path.
 */
function resolveFolder(query, configPath = DEFAULT_CONFIG_PATH) {
  if (!query) return null;
  const data = readConfig(configPath);
  const qTrim = query.trim();
  const qLower = qTrim.toLowerCase();

  // 1. By ID
  const byId = data.folders.find(f => f.id === qTrim);
  if (byId) return byId;

  // 2. By Path (e.g. "Upwork / 2026")
  if (qTrim.includes('/')) {
    const pathParts = qTrim.split('/').map(p => p.trim().toLowerCase());
    let currentParentId = null;
    let currentMatch = null;
    for (const part of pathParts) {
      currentMatch = data.folders.find(f => (f.parentId || null) === currentParentId && f.name.toLowerCase() === part);
      if (!currentMatch) break;
      currentParentId = currentMatch.id;
    }
    if (currentMatch) return currentMatch;
  }

  // 3. Exact Name match
  const byExactName = data.folders.filter(f => f.name.toLowerCase() === qLower);
  if (byExactName.length === 1) return byExactName[0];
  if (byExactName.length > 1) {
    // Return root one or first one
    return byExactName.find(f => f.parentId === null) || byExactName[0];
  }

  // 4. Substring match
  const bySub = data.folders.filter(f => f.name.toLowerCase().includes(qLower));
  if (bySub.length >= 1) return bySub[0];

  return null;
}

/**
 * Generates an ID slug from name.
 */
function slugify(name) {
  return 'folder-' + name.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '');
}

/**
 * Creates or updates a folder.
 * Supports:
 * - addFolder(name, [parentId], [customId], [color], [configPath])
 * - addFolder(id, name, [color], [configPath]) (legacy signature)
 */
function addFolder(arg1, arg2 = null, arg3 = null, arg4 = '#10b981', configPath = DEFAULT_CONFIG_PATH) {
  let name, parentId = null, customId = null, color = '#10b981', targetConfig = DEFAULT_CONFIG_PATH;

  // Handle object argument
  if (typeof arg1 === 'object' && arg1 !== null) {
    name = arg1.name;
    parentId = arg1.parentId || null;
    customId = arg1.id || null;
    color = arg1.color || '#10b981';
    targetConfig = arg2 || DEFAULT_CONFIG_PATH;
  } else if (typeof arg1 === 'string' && (arg1.startsWith('fld-') || arg1.startsWith('folder-')) && typeof arg2 === 'string') {
    // Legacy test signature: addFolder(id, name, color, configPath)
    customId = arg1;
    name = arg2;
    color = typeof arg3 === 'string' ? arg3 : '#10b981';
    targetConfig = typeof arg4 === 'string' ? arg4 : DEFAULT_CONFIG_PATH;
  } else {
    name = arg1;
    // arg2 might be parentId or customId
    if (typeof arg2 === 'string') {
      const data = readConfig(configPath);
      if (data.folders.some(f => f.id === arg2)) {
        parentId = arg2;
      } else if (arg2.startsWith('fld-') || arg2.startsWith('folder-')) {
        customId = arg2;
      } else {
        parentId = arg2;
      }
    }
    if (typeof arg3 === 'string') {
      if (arg3.startsWith('#')) {
        color = arg3;
      } else {
        customId = arg3;
      }
    }
    if (typeof arg4 === 'string' && !arg4.startsWith('#')) {
      targetConfig = arg4;
    } else if (typeof configPath === 'string') {
      targetConfig = configPath;
    }
  }

  const data = readConfig(targetConfig);

  // Normalize parentId
  if (parentId) {
    const parentFolder = data.folders.find(f => f.id === parentId || f.name.toLowerCase() === parentId.toLowerCase());
    parentId = parentFolder ? parentFolder.id : null;
  } else {
    parentId = null;
  }

  // Check sibling name collision
  const sibling = data.folders.find(f => (f.parentId || null) === parentId && f.name.toLowerCase() === name.toLowerCase());
  if (sibling) {
    sibling.color = color;
    writeConfig(data, targetConfig);
    console.log(`✅ Папка "${name}" (${sibling.id}) под родителем "${parentId || 'корень'}" обновлена.`);
    return sibling;
  }

  // Generate unique ID
  let id = customId || slugify(name);
  let idCounter = 1;
  while (data.folders.some(f => f.id === id)) {
    id = `${customId || slugify(name)}-${idCounter++}`;
  }

  const newFolder = { id, name, parentId, color, isExpanded: true };
  data.folders.push(newFolder);
  writeConfig(data, targetConfig);
  console.log(`✅ Создана папка "${name}" (ID: ${id}, Parent: ${parentId || 'корень'}).`);
  return newFolder;
}

/**
 * Renames an existing folder.
 */
function renameFolder(query, newName, configPath = DEFAULT_CONFIG_PATH) {
  const data = readConfig(configPath);
  const target = resolveFolder(query, configPath);
  if (!target) {
    console.error(`❌ Папка "${query}" не найдена.`);
    return false;
  }

  const folder = data.folders.find(f => f.id === target.id);
  if (!folder) {
    console.error(`❌ Папка "${query}" не найдена.`);
    return false;
  }

  const cleanName = newName.trim();
  // Check sibling name collision
  const collision = data.folders.find(f => f.id !== folder.id && (f.parentId || null) === (folder.parentId || null) && f.name.toLowerCase() === cleanName.toLowerCase());
  if (collision) {
    console.error(`❌ В той же ветке уже существует папка с именем "${cleanName}".`);
    return false;
  }

  const oldName = folder.name;
  folder.name = cleanName;
  writeConfig(data, configPath);
  console.log(`✅ Папка "${oldName}" переименована в "${cleanName}" (ID: ${folder.id}).`);
  return true;
}

/**
 * Moves a folder to a new parent (or to root).
 * Enforces cycle prevention: cannot move into self or any descendant.
 */
function moveFolder(query, newParentQuery, configPath = DEFAULT_CONFIG_PATH) {
  const data = readConfig(configPath);
  const folder = resolveFolder(query, configPath);
  if (!folder) {
    console.error(`❌ Папка "${query}" не найдена.`);
    return false;
  }

  let newParentId = null;
  if (newParentQuery && newParentQuery !== 'root' && newParentQuery !== 'null') {
    const parentFolder = resolveFolder(newParentQuery, configPath);
    if (!parentFolder) {
      console.error(`❌ Целевая родительская папка "${newParentQuery}" не найдена.`);
      return false;
    }
    newParentId = parentFolder.id;
  }

  // 1. Cannot move to self
  if (folder.id === newParentId) {
    console.error(`❌ Нельзя переместить папку "${folder.name}" внутрь самой себя.`);
    throw new Error('Cannot move folder into itself');
  }

  // 2. Cannot move into any of its descendants (cycle prevention)
  const descendants = getDescendantIds(folder.id, data.folders);
  if (descendants.has(newParentId)) {
    console.error(`❌ Нельзя переместить папку "${folder.name}" внутрь её подпапки (обнаружен цикл).`);
    throw new Error('Cannot move folder into its own descendant (cycle detected)');
  }

  // 3. Sibling name check in target parent
  const collision = data.folders.find(f => f.id !== folder.id && (f.parentId || null) === newParentId && f.name.toLowerCase() === folder.name.toLowerCase());
  if (collision) {
    console.error(`❌ В целевой папке уже есть элемент с именем "${folder.name}".`);
    throw new Error(`Sibling folder name collision in destination: "${folder.name}"`);
  }

  const oldParent = folder.parentId;
  const targetFolder = data.folders.find(f => f.id === folder.id);
  if (!targetFolder) {
    console.error(`❌ Папка "${query}" не найдена в конфигурации.`);
    return false;
  }
  targetFolder.parentId = newParentId;
  writeConfig(data, configPath);
  console.log(`✅ Папка "${folder.name}" перемещена: ${oldParent || 'корень'} ➔ ${newParentId || 'корень'}.`);
  return true;
}

/**
 * Deletes a folder, promoting its subfolders and projects to its parent (or to root).
 */
function removeFolder(query, configPath = DEFAULT_CONFIG_PATH) {
  const data = readConfig(configPath);
  const folder = resolveFolder(query, configPath);
  if (!folder) {
    console.error(`❌ Папка "${query}" не найдена.`);
    return false;
  }

  const id = folder.id;
  const name = folder.name;
  const parentId = folder.parentId || null;

  // 1. Promote direct child folders to parent
  let promotedFoldersCount = 0;
  for (const f of data.folders) {
    if (f.parentId === id) {
      f.parentId = parentId;
      promotedFoldersCount++;
    }
  }

  // 2. Promote projects to parent (or remove if root)
  let promotedProjectsCount = 0;
  for (const [projId, fId] of Object.entries(data.projectFolderMap)) {
    if (fId === id) {
      if (parentId) {
        data.projectFolderMap[projId] = parentId;
      } else {
        delete data.projectFolderMap[projId];
      }
      promotedProjectsCount++;
    }
  }

  // 3. Remove folder itself
  data.folders = data.folders.filter(f => f.id !== id);

  writeConfig(data, configPath);
  console.log(`✅ Папка "${name}" (${id}) удалена. Подпапок поднято: ${promotedFoldersCount}, проектов: ${promotedProjectsCount}.`);
  return true;
}

/**
 * Assigns a project to a folder.
 */
function assignProject(projQuery, folderQuery, configPath = DEFAULT_CONFIG_PATH) {
  const project = resolveProject(projQuery);
  if (!project) {
    console.error(`❌ Проект "${projQuery}" не найден.`);
    return false;
  }

  const folder = resolveFolder(folderQuery, configPath);
  if (!folder) {
    console.error(`❌ Папка "${folderQuery}" не найдена. Создайте её сначала: node folders-manager.js add-folder "${folderQuery}"`);
    return false;
  }

  const data = readConfig(configPath);
  data.projectFolderMap[project.id] = folder.id;
  writeConfig(data, configPath);
  console.log(`✅ Проект "${project.name}" добавлен в папку "${folder.name}".`);
  return true;
}

/**
 * Unassigns a project from its folder (moves to root).
 */
function unassignProject(projQuery, configPath = DEFAULT_CONFIG_PATH) {
  const project = resolveProject(projQuery);
  if (!project) {
    console.error(`❌ Проект "${projQuery}" не найден.`);
    return false;
  }

  const data = readConfig(configPath);
  if (!data.projectFolderMap[project.id]) {
    console.log(`ℹ️ Проект "${project.name}" не находится ни в одной папке (уже в корне).`);
    return true;
  }

  const oldFolderId = data.projectFolderMap[project.id];
  const oldFolder = data.folders.find(f => f.id === oldFolderId);
  delete data.projectFolderMap[project.id];
  writeConfig(data, configPath);
  console.log(`✅ Проект "${project.name}" удален из папки "${oldFolder?.name || oldFolderId}" (перенесен в корень).`);
  return true;
}

/**
 * Lists all folders hierarchically and their projects.
 */
function listAll(configPath = DEFAULT_CONFIG_PATH) {
  const data = readConfig(configPath);
  const allProjects = loadAntigravityProjects();
  const projMap = new Map(allProjects.map(p => [p.id, p.name]));

  const childrenMap = new Map();
  for (const f of data.folders) {
    const pid = f.parentId || null;
    if (!childrenMap.has(pid)) childrenMap.set(pid, []);
    childrenMap.get(pid).push(f);
  }

  const projectsInFolder = new Map();
  for (const [pid, fid] of Object.entries(data.projectFolderMap)) {
    if (!projectsInFolder.has(fid)) projectsInFolder.set(fid, []);
    projectsInFolder.get(fid).push({ id: pid, name: projMap.get(pid) || pid });
  }

  console.log('\n📁 Иерархия папок Antigravity 2.0:\n');

  function printBranch(folder, depth = 0) {
    const indent = '    '.repeat(depth);
    const projs = (projectsInFolder.get(folder.id) || []).slice().sort((a, b) => (a?.name || '').localeCompare(b?.name || '', undefined, { numeric: true, sensitivity: 'base' }));
    const subs = (childrenMap.get(folder.id) || []).slice().sort((a, b) => (a?.name || '').localeCompare(b?.name || '', undefined, { numeric: true, sensitivity: 'base' }));

    console.log(`${indent}▾ 📁 ${folder.name} [ID: ${folder.id}] (${projs.length} проектов)`);
    for (const sub of subs) {
      printBranch(sub, depth + 1);
    }
    for (const p of projs) {
      console.log(`${indent}    ↳ 📂 ${p.name}`);
    }
    if (projs.length === 0 && subs.length === 0) {
      console.log(`${indent}    (папка пуста)`);
    }
  }

  const roots = (childrenMap.get(null) || []).slice().sort((a, b) => (a?.name || '').localeCompare(b?.name || '', undefined, { numeric: true, sensitivity: 'base' }));
  for (const r of roots) {
    printBranch(r, 0);
  }

  const assigned = new Set(Object.keys(data.projectFolderMap));
  const unassigned = allProjects.filter(p => !assigned.has(p.id) && p.id !== 'cbe5c5cf-0878-4b4c-abe4-39d46e0b5b40')
    .sort((a, b) => (a?.name || '').localeCompare(b?.name || '', undefined, { numeric: true, sensitivity: 'base' }));
  if (unassigned.length > 0) {
    console.log(`\n📂 Проекты без папки (в корне списка, ${unassigned.length} шт.):`);
    unassigned.forEach(p => console.log(`    ↳ ${p.name}`));
  }
  console.log('');
}

/**
 * Lists all available projects in Antigravity.
 */
function listProjects(configPath = DEFAULT_CONFIG_PATH) {
  const data = readConfig(configPath);
  const allProjects = loadAntigravityProjects();

  console.log('\n📋 Все проекты Antigravity:\n');
  allProjects
    .filter(p => p.id !== 'cbe5c5cf-0878-4b4c-abe4-39d46e0b5b40')
    .sort((a, b) => (a?.name || '').localeCompare(b?.name || '', undefined, { numeric: true, sensitivity: 'base' }))
    .forEach(p => {
      const fId = data.projectFolderMap[p.id];
      const folderPathStr = fId ? `📁 ${getFolderPath(fId, data.folders)}` : '— (без папки)';
      console.log(`- ${p.name.padEnd(38)} | Папка: ${folderPathStr}`);
    });
  console.log('');
}

// CLI handler
if (require.main === module) {
  const [,, cmd, arg1, arg2, arg3, arg4] = process.argv;
  switch (cmd) {
    case 'list':
      listAll();
      break;
    case 'projects':
      listProjects();
      break;
    case 'add-folder':
      if (!arg1) {
        console.error('Использование: node folders-manager.js add-folder <имя_папки> [parentId] [id] [color]');
        process.exit(1);
      }
      addFolder(arg1, arg2, arg3, arg4);
      break;
    case 'rename-folder':
      if (!arg1 || !arg2) {
        console.error('Использование: node folders-manager.js rename-folder <старое_имя_или_id> <новое_имя>');
        process.exit(1);
      }
      renameFolder(arg1, arg2);
      break;
    case 'move-folder':
      if (!arg1) {
        console.error('Использование: node folders-manager.js move-folder <папка_id_или_имя> <новый_родитель_или_root>');
        process.exit(1);
      }
      moveFolder(arg1, arg2 || null);
      break;
    case 'remove-folder':
      if (!arg1) {
        console.error('Использование: node folders-manager.js remove-folder <имя_папки_или_id>');
        process.exit(1);
      }
      removeFolder(arg1);
      break;
    case 'assign':
      if (!arg1 || !arg2) {
        console.error('Использование: node folders-manager.js assign <имя_проекта> <имя_папки>');
        process.exit(1);
      }
      assignProject(arg1, arg2);
      break;
    case 'unassign':
      if (!arg1) {
        console.error('Использование: node folders-manager.js unassign <имя_проекта>');
        process.exit(1);
      }
      unassignProject(arg1);
      break;
    default:
      console.log(`
Команды управления папками (Method 1: Иерархические папки):
  node folders-manager.js list                         - Показать дерево папок и проектов
  node folders-manager.js projects                     - Список всех проектов Antigravity
  node folders-manager.js add-folder <имя> [parent]    - Создать папку (или подпапку в [parent])
  node folders-manager.js rename-folder <папка> <имя>  - Переименовать папку
  node folders-manager.js move-folder <папка> <target> - Переместить папку в другого родителя (или root)
  node folders-manager.js remove-folder <папка>        - Удалить папку (подпапки и проекты поднимаются)
  node folders-manager.js assign <проект> <папка>      - Добавить проект в папку
  node folders-manager.js unassign <проект>            - Удалить проект из папки (вернуть в корень)
`);
      listAll();
  }
}

module.exports = {
  readConfig,
  writeConfig,
  validateTree,
  getDescendantIds,
  getFolderPath,
  addFolder,
  renameFolder,
  moveFolder,
  removeFolder,
  assignProject,
  unassignProject,
  resolveProject,
  resolveFolder,
  listAll,
  listProjects,
  DEFAULT_CONFIG_PATH
};
