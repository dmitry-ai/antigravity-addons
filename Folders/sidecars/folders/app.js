// Frontend logic for Project Folders UI Extension

const sidecar = window.sidecar;
let currentTree = null;
let searchQuery = '';
let selectedColor = '#3b82f6';
let editingFolderId = null;

// Helpers
const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const fetchFn = (sidecar && sidecar.fetch) ? sidecar.fetch.bind(sidecar) : window.fetch.bind(window);
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetchFn(path, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return await res.json();
}

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 2500);
}

// ---------------------------------------------------------------------------
// Tree Loading & Rendering
// ---------------------------------------------------------------------------

async function loadTree() {
  try {
    const data = await api('/api/tree');
    currentTree = data;
    render();
    updateStats(data);
  } catch (err) {
    console.error('Failed to load tree:', err);
    $('tree-container').innerHTML = `<div class="empty-state" style="color: var(--accent);">Ошибка загрузки: ${err.message}</div>`;
  }
}

function updateStats(data) {
  $('stats-summary').textContent = `${data.totalProjects} проектов • ${data.totalConversations} диалогов`;
  const lsEl = $('ls-status');
  if (data.lsConnected) {
    lsEl.style.color = '#10b981';
    lsEl.title = 'Language Server подключен';
  } else {
    lsEl.style.color = '#f59e0b';
    lsEl.title = 'LS не обнаружен, используется локальная БД';
  }
}

function render() {
  if (!currentTree) return;
  const container = $('tree-container');
  container.innerHTML = '';

  const q = searchQuery.toLowerCase().trim();

  // Render Folders
  for (const folder of currentTree.folders) {
    const filteredProjects = folder.projects.filter(p => matchesFilter(p, folder, q));
    if (q && filteredProjects.length === 0 && !folder.name.toLowerCase().includes(q)) {
      continue;
    }

    const folderEl = document.createElement('div');
    folderEl.className = `folder-block ${folder.isExpanded === false ? 'collapsed' : ''}`;
    
    folderEl.innerHTML = `
      <div class="folder-header" data-folder-id="${folder.id}">
        <svg class="chevron" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 10l5 5 5-5z"></path>
        </svg>
        <div class="folder-color-tag" style="background-color: ${folder.color || '#3b82f6'};"></div>
        <div class="folder-title">${escapeHtml(folder.name)}</div>
        <span class="badge">${filteredProjects.length}</span>
        <div class="folder-actions">
          <button class="btn-icon btn-rename-folder" title="Переименовать" data-folder-id="${folder.id}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </button>
          <button class="btn-icon btn-delete-folder" title="Удалить" data-folder-id="${folder.id}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="folder-content" id="content-${folder.id}"></div>
    `;

    const contentEl = folderEl.querySelector(`#content-${folder.id}`);
    if (filteredProjects.length === 0) {
      contentEl.innerHTML = `<div style="font-size: 11px; color: var(--muted-fg); padding: 4px 6px;">(нет проектов)</div>`;
    } else {
      for (const p of filteredProjects) {
        contentEl.appendChild(createProjectCard(p));
      }
    }

    container.appendChild(folderEl);
  }

  // Render Unfiled Projects
  const unfiled = currentTree.unfiledProjects.filter(p => matchesFilter(p, null, q));
  if (unfiled.length > 0 || !q) {
    const unfiledFolder = document.createElement('div');
    unfiledFolder.className = 'folder-block';
    unfiledFolder.innerHTML = `
      <div class="folder-header" style="opacity: 0.85;">
        <svg class="chevron" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 10l5 5 5-5z"></path>
        </svg>
        <div class="folder-color-tag" style="background-color: #71717a;"></div>
        <div class="folder-title" style="color: var(--muted-fg);">Без папки</div>
        <span class="badge">${unfiled.length}</span>
      </div>
      <div class="folder-content" id="content-unfiled"></div>
    `;

    const contentEl = unfiledFolder.querySelector('#content-unfiled');
    for (const p of unfiled) {
      contentEl.appendChild(createProjectCard(p));
    }
    container.appendChild(unfiledFolder);
  }

  if (container.children.length === 0) {
    container.innerHTML = `<div class="empty-state">Ничего не найдено по запросу "${escapeHtml(q)}"</div>`;
  }
}

function matchesFilter(project, folder, q) {
  if (!q) return true;
  if (project.name.toLowerCase().includes(q)) return true;
  if (folder && folder.name.toLowerCase().includes(q)) return true;
  return project.conversations.some(c => c.title.toLowerCase().includes(q));
}

