/**
 * folders-bootstrap.js
 * Electron main process hook for Antigravity 2.0.
 * Intercepts https://127.0.0.1:<port>/main.js to dynamically inject folder grouping
 * directly into the left sidebar virtualized TanStack list.
 */

const { net } = require('electron');
const fs = require('fs');
const path = require('path');
const { applyFolderPatch } = require('./folders-patch');

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

      // 1. Intercept client JavaScript bundle
      if (url.pathname === '/main.js') {
        try {
          const response = await net.fetch(request, { bypassCustomProtocolHandlers: true });
          if (!response.ok) {
            return response;
          }

          const originalText = await response.text();
          const foldersData = loadFoldersData(configPath);

          // Fast cache check
          if (cachedPatchedBundle && lastSourceHash === originalText.length) {
            return new Response(cachedPatchedBundle, {
              status: 200,
              headers: {
                'content-type': 'application/javascript; charset=utf-8',
                'cache-control': 'no-cache'
              }
            });
          }

          console.log('[folders-bootstrap] Patching main.js with project folders...');
          const patchedText = applyFolderPatch(originalText, foldersData);

          cachedPatchedBundle = patchedText;
          lastSourceHash = originalText.length;

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

      // 2. Local REST endpoint for folder data query/update
      if (url.pathname === '/api/project-folders') {
        if (request.method === 'GET') {
          const data = loadFoldersData(configPath);
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
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
