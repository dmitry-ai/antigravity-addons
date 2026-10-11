/**
 * folders-client.js
 * Client-side Controller for Project Folders in Antigravity 2.0.
 * Implements:
 * 1. "Create Folder" button in Projects header + modal dialog.
 * 2. Folder context menu (...) and right-click: Rename, Delete, New Folder.
 * 3. Project context menu: Move to Folder..., Remove from Folder.
 * 4. Inline rename with F2 / double-click / menu with Enter/Esc.
 * 5. Drag & Drop of projects onto folders with visual highlight.
 * 6. Immediate reactive updates via storageService without page reloads.
 */

(function initAntigravityFoldersClient() {
  if (typeof window === 'undefined') return;
  if (window.__PROJECT_FOLDERS_CLIENT_INITIALIZED__) return;
  window.__PROJECT_FOLDERS_CLIENT_INITIALIZED__ = true;

  console.log('[folders-client] Initializing Project Folders UI Controller...');

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
      // Trigger Antigravity's storageService watcher to force re-render jZb
      if (window.__STORAGE_SERVICE__) {
        try {
          const cur = window.__STORAGE_SERVICE__.get('sidebar_collapsed_section_headers') || [];
          window.__STORAGE_SERVICE__.store('sidebar_collapsed_section_headers', cur);
        } catch (e) {
          console.warn('[folders-client] storageService re-render trigger:', e);
        }
      }
      window.dispatchEvent(new CustomEvent('antigravity-folders-updated', { detail: this.data }));
    },

    getFolder(id) {
      if (!this.data || !Array.isArray(this.data.folders)) return null;
      return this.data.folders.find(f => f.id === id) || null;
    },

    getProjectFolderId(projectId) {
      return this.data?.projectFolderMap?.[projectId] || null;
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

      const labelSpan = document.createElement('span');
      labelSpan.style.display = 'flex';
      labelSpan.style.alignItems = 'center';
      labelSpan.style.gap = '6px';
      labelSpan.innerHTML = `${item.icon || ''} <span>${item.label}</span>`;
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
        }
      });

      menu.appendChild(row);
    });

    document.body.appendChild(menu);
    client.activeMenu = menu;

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

  // --- 3. Modal Dialog for Create Folder ---
  function showCreateFolderDialog() {
    closeContextMenu();
    if (client.activeModal) return;

    const overlay = document.createElement('div');
    overlay.className = 'antigravity-folder-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'antigravity-folder-modal';

    modal.innerHTML = `
      <h3>Создать новую папку</h3>
      <input type="text" class="folder-name-input" placeholder="Название папки..." />
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
    }

    function submit() {
      const val = input.value.trim();
      if (val) {
        client.postAction('add-folder', { name: val });
      }
      closeModal();
    }

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

  // --- 4. Inline Rename (F2 / Menu) ---
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

  // --- 5. Folder Context Menu Generator ---
  function showFolderContextMenu(e, folderHeaderEl, folderId, folderName) {
    e.preventDefault();
    e.stopPropagation();

    showContextMenu(e.clientX, e.clientY, [
      {
        icon: '✏️',
        label: 'Переименовать папку',
        shortcut: 'F2',
        onClick: () => startInlineRename(folderHeaderEl, folderId, folderName)
      },
      {
        icon: '➕',
        label: 'Создать новую папку',
        onClick: () => showCreateFolderDialog()
      },
      { separator: true },
      {
        icon: '🗑️',
        label: 'Удалить папку',
        danger: true,
        onClick: () => {
          if (confirm(`Удалить папку "${folderName}"? (Все проекты внутри вернутся в корень списка)`)) {
            client.postAction('remove-folder', { id: folderId });
          }
        }
      }
    ]);
  }

  // --- 6. Project Context Menu Generator ---
  function showProjectContextMenu(e, projectCardEl, projectId, projectName) {
    e.preventDefault();
    e.stopPropagation();

    const currentFolderId = client.getProjectFolderId(projectId);
    const folders = client.data?.folders || [];

    const items = [];

    // Submenu or listed folders
    if (folders.length > 0) {
      folders.forEach(f => {
        const isCurrent = f.id === currentFolderId;
        items.push({
          icon: isCurrent ? '✓ 📁' : '📁',
          label: `В папку "${f.name}"`,
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
        showCreateFolderDialog();
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

  // --- 7. Global Event Listeners (Keyboard, Outside Click) ---
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
      if (client.hoveredFolderEl && client.hoveredFolderId) {
        e.preventDefault();
        const f = client.getFolder(client.hoveredFolderId);
        startInlineRename(client.hoveredFolderEl, client.hoveredFolderId, f?.name);
      }
    }
  });

  // --- 8. DOM Enhancement & Mutation Observer ---
  // Helper to extract folderId from header row
  function extractFolderInfo(headerEl) {
    const title = headerEl.getAttribute('data-title') || '';
    if (!title.includes('📁')) return null;

    // Check data-folder-id attribute
    let fid = headerEl.getAttribute('data-folder-id');
    if (!fid) {
      // Find matching folder from data by name
      const cleanName = title.replace(/^📁\s*/, '').replace(/\s*\(\d+\)$/, '').trim();
      const match = client.data?.folders?.find(f => f.name.toLowerCase() === cleanName.toLowerCase());
      if (match) fid = match.id;
    }
    const cleanName = title.replace(/^📁\s*/, '').replace(/\s*\(\d+\)$/, '').trim();
    return { folderId: fid, folderName: cleanName };
  }

  // Helper to extract projectId from project card
  function extractProjectInfo(cardEl) {
    const parentRow = cardEl.closest('[data-testid^="conversation-list-sidebar"] [data-index]');
    // Check href, title, or label inside button
    const labelSpan = cardEl.querySelector('span.truncate') || cardEl.querySelector('span');
    const label = labelSpan ? labelSpan.textContent.trim() : '';

    // Match with projectFolderMap or known projects
    const allProjects = client.data?.projectFolderMap ? Object.keys(client.data.projectFolderMap) : [];
    // Or scan projects data if present
    return { projectId: cardEl.getAttribute('data-project-id') || label, projectName: label };
  }

  function enhanceSidebarElements() {
    // A. Main Projects Header: Ensure 'Create Folder' button exists
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

        // Insert before or after existing actions
        actionsContainer.insertBefore(btn, actionsContainer.firstChild);
      }

      // Drag over main header to unassign (move to root)
      if (!mainHeader._foldersDragHooked) {
        mainHeader._foldersDragHooked = true;
        mainHeader.addEventListener('dragover', (e) => {
          if (e.dataTransfer.types.includes('application/antigravity-project-id') || e.dataTransfer.types.includes('text/plain')) {
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
          if (projId) {
            e.preventDefault();
            client.postAction('unassign-project', { projectId: projId });
          }
        });
      }
    }

    // B. Folder Headers: Ensure options button (...), contextmenu, and Drag&Drop drop-target
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
          showFolderContextMenu(e, headerEl, info.folderId, info.folderName);
        });
      }

      // Ensure '...' button exists
      const actionsContainer = headerEl.querySelector('.group\\/section-header > div:last-child') || headerEl.querySelector('div:last-child');
      if (actionsContainer && !actionsContainer.querySelector('.btn-folder-options')) {
        const optBtn = document.createElement('button');
        optBtn.type = 'button';
        optBtn.className = 'btn-folder-options';
        optBtn.title = 'Опции папки (Переименовать, Удалить)';
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
          }, headerEl, info.folderId, info.folderName);
        });

        actionsContainer.appendChild(optBtn);
      }

      // Drag & Drop onto folder
      if (!headerEl._foldersDropHooked) {
        headerEl._foldersDropHooked = true;
        headerEl.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          headerEl.classList.add('folder-drop-target');
        });
        headerEl.addEventListener('dragleave', () => {
          headerEl.classList.remove('folder-drop-target');
        });
        headerEl.addEventListener('drop', (e) => {
          headerEl.classList.remove('folder-drop-target');
          const projId = e.dataTransfer.getData('application/antigravity-project-id') || e.dataTransfer.getData('text/plain');
          if (projId) {
            e.preventDefault();
            client.postAction('assign-project', { projectId: projId, folderId: info.folderId });
          }
        });
      }
    });

    // C. Project Cards: Make draggable and hook contextmenu
    const projectCards = document.querySelectorAll('button[data-project-card]');
    projectCards.forEach(card => {
      if (card._foldersProjectHooked) return;
      card._foldersProjectHooked = true;

      const info = extractProjectInfo(card);

      // Make draggable
      card.setAttribute('draggable', 'true');

      card.addEventListener('dragstart', (e) => {
        const curInfo = extractProjectInfo(card);
        e.dataTransfer.setData('application/antigravity-project-id', curInfo.projectName); // Name or ID
        e.dataTransfer.setData('text/plain', curInfo.projectName);
        e.dataTransfer.effectAllowed = 'move';
        card.style.opacity = '0.5';
      });

      card.addEventListener('dragend', () => {
        card.style.opacity = '';
        document.querySelectorAll('.folder-drop-target').forEach(el => el.classList.remove('folder-drop-target'));
      });

      // Context menu on right click
      card.addEventListener('contextmenu', (e) => {
        const curInfo = extractProjectInfo(card);
        showProjectContextMenu(e, card, curInfo.projectName, curInfo.projectName);
      });
    });
  }

  // Run observer
  const observer = new MutationObserver(() => {
    enhanceSidebarElements();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Initial scan
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceSidebarElements);
  } else {
    enhanceSidebarElements();
  }

  // Periodic safeguard for virtualized scroll repaints
  setInterval(enhanceSidebarElements, 600);

  console.log('[folders-client] Project Folders UI Controller successfully loaded and active.');
})();