function createProjectCard(project) {
  const card = document.createElement('div');
  card.className = 'project-card collapsed';
  card.dataset.projectId = project.id;

  // Folder assignment options
  const folderOptions = (currentTree.folders || []).map(f => 
    `<option value="${f.id}" ${f.id === project.assignedFolderId ? 'selected' : ''}>📁 ${escapeHtml(f.name)}</option>`
  ).join('');

  card.innerHTML = `
    <div class="project-header">
      <svg class="project-icon" viewBox="0 0 24 24">
        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
      </svg>
      <span class="project-name" title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</span>
      <select class="folder-select" style="font-size: 10px; background: transparent; border: 1px solid var(--card-brd); color: var(--muted-fg); border-radius: 4px; padding: 1px 3px;" data-project-id="${project.id}">
        <option value="unfiled">-- Папка --</option>
        ${folderOptions}
      </select>
      <span class="badge" title="Диалогов: ${project.conversationCount}">${project.conversationCount}</span>
    </div>
    <div class="project-convos">
      ${project.conversations.map(c => `
        <div class="convo-item" data-convo-id="${c.id}" title="Открыть: ${escapeHtml(c.title)}">
          <svg class="convo-icon" viewBox="0 0 24 24">
            <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
          </svg>
          <span class="convo-title">${escapeHtml(c.title)}</span>
        </div>
      `).join('')}
    </div>
  `;

  return card;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

function setupEventListeners() {
  // Search
  $('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    render();
  });

  // Refresh
  $('btn-refresh').addEventListener('click', async () => {
    $('stats-summary').textContent = 'Синхронизация...';
    await loadTree();
    showToast('Синхронизировано');
  });

  // Add Folder Modal
  $('btn-add-folder').addEventListener('click', () => {
    editingFolderId = null;
    $('modal-title').textContent = 'Новая папка';
    $('modal-folder-name').value = '';
    $('folder-modal').style.display = 'flex';
    $('modal-folder-name').focus();
  });

  $('modal-btn-cancel').addEventListener('click', () => {
    $('folder-modal').style.display = 'none';
  });

  // Color picker
  $('modal-colors').addEventListener('click', (e) => {
    const opt = e.target.closest('.color-option');
    if (opt) {
      document.querySelectorAll('.color-option').forEach(el => el.classList.remove('selected'));
      opt.classList.add('selected');
      selectedColor = opt.dataset.color;
    }
  });

  // Save Folder
  $('modal-btn-save').addEventListener('click', async () => {
    const name = $('modal-folder-name').value.trim();
    if (!name) return;

    try {
      await api('/api/folders', {
        method: 'POST',
        body: JSON.stringify({
          id: editingFolderId || undefined,
          name,
          color: selectedColor
        })
      });
      $('folder-modal').style.display = 'none';
      await loadTree();
      showToast(editingFolderId ? 'Папка обновлена' : 'Папка создана');
    } catch (err) {
      alert(`Ошибка: ${err.message}`);
    }
  });

  // Delegated clicks on Tree
  $('tree-container').addEventListener('click', async (e) => {
    // 1. Rename folder button
    const renameBtn = e.target.closest('.btn-rename-folder');
    if (renameBtn) {
      e.stopPropagation();
      const fid = renameBtn.dataset.folderId;
      const folder = currentTree.folders.find(f => f.id === fid);
      if (folder) {
        editingFolderId = fid;
        $('modal-title').textContent = 'Переименовать папку';
        $('modal-folder-name').value = folder.name;
        selectedColor = folder.color || '#3b82f6';
        $('folder-modal').style.display = 'flex';
        $('modal-folder-name').focus();
      }
      return;
    }

    // 2. Delete folder button
    const deleteBtn = e.target.closest('.btn-delete-folder');
    if (deleteBtn) {
      e.stopPropagation();
      const fid = deleteBtn.dataset.folderId;
      if (confirm('Удалить эту папку? Проекты будут перемещены в "Без папки".')) {
        await api('/api/folders/delete', {
          method: 'POST',
          body: JSON.stringify({ id: fid })
        });
        await loadTree();
        showToast('Папка удалена');
      }
      return;
    }

    // 3. Toggle folder collapse
    const folderHeader = e.target.closest('.folder-header');
    if (folderHeader && !e.target.closest('.btn-icon')) {
      const folderBlock = folderHeader.closest('.folder-block');
      folderBlock.classList.toggle('collapsed');
      const fid = folderHeader.dataset.folderId;
      if (fid) {
        api('/api/folder/toggle', { method: 'POST', body: JSON.stringify({ id: fid }) }).catch(() => {});
      }
      return;
    }

    // 4. Toggle project card collapse
    const projectHeader = e.target.closest('.project-header');
    if (projectHeader && !e.target.closest('.folder-select')) {
      const card = projectHeader.closest('.project-card');
      card.classList.toggle('collapsed');
      return;
    }

    // 5. Open conversation via Antigravity Host Bridge
    const convoItem = e.target.closest('.convo-item');
    if (convoItem) {
      const cid = convoItem.dataset.convoId;
      if (sidecar && sidecar.ui && sidecar.ui.toggleConversation) {
        sidecar.ui.toggleConversation(cid);
        showToast('Открыт диалог');
      } else {
        showToast(`Диалог ID: ${cid.slice(0, 8)}`);
      }
      return;
    }
  });

  // Assign project to folder select change
  $('tree-container').addEventListener('change', async (e) => {
    const sel = e.target.closest('.folder-select');
    if (sel) {
      const projectId = sel.dataset.projectId;
      const folderId = sel.value;
      try {
        await api('/api/assign', {
          method: 'POST',
          body: JSON.stringify({ projectId, folderId })
        });
        await loadTree();
        showToast('Проект перемещен');
      } catch (err) {
        alert(`Ошибка перемещения: ${err.message}`);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadTree();
});
