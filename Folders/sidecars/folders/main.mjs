// Backend for the Project Folders UI Extension.
//
// Running inside Google Antigravity:
//   Antigravity starts this process and provides 'sidecar_sdk'.
//   The persistent data directory is provided via ANTIGRAVITY_EXECUTABLE_DATA_DIR.
//
// Standalone / local testing:
//   Falls back to standard node:http if sidecar_sdk is not present.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR || join(HERE, '.data');
const FOLDERS_FILE = join(DATA_DIR, 'folders.json');

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Storage Management
// ---------------------------------------------------------------------------

const DEFAULT_STATE = {
  folders: [
    { id: 'folder-clients', name: 'Клиенты', parentId: null, color: '#3b82f6', isExpanded: true },
    { id: 'folder-internal', name: 'Внутренние', parentId: null, color: '#10b981', isExpanded: true },
    { id: 'folder-archive', name: 'Архив', parentId: null, color: '#64748b', isExpanded: false }
  ],
  projectFolderMap: {},
  collapsedFolders: []
};

function loadFolderState() {
  if (!existsSync(FOLDERS_FILE)) {
    saveFolderState(DEFAULT_STATE);
    return DEFAULT_STATE;
  }
  try {
    const raw = readFileSync(FOLDERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders : DEFAULT_STATE.folders,
      projectFolderMap: parsed.projectFolderMap || {},
      collapsedFolders: Array.isArray(parsed.collapsedFolders) ? parsed.collapsedFolders : []
    };
  } catch (err) {
    console.error(`[ProjectFolders] Error loading ${FOLDERS_FILE}:`, err.message);
    return DEFAULT_STATE;
  }
}

function saveFolderState(state) {
  try {
    writeFileSync(FOLDERS_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error(`[ProjectFolders] Error saving ${FOLDERS_FILE}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Antigravity Data Discovery
// ---------------------------------------------------------------------------

function discoverLanguageServer() {
  let port = null;
  let csrf = null;

  // 1. Environment variables
  if (process.env.ANTIGRAVITY_LS_ADDRESS) {
    const m = process.env.ANTIGRAVITY_LS_ADDRESS.match(/:(\d+)$/);
    if (m) port = parseInt(m[1], 10);
  }
  if (process.env.ANTIGRAVITY_CSRF_TOKEN) {
    csrf = process.env.ANTIGRAVITY_CSRF_TOKEN;
  }

  // 2. Read language_server.log
  if (!port) {
    try {
      const logPath = join(process.env.APPDATA || '', 'Antigravity', 'logs', 'language_server.log');
      if (existsSync(logPath)) {
        const text = readFileSync(logPath, 'utf8');
        const matches = [...text.matchAll(/Language server listening on random port at (\d+) for HTTP\b/gi)];
        if (matches.length > 0) {
          port = parseInt(matches[matches.length - 1][1], 10);
        }
      }
    } catch (_) {}
  }

  // 3. Process command line via PowerShell (Windows)
  if (!csrf && process.platform === 'win32') {
    try {
      const out = execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name LIKE '%language_server%'\\").CommandLine"`).toString();
      const m = out.match(/--csrf_token\s+([0-9a-f-]+)/i);
      if (m) csrf = m[1];
    } catch (_) {}
  }

  return { port, csrf };
}

async function fetchProjectsFromLS(port, csrf) {
  if (!port || !csrf) return [];

  const home = os.homedir();
  const protoPath = join(home, '.gemini', 'antigravity', 'agyhub_summaries_proto.pb');
  let uuids = [];

  if (existsSync(protoPath)) {
    try {
      const protoBuf = readFileSync(protoPath);
      const str = protoBuf.toString('latin1');
      const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
      uuids = [...new Set(str.match(uuidRegex) || [])];
    } catch (_) {}
  }

  if (uuids.length === 0) return [];

  return new Promise((resolve) => {
    const payload = JSON.stringify({ ids: uuids });
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/exa.language_server_pb.LanguageServerService/ReadProjects',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-codeium-csrf-token': csrf,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 3000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed.projects || []);
        } catch (_) {
          resolve([]);
        }
      });
    });

    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.write(payload);
    req.end();
  });
}

