/**
 * folders-client.js
 * Client-side Controller for Hierarchical Project Folders in Antigravity 2.0.
 * Uses a parent references tree model:
 * 1. "Create Folder" button in Projects header + modal dialog.
 * 2. Hierarchical folder operations: "Создать подпапку", "Переместить папку…", Inline rename, Delete with promotion.
 * 3. Cycle prevention & validation in UI.
 * 4. Project context menu with hierarchical folder paths ("Upwork / 2026").
 * 5. Drag & Drop for projects and folders (into folders, re-parenting, and unassigning to root).
 * 6. Immediate reactive updates via window custom events without page reload.
 */
(function initAntigravityFoldersClient() {
	let r;
	result: {
  if ('undefined' === typeof window) { r = undefined; break result; }
  if (window.__PROJECT_FOLDERS_CLIENT_INITIALIZED__) { r = undefined; break result; }
  window.__PROJECT_FOLDERS_CLIENT_INITIALIZED__ = true;
  console.log('[folders-client] Initializing Hierarchical Project Folders UI Controller...');
  function escapeHtml(str) {
		let r;
		result: {
    if (!str) { r = ''; break result; }
    { r = String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'); break result; }
		}
		return r;
  }
  function hasDragType(dataTransfer, type) {
		let r;
		result: {
    if (!dataTransfer || !dataTransfer.types) { r = false; break result; }
    if ('function' === typeof dataTransfer.types.includes) {
      { r = dataTransfer.types.includes(type); break result; }
    }
    if ('function' === typeof dataTransfer.types.contains) {
      { r = dataTransfer.types.contains(type); break result; }
    }
    try {
      { r = Array.from(dataTransfer.types).includes(type); break result; }
    } catch (_) {
      { r = false; break result; }
    }
		}
		return r;
  }
  // --- 1. Client State & Server API ---
  const client = {
    data: window.__PROJECT_FOLDERS_DATA__ || { folders: [], projectFolderMap: {} },
    activeMenu: null,
    activeModal: null,
    hoveredFolderId: null,
    hoveredFolderEl: null,
    lastHoveredFolderId: null,
    lastHoveredFolderTime: 0,
    lastActiveFolderId: null,
    lastActiveProjectId: null,
    draggedFolderId: null,
    draggedProjectId: null,
    isDragging: false,
    async postAction(action, payload = {}) {
			let r;
			result: {
      try {
        console.log(`[folders-client] Dispatching action: ${action}`, payload);
        const res = await fetch('/api/project-folders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, ...payload })
        });
        const result = await res.json();
        if (result.success && result.data) {
          this.notifyUpdate(result.data);
        }
        { r = result; break result; }
      } catch (err) {
        console.error('[folders-client] Action error:', err);
        { r = { success: false, error: err.message }; break result; }
      }
			}
			return r;
    },
    notifyUpdate(newData) {
      this.data = newData;
      window.__PROJECT_FOLDERS_DATA__ = newData;
      this.triggerRerender();
    },
    triggerRerender() {
      // The shared React row hook subscribes to this event.
      window.dispatchEvent(new CustomEvent('antigravity-folders-updated', { detail: this.data }));
    },
    getFolder(id) {
			let r;
			result: {
      if (!this.data || !Array.isArray(this.data.folders)) { r = null; break result; }
      { r = this.data.folders.find(f => f.id === id) || null; break result; }
			}
			return r;
    },
    getProjectFolderId(projectId) {
      return this.data?.projectFolderMap?.[projectId] || null;
    },
    getFolderPath(folderId) {
			let r;
			result: {
      if (!this.data || !Array.isArray(this.data.folders)) { r = ''; break result; }
      const map = new Map(this.data.folders.map(f => [f.id, f]));
      const parts = [];
      let curr = map.get(folderId);
      const seen = new Set();
      while (curr && !seen.has(curr.id)) {
        seen.add(curr.id);
        parts.unshift(curr.name);
        curr = curr.parentId ? map.get(curr.parentId) : null;
      }
      { r = parts.join(' / '); break result; }
			}
			return r;
    },
    getDescendantIds(folderId) {
			let r;
			result: {
      if (!this.data || !Array.isArray(this.data.folders)) { r = new Set(); break result; }
      const childrenMap = new Map();
      for (const f of this.data.folders) {
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
      { r = descendants; break result; }
			}
			return r;
    },
    detectCurrentFolderId() {
			let r;
			result: {
      // 1. Currently hovered folder header
      if (this.hoveredFolderId && this.getFolder(this.hoveredFolderId)) {
        { r = this.hoveredFolderId; break result; }
      }
      // 2. Recently hovered folder (within 5 seconds - e.g. user moved mouse from folder to create button)
      if (this.lastHoveredFolderId && (5000 > Date.now() - this.lastHoveredFolderTime) && this.getFolder(this.lastHoveredFolderId)) {
        { r = this.lastHoveredFolderId; break result; }
      }
      // 3. Focused element inside document
      const activeEl = 'undefined' !== typeof document ? document.activeElement : null;
      if (activeEl) {
        const fHeader = activeEl.closest?.('[data-folder-id]');
        if (fHeader) {
          const fid = fHeader.getAttribute('data-folder-id');
          if (fid && this.getFolder(fid)) { r = fid; break result; }
        }
        const pCard = activeEl.closest?.('[data-project-card]');
        if (pCard) {
          const pid = pCard.getAttribute('data-project-id');
          const fid = this.getProjectFolderId(pid);
          if (fid && this.getFolder(fid)) { r = fid; break result; }
        }
        const cRow = activeEl.closest?.("[data-testid^='conversation-row-']");
        if (cRow) {
          const pid = cRow.closest('[data-group-id]')?.getAttribute('data-group-id');
          if (pid) {
            const fid = this.getProjectFolderId(pid);
            if (fid && this.getFolder(fid)) { r = fid; break result; }
          }
        }
      }
      // 4. Currently active / selected conversation in sidebar
      if ('undefined' !== typeof document) {
        const selectedConvo = document.querySelector("[data-testid='conversation-row-sidebar'][data-selected='true'], [data-testid^='conversation-row-'][data-selected='true']");
        if (selectedConvo) {
          const pid = selectedConvo.closest('[data-group-id]')?.getAttribute('data-group-id');
          if (pid) {
            const fid = this.getProjectFolderId(pid);
            if (fid && this.getFolder(fid)) { r = fid; break result; }
          }
          const cascadeId = selectedConvo.getAttribute('data-cascade-id');
          if (cascadeId && 'undefined' !== typeof window && window.__PROJECT_FOLDERS_CONVO_MAP__?.[cascadeId]) {
            const convoPid = window.__PROJECT_FOLDERS_CONVO_MAP__[cascadeId];
            const fid = this.getProjectFolderId(convoPid);
            if (fid && this.getFolder(fid)) { r = fid; break result; }
          }
          // Fallback: search backwards in virtual list DOM
          const rowWrapper = selectedConvo.closest('[data-index]');
          if (rowWrapper) {
            let curr = rowWrapper.previousElementSibling;
            while (curr) {
              const card = curr.querySelector('button[data-project-card]');
              if (card) {
                const pId = card.getAttribute('data-project-id');
                const fId = this.getProjectFolderId(pId);
                if (fId && this.getFolder(fId)) { r = fId; break result; }
                break;
              }
              const fHead = curr.querySelector('[data-folder-id]');
              if (fHead) {
                const fId = fHead.getAttribute('data-folder-id');
                if (fId && this.getFolder(fId)) { r = fId; break result; }
              }
              curr = curr.previousElementSibling;
            }
          }
        }
        // 5. Active conversation in main view (independent of sidebar scroll position)
        const activeConvoView = document.querySelector("[data-testid='conversation-view'][data-cascade-id]");
        if (activeConvoView) {
          const activeCascadeId = activeConvoView.getAttribute('data-cascade-id');
          if (activeCascadeId && 'undefined' !== typeof window && window.__PROJECT_FOLDERS_CONVO_MAP__?.[activeCascadeId]) {
            const pId = window.__PROJECT_FOLDERS_CONVO_MAP__[activeCascadeId];
            const fId = this.getProjectFolderId(pId);
            if (fId && this.getFolder(fId)) { r = fId; break result; }
          }
        }
      }
      // 6. Last explicitly interacted folder
      if (this.lastActiveFolderId && this.getFolder(this.lastActiveFolderId)) {
        { r = this.lastActiveFolderId; break result; }
      }
      // 7. Last explicitly interacted project's folder
      if (this.lastActiveProjectId) {
        const fid = this.getProjectFolderId(this.lastActiveProjectId);
        if (fid && this.getFolder(fid)) { r = fid; break result; }
      }
      { r = null; break result; }
			}
			return r;
    },
    buildFolderSelectOptions(selectedParentId = null) {
      const folders = this.data?.folders || [];
      const childrenMap = new Map();
      for (const f of folders) {
        const pid = f.parentId || null;
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid).push(f);
      }
      const options = [];
      const isRootSelected = !selectedParentId || !this.getFolder(selectedParentId);
      options.push(`<option value="" ${isRootSelected ? 'selected' : ''}>📁 Корень (без родителя)</option>`);
      const walk = (parentId, depth) => {
        const list = (childrenMap.get(parentId) || []).slice().sort((a, b) => {
          const cmp = (a?.name || '').localeCompare(b?.name || '', undefined, { numeric: true, sensitivity: 'base' });
          return 0 !== cmp ? cmp : (a?.id || '').localeCompare(b?.id || '');
        });
        for (const f of list) {
          const isSelected = f.id === selectedParentId;
          const prefix = 0 < depth ? `${'&nbsp;&nbsp;'.repeat(depth)}↳ ` : '';
          options.push(`<option value="${escapeHtml(f.id)}" ${isSelected ? 'selected' : ''}>${prefix}📁 ${escapeHtml(f.name)}</option>`);
          walk(f.id, depth + 1);
        }
      };
      walk(null, 0);
      return options.join('');
    }
  };
  window.__PROJECT_FOLDERS_CLIENT__ = client;
  // --- 2. Context Menu System ---
  function closeContextMenu() {
    if (client.activeMenu && client.activeMenu.parentNode) {
      client.activeMenu.parentNode.removeChild(client.activeMenu);
    }
    client.activeMenu = null;
    document.querySelectorAll('.btn-folder-options.is-active').forEach(b => b.classList.remove('is-active'));
  }
  function showContextMenu(x, y, items) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'antigravity-folder-menu';
    menu.setAttribute('role', 'menu');
    items.forEach(item => {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'antigravity-folder-menu-separator';
        menu.appendChild(sep);
        return;
      }
      const row = document.createElement('div');
      row.className = `antigravity-folder-menu-item ${item.danger ? 'danger' : ''}`;
      row.setAttribute('tabindex', '0');
      row.setAttribute('role', 'menuitem');
      const labelSpan = document.createElement('span');
      labelSpan.style.display = 'flex';
      labelSpan.style.alignItems = 'center';
      labelSpan.style.gap = '6px';
      labelSpan.textContent = `${item.icon || ''} ${item.label}`;
      row.appendChild(labelSpan);
      if (item.shortcut) {
        const sc = document.createElement('span');
        sc.className = 'antigravity-folder-menu-shortcut';
        sc.textContent = item.shortcut;
        row.appendChild(sc);
      }
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        closeContextMenu();
        if ('function' === typeof item.onClick) item.onClick();
      });
      row.addEventListener('keydown', (e) => {
        if ('Enter' === e.key || ' ' === e.key) {
          e.preventDefault();
          row.click();
        } else if ('ArrowDown' === e.key || 'ArrowUp' === e.key) {
          e.preventDefault();
          const rows = Array.from(menu.querySelectorAll('[role=menuitem]'));
          const index = rows.indexOf(row);
          rows[(index + ('ArrowDown' === e.key ? 1 : -1) + rows.length) % rows.length]?.focus();
        }
      });
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    client.activeMenu = menu;
    menu.querySelector('[role=menuitem]')?.focus();
    // Boundary check
    const rect = menu.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) {
      left = window.innerWidth - rect.width - 8;
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = window.innerHeight - rect.height - 8;
    }
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  }
  // --- 3. Modal Dialog for Create Folder / Subfolder ---
  function showCreateFolderDialog(projectId = null, explicitParentId = undefined) {
    closeContextMenu();
    if (client.activeModal) return;
    let targetParentId = explicitParentId;
    if (targetParentId === undefined) {
      if (projectId) {
        targetParentId = client.getProjectFolderId(projectId) || null;
      } else {
        targetParentId = client.detectCurrentFolderId();
      }
    }
    const parentFolder = targetParentId ? client.getFolder(targetParentId) : null;
    const parentNameSafe = parentFolder ? escapeHtml(parentFolder.name) : '';
    const titleText = parentFolder ? `Создать подпапку в «${parentNameSafe}»` : 'Создать новую папку';
    const overlay = document.createElement('div');
    overlay.className = 'antigravity-folder-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'antigravity-folder-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', parentFolder ? `Создать подпапку в «${parentFolder.name}»` : 'Создать новую папку');
    modal.innerHTML = `
      <h3 class="folder-modal-title">${titleText}</h3>
      <label class="antigravity-folder-label">Название папки:</label>
      <input type="text" class="folder-name-input" placeholder="${parentFolder ? 'Название подпапки...' : 'Название папки...'}" />
      <label class="antigravity-folder-label">Расположение (родитель):</label>
      <select class="folder-parent-select">
        ${client.buildFolderSelectOptions(targetParentId)}
      </select>
      <div class="antigravity-folder-modal-buttons">
        <button type="button" class="antigravity-folder-btn secondary btn-cancel">Отмена</button>
        <button type="button" class="antigravity-folder-btn primary btn-submit">Создать</button>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    client.activeModal = overlay;
    const titleEl = modal.querySelector('.folder-modal-title');
    const input = modal.querySelector('input.folder-name-input');
    const select = modal.querySelector('select.folder-parent-select');
    const btnCancel = modal.querySelector('.btn-cancel');
    const btnSubmit = modal.querySelector('.btn-submit');
    select.addEventListener('change', () => {
      const curParentId = select.value || null;
      const curParent = curParentId ? client.getFolder(curParentId) : null;
      titleEl.textContent = curParent ? `Создать подпапку в «${curParent.name}»` : 'Создать новую папку';
      input.placeholder = curParent ? 'Название подпапки...' : 'Название папки...';
      input.setCustomValidity('');
    });
    input.focus();
    function closeModal() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      client.activeModal = null;
      document.querySelector('.btn-create-folder')?.focus();
    }
    async function submit() {
			let r;
			result: {
      if (btnSubmit.disabled) { r = undefined; break result; }
      const val = input.value.trim();
      if (!val) {
        input.setCustomValidity('Введите название папки');
        input.reportValidity();
        { r = undefined; break result; }
      }
      const chosenParentId = select.value || null;
      // Sibling uniqueness check (same name allowed in different parents)
      const siblings = (client.data?.folders || []).filter(folder => (folder.parentId || null) === (chosenParentId || null));
      if (siblings.some(folder => folder.name.toLowerCase() === val.toLowerCase())) {
        input.setCustomValidity('Папка с таким названием уже существует в этой ветке');
        input.reportValidity();
        { r = undefined; break result; }
      }
      btnSubmit.disabled = true;
      const result = await client.postAction('add-folder', { name: val, parentId: chosenParentId });
      if (!(result.success)) {
        btnSubmit.disabled = false;
        input.setCustomValidity(result.error || 'Не удалось создать папку');
        input.reportValidity();
      } else {
        const createdFolder = (result.data?.folders || []).find(f => (f.parentId || null) === (chosenParentId || null) && f.name.toLowerCase() === val.toLowerCase());
        if (createdFolder) {
          client.lastActiveFolderId = createdFolder.id;
          if (projectId) {
            await client.postAction('assign-project', { projectId, folderId: createdFolder.id });
          }
        }
        // If created inside a collapsed parent folder, auto-expand parent so new child is visible
        if (chosenParentId) {
          const parentHeader = document.querySelector(`[data-testid='section-header'][data-folder-id='${chosenParentId}']`);
          const toggleBtn = parentHeader?.querySelector('h2 button') || parentHeader?.querySelector('button');
          if (toggleBtn && 'false' === toggleBtn.getAttribute('aria-expanded')) {
            toggleBtn.click();
          }
        }
        closeModal();
      }
			}
			return r;
    }
    input.addEventListener('input', () => input.setCustomValidity(''));
    btnCancel.addEventListener('click', closeModal);
    btnSubmit.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if ('Enter' === e.key) {
        e.preventDefault();
        submit();
      } else if ('Escape' === e.key) {
        e.preventDefault();
        closeModal();
      }
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  }
  // --- 4. Move Folder Menu ---
  function showMoveFolderMenu(coords, folderId) {
    const folder = client.getFolder(folderId);
    if (!folder) return;
    const descendants = client.getDescendantIds(folderId);
    const folders = client.data?.folders || [];
    const items = [];
    const isRoot = null === folder.parentId;
    items.push({
      icon: isRoot ? '✓ 📁' : '📁',
      label: 'В корень (без родителя)',
      onClick: () => {
        if (!isRoot) {
          client.postAction('move-folder', { id: folderId, newParentId: null });
        }
      }
    });
    // Valid targets exclude self and any descendant, sorted in natural alphabetical path order
    const validTargets = folders
      .filter(f => f.id !== folderId && !descendants.has(f.id))
      .sort((a, b) => {
        const pathA = client.getFolderPath(a.id);
        const pathB = client.getFolderPath(b.id);
        const cmp = pathA.localeCompare(pathB, undefined, { numeric: true, sensitivity: 'base' });
        return 0 !== cmp ? cmp : (a?.id || '').localeCompare(b?.id || '');
      });
    if (0 < validTargets.length) {
      items.push({ separator: true });
      validTargets.forEach(target => {
        const isCurrentParent = folder.parentId === target.id;
        const targetPath = client.getFolderPath(target.id);
        items.push({
          icon: isCurrentParent ? '✓ 📁' : '📁',
          label: `В «${targetPath}»`,
          onClick: () => {
            if (!isCurrentParent) {
              client.postAction('move-folder', { id: folderId, newParentId: target.id });
            }
          }
        });
      });
    }
    showContextMenu(coords.clientX, coords.clientY, items);
  }
  // --- 5. Inline Rename (F2 / Menu) ---
  function startInlineRename(folderHeaderEl, folderId, currentName) {
		let r;
		result: {
    closeContextMenu();
    if (!folderHeaderEl) { r = undefined; break result; }
    // Find the text container
    const h2 = folderHeaderEl.querySelector('h2');
    if (!h2) { r = undefined; break result; }
    const button = h2.querySelector('button') || h2;
    const textSpan = button.querySelector('span.truncate') || button.querySelector('span');
    if (!textSpan) { r = undefined; break result; }
    if (folderHeaderEl.querySelector('.folder-rename-input')) { r = undefined; break result; } // Already editing
    const originalText = textSpan.textContent;
    // Extract base name without '📁 ' and ' (N)'
    const baseName = currentName || originalText.replace(/^📁\s*/, '').replace(/\s*\(\d+\)$/, '').trim();
    textSpan.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'folder-rename-input';
    input.value = baseName;
    button.insertBefore(input, textSpan);
    input.focus();
    input.select();
    let finished = false;
    function finish(save) {
      if (finished) return;
      finished = true;
      const newName = input.value.trim();
      if (input.parentNode) input.parentNode.removeChild(input);
      textSpan.style.display = '';
      button.focus?.();
      if (save && newName && newName !== baseName) {
        client.postAction('rename-folder', { id: folderId, newName });
      }
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if ('Enter' === e.key) {
        e.preventDefault();
        finish(true);
      } else if ('Escape' === e.key) {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => {
      finish(true);
    });
    input.addEventListener('click', (e) => {
      e.stopPropagation();
    });
		}
		return r;
  }
  // --- 6. Folder Context Menu Generator ---
  function showFolderContextMenu(e, folderHeaderEl, folderId, folderName) {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      {
        icon: '📁➕',
        label: 'Создать подпапку…',
        onClick: () => showCreateFolderDialog(null, folderId)
      },
      {
        icon: '↗️',
        label: 'Переместить папку…',
        onClick: () => {
          const rect = folderHeaderEl.getBoundingClientRect();
          showMoveFolderMenu({ clientX: rect.left + 20, clientY: rect.bottom + 4 }, folderId);
        }
      },
      {
        icon: '✏️',
        label: 'Переименовать папку',
        shortcut: 'F2',
        onClick: () => startInlineRename(folderHeaderEl, folderId, folderName)
      },
      {
        icon: '➕',
        label: 'Создать новую корневую папку',
        onClick: () => showCreateFolderDialog(null, null)
      },
      { separator: true },
      {
        icon: '🗑️',
        label: 'Удалить папку',
        danger: true,
        onClick: () => {
          if (confirm(`Удалить папку "${folderName}"? (Подпапки и проекты будут подняты на уровень выше)`)) {
            client.postAction('remove-folder', { id: folderId });
          }
        }
      }
    ]);
  }
  // --- 7. Project Context Menu Generator ---
  function showProjectContextMenu(e, projectCardEl, projectId, projectName) {
    e.preventDefault();
    e.stopPropagation();
    const currentFolderId = client.getProjectFolderId(projectId);
    const folders = (client.data?.folders || []).slice().sort((a, b) => {
      const pathA = client.getFolderPath(a.id);
      const pathB = client.getFolderPath(b.id);
      const cmp = pathA.localeCompare(pathB, undefined, { numeric: true, sensitivity: 'base' });
      return 0 !== cmp ? cmp : (a?.id || '').localeCompare(b?.id || '');
    });
    const items = [];
    // List folders with hierarchical breadcrumb paths
    if (0 < folders.length) {
      folders.forEach(f => {
        const isCurrent = f.id === currentFolderId;
        const folderPath = client.getFolderPath(f.id);
        items.push({
          icon: isCurrent ? '✓ 📁' : '📁',
          label: `В папку "${folderPath}"`,
          onClick: () => {
            if (!isCurrent) {
              client.postAction('assign-project', { projectId, folderId: f.id });
            }
          }
        });
      });
    }
    items.push({
      icon: '➕',
      label: 'В новую папку…',
      onClick: () => {
        showCreateFolderDialog(projectId);
      }
    });
    if (currentFolderId) {
      items.push({ separator: true });
      items.push({
        icon: '📤',
        label: 'Убрать из папки (вернуть в корень)',
        onClick: () => {
          client.postAction('unassign-project', { projectId });
        }
      });
    }
    showContextMenu(e.clientX, e.clientY, items);
  }
  // --- 8. Global Event Listeners (Keyboard, Outside Click) ---
  window.addEventListener('click', (e) => {
    if (client.activeMenu && !client.activeMenu.contains(e.target)) {
      closeContextMenu();
    }
  });
  window.addEventListener('keydown', (e) => {
    if ('Escape' === e.key) {
      closeContextMenu();
      if (client.activeModal) {
        if (client.activeModal.parentNode) client.activeModal.parentNode.removeChild(client.activeModal);
        client.activeModal = null;
      }
    } else if (('Insert' === e.key || (e.altKey && ('n' === e.key || 'N' === e.key || 'т' === e.key || 'Т' === e.key))) && !client.activeModal) {
      const isInput = e.target && ('INPUT' === e.target.tagName || 'TEXTAREA' === e.target.tagName || e.target.isContentEditable);
      if (!isInput) {
        e.preventDefault();
        showCreateFolderDialog();
      }
    } else if ('F2' === e.key) {
      const focusedHeader = document.activeElement?.closest('[data-folder-id]');
      const renameHeader = focusedHeader || client.hoveredFolderEl;
      const renameId = focusedHeader?.getAttribute('data-folder-id') || client.hoveredFolderId;
      if (renameHeader && renameId) {
        e.preventDefault();
        const f = client.getFolder(renameId);
        startInlineRename(renameHeader, renameId, f?.name);
      }
    }
  }, true);
  // --- 9. DOM Enhancement & Mutation Observer ---
  function extractFolderInfo(headerEl) {
		let r;
		result: {
    const title = headerEl.getAttribute('data-title') || '';
    if (!title.includes('📁')) { r = null; break result; }
    let fid = headerEl.getAttribute('data-folder-id');
    if (!fid) {
      const parentRow = headerEl.closest('[data-folder-id]');
      if (parentRow) fid = parentRow.getAttribute('data-folder-id');
    }
    if (!fid) {
      const cleanName = title.replace(/^📁\s*/, '').replace(/\s*\(\d+\)$/, '').trim();
      const match = client.data?.folders?.find(f => f.name.toLowerCase() === cleanName.toLowerCase());
      if (match) fid = match.id;
    }
    const cleanName = title.replace(/^📁\s*/, '').replace(/\s*\(\d+\)$/, '').trim();
    { r = { folderId: fid, folderName: cleanName }; break result; }
		}
		return r;
  }
  function extractProjectInfo(cardEl) {
    const labelSpan = cardEl.querySelector('span.truncate') || cardEl.querySelector('span');
    const label = labelSpan ? labelSpan.textContent.trim() : '';
    return { projectId: cardEl.getAttribute('data-project-id'), projectName: label };
  }
  function enhanceSidebarElements() {
    // A. Main Projects Header: 'Create Folder' button + Drop target to unassign/re-parent
    const mainHeader = document.querySelector("[data-testid='section-header'][data-title='Projects'], [data-testid='section-header'][data-title='Workspaces'], [data-testid='section-header'][data-title*='Project']");
    if (mainHeader) {
      const actionsContainer = mainHeader.querySelector('.group\\/section-header > div:last-child') || mainHeader.querySelector('div:last-child');
      if (actionsContainer && !actionsContainer.querySelector('.btn-create-folder')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-create-folder';
        btn.title = 'Создать новую папку (по умолчанию в активной папке)';
        btn.setAttribute('aria-label', 'Создать новую папку');
        btn.innerHTML = '📁<span style="font-size:10px;font-weight:bold;margin-left:1px;">+</span>';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          showCreateFolderDialog();
        });
        actionsContainer.insertBefore(btn, actionsContainer.firstChild);
      }
      if (!mainHeader._foldersDragHooked) {
        mainHeader._foldersDragHooked = true;
        let mainDragCounter = 0;
        mainHeader.addEventListener('dragenter', (e) => {
          const isProjectDrag = hasDragType(e.dataTransfer, 'application/antigravity-project-id') || !!client.draggedProjectId;
          const isFolderDrag = hasDragType(e.dataTransfer, 'application/antigravity-folder-id') || !!client.draggedFolderId;
          if (!isProjectDrag && !isFolderDrag) return;
          mainDragCounter++;
          mainHeader.classList.add('folder-drop-target');
        });
        mainHeader.addEventListener('dragover', (e) => {
					let r;
					result: {
          const isProjectDrag = hasDragType(e.dataTransfer, 'application/antigravity-project-id') || !!client.draggedProjectId;
          const isFolderDrag = hasDragType(e.dataTransfer, 'application/antigravity-folder-id') || !!client.draggedFolderId;
          if (!isProjectDrag && !isFolderDrag) { r = undefined; break result; }
          const draggedFolderId = client.draggedFolderId || e.dataTransfer.getData('application/antigravity-folder-id');
          if (isFolderDrag && draggedFolderId) {
            const f = client.getFolder(draggedFolderId);
            if (f && null === f.parentId || null) {
              { r = undefined; break result; } // Already in root
            }
            if (f) {
              const rootSiblings = (client.data?.folders || []).filter(item => null === item.parentId || null);
              if (rootSiblings.some(item => item.id !== f.id && item.name.toLowerCase() === f.name.toLowerCase())) {
                e.dataTransfer.dropEffect = 'none';
                { r = undefined; break result; }
              }
            }
          }
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          mainHeader.classList.add('folder-drop-target');
					}
					return r;
        });
        mainHeader.addEventListener('dragleave', () => {
          mainDragCounter--;
          if (0 >= mainDragCounter) {
            mainDragCounter = 0;
            mainHeader.classList.remove('folder-drop-target');
          }
        });
        mainHeader.addEventListener('drop', (e) => {
          mainDragCounter = 0;
          mainHeader.classList.remove('folder-drop-target');
          e.preventDefault();
          e.stopPropagation();
          const projId = e.dataTransfer.getData('application/antigravity-project-id') || client.draggedProjectId;
          const folderId = e.dataTransfer.getData('application/antigravity-folder-id') || client.draggedFolderId;
          if (projId) {
            client.postAction('unassign-project', { projectId: projId });
          } else if (folderId) {
            client.postAction('move-folder', { id: folderId, newParentId: null });
          }
        });
      }
    }
    // B. Folder Headers: '+', '...' buttons, context menu, drag & drop
    const folderHeaders = document.querySelectorAll("[data-testid='section-header'][data-title*='📁']");
    folderHeaders.forEach(headerEl => {
      const info = extractFolderInfo(headerEl);
      if (!info || !info.folderId) return;
      headerEl.setAttribute('data-folder-id', info.folderId);
      const innerButton = headerEl.querySelector('h2 button') || headerEl.querySelector('button');
      // Track hovered folder (both current and recent hover history)
      if (!headerEl._foldersHoverHooked) {
        headerEl._foldersHoverHooked = true;
        headerEl.addEventListener('mouseenter', () => {
          client.hoveredFolderId = info.folderId;
          client.hoveredFolderEl = headerEl;
          client.lastHoveredFolderId = info.folderId;
          client.lastHoveredFolderTime = Date.now();
        });
        headerEl.addEventListener('mouseleave', () => {
          if (client.hoveredFolderId === info.folderId) {
            client.hoveredFolderId = null;
            client.hoveredFolderEl = null;
          }
        });
        headerEl.addEventListener('contextmenu', (e) => {
          showFolderContextMenu(e, headerEl, info.folderId, client.getFolder(info.folderId)?.name || info.folderName);
        });
      }
      // Track active folder on click
      if (!headerEl._foldersClickHooked) {
        headerEl._foldersClickHooked = true;
        headerEl.addEventListener('click', (e) => {
          if (client.isDragging) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          client.lastActiveFolderId = info.folderId;
        }, true);
      }
      // Ensure actions container exists
      let actionsContainer = headerEl.querySelector('.antigravity-folder-actions');
      if (!actionsContainer) {
        const innerHeader = headerEl.querySelector('.group\\/section-header') || headerEl;
        actionsContainer = document.createElement('div');
        actionsContainer.className = 'antigravity-folder-actions';
        innerHeader.appendChild(actionsContainer);
      }
      // 1. '+' button to create subfolder
      if (!actionsContainer.querySelector('.btn-folder-add')) {
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn-folder-add';
        const currentFolderName = client.getFolder(info.folderId)?.name || info.folderName;
        addBtn.title = `Создать подпапку в «${currentFolderName}»`;
        addBtn.setAttribute('aria-label', `Создать подпапку в «${currentFolderName}»`);
        addBtn.innerHTML = '📁<span style="font-size:10px;font-weight:bold;margin-left:1px;">+</span>';
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showCreateFolderDialog(null, info.folderId);
        });
        actionsContainer.appendChild(addBtn);
      }
      // 2. '...' button for folder options
      if (!actionsContainer.querySelector('.btn-folder-options')) {
        const optBtn = document.createElement('button');
        optBtn.type = 'button';
        optBtn.className = 'btn-folder-options';
        optBtn.title = 'Опции папки (Подпапка, Переместить, Переименовать, Удалить)';
        optBtn.setAttribute('aria-label', 'Опции папки');
        optBtn.innerHTML = '⋯';
        optBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          optBtn.classList.add('is-active');
          const rect = optBtn.getBoundingClientRect();
          showFolderContextMenu({
            clientX: rect.left,
            clientY: rect.bottom + 4,
            preventDefault: () => {},
            stopPropagation: () => {}
          }, headerEl, info.folderId, client.getFolder(info.folderId)?.name || info.folderName);
        });
        actionsContainer.appendChild(optBtn);
      }
      // Pointerdown handling to prevent Antigravity virtual list from capturing pointer and killing drag
      const handleFolderPointerDown = (e) => {
				let r;
				result: {
        if (e.altKey || 0 !== e.button) { r = undefined; break result; }
        if (e.target.closest('.btn-folder-options') || e.target.closest('.btn-folder-add') || e.target.closest('.folder-rename-input') || e.target.closest('input')) { r = undefined; break result; }
        e.stopPropagation();
				}
				return r;
      };
      if (!headerEl._foldersPointerHooked) {
        headerEl._foldersPointerHooked = true;
        headerEl.addEventListener('pointerdown', handleFolderPointerDown);
      }
      if (innerButton && !innerButton._foldersPointerHooked) {
        innerButton._foldersPointerHooked = true;
        innerButton.addEventListener('pointerdown', handleFolderPointerDown);
      }
      // Make folder header and inner button draggable
      headerEl.setAttribute('draggable', 'true');
      if (innerButton) {
        innerButton.setAttribute('draggable', 'true');
      }
      const handleFolderDragStart = (e) => {
				let r;
				result: {
        if (e.target.closest('.btn-folder-options') || e.target.closest('.btn-folder-add') || e.target.closest('.folder-rename-input') || e.target.closest('input')) {
          e.preventDefault();
          { r = undefined; break result; }
        }
        if (e.altKey) { r = undefined; break result; }
        e.stopPropagation();
        client.isDragging = true;
        client.draggedFolderId = info.folderId;
        client.draggedProjectId = null;
        e.dataTransfer.setData('application/antigravity-folder-id', info.folderId);
        e.dataTransfer.setData('text/plain', info.folderId);
        e.dataTransfer.effectAllowed = 'move';
        headerEl.style.opacity = '0.5';
				}
				return r;
      };
      const handleFolderDragEnd = () => {
        headerEl.style.opacity = '';
        client.draggedFolderId = null;
        client.draggedProjectId = null;
        document.querySelectorAll('.folder-drop-target').forEach(el => el.classList.remove('folder-drop-target'));
        setTimeout(() => { client.isDragging = false; }, 100);
      };
      if (!headerEl._foldersDragStartHooked) {
        headerEl._foldersDragStartHooked = true;
        headerEl.addEventListener('dragstart', handleFolderDragStart);
        headerEl.addEventListener('dragend', handleFolderDragEnd);
      }
      if (innerButton && !innerButton._foldersDragStartHooked) {
        innerButton._foldersDragStartHooked = true;
        innerButton.addEventListener('dragstart', handleFolderDragStart);
        innerButton.addEventListener('dragend', handleFolderDragEnd);
      }
      // Drop target on folder header
      if (!headerEl._foldersDropHooked) {
        headerEl._foldersDropHooked = true;
        headerEl._dragCounter = 0;
        headerEl.addEventListener('dragenter', (e) => {
					let r;
					result: {
          const isProjectDrag = hasDragType(e.dataTransfer, 'application/antigravity-project-id') || !!client.draggedProjectId;
          const isFolderDrag = hasDragType(e.dataTransfer, 'application/antigravity-folder-id') || !!client.draggedFolderId;
          if (!isProjectDrag && !isFolderDrag) { r = undefined; break result; }
          const draggedFolderId = client.draggedFolderId || e.dataTransfer.getData('application/antigravity-folder-id');
          if (isFolderDrag && draggedFolderId) {
            if (draggedFolderId === info.folderId) { r = undefined; break result; }
            const descendants = client.getDescendantIds(draggedFolderId);
            if (descendants.has(info.folderId)) { r = undefined; break result; }
            const df = client.getFolder(draggedFolderId);
            if (df && (df.parentId || null) === info.folderId) { r = undefined; break result; }
          }
          headerEl._dragCounter++;
          headerEl.classList.add('folder-drop-target');
					}
					return r;
        });
        headerEl.addEventListener('dragover', (e) => {
					let r;
					result: {
          const isProjectDrag = hasDragType(e.dataTransfer, 'application/antigravity-project-id') || !!client.draggedProjectId;
          const isFolderDrag = hasDragType(e.dataTransfer, 'application/antigravity-folder-id') || !!client.draggedFolderId;
          if (!isProjectDrag && !isFolderDrag) { r = undefined; break result; }
          const draggedFolderId = client.draggedFolderId || e.dataTransfer.getData('application/antigravity-folder-id');
          if (isFolderDrag && draggedFolderId) {
            // 1. Cannot drop into self
            if (draggedFolderId === info.folderId) {
              e.dataTransfer.dropEffect = 'none';
              { r = undefined; break result; }
            }
            // 2. Cannot drop into descendant (cycle prevention)
            const descendants = client.getDescendantIds(draggedFolderId);
            if (descendants.has(info.folderId)) {
              e.dataTransfer.dropEffect = 'none';
              { r = undefined; break result; }
            }
            // 3. Cannot drop if already a child of this folder
            const df = client.getFolder(draggedFolderId);
            if (df && (df.parentId || null) === info.folderId) {
              e.dataTransfer.dropEffect = 'none';
              { r = undefined; break result; }
            }
            // 4. Sibling name collision check
            if (df) {
              const targetSiblings = (client.data?.folders || []).filter(f => (f.parentId || null) === info.folderId);
              if (targetSiblings.some(f => f.id !== df.id && f.name.toLowerCase() === df.name.toLowerCase())) {
                e.dataTransfer.dropEffect = 'none';
                { r = undefined; break result; }
              }
            }
          }
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          headerEl.classList.add('folder-drop-target');
					}
					return r;
        });
        headerEl.addEventListener('dragleave', () => {
          headerEl._dragCounter--;
          if (0 >= headerEl._dragCounter) {
            headerEl._dragCounter = 0;
            headerEl.classList.remove('folder-drop-target');
          }
        });
        headerEl.addEventListener('drop', async (e) => {
          headerEl._dragCounter = 0;
          headerEl.classList.remove('folder-drop-target');
          e.preventDefault();
          e.stopPropagation();
          const projId = e.dataTransfer.getData('application/antigravity-project-id') || client.draggedProjectId;
          const draggedFolderId = e.dataTransfer.getData('application/antigravity-folder-id') || client.draggedFolderId;
          if (projId) {
            await client.postAction('assign-project', { projectId: projId, folderId: info.folderId });
          } else if (draggedFolderId && draggedFolderId !== info.folderId) {
            const descendants = client.getDescendantIds(draggedFolderId);
            if (!descendants.has(info.folderId)) {
              const res = await client.postAction('move-folder', { id: draggedFolderId, newParentId: info.folderId });
              if (res && res.success) {
                // Automatically expand target folder if collapsed so user sees the newly moved folder
                const toggleBtn = headerEl.querySelector('h2 button') || headerEl.querySelector('button');
                if (toggleBtn && 'false' === toggleBtn.getAttribute('aria-expanded')) {
                  toggleBtn.click();
                }
              }
            }
          }
        });
      }
    });
    // C. Empty Folder Placeholders: Also accept dropping directly onto "(папка пуста)"
    const placeholders = document.querySelectorAll("[data-testid='empty-placeholder'], [data-group-id^='folder-']");
    placeholders.forEach(ph => {
			let r;
			result: {
      if (ph._foldersDropHooked) { r = undefined; break result; }
      const groupId = ph.getAttribute('data-group-id') || '';
      let targetFolderId = ph.getAttribute('data-folder-id');
      if (!targetFolderId && groupId.startsWith('folder-')) {
        targetFolderId = groupId.slice(7);
      }
      if (!targetFolderId) { r = undefined; break result; }
      ph._foldersDropHooked = true;
      ph.addEventListener('dragover', (e) => {
				let r;
				result: {
        const isProjectDrag = hasDragType(e.dataTransfer, 'application/antigravity-project-id') || !!client.draggedProjectId;
        const isFolderDrag = hasDragType(e.dataTransfer, 'application/antigravity-folder-id') || !!client.draggedFolderId;
        if (!isProjectDrag && !isFolderDrag) { r = undefined; break result; }
        const draggedFolderId = client.draggedFolderId || e.dataTransfer.getData('application/antigravity-folder-id');
        if (isFolderDrag && draggedFolderId) {
          if (draggedFolderId === targetFolderId) { r = undefined; break result; }
          const descendants = client.getDescendantIds(draggedFolderId);
          if (descendants.has(targetFolderId)) { r = undefined; break result; }
          const df = client.getFolder(draggedFolderId);
          if (df && (df.parentId || null) === targetFolderId) { r = undefined; break result; }
          if (df) {
            const targetSiblings = (client.data?.folders || []).filter(f => (f.parentId || null) === targetFolderId);
            if (targetSiblings.some(f => f.id !== df.id && f.name.toLowerCase() === df.name.toLowerCase())) {
              { r = undefined; break result; }
            }
          }
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        ph.classList.add('folder-drop-target');
				}
				return r;
      });
      ph.addEventListener('dragleave', () => {
        ph.classList.remove('folder-drop-target');
      });
      ph.addEventListener('drop', async (e) => {
        ph.classList.remove('folder-drop-target');
        e.preventDefault();
        e.stopPropagation();
        const projId = e.dataTransfer.getData('application/antigravity-project-id') || client.draggedProjectId;
        const draggedFolderId = e.dataTransfer.getData('application/antigravity-folder-id') || client.draggedFolderId;
        if (projId) {
          await client.postAction('assign-project', { projectId: projId, folderId: targetFolderId });
        } else if (draggedFolderId && draggedFolderId !== targetFolderId) {
          const descendants = client.getDescendantIds(draggedFolderId);
          if (!descendants.has(targetFolderId)) {
            const df = client.getFolder(draggedFolderId);
            if (df && (df.parentId || null) !== targetFolderId) {
              const targetSiblings = (client.data?.folders || []).filter(f => (f.parentId || null) === targetFolderId);
              if (!targetSiblings.some(f => f.id !== df.id && f.name.toLowerCase() === df.name.toLowerCase())) {
                await client.postAction('move-folder', { id: draggedFolderId, newParentId: targetFolderId });
              }
            }
          }
        }
      });
			}
			return r;
    });
    // D. Project Cards: Draggable and context menu
    const projectCards = document.querySelectorAll('button[data-project-card]');
    projectCards.forEach(card => {
			let r;
			result: {
      if (card._foldersProjectHooked) { r = undefined; break result; }
      const info = extractProjectInfo(card);
      if (!info.projectId) { r = undefined; break result; }
      card._foldersProjectHooked = true;
      // Keep folder drag separate from Antigravity pointer drag
      card.addEventListener('pointerdown', e => { if (!e.altKey && 0 === e.button) e.stopPropagation(); });
      card.addEventListener('dragstart', e => { if (e.altKey) e.preventDefault(); });
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', (e) => {
        const curInfo = extractProjectInfo(card);
        client.isDragging = true;
        client.draggedProjectId = curInfo.projectId;
        client.draggedFolderId = null;
        e.dataTransfer.setData('application/antigravity-project-id', curInfo.projectId);
        e.dataTransfer.setData('text/plain', curInfo.projectId);
        e.dataTransfer.effectAllowed = 'move';
        card.style.opacity = '0.5';
      });
      card.addEventListener('dragend', () => {
        card.style.opacity = '';
        client.draggedProjectId = null;
        client.draggedFolderId = null;
        document.querySelectorAll('.folder-drop-target').forEach(el => el.classList.remove('folder-drop-target'));
        setTimeout(() => { client.isDragging = false; }, 100);
      });
      card.addEventListener('click', () => {
        const curInfo = extractProjectInfo(card);
        if (curInfo.projectId) {
          client.lastActiveProjectId = curInfo.projectId;
          client.lastActiveFolderId = client.getProjectFolderId(curInfo.projectId);
        }
      });
      card.addEventListener('contextmenu', (e) => {
        const curInfo = extractProjectInfo(card);
        showProjectContextMenu(e, card, curInfo.projectId, curInfo.projectName);
      });
			}
			return r;
    });
    // E. Conversation Rows: Track active project and folder on click
    const convoRows = document.querySelectorAll("[data-testid^='conversation-row-']");
    convoRows.forEach(row => {
      if (row._foldersConvoHooked) return;
      row._foldersConvoHooked = true;
      row.addEventListener('click', () => {
        const pid = row.closest('[data-group-id]')?.getAttribute('data-group-id');
        if (pid) {
          client.lastActiveProjectId = pid;
          client.lastActiveFolderId = client.getProjectFolderId(pid);
        }
      });
    });
  }
  const observer = new MutationObserver(() => {
    enhanceSidebarElements();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if ('loading' === document.readyState) {
    document.addEventListener('DOMContentLoaded', enhanceSidebarElements);
  } else {
    enhanceSidebarElements();
  }
  console.log('[folders-client] Hierarchical Project Folders UI Controller successfully loaded and active.');
	}
	return r;
})();
