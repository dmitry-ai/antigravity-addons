// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Extract FolderMenuController and FolderDialogController ES6 classes from FoldersView in Folders/folders-client.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/39
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders module loader, tree indexer, declarative DOM helper, and CAS store/CLI wrappers":
// https://github.com/dmitry-ai/antigravity-addons/issues/44
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Convert createAdapter in Folders/antigravity-adapter.js into ConnectSummaryStream and AntigravityAdapter ES6 classes":
// https://github.com/dmitry-ai/antigravity-addons/issues/36
const {folderPickerModel} = require('./folder-menu');
class FolderDialogController {
	constructor(view) {
		Object.assign(this, {view, activeModal: null, closeActiveModal: null});
	}
	close() {
		this.closeActiveModal?.();
	}
	openCreateFolder(projectId = null, explicitParentId = undefined) {
		const targetParentId = undefined !== explicitParentId ? explicitParentId : projectId ? this.view.getProjectFolderId(projectId) || null : this.view.detectCurrentFolderId();
		const parentFolder = targetParentId ? this.view.getFolder(targetParentId) : null;
		const titleText = parentFolder ? `Create subfolder in “${parentFolder.name}”` : 'Create new folder';
		let input;
		let select;
		this.openModal({
			title: titleText,
			ariaLabel: titleText,
			submitLabel: 'Create',
			onClose: () => this.view.doc?.querySelector?.('.btn-create-folder')?.focus?.(),
			buildBody: ({form, titleEl}) => {
				input = this.view.element('input', 'folder-name-input', undefined, {
					attrs: {'aria-label': 'Folder name'},
					on: {input: () => input.setCustomValidity('')},
					props: {type: 'text', placeholder: parentFolder ? 'Subfolder name...' : 'Folder name...'}
				});
				select = this.view.element('select', 'folder-parent-select', undefined, {
					attrs: {'aria-label': 'Location (parent)'},
					on: {change: () => {
						const curParent = select.value ? this.view.getFolder(select.value) : null;
						const nextTitle = curParent ? `Create subfolder in “${curParent.name}”` : 'Create new folder';
						titleEl.textContent = nextTitle;
						form.setAttribute('aria-label', nextTitle);
						input.placeholder = curParent ? 'Subfolder name...' : 'Folder name...';
						input.setCustomValidity('');
					}}
				});
				this.populateFolderSelect(select, targetParentId);
				form.append(this.view.element('label', 'antigravity-folder-label', 'Folder name:'), input, this.view.element('label', 'antigravity-folder-label', 'Location (parent):'), select);
				return input;
			},
			onSubmit: async () => {
				let r = false;
				const val = input.value.trim();
				const chosenParentId = select.value || null;
				try {
					this.view.model.applyAction(this.view.data, {action: 'add-folder', name: val, parentId: chosenParentId});
					const result = await this.view.postAction('add-folder', {name: val, parentId: chosenParentId});
					if (!result.success) {
						throw Error(result.error || 'Failed to create folder');
					}
					const createdFolder = (result.data?.folders || []).find(f => (chosenParentId || null) === (f.parentId || null) && val.toLowerCase() === f.name.toLowerCase());
					if (createdFolder) {
						this.view.lastActiveFolderId = createdFolder.id;
						if (projectId) {
							await this.view.postAction('assign-project', {projectId, folderId: createdFolder.id});
						}
					}
					if (chosenParentId) {
						this.view.expandFolder(chosenParentId);
					}
					r = true;
				}
				catch (cause) {
					input.setCustomValidity(cause.message);
					input.reportValidity();
				}
				return r;
			}
		});
	}
	openCreateProject(folderId) {
		let createdId;
		let directory;
		let name;
		const requestId = crypto.randomUUID();
		this.openModal({
			title: folderId ? `Create project in “${this.view.getFolder(folderId)?.name}”` : 'Create project',
			ariaLabel: 'Create project',
			submitLabel: 'Create',
			buildBody: ({errorEl, form}) => {
				name = this.view.element('input', undefined, undefined, {attrs: {'aria-label': 'Project name'}, props: {placeholder: 'Project name', required: true}});
				directory = this.view.element('input', undefined, undefined, {attrs: {'aria-label': 'Project directory'}, props: {placeholder: 'Project directory (optional)'}});
				const browse = this.view.element('button', 'antigravity-folder-btn secondary', 'Browse…', {props: {type: 'button', onclick: async () => {
					try {
						const result = await this.view.win.dialog.showOpenDialog();
						if (result) {
							directory.value = 'string' === typeof result ? result : Array.isArray(result) ? result[0] || '' : result.filePaths?.[0] || '';
						}
					}
					catch (cause) {
						errorEl.textContent = cause.message;
					}
				}}});
				form.append(name, this.view.element('div', 'fg-project-path', undefined, {children: [directory, browse]}));
				return name;
			},
			onSubmit: async ({close}) => {
				if (!createdId) {
					const resources = directory.value.trim() ? [{folderUri: new URL('file:///' + directory.value.trim().replace(/\\/g, '/')).href}] : [];
					createdId = await this.view.adapter.createProject({id: requestId, name: name.value, resources});
				}
				if (folderId) {
					const assignment = await this.view.postAction('assign-project', {projectId: createdId, folderId});
					if (!assignment.success) {
						throw Error(`Project ${createdId} created, but folder was not assigned: ${assignment.error}`);
					}
				}
				close();
				this.view.reveal(createdId, folderId);
				this.view.adapter.navigate({projectId: createdId});
			}
		});
	}
	openModal({ariaLabel, buildBody, onClose, onSubmit, submitLabel = 'Save', title}) {
		this.view.menus?.close();
		let r = null;
		if (!this.activeModal) {
			let closed = false;
			let overlay;
			const close = () => {
				if (!closed) {
					closed = true;
					if (overlay === this.activeModal) {
						this.activeModal = null;
						this.closeActiveModal = null;
					}
					overlay.remove();
					onClose?.();
					this.view.schedule();
				}
			};
			const titleEl = this.view.element('h3', 'folder-modal-title', title);
			const errorEl = this.view.element('div', 'fg-dialog-error', undefined, {attrs: {role: 'alert'}});
			const cancel = this.view.element('button', 'antigravity-folder-btn secondary btn-cancel', 'Cancel', {on: {click: close}, props: {type: 'button'}});
			const submit = this.view.element('button', 'antigravity-folder-btn primary btn-submit', submitLabel, {props: {type: 'submit'}});
			const form = this.view.element('form', 'antigravity-folder-modal', undefined, {
				attrs: {role: 'dialog', 'aria-modal': 'true', 'aria-label': ariaLabel || title},
				children: [titleEl],
				on: {submit: async e => {
					e.preventDefault();
					if (!submit.disabled) {
						submit.disabled = true;
						errorEl.textContent = '';
						try {
							const done = await onSubmit({close, errorEl, submit});
							false === done ? (submit.disabled = false) : close();
						}
						catch (cause) {
							errorEl.textContent = cause.message;
							submit.disabled = false;
						}
					}
				}}
			});
			const focusTarget = buildBody?.({errorEl, form, submit, titleEl});
			form.append(errorEl, this.view.element('div', 'antigravity-folder-modal-buttons', undefined, {children: [cancel, submit]}));
			overlay = this.view.element('div', 'antigravity-folder-modal-overlay', undefined, {children: [form], on: {click: e => overlay === e.target && close()}});
			this.view.doc.body.append(overlay);
			this.activeModal = overlay;
			this.closeActiveModal = close;
			focusTarget?.focus?.();
			r = {close, errorEl, form, overlay, submit, titleEl};
		}
		return r;
	}
	openRenameFolder(folderId) {
		const folder = this.view.getFolder(folderId);
		if (folder) {
			this.openText('Folder name', folder.name, async newName => {
				if (newName && folder.name !== newName) {
					const res = await this.view.postAction('rename-folder', {id: folderId, newName});
					if (!res.success) {
						throw Error(res.error || 'Failed to rename folder');
					}
				}
			});
		}
	}
	openRenameProject(id) {
		const project = this.view.state.projects.find(item => id === item.id);
		if (project) {
			this.openText('Project name', project.name, async name => {
				await this.view.adapter.rpc('UpdateProject', {project: {...project, name}});
				await this.view.adapter.readProjects({force: true});
			});
		}
	}
	openText(title, initialValue, submitAction) {
		let input;
		const modal = this.openModal({
			title,
			ariaLabel: title,
			submitLabel: 'Save',
			buildBody: ({form}) => (input = this.view.element('input', undefined, undefined, {attrs: {'aria-label': title}, props: {value: initialValue, required: true}}), form.append(input), input),
			onSubmit: () => submitAction(input.value.trim())
		});
		if (modal) {
			input.select?.();
		}
	}
	populateFolderSelect(select, selectedParentId = null) {
		const {byId, children} = folderPickerModel(this.view.data?.folders, selectedParentId, new Set(), this.view.model);
		select.replaceChildren(this.view.element('option', '', '📁 Root (no parent)', {props: {value: '', selected: !selectedParentId || !byId.has(selectedParentId)}}));
		const walk = (parentId, depth) => {
			for (const folder of children.get(parentId) || []) {
				const prefix = 0 < depth ? `${'\u00a0\u00a0'.repeat(depth)}↳ ` : '';
				select.append(this.view.element('option', '', `${prefix}📁 ${folder.name}`, {props: {value: folder.id, selected: selectedParentId === folder.id}}));
				walk(folder.id, depth + 1);
			}
		};
		walk(null, 0);
	}
}
module.exports = {FolderDialogController};
