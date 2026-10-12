/**
 * folders-client.js
 * Client-side Controller for Hierarchical Project Folders in Antigravity 2.0.
 * Implements Method 1 from res/16.md (Parent References tree model):
 * 1. "Create Folder" button in Projects header + modal dialog.
 * 2. Hierarchical folder operations: "Создать подпапку", "Переместить папку…", Inline rename, Delete with promotion.
 * 3. Cycle prevention & validation in UI.
 * 4. Project context menu with hierarchical folder paths ("Upwork / 2026").
 * 5. Drag & Drop for projects and folders (into folders, re-parenting, and unassigning to root).
 * 6. Immediate reactive updates via window custom events without page reload.
 */

(function initAntigravityFoldersClient() {
  if (typeof window === 'undefined') return;
  if (window.__PROJECT_FOLDERS_CLIENT_INITIALIZED__) return;
  window.__PROJECT_FOLDERS_CLIENT_INITIALIZED__ = true;

  console.log('[folders-client] Initializing Hierarchical Project Folders UI Controller...');

  // --- 1. Client State & Server API ---
  const client = {
    data: window.__PROJECT_FOLDERS_DATA__ || { folders: [], projectFolderMap: {} },
    activeMenu: null,
    activeModal: null,
    hoveredFolderId: null,
    hoveredFolderEl: null,

    async postAction(action, payload = {}) {
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
        return result;
      } catch (err) {
        console.error('[folders-client] Action error:', err);
        return { success: false, error: err.message };
      }
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
      if (!this.data || !Array.isArray(this.data.folders)) return null;
      return this.data.folders.find(f => f.id === id) || null;
    },

    getProjectFolderId(projectId) {
      return this.data?.projectFolderMap?.[projectId] || null;
    },

    getFolderPath(folderId) {
      if (!this.data || !Array.isArray(this.data.folders)) return '';
      const map = new Map(this.data.folders.map(f => [f.id, f]));
      const parts = [];
      let curr = map.get(folderId);
      const seen = new Set();
      while (curr && !seen.has(curr.id)) {
        seen.add(curr.id);
        parts.unshift(curr.name);
        curr = curr.parentId ? map.get(curr.parentId) : null;
      }
      return parts.join(' / ');
    },

    getDescendantIds(folderId) {
      if (!this.data || !Array.isArray(this.data.folders)) return new Set();
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
      return descendants;
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
        if (typeof item.onClick === 'function') item.onClick();
      });

      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          row.click();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const rows = Array.from(menu.querySelectorAll('[role=menuitem]'));
          const index = rows.indexOf(row);
          rows[(index + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
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
  function showCreateFolderDialog(projectId = null, parentId = null) {
    closeContextMenu();
    if (client.activeModal) return;

    const parentFolder = parentId ? client.getFolder(parentId) : null;
    const titleText = parentFolder ? `Создать подпапку в «${parentFolder.name}»` : 'Создать новую папку';

    const overlay = document.createElement('div');
    overlay.className = 'antigravity-folder-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'antigravity-folder-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', titleText);

    modal.innerHTML = `
      <h3>${titleText}</h3>
      <input type="text" class="folder-name-input" placeholder="${parentFolder ? 'Название подпапки...' : 'Название папки...'}" />
      <div class="antigravity-folder-modal-buttons">
        <button type="button" class="antigravity-folder-btn secondary btn-cancel">Отмена</button>
        <button type="button" class="antigravity-folder-btn primary btn-submit">Создать</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    client.activeModal = overlay;

    const input = modal.querySelector('input');
    const btnCancel = modal.querySelector('.btn-cancel');
    const btnSubmit = modal.querySelector('.btn-submit');

    input.focus();

    function closeModal() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      client.activeModal = null;
      document.querySelector('.btn-create-folder')?.focus();
    }

    async function submit() {
      if (btnSubmit.disabled) return;
      const val = input.value.trim();
      if (!val) return;

      // Sibling uniqueness check (same name allowed in different parents)
      const siblings = (client.data?.folders || []).filter(folder => (folder.parentId || null) === (parentId || null));
      if (siblings.some(folder => folder.name.toLowerCase() === val.toLowerCase())) {
        input.setCustomValidity('Папка с таким названием уже существует в этой ветке');
        input.reportValidity();
        return;
      }

      btnSubmit.disabled = true;
      const result = await client.postAction('add-folder', { name: val, parentId: parentId || null });
      if (result.success) {
        if (projectId) {
          const folder = (result.data.folders || []).find(f => (f.parentId || null) === (parentId || null) && f.name === val);
          if (folder) await client.postAction('assign-project', { projectId, folderId: folder.id });
        }
        closeModal();
      } else {
        btnSubmit.disabled = false;
        input.setCustomValidity(result.error || 'Не удалось создать папку');
        input.reportValidity();
      }
    }

    input.addEventListener('input', () => input.setCustomValidity(''));
    btnCancel.addEventListener('click', closeModal);
    btnSubmit.addEventListener('click', submit);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
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
    const isRoot = folder.parentId === null;

    items.push({
      icon: isRoot ? '✓ 📁' : '📁',
      label: 'В корень (без родителя)',
      onClick: () => {
        if (!isRoot) {
          client.postAction('move-folder', { id: folderId, newParentId: null });
        }
      }
    });

    // Valid targets exclude self and any descendant
    const validTargets = folders.filter(f => f.id !== folderId && !descendants.has(f.id));
    if (validTargets.length > 0) {
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
    closeContextMenu();
    if (!folderHeaderEl) return;

    // Find the text container
    const h2 = folderHeaderEl.querySelector('h2');
    if (!h2) return;
    const button = h2.querySelector('button') || h2;
    const textSpan = button.querySelector('span.truncate') || button.querySelector('span');
    if (!textSpan) return;

    if (folderHeaderEl.querySelector('.folder-rename-input')) return; // Already editing

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
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
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
        onClick: () => showCreateFolderDialog()
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
    const folders = client.data?.folders || [];

    const items = [];

    // List folders with hierarchical breadcrumb paths
    if (folders.length > 0) {
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
    if (e.key === 'Escape') {
      closeContextMenu();
      if (client.activeModal) {
        if (client.activeModal.parentNode) client.activeModal.parentNode.removeChild(client.activeModal);
        client.activeModal = null;
      }
    } else if (e.key === 'F2') {
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
    const title = headerEl.getAttribute('data-title') || '';
    if (!title.includes('📁')) return null;

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
    return { folderId: fid, folderName: cleanName };
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
        btn.title = 'Создать новую папку';
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
        mainHeader.addEventListener('dragover', (e) => {
          if (e.dataTransfer.types.includes('application/antigravity-project-id') || e.dataTransfer.types.includes('application/antigravity-folder-id')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            mainHeader.classList.add('folder-drop-target');
          }
        });
        mainHeader.addEventListener('dragleave', () => {
          mainHeader.classList.remove('folder-drop-target');
        });
        mainHeader.addEventListener('drop', (e) => {
          mainHeader.classList.remove('folder-drop-target');
          const projId = e.dataTransfer.getData('application/antigravity-project-id');
          const folderId = e.dataTransfer.getData('application/antigravity-folder-id');
          if (projId) {
            e.preventDefault();
            client.postAction('unassign-project', { projectId: projId });
          } else if (folderId) {
            e.preventDefault();
            client.postAction('move-folder', { id: folderId, newParentId: null });
          }
        });
      }
    }

    // B. Folder Headers: '...' button, context menu, drag & drop
    const folderHeaders = document.querySelectorAll("[data-testid='section-header'][data-title*='📁']");
    folderHeaders.forEach(headerEl => {
      const info = extractFolderInfo(headerEl);
      if (!info || !info.folderId) return;

      headerEl.setAttribute('data-folder-id', info.folderId);

      // Track hovered folder for F2
      if (!headerEl._foldersHoverHooked) {
        headerEl._foldersHoverHooked = true;
        headerEl.addEventListener('mouseenter', () => {
          client.hoveredFolderId = info.folderId;
          client.hoveredFolderEl = headerEl;
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

      // Ensure '...' button exists
      let actionsContainer = headerEl.querySelector('.antigravity-folder-actions') || headerEl.querySelector(':scope > div:last-child');
      if (!actionsContainer) {
        actionsContainer = document.createElement('div');
        actionsContainer.className = 'antigravity-folder-actions';
        headerEl.appendChild(actionsContainer);
      }
      if (actionsContainer && !actionsContainer.querySelector('.btn-folder-options')) {
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

      // Make folder header draggable
      headerEl.setAttribute('draggable', 'true');
      if (!headerEl._foldersDragStartHooked) {
        headerEl._foldersDragStartHooked = true;
        headerEl.addEventListener('dragstart', (e) => {
          // Alt+drag preserves original behavior if any
          if (e.altKey) return;
          e.dataTransfer.setData('application/antigravity-folder-id', info.folderId);
          e.dataTransfer.setData('text/plain', info.folderId);
          e.dataTransfer.effectAllowed = 'move';
          headerEl.style.opacity = '0.5';
        });
        headerEl.addEventListener('dragend', () => {
          headerEl.style.opacity = '';
          document.querySelectorAll('.folder-drop-target').forEach(el => el.classList.remove('folder-drop-target'));
        });
      }

      // Drop target on folder header
      if (!headerEl._foldersDropHooked) {
        headerEl._foldersDropHooked = true;
        headerEl.addEventListener('dragover', (e) => {
          if (e.dataTransfer.types.includes('application/antigravity-project-id') || e.dataTransfer.types.includes('application/antigravity-folder-id')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            headerEl.classList.add('folder-drop-target');
          }
        });
        headerEl.addEventListener('dragleave', () => {
          headerEl.classList.remove('folder-drop-target');
        });
        headerEl.addEventListener('drop', (e) => {
          headerEl.classList.remove('folder-drop-target');
          const projId = e.dataTransfer.getData('application/antigravity-project-id');
          const draggedFolderId = e.dataTransfer.getData('application/antigravity-folder-id');

          if (projId) {
            e.preventDefault();
            client.postAction('assign-project', { projectId: projId, folderId: info.folderId });
          } else if (draggedFolderId && draggedFolderId !== info.folderId) {
            e.preventDefault();
            const descendants = client.getDescendantIds(draggedFolderId);
            if (!descendants.has(info.folderId)) {
              client.postAction('move-folder', { id: draggedFolderId, newParentId: info.folderId });
            }
          }
        });
      }
    });

    // C. Project Cards: Draggable and context menu
    const projectCards = document.querySelectorAll('button[data-project-card]');
    projectCards.forEach(card => {
      if (card._foldersProjectHooked) return;
      const info = extractProjectInfo(card);
      if (!info.projectId) return;
      card._foldersProjectHooked = true;

      // Keep folder drag separate from Antigravity pointer drag
      card.addEventListener('pointerdown', e => { if (!e.altKey && e.button === 0) e.stopPropagation(); });
      card.addEventListener('dragstart', e => { if (e.altKey) e.preventDefault(); });
      card.setAttribute('draggable', 'true');

      card.addEventListener('dragstart', (e) => {
        const curInfo = extractProjectInfo(card);
        e.dataTransfer.setData('application/antigravity-project-id', curInfo.projectId);
        e.dataTransfer.setData('text/plain', curInfo.projectId);
        e.dataTransfer.effectAllowed = 'move';
        card.style.opacity = '0.5';
      });

      card.addEventListener('dragend', () => {
        card.style.opacity = '';
        document.querySelectorAll('.folder-drop-target').forEach(el => el.classList.remove('folder-drop-target'));
      });

      card.addEventListener('contextmenu', (e) => {
        const curInfo = extractProjectInfo(card);
        showProjectContextMenu(e, card, curInfo.projectId, curInfo.projectName);
      });
    });
  }

  const observer = new MutationObserver(() => {
    enhanceSidebarElements();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceSidebarElements);
  } else {
    enhanceSidebarElements();
  }

  console.log('[folders-client] Hierarchical Project Folders UI Controller successfully loaded and active.');
})();
