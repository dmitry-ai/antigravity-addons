/**
 * folders-bootstrap.js
 * Electron main process hook for Antigravity 2.0.
 * Intercepts https://127.0.0.1:<port>/main.js to dynamically inject folder grouping
 * directly into the left sidebar virtualized TanStack list.
 */
const { net } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const patchModulePath = require.resolve('./folders-patch');
const layoutModulePath = require.resolve('./folders-layout');
const { addFolder, renameFolder, moveFolder, removeFolder, assignProject, unassignProject, writeConfig, validateTree } = require('./folders-manager');
const DEFAULT_FOLDERS_PATH = path.join(__dirname, 'folders.json').replace(/\\/g, '/');
let cachedFoldersData = null;
let cachedPatchedBundle = null;
let lastSourceHash = null;
function loadFoldersData(configPath = DEFAULT_FOLDERS_PATH) {
	let r;
	result: {
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
			const data = JSON.parse(raw);
			validateTree(data.folders);
			cachedFoldersData = data;
      { r = cachedFoldersData; break result; }
    }
  } catch (err) {
    console.error('[folders-bootstrap] Failed to read folders.json:', err);
  }
  { r = cachedFoldersData || { folders: [], projectFolderMap: {}, collapsedFolders: [] }; break result; }
	}
	return r;
}
function setupWatcher(configPath = DEFAULT_FOLDERS_PATH, win) {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const watcher = fs.watch(dir, (eventType, filename) => {
      if (filename === path.basename(configPath)) {
        console.log('[folders-bootstrap] folders.json changed, invalidating bundle cache...');
        loadFoldersData(configPath);
        cachedPatchedBundle = null; // Forces re-patch on next request
        if (win && !win.isDestroyed()) {
          try {
            win.webContents.executeJavaScript(`
              if (window.__PROJECT_FOLDERS_DATA__) {
                console.log("[folders-client] Config reloaded from disk.");
              }
            `).catch(() => {});
          } catch (_) {}
        }
      }
    });
		watcher.on?.('error', error => console.warn('[folders-bootstrap]', error.message));
		win?.once?.('closed', () => watcher.close());
  } catch (e) {
    console.warn('[folders-bootstrap] Could not set up watcher for folders.json:', e);
  }
}
/**
 * Initializes the protocol interceptor for the window session.
 * @param {import('electron').BrowserWindow} win
 * @param {string} [configPath]
 */
