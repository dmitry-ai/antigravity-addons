/**
 * folders-manager.js
 * CLI and API tool to manage folders and project assignments in Antigravity 2.0.
 * Supports resolving projects and folders by human-readable names as well as by IDs.
 *
 * Usage:
 *   node folders-manager.js list
 *   node folders-manager.js projects
 *   node folders-manager.js add-folder <name> [id] [color]
 *   node folders-manager.js rename-folder <id_or_name> <new_name>
 *   node folders-manager.js remove-folder <id_or_name>
 *   node folders-manager.js assign <project_name_or_id> <folder_name_or_id>
 *   node folders-manager.js unassign <project_name_or_id>
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
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Finds a folder by ID or name.
 */
function resolveFolder(query, configPath = DEFAULT_CONFIG_PATH) {
  if (!query) return null;
  const data = readConfig(configPath);
  const qLower = query.toLowerCase().trim();

  const byId = data.folders.find(f => f.id === query);
  if (byId) return byId;

  const byExactName = data.folders.find(f => f.name.toLowerCase() === qLower);
  if (byExactName) return byExactName;

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
 * - addFolder(name, [customId], [color], [configPath])
 * - addFolder(id, name, [color], [configPath]) (legacy/test signature)
 */
function addFolder(arg1, arg2 = null, color = '#10b981', configPath = DEFAULT_CONFIG_PATH) {
  let id, name;
  if (arg2) {
    if (typeof arg1 === 'string' && (arg1.startsWith('fld-') || arg1.startsWith('folder-'))) {
      id = arg1;
      name = arg2;
    } else if (typeof arg2 === 'string' && (arg2.startsWith('fld-') || arg2.startsWith('folder-'))) {
      name = arg1;
      id = arg2;
    } else {
      name = arg1;
      id = arg2;
    }
  } else {
    name = arg1;
    id = slugify(name);
  }

  const data = readConfig(configPath);
  const existing = data.folders.find(f => f.id === id || f.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.name = name;
    existing.color = color;
    writeConfig(data, configPath);
    console.log(`✅ Папка "${name}" (${existing.id}) обновлена.`);
    return existing;
  }

  const newFolder = { id, name, parentId: null, color, isExpanded: true };
  data.folders.push(newFolder);
  writeConfig(data, configPath);
  console.log(`✅ Создана папка "${name}" (ID: ${id}).`);
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

  const oldName = folder.name;
  folder.name = newName;
  writeConfig(data, configPath);
  console.log(`✅ Папка "${oldName}" переименована в "${newName}" (ID: ${folder.id}).`);
  return true;
}

/**
 * Deletes a folder and unassigns its projects.
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
  data.folders = data.folders.filter(f => f.id !== id);

  let unassignedCount = 0;
  for (const [projId, fId] of Object.entries(data.projectFolderMap)) {
    if (fId === id) {
      delete data.projectFolderMap[projId];
      unassignedCount++;
    }
  }

  writeConfig(data, configPath);
  console.log(`✅ Папка "${name}" (${id}) удалена. Проектов возвращено в корень: ${unassignedCount}.`);
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
 * Lists all folders and their projects.
 */
function listAll(configPath = DEFAULT_CONFIG_PATH) {
  const data = readConfig(configPath);
  const allProjects = loadAntigravityProjects();
  const projMap = new Map(allProjects.map(p => [p.id, p.name]));

  console.log('\n📁 Иерархия папок Antigravity 2.0:\n');
  data.folders.forEach(f => {
    const projs = Object.entries(data.projectFolderMap)
      .filter(([_, fid]) => fid === f.id)
      .map(([pid]) => ({ id: pid, name: projMap.get(pid) || pid }));
    console.log(`▾ 📁 ${f.name} [ID: ${f.id}] (${projs.length} проектов)`);
    if (projs.length === 0) {
      console.log('    (папка пуста)');
    } else {
      projs.forEach(p => console.log(`    ↳ 📂 ${p.name}`));
    }
  });

  const assigned = new Set(Object.keys(data.projectFolderMap));
  const unassigned = allProjects.filter(p => !assigned.has(p.id) && p.id !== 'cbe5c5cf-0878-4b4c-abe4-39d46e0b5b40');
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
  const folderNames = new Map(data.folders.map(f => [f.id, f.name]));

  console.log('\n📋 Все проекты Antigravity:\n');
  allProjects
    .filter(p => p.id !== 'cbe5c5cf-0878-4b4c-abe4-39d46e0b5b40')
    .forEach(p => {
      const fId = data.projectFolderMap[p.id];
      const folderStr = fId ? `📁 ${folderNames.get(fId) || fId}` : '— (без папки)';
      console.log(`- ${p.name.padEnd(38)} | Папка: ${folderStr}`);
    });
  console.log('');
}

// CLI handler
if (require.main === module) {
  const [,, cmd, arg1, arg2, arg3] = process.argv;
  switch (cmd) {
    case 'list':
      listAll();
      break;
    case 'projects':
      listProjects();
      break;
    case 'add-folder':
      if (!arg1) {
        console.error('Использование: node folders-manager.js add-folder <имя_папки> [id] [color]');
        process.exit(1);
      }
      addFolder(arg1, arg2, arg3);
      break;
    case 'rename-folder':
      if (!arg1 || !arg2) {
        console.error('Использование: node folders-manager.js rename-folder <старое_имя_или_id> <новое_имя>');
        process.exit(1);
      }
      renameFolder(arg1, arg2);
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
Команды управления папками:
  node folders-manager.js list                         - Показать дерево папок и проектов
  node folders-manager.js projects                     - Список всех проектов Antigravity
  node folders-manager.js add-folder <имя>             - Создать папку
  node folders-manager.js rename-folder <папка> <имя>  - Переименовать папку
  node folders-manager.js remove-folder <папка>        - Удалить папку
  node folders-manager.js assign <проект> <папка>      - Добавить проект в папку
  node folders-manager.js unassign <проект>            - Удалить проект из папки (вернуть в корень)
`);
      listAll();
  }
}

module.exports = {
  readConfig,
  writeConfig,
  addFolder,
  renameFolder,
  removeFolder,
  assignProject,
  unassignProject,
  resolveProject,
  resolveFolder,
  listAll,
  listProjects,
  DEFAULT_CONFIG_PATH
};
