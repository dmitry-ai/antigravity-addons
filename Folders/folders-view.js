(function installFoldersView() {
	if (window.__PROJECT_FOLDERS_VIEW__) return;
	const model = window.AntigravityFoldersModel;
	const client = window.__PROJECT_FOLDERS_CLIENT__;
	const state = {projects: [], summaries: new Map(), collapsed: new Set(), rows: [], errors: new Map(), revision: '', ready: false, haveConfig: false, haveProjects: false, haveSummaries: false, savedView: false, knownProjects: new Set()};
	let root, nativeList, nativePaddingTop, scroll, canvas, timer, paintTimer, disposed = false, storageReady = false;
	let rowHeight = 16;
	let removeStorageListener;
	const sizing = new ResizeObserver(() => schedule());
	const storageKey = 'antigravity-folders.v2.collapsed';
	const element = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
	const style = element('style');
	style.dataset.foldersViewStyle = '2';
	style.textContent = window.__FOLDERS_STYLE__ || "";
	if (!window.__ANTIGRAVITY_TOOLS_INSPECTOR_STYLES__) document.head.append(style);
	const status = (channel, error) => {
		if (disposed) return;
		if (error) state.errors.set(channel, error); else state.errors.delete(channel);
		window.__PROJECT_FOLDERS_STATUS__ = {architecture: 2, state: state.errors.size ? 'error' : state.ready && state.haveSummaries ? 'ready' : 'loading', nativeContract: adapter.contract, errors: Object.fromEntries(state.errors), folders: client.data.folders.length, projects: state.projects.length, conversations: state.summaries.size};
		const message = [...state.errors].map(([key, value]) => `${key}: ${value}`).join('\n');
		const banner = root?.querySelector('.fg-state');
		const bannerText = message ? `Folders — ошибка совместимости или связи. ${message}` : '';
		if (banner && banner.textContent !== bannerText) banner.textContent = bannerText;
		let fault = document.querySelector('.fg-fault');
		if (!root?.isConnected && message) {
			if (!fault) { fault = element('div', 'fg-fault'); fault.setAttribute('role', 'alert'); document.body.append(fault); }
			const faultText = `Folders: ${message}. Штатный интерфейс сохранён.`;
			if (fault.textContent !== faultText) fault.textContent = faultText;
		} else fault?.remove();
	};
	const persist = () => {
		if (!storageReady) return;
		const saved = {collapsed: [...state.collapsed]};
		if (window.__ANTIGRAVITY_TOOLS_REQUEST__) window.__ANTIGRAVITY_TOOLS_REQUEST__('folders', {method: 'SET_VIEW_STATE', body: saved}).catch(error => status('view-state', error.message));
		else sessionStorage.setItem(storageKey, JSON.stringify(saved.collapsed));
	};
	const schedule = () => { if (paintTimer) return; paintTimer = setTimeout(() => {paintTimer = null; render();}, 40); };
	const toggle = row => {
		if (state.collapsed.has(row.key)) state.collapsed.delete(row.key); else state.collapsed.add(row.key);
		persist(); render();
	};
	const adapter = window.AntigravityFoldersAdapter({window, model,
		onProjects: projects => { if (!state.savedView) for (const project of projects) if (!state.knownProjects.has(project.id)) state.collapsed.add(`project:${project.id}`); state.knownProjects = new Set(projects.map(project => project.id)); state.haveProjects = true; const revision = JSON.stringify(projects); if (revision !== state.projectRevision) { state.projects = projects; state.projectRevision = revision; schedule(); } },
		onSummaries: summaries => { state.haveSummaries = true; state.summaries = summaries; schedule(); },
		onStatus: status
	});
	const readConfig = async () => {
		const response = window.__ANTIGRAVITY_TOOLS_REQUEST__ ? null : await fetch('/api/project-folders');
		if (response && !response.ok) throw Error(`Folder storage: HTTP ${response.status}; run Upg to reconnect the loader`);
		const payload = response ? await response.json() : await window.__ANTIGRAVITY_TOOLS_REQUEST__('folders', {method: 'GET'});
		if (payload.error) throw Error(payload.error);
		const data = payload.schemaVersion === 2 ? payload.data : payload;
		model.validateFolders(data.folders);
		state.haveConfig = true;
		if (payload.revision) window.__FOLDERS_REVISION__ = payload.revision;
		const revision = payload.revision || JSON.stringify(data);
		if (revision !== state.revision) { state.revision = revision; client.notifyUpdate(data); }
		status('folders', null);
	};
	const rowElement = (row, index) => {
		const el = element('div', 'fg-row');
		el.dataset.foldersRow = row.key; el.dataset.rowIndex = index; el.style.top = `${index * rowHeight}px`; el.style.setProperty('--fg-depth', row.depth);
		el.setAttribute('role', 'treeitem'); el.setAttribute('aria-level', row.depth + 1);
		const selection = adapter.selection();
		if (row.kind === 'conversation' && selection.conversationId === row.id || row.kind === 'project' && !selection.conversationId && selection.projectId === row.id) el.setAttribute('aria-selected', 'true');
		if (row.folderId) { el.dataset.folderId = row.folderId; el.dataset.folderDepth = row.depth; }
		if (row.projectId) el.dataset.groupId = row.projectId;
		if (row.kind === 'folder' || row.kind === 'project') {
			el.setAttribute('aria-expanded', row.expanded);
			const collapse = element('button', 'fg-toggle', row.expanded ? '⌄' : '›'); collapse.setAttribute('aria-label', `${row.expanded ? 'Свернуть' : 'Развернуть'} ${row.name}`);
			collapse.onclick = event => { event.stopPropagation(); toggle(row); }; el.append(collapse);
		}
		if (row.kind === 'folder') {
			el.dataset.testid = 'section-header'; el.dataset.title = `📁 ${row.name}`; el.dataset.collapsed = !row.expanded;
			const h2 = element('h2'), button = element('button', 'fg-label'); button.setAttribute('aria-expanded', row.expanded);
			button.append(element('span', row.running ? 'fg-icon fg-folder-running' : 'fg-icon', '📁'), element('span', 'truncate', row.name)); button.onclick = () => toggle(row); h2.append(button); el.append(h2);
		} else if (row.kind === 'project') {
			const button = element('button', 'fg-label'); button.dataset.projectCard = 'true'; button.dataset.projectId = row.id;
			if (row.folderId) button.dataset.folderId = row.folderId;
			const icon=element('span', row.running ? 'fg-icon fg-project-running' : 'fg-icon');
			icon.innerHTML='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 7V5h6l2 2h10v13H3z"/></svg>';
			button.title='Проект: '+row.name;
			button.append(icon, element('span', 'truncate', row.name));
			button.onclick = () => adapter.navigate({projectId: row.id}); el.append(button);
		} else if (row.kind === 'conversation') {
			const button = element('button', 'fg-label'); button.dataset.testid = 'conversation-row-sidebar'; button.dataset.cascadeId = row.id;
			button.dataset.selected = selection.conversationId === row.id;
			const running = row.running;
			button.append(element('span', running ? 'fg-icon fg-running' : 'fg-icon', running ? '●' : row.pinned ? '📌' : '◦'), element('span', 'truncate', row.name));
			button.onclick = () => adapter.navigate({projectId: row.projectId, conversationId: row.id}); el.append(button);
			button.oncontextmenu = event => {
				event.preventDefault(); event.stopPropagation();
				client.ui.showContextMenu(event.clientX, event.clientY, [
					{label: 'Открыть разговор', onClick: () => adapter.navigate({projectId: row.projectId, conversationId: row.id})},
					{label: 'Переименовать…', onClick: () => textDialog('Название разговора', model.summaryName(state.summaries.get(row.id) || row.summary), value => adapter.updateConversation(row.id, {title: value}))},
					{label: row.summary.annotations?.pinned ? 'Открепить' : 'Закрепить', onClick: () => adapter.updateConversation(row.id, {pinned: !row.summary.annotations?.pinned}).catch(error => status('action', error.message))},
					{label: 'В архив', onClick: () => adapter.updateConversation(row.id, {archived: true, archivalStatusTimestamp: new Date().toISOString()}).catch(error => status('action', error.message))}
				], 'Разговор');
			};
			window.__PROJECT_FOLDERS_CONVO_MAP__ ||= {}; if (row.projectId) window.__PROJECT_FOLDERS_CONVO_MAP__[row.id] = row.projectId;
		} else { el.append(element('span', row.kind === 'empty' ? 'fg-empty' : '', row.name)); }
		return el;
	};
	function render() {
		if (disposed || !root?.isConnected || !scroll) return;
		if (client.activeMenu || client.activeModal || root.querySelector('.folder-rename-input') || client.isDragging) { schedule(); return; }
		try {
			rowHeight = parseFloat(getComputedStyle(root).getPropertyValue('--antigravity-tree-row-height')) || 16;
			state.rows = model.buildRows({data: client.data, projects: state.projects, summaries: state.summaries, collapsed: state.collapsed});
			canvas.style.height = `${state.rows.length * rowHeight}px`;
			const start = Math.max(0, Math.floor(scroll.scrollTop / rowHeight) - 8);
			const end = Math.min(state.rows.length, Math.ceil((scroll.scrollTop + scroll.clientHeight) / rowHeight) + 8);
			const focused = root.contains(document.activeElement) ? document.activeElement : null;
			const focusKey = focused?.closest('[data-folders-row]')?.dataset.foldersRow;
			canvas.replaceChildren(...state.rows.slice(start, end).map((row, offset) => rowElement(row, start + offset)));
			if (focusKey && !focused.isConnected) {const row = [...canvas.children].find(el => el.dataset.foldersRow === focusKey); row?.querySelector(focused.classList.contains('fg-toggle') ? '.fg-toggle' : '.fg-label')?.focus({preventScroll: true});}
			state.ready = true; status('tree', null);
		} catch (error) { status('tree', error.message); }
	}
	const mount = () => {
		if (disposed || root?.isConnected || !state.haveConfig || !state.haveProjects) return;
		const matches = [...document.querySelectorAll('[data-testid="conversation-list-sidebar"]')].filter(el => el.closest('[role="navigation"]'));
		if (matches.length !== 1) { status('mount', `Expected one native sidebar, found ${matches.length}`); return; }
		nativeList = matches[0];
		nativePaddingTop = nativeList.style.paddingTop;
		root = element('section', 'fg-panel'); root.dataset.foldersRoot = '2'; root.dataset.testid = 'folders-tree'; root.setAttribute('aria-label', 'Папки и проекты');
		const toolbar = element('div', 'fg-toolbar'); toolbar.dataset.testid = 'section-header'; toolbar.dataset.title = 'Projects';
		toolbar.append(element('strong', '', 'Projects'));
		const nativeButton = element('button', 'fg-native', '⋯'); nativeButton.title = 'Вид списка'; nativeButton.onclick = () => { const native = !root.classList.contains('fg-native-mode'); root.classList.toggle('fg-native-mode', native); root.style.bottom = native ? 'auto' : '0'; scroll.style.display = native ? 'none' : ''; if (native) { nativeList.style.paddingTop = '20px'; nativeList.style.removeProperty('display'); nativeList.removeAttribute('aria-hidden'); nativeButton.title = 'Вернуть папки'; } else { nativeList.style.paddingTop = nativePaddingTop; nativeList.style.setProperty('display', 'none', 'important'); nativeList.setAttribute('aria-hidden', 'true'); nativeButton.title = 'Показать штатный список'; render(); } };
		const projectButton = element('button', '', '+'); projectButton.title = 'Создать проект'; projectButton.setAttribute('aria-label', 'Создать проект'); projectButton.onclick = () => createProjectDialog(client.detectCurrentFolderId());
		const actions = element('div', 'fg-actions'); actions.append(nativeButton, projectButton); toolbar.append(actions);
		const message = element('div', 'fg-state'); message.setAttribute('role', 'alert');
		scroll = element('div', 'fg-scroll'); scroll.setAttribute('role', 'tree'); canvas = element('div', 'fg-canvas'); scroll.append(canvas); scroll.addEventListener('scroll', schedule, {passive: true});
		sizing.observe(scroll);
		root.append(toolbar, message, scroll);
		nativeList.parentElement.append(root);
		nativeList.style.setProperty('display', 'none', 'important'); nativeList.setAttribute('aria-hidden', 'true');
		root.addEventListener('keydown', event => {
			if (event.target.matches('input,textarea')) return;
			const index = Number(event.target.closest('[data-row-index]')?.dataset.rowIndex);
			if (!Number.isInteger(index)) return;
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault(); const target = Math.max(0, Math.min(state.rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
				scroll.scrollTop = target * rowHeight < scroll.scrollTop ? target * rowHeight : (target + 1) * rowHeight > scroll.scrollTop + scroll.clientHeight ? (target + 1) * rowHeight - scroll.clientHeight : scroll.scrollTop;
				render(); canvas.querySelector(`[data-row-index="${target}"] button`)?.focus({preventScroll: true});
			} else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && ['folder', 'project'].includes(state.rows[index]?.kind)) {
				event.preventDefault(); const row = state.rows[index]; if (row.expanded === (event.key === 'ArrowLeft')) toggle(row);
			}
		});
		view.root = root; status('mount', null); render(); client.bindRoot(root);
		if (Number.isFinite(window.__FOLDERS_RESTORE_SCROLL__)) {scroll.scrollTop=window.__FOLDERS_RESTORE_SCROLL__;delete window.__FOLDERS_RESTORE_SCROLL__;render();}
	};
	async function createProjectDialog(folderId) {
		client.ui.closeContextMenu(); if (client.activeModal) return;
		const overlay = element('div', 'antigravity-folder-modal-overlay');
		const dialog = element('form', 'antigravity-folder-modal'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Создать проект');
		dialog.append(element('h3', '', folderId ? `Создать проект в «${client.getFolder(folderId)?.name}»` : 'Создать проект'));
		const name = element('input'); name.placeholder = 'Название проекта'; name.required = true; name.setAttribute('aria-label', 'Название проекта'); dialog.append(name);
		const pathRow = element('div', 'fg-project-path'), directory = element('input'); directory.placeholder = 'Папка проекта (необязательно)'; directory.setAttribute('aria-label', 'Папка проекта');
		const browse = element('button', 'antigravity-folder-btn secondary', 'Выбрать…'); browse.type = 'button';
		browse.onclick = async () => { try { const result = await window.dialog.showOpenDialog(); if (result) directory.value = typeof result === 'string' ? result : Array.isArray(result) ? result[0] || '' : result.filePaths?.[0] || ''; } catch (cause) { error.textContent = cause.message; } };
		pathRow.append(directory, browse); dialog.append(pathRow);
		const error = element('div', 'fg-dialog-error'); error.setAttribute('role', 'alert'); dialog.append(error);
		const buttons = element('div', 'antigravity-folder-modal-buttons'), cancel = element('button', 'antigravity-folder-btn secondary', 'Отмена'), submit = element('button', 'antigravity-folder-btn primary', 'Создать'); cancel.type = 'button'; submit.type = 'submit';
		const close = () => { overlay.remove(); if (client.activeModal === overlay) client.activeModal = null; schedule(); };
		cancel.onclick = close; buttons.append(cancel, submit); dialog.append(buttons); overlay.append(dialog); document.body.append(overlay); client.activeModal = overlay; name.focus();
		let createdId;
		const requestId = crypto.randomUUID();
		dialog.onsubmit = async event => {
			event.preventDefault(); if (submit.disabled) return; submit.disabled = true; error.textContent = '';
			try {
				if (!createdId) {
					const resources = directory.value.trim() ? [{folderUri: new URL('file:///' + directory.value.trim().replace(/\\/g, '/')).href}] : [];
					createdId = await adapter.createProject({id: requestId, name: name.value, resources});
				}
				if (folderId) { const assignment = await client.postAction('assign-project', {projectId: createdId, folderId}); if (!assignment.success) throw Error(`Проект ${createdId} создан, но папка не назначена: ${assignment.error}`); }
				close(); view.reveal(createdId, folderId); adapter.navigate({projectId: createdId});
			} catch (cause) { error.textContent = cause.message; submit.disabled = false; }
		};
	}
	function textDialog(title, initialValue, submitAction) {
		client.ui.closeContextMenu(); if (client.activeModal) return;
		const overlay = element('div', 'antigravity-folder-modal-overlay'), form = element('form', 'antigravity-folder-modal'); form.setAttribute('role', 'dialog'); form.setAttribute('aria-label', title);
		const input = element('input'); input.value = initialValue; input.required = true; input.setAttribute('aria-label', title);
		const error = element('div', 'fg-dialog-error'), buttons = element('div', 'antigravity-folder-modal-buttons'), cancel = element('button', 'antigravity-folder-btn secondary', 'Отмена'), submit = element('button', 'antigravity-folder-btn primary', 'Сохранить');
		cancel.type = 'button'; submit.type = 'submit'; const close = () => {overlay.remove(); if (client.activeModal === overlay) client.activeModal = null; schedule();}; cancel.onclick = close;
		buttons.append(cancel, submit); form.append(element('h3', '', title), input, error, buttons); overlay.append(form); document.body.append(overlay); client.activeModal = overlay; input.focus(); input.select();
		form.onsubmit = async event => {event.preventDefault(); if (submit.disabled) return; submit.disabled = true; try {await submitAction(input.value.trim()); close();} catch (cause) {error.textContent = cause.message; submit.disabled = false;}};
	}
	const view = {
		root: null, adapter, state, createProject: createProjectDialog,
		renameProject(id) {const project = state.projects.find(item => item.id === id); if (project) textDialog('Название проекта', project.name, async name => {await adapter.rpc('UpdateProject', {project: {...project, name}}); await adapter.readProjects();});},
		reveal(projectId, folderId) {
			for (let folder = client.getFolder(folderId); folder; folder = client.getFolder(folder.parentId)) state.collapsed.delete(`folder:${folder.id}`);
			state.collapsed.delete(`project:${projectId}`); persist(); render();
			const index = state.rows.findIndex(row => row.key === `project:${projectId}`); if (index >= 0) { scroll.scrollTop = index * rowHeight; render(); }
		},
		inspect() { return {...window.__PROJECT_FOLDERS_STATUS__, rowCount: state.rows.length, renderedRows: canvas?.children.length || 0, collapsed: [...state.collapsed]}; },
		reportAction(error) { status('action', error); },
		refresh: render,
		dispose() { if(scroll)window.__FOLDERS_RESTORE_SCROLL__=scroll.scrollTop;disposed = true; clearInterval(timer); clearTimeout(paintTimer); observer.disconnect(); sizing.disconnect(); removeStorageListener?.(); adapter.dispose(); root?.remove(); style.remove(); if (nativeList) { nativeList.style.paddingTop = nativePaddingTop; nativeList.style.removeProperty('display'); nativeList.removeAttribute('aria-hidden'); } window.removeEventListener('antigravity-folders-updated', schedule); window.removeEventListener('popstate', schedule); delete window.__PROJECT_FOLDERS_VIEW__; }
	};
	window.__PROJECT_FOLDERS_VIEW__ = view;
	window.addEventListener('antigravity-folders-updated', schedule);
	window.addEventListener('popstate', schedule);
	const observer = new MutationObserver(() => { if (!root?.isConnected) mount(); }); observer.observe(document.documentElement, {childList: true, subtree: true});
	(async () => {
		try {
			const saved = window.__ANTIGRAVITY_TOOLS_REQUEST__ ? await window.__ANTIGRAVITY_TOOLS_REQUEST__('folders', {method: 'GET_VIEW_STATE'}) : {collapsed: sessionStorage.getItem(storageKey) ? JSON.parse(sessionStorage.getItem(storageKey)) : undefined};
			const items = saved.collapsed === undefined && window.nativeStorage?.getItems ? await window.nativeStorage.getItems() : {};
			const value = saved.collapsed === undefined ? undefined : JSON.stringify(saved.collapsed);
			if (value !== undefined) { const collapsed = JSON.parse(value); if (!Array.isArray(collapsed) || collapsed.some(key => typeof key !== 'string')) throw Error('Invalid saved folder view state'); state.collapsed = new Set(collapsed); state.savedView = true; }
			else {
				for (const project of state.projects) state.collapsed.add(`project:${project.id}`);
				const legacy = JSON.parse(items.sidebar_collapsed_section_headers || '[]');
				const closed = Array.isArray(legacy) ? new Set(legacy) : new Set(Object.keys(legacy).filter(key => legacy[key]));
				for (const folder of client.data.folders) if (closed.has(`folder-${folder.id}`)) state.collapsed.add(`folder:${folder.id}`);
			}
			const changed = event => {try {const values = event.detail.collapsed; if (!Array.isArray(values) || values.some(key => typeof key !== 'string')) throw Error('Invalid saved folder state'); state.collapsed = new Set(values); state.savedView = true; schedule();} catch (error) {status('view-state', error.message);}};
			window.addEventListener('antigravity-folders-view-state', changed); removeStorageListener = () => window.removeEventListener('antigravity-folders-view-state', changed);
			storageReady = true; status('view-state', null);
		} catch (error) { status('view-state', error.message); }
		try { await readConfig(); await adapter.start(); mount(); }
		catch (error) { status('startup', error.message); }
		timer = setInterval(() => { readConfig().catch(error => status('folders', error.message)); if (!root?.isConnected) mount(); }, 2000);
	})();
})();