function initFoldersHook(win, configPath = DEFAULT_FOLDERS_PATH) {
	let r;
	result: {
  if (!win || win.isDestroyed()) {
    { r = undefined; break result; }
  }
  const wc = win.webContents;
  const ses = wc.session;
  if (!ses) {
    console.warn('[folders-bootstrap] No session found on webContents.');
    { r = undefined; break result; }
  }
  loadFoldersData(configPath);
  setupWatcher(configPath, win);
  ses._antigravityFoldersWindows ||= new Set();
  ses._antigravityFoldersWindows.add(win);
  win.once?.('closed', () => ses._antigravityFoldersWindows.delete(win));
  if (ses._antigravityFoldersHooked) {
    { r = undefined; break result; }
  }
  ses._antigravityFoldersHooked = true;
  try {
    ses.protocol.handle('https', async (request) => {
			let r;
			result: {
      let url;
      try {
        url = new URL(request.url);
      } catch (_) {
        { r = net.fetch(request, { bypassCustomProtocolHandlers: true }); break result; }
      }
      if ('127.0.0.1' !== url.hostname && 'localhost' !== url.hostname) { r = net.fetch(request, { bypassCustomProtocolHandlers: true }); break result; }
      // 1. Intercept client JavaScript bundle
      if ('/main.js' === url.pathname) {
        try {
          const response = await net.fetch(request, { bypassCustomProtocolHandlers: true });
          if (!response.ok) {
            { r = response; break result; }
          }
          const originalText = await response.text();
          const foldersData = loadFoldersData(configPath);
          const sourceHash = crypto.createHash('sha256').update(originalText).digest('hex');
          const cacheKey = sourceHash + JSON.stringify(foldersData) + fs.statSync(patchModulePath).mtimeMs + fs.statSync(layoutModulePath).mtimeMs + fs.statSync(path.join(__dirname, 'folders-client.js')).mtimeMs;
          // Code changes must take effect on the next renderer reload as well.
          if (cachedPatchedBundle && lastSourceHash === cacheKey) {
            { r = new Response(cachedPatchedBundle, {
              status: 200,
              headers: {
                'content-type': 'application/javascript; charset=utf-8',
                'cache-control': 'no-cache'
              }
            }); break result; }
          }
          console.log('[folders-bootstrap] Patching main.js with project folders...');
          delete require.cache[patchModulePath];
			delete require.cache[layoutModulePath];
          const patchedText = require(patchModulePath).applyFolderPatch(originalText, foldersData, {strict: true});
          cachedPatchedBundle = patchedText;
          lastSourceHash = cacheKey;
          { r = new Response(patchedText, {
            status: 200,
            headers: {
              'content-type': 'application/javascript; charset=utf-8',
              'cache-control': 'no-cache'
            }
          }); break result; }
        } catch (err) {
          console.error('[folders-bootstrap] Error handling /main.js request:', err);
          { r = net.fetch(request, { bypassCustomProtocolHandlers: true }); break result; }
        }
      }
      // 2. Local REST endpoint for folder data query/mutations
      if ('/api/project-folders' === url.pathname || url.pathname.startsWith('/api/project-folders/')) {
        if ('GET' === request.method) {
          const data = loadFoldersData(configPath);
          { r = new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
          }); break result; }
        }
        if ('POST' === request.method) {
          try {
            let body = {};
            const text = await request.text();
            if (text) {
              body = JSON.parse(text);
            }
            const { action } = body;
            console.log(`[folders-bootstrap] Received action: ${action}`, body);
            if ('add-folder' === action) {
              addFolder({
                name: body.name,
                parentId: body.parentId || null,
                id: body.id || null,
                color: body.color || '#10b981'
              }, configPath);
            } else if ('rename-folder' === action) {
              renameFolder(body.id || body.query, body.newName, configPath);
            } else if ('move-folder' === action) {
              moveFolder(body.id || body.query, body.newParentId !== undefined ? body.newParentId : (body.newParentQuery !== undefined ? body.newParentQuery : null), configPath);
            } else if ('remove-folder' === action) {
              removeFolder(body.id || body.query, configPath);
            } else if ('assign-project' === action) {
              assignProject(body.projectId || body.projectQuery, body.folderId || body.folderQuery, configPath);
            } else if ('unassign-project' === action) {
              unassignProject(body.projectId || body.projectQuery, configPath);
            } else if (!('save-config' === action)) {
              { r = new Response(JSON.stringify({ success: false, error: 'Unknown folder action' }), { status: 400, headers: { 'content-type': 'application/json' } }); break result; }
            } else {
              if (body.data && Array.isArray(body.data.folders)) {
                validateTree(body.data.folders);
              }
              writeConfig(body.data, configPath);
            }
            const updated = loadFoldersData(configPath);
            cachedPatchedBundle = null; // Invalidate bundle cache
            // Broadcast to window renderer
            for (const updateWindow of ses._antigravityFoldersWindows) {
              if (updateWindow.isDestroyed()) continue;
              try {
                updateWindow.webContents.executeJavaScript(`
                  window.__PROJECT_FOLDERS_DATA__ = ${JSON.stringify(updated)};
                  if (window.__PROJECT_FOLDERS_CLIENT__ && typeof window.__PROJECT_FOLDERS_CLIENT__.notifyUpdate === 'function') {
                    window.__PROJECT_FOLDERS_CLIENT__.notifyUpdate(${JSON.stringify(updated)});
                  }
                `).catch(() => {});
              } catch (_) {}
            }
            { r = new Response(JSON.stringify({ success: true, data: updated }), {
              status: 200,
              headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
            }); break result; }
          } catch (err) {
            console.error('[folders-bootstrap] Failed handling action:', err);
            { r = new Response(JSON.stringify({ success: false, error: err.message }), {
              status: 500,
              headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
            }); break result; }
          }
        }
      }
      // Default: transparent pass-through
      { r = net.fetch(request, { bypassCustomProtocolHandlers: true }); break result; }
			}
			return r;
    });
    console.log('[folders-bootstrap] Successfully registered HTTPS protocol handler.');
  } catch (err) {
		ses._antigravityFoldersHooked = false;
    console.error('[folders-bootstrap] Failed to register protocol handler:', err);
  }
	}
	return r;
}
module.exports = initFoldersHook;
