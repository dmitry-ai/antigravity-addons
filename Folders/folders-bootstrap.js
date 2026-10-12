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
const { addFolder, renameFolder, removeFolder, assignProject, unassignProject, writeConfig } = require('./folders-manager');

const DEFAULT_FOLDERS_PATH = path.join(__dirname, 'folders.json').replace(/\\/g, '/');

let cachedFoldersData = null;
let cachedPatchedBundle = null;
let lastSourceHash = null;

function loadFoldersData(configPath = DEFAULT_FOLDERS_PATH) {
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedFoldersData = JSON.parse(raw);
      return cachedFoldersData;
    }
  } catch (err) {
    console.error('[folders-bootstrap] Failed to read folders.json:', err);
  }
  return cachedFoldersData || { folders: [], projectFolderMap: {}, collapsedFolders: [] };
}

function setupWatcher(configPath = DEFAULT_FOLDERS_PATH, win) {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.watch(dir, (eventType, filename) => {
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
  if (!win || win.isDestroyed()) {
    return;
  }

  const wc = win.webContents;
  const ses = wc.session;

  if (!ses) {
    console.warn('[folders-bootstrap] No session found on webContents.');
    return;
  }

  loadFoldersData(configPath);
  setupWatcher(configPath, win);
  ses._antigravityFoldersWindows ||= new Set();
  ses._antigravityFoldersWindows.add(win);
  win.once?.('closed', () => ses._antigravityFoldersWindows.delete(win));

  if (ses._antigravityFoldersHooked) {
    return;
  }
  ses._antigravityFoldersHooked = true;

  try {
    ses.protocol.handle('https', async (request) => {
      let url;
      try {
        url = new URL(request.url);
      } catch (_) {
        return net.fetch(request, { bypassCustomProtocolHandlers: true });
      }

      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return net.fetch(request, { bypassCustomProtocolHandlers: true });

      // 1. Intercept client JavaScript bundle
      if (url.pathname === '/main.js') {
        try {
          const response = await net.fetch(request, { bypassCustomProtocolHandlers: true });
          if (!response.ok) {
            return response;
          }

          const originalText = await response.text();
          const foldersData = loadFoldersData(configPath);

          const sourceHash = crypto.createHash('sha256').update(originalText).digest('hex');
          const cacheKey = sourceHash + JSON.stringify(foldersData) + fs.statSync(patchModulePath).mtimeMs + fs.statSync(path.join(__dirname, 'folders-client.js')).mtimeMs;
          // Code changes must take effect on the next renderer reload as well.
          if (cachedPatchedBundle && lastSourceHash === cacheKey) {
            return new Response(cachedPatchedBundle, {
              status: 200,
              headers: {
                'content-type': 'application/javascript; charset=utf-8',
                'cache-control': 'no-cache'
              }
            });
          }

          console.log('[folders-bootstrap] Patching main.js with project folders...');
          delete require.cache[patchModulePath];
          const patchedText = require(patchModulePath).applyFolderPatch(originalText, foldersData);

          cachedPatchedBundle = patchedText;
          lastSourceHash = cacheKey;

          return new Response(patchedText, {
            status: 200,
            headers: {
              'content-type': 'application/javascript; charset=utf-8',
              'cache-control': 'no-cache'
            }
          });
        } catch (err) {
          console.error('[folders-bootstrap] Error handling /main.js request:', err);
          return net.fetch(request, { bypassCustomProtocolHandlers: true });
        }
      }

      // 2. Local REST endpoint for folder data query/mutations
      if (url.pathname === '/api/project-folders' || url.pathname.startsWith('/api/project-folders/')) {
        if (request.method === 'GET') {
          const data = loadFoldersData(configPath);
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
          });
        }

        if (request.method === 'POST') {
          try {
            let body = {};
            const text = await request.text();
            if (text) {
              body = JSON.parse(text);
            }
            const { action } = body;
            console.log(`[folders-bootstrap] Received action: ${action}`, body);

            if (action === 'add-folder') {
              addFolder(body.name, body.id, body.color, configPath);
            } else if (action === 'rename-folder') {
              renameFolder(body.id || body.query, body.newName, configPath);
            } else if (action === 'remove-folder') {
              removeFolder(body.id || body.query, configPath);
            } else if (action === 'assign-project') {
              assignProject(body.projectId || body.projectQuery, body.folderId || body.folderQuery, configPath);
            } else if (action === 'unassign-project') {
              unassignProject(body.projectId || body.projectQuery, configPath);
            } else if (action === 'save-config') {
              writeConfig(body.data, configPath);
            } else {
              return new Response(JSON.stringify({ success: false, error: 'Unknown folder action' }), { status: 400, headers: { 'content-type': 'application/json' } });
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

            return new Response(JSON.stringify({ success: true, data: updated }), {
              status: 200,
              headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
            });
          } catch (err) {
            console.error('[folders-bootstrap] Failed handling action:', err);
            return new Response(JSON.stringify({ success: false, error: err.message }), {
              status: 500,
              headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
            });
          }
        }
      }

      // Default: transparent pass-through
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    });

    console.log('[folders-bootstrap] Successfully registered HTTPS protocol handler.');
  } catch (err) {
    console.error('[folders-bootstrap] Failed to register protocol handler:', err);
  }
}

module.exports = initFoldersHook;