async function fetchConversationsFromDB() {
  const home = os.homedir();
  const dbPath = join(home, '.gemini', 'antigravity', 'conversation_summaries.db');
  if (!existsSync(dbPath)) return [];

  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare('SELECT conversation_id, project_id, title, last_modified_time FROM conversation_summaries ORDER BY last_modified_time DESC').all();
    db.close();
    return rows;
  } catch (_) {
    try {
      const cmd = `python -c "import sqlite3, json; conn=sqlite3.connect(r'${dbPath}'); c=conn.cursor(); c.execute('SELECT conversation_id, project_id, title, last_modified_time FROM conversation_summaries ORDER BY last_modified_time DESC'); print(json.dumps([{'conversation_id':r[0],'project_id':r[1],'title':r[2],'last_modified_time':str(r[3])} for r in c.fetchall()]))"`;
      const out = execSync(cmd).toString();
      return JSON.parse(out);
    } catch (err) {
      console.error('[ProjectFolders] Failed to query conversation_summaries.db:', err);
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Tree Builder
// ---------------------------------------------------------------------------

async function buildProjectTree() {
  const state = loadFolderState();
  const { port, csrf } = discoverLanguageServer();
  const rawProjects = await fetchProjectsFromLS(port, csrf);
  const rawConvos = await fetchConversationsFromDB();

  // Index conversations by project_id
  const convosByProject = new Map();
  for (const c of rawConvos) {
    if (!c.project_id) continue;
    if (!convosByProject.has(c.project_id)) convosByProject.set(c.project_id, []);
    convosByProject.get(c.project_id).push({
      id: c.conversation_id,
      title: c.title || 'Новый диалог',
      lastModified: c.last_modified_time
    });
  }

  // Decorate projects
  const projectsById = new Map();
  for (const p of rawProjects) {
    const pConvos = convosByProject.get(p.id) || [];
    projectsById.set(p.id, {
      id: p.id,
      name: p.name || p.id,
      assignedFolderId: state.projectFolderMap[p.id] || null,
      conversations: pConvos,
      conversationCount: pConvos.length,
      lastActive: pConvos[0]?.lastModified || null
    });
  }

  // Also include any projects found in DB that were not in ReadProjects
  for (const [pid, pConvos] of convosByProject.entries()) {
    if (!projectsById.has(pid)) {
      projectsById.set(pid, {
        id: pid,
        name: pConvos[0]?.title ? `Проект ${pid.slice(0, 8)}` : pid,
        assignedFolderId: state.projectFolderMap[pid] || null,
        conversations: pConvos,
        conversationCount: pConvos.length,
        lastActive: pConvos[0]?.lastModified || null
      });
    }
  }

  // Distribute projects into folders
  const folderItems = state.folders.map(f => ({
    ...f,
    projects: []
  }));
  const folderMap = new Map(folderItems.map(f => [f.id, f]));
  const unfiledProjects = [];

  for (const project of projectsById.values()) {
    const fid = project.assignedFolderId;
    if (fid && folderMap.has(fid)) {
      folderMap.get(fid).projects.push(project);
    } else {
      unfiledProjects.push(project);
    }
  }

  // Sort projects alphabetically or by activity within folders
  const sorter = (a, b) => {
    if (a.lastActive && b.lastActive) {
      return new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime();
    }
    return a.name.localeCompare(b.name, 'ru');
  };

  folderItems.forEach(f => f.projects.sort(sorter));
  unfiledProjects.sort(sorter);

  return {
    folders: folderItems,
    unfiledProjects,
    totalProjects: projectsById.size,
    totalConversations: rawConvos.length,
    lsConnected: Boolean(port && csrf)
  };
}

// ---------------------------------------------------------------------------
// App Bootstrap (Sidecar SDK or Fallback)
// ---------------------------------------------------------------------------

const readStatic = (file) => readFileSync(join(HERE, file), 'utf8');

async function startServer() {
  let SidecarAppClass = null;
  let ResponseClass = null;

  try {
    const sdk = await import('sidecar_sdk');
    SidecarAppClass = sdk.SidecarApp;
    ResponseClass = sdk.Response;
  } catch (_) {
    // Standalone fallback
  }

  if (SidecarAppClass) {
    const app = new SidecarAppClass();

    app.page('/', () => readStatic('index.html'));
    app.page('/app.js', () => readStatic('app.js'));
    app.api('/styles.css', () => new ResponseClass(readStatic('styles.css'), { contentType: 'text/css' }), 'GET');

    app.api('/api/tree', async () => await buildProjectTree(), 'GET');

    app.api('/api/folders', (data) => {
      const state = loadFolderState();
      const id = data.id || `folder-${Date.now()}`;
      const existingIdx = state.folders.findIndex(f => f.id === id);
      const folderObj = {
        id,
        name: data.name?.trim() || 'Новая папка',
        parentId: data.parentId || null,
        color: data.color || '#3b82f6',
        isExpanded: data.isExpanded !== undefined ? data.isExpanded : true
      };

      if (existingIdx >= 0) {
        state.folders[existingIdx] = { ...state.folders[existingIdx], ...folderObj };
      } else {
        state.folders.push(folderObj);
      }
      saveFolderState(state);
      return { success: true, folder: folderObj };
    });

    app.api('/api/folders/delete', (data) => {
      const state = loadFolderState();
      const id = data.id;
      state.folders = state.folders.filter(f => f.id !== id);
      // Unassign projects from deleted folder
      for (const [pid, fid] of Object.entries(state.projectFolderMap)) {
        if (fid === id) delete state.projectFolderMap[pid];
      }
      saveFolderState(state);
      return { success: true };
    });

    app.api('/api/assign', (data) => {
      const state = loadFolderState();
      const { projectId, folderId } = data;
      if (!projectId) return { error: 'projectId required' };
      if (!folderId || folderId === 'unfiled') {
        delete state.projectFolderMap[projectId];
      } else {
        state.projectFolderMap[projectId] = folderId;
      }
      saveFolderState(state);
      return { success: true };
    });

    app.api('/api/folder/toggle', (data) => {
      const state = loadFolderState();
      const folder = state.folders.find(f => f.id === data.id);
      if (folder) {
        folder.isExpanded = !folder.isExpanded;
        saveFolderState(state);
      }
      return { success: true };
    });

    app.run();
    console.log('[ProjectFolders] Sidecar running via sidecar_sdk.');
  } else {
    // Standalone fallback on port 45789
    const port = process.env.PORT || 45789;
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(readStatic('index.html'));
      }
      if (url.pathname === '/app.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        return res.end(readStatic('app.js'));
      }
      if (url.pathname === '/styles.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        return res.end(readStatic('styles.css'));
      }
      if (url.pathname === '/api/tree') {
        const tree = await buildProjectTree();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(tree));
      }
      res.writeHead(404);
      res.end('Not found');
    });
    server.listen(port, '127.0.0.1', () => {
      console.log(`[ProjectFolders] Standalone server listening at http://127.0.0.1:${port}`);
    });
  }
}

startServer().catch(err => {
  console.error('[ProjectFolders] Startup error:', err);
});
