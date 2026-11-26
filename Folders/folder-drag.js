// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// 2026-11-14
// "Decompose Folders/folders-client.js into FolderStorageClient, FolderTreeRenderer, and folder-drag.js, narrow MutationObserver, and stop idle polling":
// https://github.com/dmitry-ai/antigravity-addons/issues/46
class SidebarDragController {
	/**
	 * @used-by {@link import('./folder-picker.test.js')}
	 * @used-by {@link import('./folders-client.js').FoldersView#constructor}
	 */
	constructor(view) {
		Object.assign(this, {view, activeDropEl: null, draggedElement: null, abortController: null});
	}
	/**
	 * @used-by {@link import('../Multi-Account/main-bootstrap.js').configureSecondaryProfile}
	 * @used-by {@link import('../Multi-Account/main-bootstrap.js')} (configureProtocolHandler)
	 * @used-by {@link import('../Multi-Account/update-guard.js')} (UpdateGuard#patchAutoUpdater)
	 * @used-by {@link import('../Multi-Account/window-identity.js').patchWindowTitle}
	 * @used-by {@link import('../Titlebar-Badges/browser.test.js')} (openFixture)
	 * @used-by {@link import('../Upgrade/test-cdp-runtime.js')}
	 * @used-by {@link import('./antigravity-adapter.js')}
	 * @used-by {@link import('./architecture.test.js')}
	 * @used-by {@link import('./folders-client.js').FolderTreeRenderer#bindRoot}
	 */
	bind(root) {
		this.dispose();
		this.abortController = new AbortController();
		const on = (type, listener, capture = false) => root.addEventListener(type, listener, {capture, signal: this.abortController.signal});
		on('click', e => {
			if (this.view.isDragging && e.target.closest?.('[data-folders-row^="folder:"]')) {
				e.preventDefault();
				e.stopPropagation();
			}
		}, true);
		on('pointerdown', e => {
			if (!e.altKey && 0 === e.button && !e.target.closest?.('input') && e.target.closest?.('[data-folders-row^="folder:"], button[data-project-card]')) {
				e.stopPropagation();
			}
		});
		on('dragstart', e => this.startDrag(e));
		on('dragend', () => this.endDrag());
		on('dragover', e => this.handleDragOver(e));
		on('dragleave', e => {
			if (!root.contains(e.relatedTarget) || !this.resolveDropZone(e.relatedTarget)) {
				this.setDropTarget(null);
			}
		});
		on('drop', e => this.executeDrop(e));
	}
	/**
	 * @used-by {@link SidebarDragController#executeDrop}
	 * @used-by {@link SidebarDragController#handleDragOver}
	 * @used-by {@link import('./folder-picker.test.js')}
	 */
	canDropOnTarget(e, targetFolderId) {
		let r = {allowed: false, blocked: false};
		const isProjectDrag = hasDragType(e?.dataTransfer, 'application/antigravity-project-id') || !!this.view.draggedProjectId;
		const isFolderDrag = hasDragType(e?.dataTransfer, 'application/antigravity-folder-id') || !!this.view.draggedFolderId;
		if (isProjectDrag) {
			r = {allowed: true, blocked: false};
		}
		else if (isFolderDrag) {
			const draggedFolderId = this.view.draggedFolderId || e?.dataTransfer?.getData('application/antigravity-folder-id');
			const df = draggedFolderId ? this.view.getFolder(draggedFolderId) : null;
			if (df) {
				const targetParent = targetFolderId || null;
				if (targetParent === df.id || targetParent === (df.parentId || null)) {
					r = {allowed: false, blocked: null !== targetParent};
				}
				else {
					try {
						this.view.model.applyAction(this.view.data, {action: 'move-folder', id: df.id, newParentId: targetParent});
						r = {allowed: true, blocked: false};
					}
					catch {
						r = {allowed: false, blocked: true};
					}
				}
			}
		}
		return r;
	}
	/**
	 * @used-by {@link SidebarDragController#bind}
	 */
	dispose() {
		this.abortController?.abort();
		this.abortController = null;
		this.setDropTarget(null);
	}
	/**
	 * @used-by {@link SidebarDragController#bind}
	 */
	endDrag() {
		if (this.draggedElement) {
			this.draggedElement.style.opacity = '';
			this.draggedElement = null;
		}
		this.setDropTarget(null);
		this.view.draggedFolderId = null;
		this.view.draggedProjectId = null;
		setTimeout(() => {
			this.view.isDragging = false;
		}, 100);
	}
	/**
	 * @used-by {@link SidebarDragController#bind}
	 */
	async executeDrop(e) {
		const zone = this.resolveDropZone(e.target);
		this.setDropTarget(null);
		if (zone) {
			e.preventDefault();
			e.stopPropagation();
			const projId = e.dataTransfer?.getData('application/antigravity-project-id') || this.view.draggedProjectId;
			const draggedFolderId = e.dataTransfer?.getData('application/antigravity-folder-id') || this.view.draggedFolderId;
			if (projId) {
				await this.view.postAction(zone.folderId ? 'assign-project' : 'unassign-project', zone.folderId ? {projectId: projId, folderId: zone.folderId} : {projectId: projId});
			}
			else if (draggedFolderId && this.canDropOnTarget(e, zone.folderId).allowed) {
				const res = await this.view.postAction('move-folder', {id: draggedFolderId, newParentId: zone.folderId});
				if (res?.success && zone.folderId) {
					this.view.expandFolder(zone.folderId);
				}
			}
		}
	}
	/**
	 * @used-by {@link SidebarDragController#bind}
	 */
	handleDragOver(e) {
		const zone = this.resolveDropZone(e.target);
		if (!zone) {
			this.setDropTarget(null);
		}
		else {
			const check = this.canDropOnTarget(e, zone.folderId);
			if (!check.allowed) {
				this.setDropTarget(null);
				if (check.blocked && e.dataTransfer) {
					e.dataTransfer.dropEffect = 'none';
				}
			}
			else {
				e.preventDefault();
				e.stopPropagation();
				if (e.dataTransfer) {
					e.dataTransfer.dropEffect = 'move';
				}
				this.setDropTarget(zone.el);
			}
		}
	}
	/**
	 * @used-by {@link SidebarDragController#bind}
	 * @used-by {@link SidebarDragController#executeDrop}
	 * @used-by {@link SidebarDragController#handleDragOver}
	 */
	resolveDropZone(target) {
		const el = target && 1 === target.nodeType ? target : target?.parentElement;
		const toolbar = el?.closest('.fg-toolbar');
		const row = toolbar ? null : el?.closest('[data-folders-row^="folder:"], [data-folders-row^="empty:"]');
		return toolbar ? {el: toolbar, folderId: null} : row ? {el: row, folderId: row.dataset.folderId} : null;
	}
	/**
	 * @used-by {@link SidebarDragController#bind}
	 * @used-by {@link SidebarDragController#dispose}
	 * @used-by {@link SidebarDragController#endDrag}
	 * @used-by {@link SidebarDragController#executeDrop}
	 * @used-by {@link SidebarDragController#handleDragOver}
	 */
	setDropTarget(el) {
		if (el !== this.activeDropEl) {
			this.activeDropEl?.classList.remove('folder-drop-target');
			this.activeDropEl = el;
			this.activeDropEl?.classList.add('folder-drop-target');
		}
	}
	/**
	 * @used-by {@link SidebarDragController#bind}
	 */
	startDrag(e) {
		if (e.altKey || e.target.closest?.('input')) {
			e.preventDefault();
		}
		else {
			const card = e.target.closest?.('button[data-project-card]');
			const folderRow = card ? null : e.target.closest?.('[data-folders-row^="folder:"]');
			const el = card?.dataset.projectId ? card : folderRow?.dataset.folderId ? folderRow : null;
			if (el) {
				const isProject = el === card;
				const id = isProject ? card.dataset.projectId : folderRow.dataset.folderId;
				e.stopPropagation();
				Object.assign(this.view, {isDragging: true, draggedProjectId: isProject ? id : null, draggedFolderId: isProject ? null : id});
				this.draggedElement = el;
				e.dataTransfer.setData(isProject ? 'application/antigravity-project-id' : 'application/antigravity-folder-id', id);
				e.dataTransfer.setData('text/plain', id);
				e.dataTransfer.effectAllowed = 'move';
				el.style.opacity = '0.5';
			}
		}
	}
}
/**
 * @used-by {@link SidebarDragController#canDropOnTarget}
 * @used-by {@link import('./folder-drag.js')}
 * @used-by {@link import('./folder-picker.test.js')}
 */
const hasDragType = (dataTransfer, type) => Array.from(dataTransfer?.types || []).includes(type);
// 2026-11-14
// "Consolidate Folders module loader, tree indexer, declarative DOM helper, and CAS store/CLI wrappers":
// https://github.com/dmitry-ai/antigravity-addons/issues/44
module.exports = {SidebarDragController, hasDragType};
