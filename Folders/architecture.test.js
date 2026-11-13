// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders around standalone v2 architecture, delegated events, UMD test exports, and shared folders-model mutations":
// https://github.com/dmitry-ai/antigravity-addons/issues/24
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders UI layer (folders-client.js and folders-view.js) with unified modal builder, direct selection lookup, and removal of non-CDP fallbacks":
// https://github.com/dmitry-ai/antigravity-addons/issues/30
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decompose installFoldersView into ES6 class FoldersView in Folders/folders-view.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/28
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const model = require('./folders-model');
const createAdapter = require('./antigravity-adapter');
const manager = require('./folders-manager');
const {FoldersStore} = require('./folders-store');
const {FoldersView, createReadConfig} = require('./folders-view');
const config = () => ({
	folders: [
		{id: 'root', name: 'Work', parentId: null},
		{id: 'ten', name: '10', parentId: 'root'},
		{id: 'two', name: '2', parentId: 'root'},
		{id: 'empty', name: 'Empty', parentId: null}
	],
	projectFolderMap: {p1: 'two', p2: 'two'},
	futureMetadata: {preserve: true}
});
const projects = [
	{id: 'p2', name: 'Project 10', newField: {}},
	{id: 'p1', name: 'Project 2'},
	{id: 'p3', name: 'Unassigned'}
];
const summary = (projectId, title = 'Conversation') => ({
	annotations: {title},
	trajectoryMetadata: {projectId},
	status: 'CASCADE_RUN_STATUS_IDLE',
	lastModifiedTime: '2026-10-28T10:00:00Z'
});
const scratch = context => {
	const parent = os.tmpdir();
	const directory = fs.mkdtempSync(path.join(parent, 'antigravity-folders-'));
	context.after(() => {
		const resolved = path.resolve(directory);
		assert.ok(resolved.startsWith(path.resolve(parent) + path.sep));
		fs.rmSync(resolved, {recursive: true, force: true});
	});
	const filename = path.join(directory, 'folders.json');
	fs.writeFileSync(filename, JSON.stringify(config()));
	return {directory, filename};
};
test('The independent model sorts nested folders and projects and preserves conversation identities', () => {
	const data = config();
	const before = JSON.stringify(data);
	const rows = model.buildRows({
		data,
		projects,
		summaries: new Map([['c1', summary('p1')], ['standalone', summary(null)]])
	});
	assert.deepEqual(rows.filter(row => 'folder' === row.kind).map(row => row.id), ['empty', 'root', 'two', 'ten']);
	assert.deepEqual(rows.filter(row => 'project' === row.kind).map(row => row.id), ['p1', 'p2', 'p3']);
	assert.equal(rows.find(row => 'c1' === row.id).depth, 3);
	assert.equal(rows.find(row => 'c1' === row.id).projectId, 'p1');
	assert.equal(rows.some(row => 'empty' === row.kind && 'root' === row.folderId), false);
	assert.equal(rows.some(row => 'empty' === row.kind && 'empty' === row.folderId), true);
	assert.equal(JSON.stringify(data), before);
});
test('Collapsed parents never leak assigned projects, subfolders, or conversations to the root', () => {
	const rows = model.buildRows({
		data: config(),
		projects,
		summaries: new Map([['c1', summary('p1')]]),
		collapsed: new Set(['folder:root'])
	});
	assert.equal(rows.some(row => ['two', 'ten', 'p1', 'p2', 'c1'].includes(row.id)), false);
	assert.equal(rows.some(row => 'p3' === row.id), true);
});
// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
test('Hiding Outside of Project changes only visible rows and preserves conversations and exact project identities', () => {
	const data = config();
	const nativeProjects = [
		...projects,
		{id: 'outside-of-project', name: 'Outside of Project'},
		{id: 'ordinary', name: 'Outside of Project'}
	];
	const summaries = new Map([
		['outside-chat', summary('outside-of-project')],
		['kept-chat', summary('p1')],
		['pinned-outside', {...summary('outside-of-project'), annotations: {pinned: true}}]
	]);
	const before = structuredClone({data, projects: nativeProjects, summaries});
	const options = {data, projects: nativeProjects, summaries};
	const visible = model.buildRows(options);
	const hidden = model.buildRows({...options, hideOutsideProject: true});
	assert.ok(visible.some(row => 'outside-of-project' === row.id));
	assert.ok(visible.some(row => 'outside-chat' === row.id));
	assert.equal(hidden.some(row => 'outside-of-project' === row.id || 'outside-chat' === row.id), false);
	assert.ok(hidden.some(row => 'ordinary' === row.id));
	assert.ok(hidden.some(row => 'kept-chat' === row.id));
	assert.ok(hidden.some(row => 'pinned-outside' === row.id));
	assert.equal(hidden.length, visible.length - 2);
	assert.deepEqual({data, projects: nativeProjects, summaries}, before);
});
test('Hiding the standalone Conversations section preserves its source summaries and project chats', () => {
	const summaries = new Map([
		['no-project', summary(null)],
		['missing-project', summary('missing')],
		['project-chat', summary('p1')]
	]);
	const before = structuredClone(summaries);
	const options = {data: config(), projects, summaries};
	const visible = model.buildRows(options);
	const hidden = model.buildRows({...options, hideStandaloneConversations: true});
	assert.ok(visible.some(row => 'standalone' === row.key));
	assert.equal(hidden.some(row => 'standalone' === row.key || 'no-project' === row.id || 'missing-project' === row.id), false);
	assert.ok(hidden.some(row => 'project-chat' === row.id));
	assert.equal(hidden.length, visible.length - 3);
	assert.deepEqual(summaries, before);
});
test('Folder mutations validate cycles and sibling names, promote children, and preserve unknown metadata', () => {
	const original = config();
	assert.throws(() => model.applyAction(original, {action: 'move-folder', id: 'root', newParentId: 'two'}), /Cycle/);
	assert.throws(() => model.applyAction(original, {action: 'rename-folder', id: 'ten', newName: '2'}), /collision/);
	assert.throws(() => model.applyAction(original, {action: 'add-folder', name: 'New', parentId: 'missing'}), /not found/);
	let next = model.applyAction(original, {action: 'add-folder', id: 'child', name: 'Child', parentId: 'two'});
	next = model.applyAction(next, {action: 'remove-folder', id: 'two'});
	assert.equal(next.folders.find(folder => 'child' === folder.id).parentId, 'root');
	assert.equal(next.projectFolderMap.p1, 'root');
	assert.deepEqual(next.futureMetadata, original.futureMetadata);
	assert.equal(original.folders.some(folder => 'two' === folder.id), true);
});
test('Assignments use exact opaque IDs, never project labels or positional matches', () => {
	const data = model.applyAction(config(), {action: 'assign-project', projectId: 'Same visible name / provider:new', folderId: 'ten'});
	assert.equal(data.projectFolderMap['Same visible name / provider:new'], 'ten');
	assert.equal(data.projectFolderMap.p1, 'two');
	assert.throws(() => model.applyAction(data, {action: 'assign-project', projectId: 'p4', folderId: 'Work'}), /not found/);
});
test('Conversation updates handle deletion and additive fields; incompatible schemas fail explicitly', () => {
	const first = model.applySummaryUpdate(new Map(), {updates: {c1: {...summary('p1'), future: {value: 1}}}});
	const next = model.applySummaryUpdate(first, {updates: {c2: summary('p2')}, deletes: ['c1'], futureEnvelopeField: true});
	assert.deepEqual([...next.keys()], ['c2']);
	assert.throws(() => model.applySummaryUpdate(next, {updates: []}), /Invalid/);
	assert.throws(() => model.applySummaryUpdate(next, {newProtocol: {items: []}}), /contract changed/);
});
test('Atomic storage rejects stale UI revisions and stale CLI snapshots without overwriting concurrent work', context => {
	const {filename, directory} = scratch(context);
	const store = new FoldersStore(filename);
	context.after(() => store.dispose());
	const snapshot = manager.readConfig(filename);
	const oldRevision = store.revision;
	store.dispatch({action: 'rename-folder', id: 'ten', newName: 'Ten', revision: oldRevision});
	assert.throws(() => store.dispatch({action: 'rename-folder', id: 'two', newName: 'Lost', revision: oldRevision}), /concurrently/);
	snapshot.folders[0].name = 'Stale CLI';
	assert.throws(() => manager.writeConfig(snapshot, filename), /concurrently/);
	assert.equal(manager.readConfig(filename).folders.find(folder => 'ten' === folder.id).name, 'Ten');
	assert.deepEqual(fs.readdirSync(directory), ['folders.json']);
});
test('Invalid external JSON retains the last valid tree and reports an error, then recovers after atomic replacement', async context => {
	const {filename, directory} = scratch(context);
	const store = new FoldersStore(filename);
	context.after(() => store.dispose());
	const before = store.data;
	fs.writeFileSync(filename, '{');
	store.reload();
	assert.equal(store.data, before);
	assert.ok(store.error);
	assert.throws(() => store.dispatch({action: 'remove-folder', id: 'root'}));
	const next = config();
	next.folders[0].name = 'External';
	const temporary = path.join(directory, 'next.json');
	fs.writeFileSync(temporary, JSON.stringify(next));
	fs.renameSync(temporary, filename);
	await new Promise(resolve => setTimeout(resolve, 160));
	assert.equal(store.error, null);
	assert.equal(store.data.folders[0].name, 'External');
});
const fakeWindow = () => {
	const win = {
		__APP_CONFIG__: {csrfToken: 'fixture-only'},
		location: {href: 'https://127.0.0.1:12345/'},
		history: {
			pushState(_state, _title, url) {
				win.lastUrl = url;
				win.location.href = new URL(url, win.location.href).href;
			}
		},
		dispatchEvent(event) {
			win.lastEvent = event;
		},
		PopStateEvent: class {
			constructor(type) {
				this.type = type;
			}
		}
	};
	return win;
};
test('Native API adapter tolerates added DTO fields and uses the declared project endpoints and IDs', async () => {
	const calls = [];
	const win = fakeWindow();
	const native = [projects[1]];
	const adapter = createAdapter({
		window: win,
		model,
		fetch: async (url, options) => {
			calls.push({url, options});
			if (url.endsWith('/CreateProject')) {
				native.push(JSON.parse(options.body).project);
			}
			return Response.json(
				url.endsWith('/ListProjects')
					? {projectIds: native.map(project => project.id), future: {}}
					: url.endsWith('/ReadProjects')
						? {projects: native, future: true}
						: {}
			);
		}
	});
	try {
		assert.equal((await adapter.readProjects())[0].id, 'p1');
		assert.deepEqual(JSON.parse(calls[1].options.body), {ids: ['p1']});
		assert.equal(calls[0].options.headers['x-codeium-csrf-token'], 'fixture-only');
		await adapter.createProject({id: 'exact-new-id', name: 'New', resources: []});
		assert.equal(JSON.parse(calls.find(call => call.url.endsWith('/CreateProject')).options.body).project.id, 'exact-new-id');
		adapter.navigate({projectId: 'p1', conversationId: 'c1'});
		assert.equal(win.lastUrl, '/c/c1?section=p1');
		assert.equal(win.lastEvent.type, 'popstate');
		// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
		// "Add Project settings action to project context menu in Folders":
		// https://github.com/dmitry-ai/antigravity-addons/issues/17
		adapter.openProjectSettings('p2');
		assert.equal(win.lastUrl, '/c/c1?section=p1&settingsOpen=true&settingsProjectId=p2');
		assert.equal(win.lastEvent.type, 'popstate');
		assert.throws(() => adapter.openProjectSettings(''), /Project id is required/);
	}
	finally {
		adapter.dispose();
	}
});
test('Native API errors and missing records are surfaced instead of reporting an empty successful tree', async () => {
	const adapter = createAdapter({
		window: fakeWindow(),
		model,
		fetch: async url => Response.json(url.endsWith('/ListProjects') ? {projectIds: ['p1']} : {projects: []})
	});
	await assert.rejects(adapter.readProjects(), /refusing to hide missing projects/);
	adapter.dispose();
	const failed = createAdapter({
		window: fakeWindow(),
		model,
		fetch: async () => new Response('changed', {status: 404})
	});
	await assert.rejects(failed.createProject({id: 'p-new', name: 'New'}), /HTTP 404/);
	failed.dispose();
});
const encode = value => {
	const data = new TextEncoder().encode(JSON.stringify(value));
	const bytes = new Uint8Array(data.length + 5);
	new DataView(bytes.buffer).setUint32(1, data.length);
	bytes.set(data, 5);
	return bytes;
};
test('Live conversation stream decodes fragmented/coalesced frames and preserves updates and deletions', async () => {
	const a = encode({updates: {c1: summary('p1')}});
	const b = encode({updates: {c2: summary('p1')}, deletes: ['c1']});
	const frames = new Uint8Array(a.length + b.length);
	frames.set(a);
	frames.set(b, a.length);
	let finish;
	const complete = new Promise(resolve => {
		finish = resolve;
	});
	const received = [];
	const adapter = createAdapter({
		window: fakeWindow(),
		model,
		onSummaries: value => {
			received.push([...value.keys()]);
			if (2 === received.length) {
				adapter.dispose();
				finish();
			}
		},
		fetch: async url => {
			let r;
			if (!url.endsWith('/JetboxSubscribeToSummaries')) {
				r = Response.json(url.endsWith('/ListProjects') ? {projectIds: []} : {});
			}
			else {
				r = new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(frames.slice(0, 3));
							controller.enqueue(frames.slice(3, 17));
							controller.enqueue(frames.slice(17));
						}
					}),
					{headers: {'content-type': 'application/connect+json'}}
				);
			}
			return r;
		}
	});
	await adapter.start();
	await complete;
	adapter.dispose();
	assert.deepEqual(received, [['c1'], ['c2']]);
});
test('Renaming a running conversation sends an annotation patch without writing or cloning its trajectory summary', async () => {
	const original = {
		...summary('p1'),
		status: 'CASCADE_RUN_STATUS_RUNNING',
		stepCount: 120,
		trajectoryId: 'same-trajectory',
		futureMetadata: {kept: true}
	};
	const calls = [];
	let ready;
	let latest;
	let stream;
	const received = new Promise(resolve => {
		ready = resolve;
	});
	const adapter = createAdapter({
		window: fakeWindow(),
		model,
		onSummaries: value => {
			latest = value;
			ready();
		},
		fetch: async (url, options) => {
			let r;
			calls.push({
				method: url.split('/').at(-1),
				body: 'string' === typeof options.body ? JSON.parse(options.body) : null
			});
			if (url.endsWith('/ListProjects')) {
				r = Response.json({projectIds: []});
			}
			else if (url.endsWith('/JetboxSubscribeToSummaries')) {
				r = new Response(
					new ReadableStream({
						start(controller) {
							stream = controller;
							controller.enqueue(encode({updates: {c1: original}}));
							options.signal.addEventListener('abort', () => controller.close(), {once: true});
						}
					}),
					{headers: {'content-type': 'application/connect+json'}}
				);
			}
			else if (url.endsWith('/UpdateConversationAnnotations')) {
				stream.enqueue(encode({updates: {c1: {...original, stepCount: 121}}}));
				await new Promise(resolve => setImmediate(resolve));
				r = Response.json({});
			}
			else {
				throw Error('Unexpected RPC ' + url);
			}
			return r;
		}
	});
	try {
		await adapter.start();
		await received;
		await adapter.updateConversation('c1', {title: '52'});
		assert.deepEqual(calls.find(call => 'UpdateConversationAnnotations' === call.method).body, {
			cascadeIds: ['c1'],
			annotations: {title: '52'},
			mergeAnnotations: true
		});
		assert.equal(calls.some(call => 'JetboxWriteSummary' === call.method), false);
		assert.equal(latest.size, 1);
		assert.equal(latest.get('c1').trajectoryId, 'same-trajectory');
		assert.equal(latest.get('c1').stepCount, 121);
		assert.equal(latest.get('c1').status, 'CASCADE_RUN_STATUS_RUNNING');
		assert.deepEqual(latest.get('c1').futureMetadata, {kept: true});
		assert.equal(latest.get('c1').annotations.title, '52');
	}
	finally {
		adapter.dispose();
	}
});
test('Subagent snapshots do not appear as duplicate root conversations in the project list', () => {
	const root = {...summary('p1', '52'), trajectoryMetadata: {projectId: 'p1', rootConversationId: 'root'}};
	const child = {...summary('p1', '52'), trajectoryMetadata: {projectId: 'p1', rootConversationId: 'root'}};
	const rows = model.buildRows({
		data: config(),
		projects,
		summaries: new Map([['root', root], ['child', child]])
	});
	assert.deepEqual(rows.filter(row => 'conversation' === row.kind).map(row => row.id), ['root']);
});
// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Add Project settings action to project context menu in Folders":
// https://github.com/dmitry-ai/antigravity-addons/issues/17
test('folders-view readConfig coalesces concurrent polls so a restarting companion never queues duplicate 15s requests', async () => {
	let getCalls = 0;
	let releaseGet;
	const statuses = [];
	const state = {haveConfig: false, revision: ''};
	const readConfig = createReadConfig({
		window: {
			__ANTIGRAVITY_TOOLS_REQUEST__: (_tool, message) => {
				if ('GET' === message.method) {
					getCalls++;
				}
				return new Promise(resolve => {
					releaseGet = () => resolve({schemaVersion: 2, revision: 'rev-coalesced', data: config()});
				});
			}
		},
		model,
		state,
		client: {notifyUpdate() {}},
		status: (channel, err) => statuses.push([channel, err])
	});
	const p1 = readConfig();
	const p2 = readConfig();
	const p3 = readConfig();
	assert.equal(getCalls, 1, 'Concurrent polls while GET is in-flight must share one storage request');
	releaseGet();
	await Promise.all([p1, p2, p3]);
	assert.equal(state.haveConfig, true);
	assert.equal(state.revision, 'rev-coalesced');
	assert.deepEqual(statuses, [['folders', null]]);
	const p4 = readConfig();
	assert.equal(getCalls, 2, 'Subsequent poll after completion issues a fresh GET');
	releaseGet();
	await p4;
	const disconnected = createReadConfig({window: {}, model, state, client: {notifyUpdate() {}}, status() {}});
	await assert.rejects(disconnected(), /Folder storage bridge is unavailable/);
});
test('folders-manager CRUD operations delegate to folders-model and preserve metadata and tree invariants', context => {
	const {filename} = scratch(context);
	const added = manager.addFolder({name: 'Child', parentId: 'two'}, filename);
	assert.ok(added.id);
	assert.equal(manager.getFolderPath(added.id, manager.readConfig(filename).folders), 'Work / 2 / Child');
	assert.deepEqual([...manager.getDescendantIds('root', manager.readConfig(filename).folders)].sort(), [added.id, 'ten', 'two'].sort());
	assert.equal(manager.renameFolder(added.id, 'Child Renamed', filename), true);
	assert.equal(manager.moveFolder(added.id, 'ten', filename), true);
	assert.throws(() => manager.moveFolder('root', added.id, filename), /cycle/i);
	assert.equal(manager.assignProject('p9', added.id, filename), true);
	assert.equal(manager.removeFolder('ten', filename), true);
	const after = manager.readConfig(filename);
	assert.equal(after.folders.find(f => added.id === f.id).parentId, 'root');
	assert.equal(manager.unassignProject('p9', filename), true);
	assert.deepEqual(manager.readConfig(filename).futureMetadata, {preserve: true});
});
test('FoldersView class methods manage collapsed state, routes, status, reveal, and teardown in Node without Chromium', () => {
	const persisted = [];
	const data = config();
	const win = {
		location: {pathname: '/onboarding'},
		__ANTIGRAVITY_TOOLS_REQUEST__: async (_tool, message) => {
			persisted.push(message);
			return {};
		}
	};
	const client = {
		data,
		element: (tag, className = '', text = '') => ({
			tag,
			className,
			textContent: text,
			dataset: {},
			style: {},
			attributes: {},
			setAttribute(key, value) {
				this.attributes[key] = String(value);
			},
			remove() {
				this.removed = true;
			}
		}),
		getFolder: id => data.folders.find(item => id === item.id) || null,
		notifyUpdate() {}
	};
	let adapterDisposed = false;
	const view = new FoldersView(win, {
		model,
		client,
		adapter: {
			contract: {rpc: 'ok'},
			dispose: () => {
				adapterDisposed = true;
			},
			selection: () => ({})
		}
	});
	win.__PROJECT_FOLDERS_VIEW__ = view;
	view.storageReady = true;
	assert.equal(view.isOnboardingRoute(), true);
	view.updateStatus('mount', null);
	assert.equal(win.__PROJECT_FOLDERS_STATUS__.state, 'deferred');
	win.location.pathname = '/settings-standalone';
	assert.equal(view.isStandaloneRoute(), true);
	view.updateStatus('mount', null);
	assert.equal(win.__PROJECT_FOLDERS_STATUS__.state, 'ready');
	win.location.pathname = '/';
	view.handleProjects(projects);
	assert.deepEqual([...view.state.collapsed], ['project:p2', 'project:p1', 'project:p3']);
	view.state.collapsed.add('folder:root');
	view.state.collapsed.add('folder:two');
	view.expandFolder('root');
	assert.equal(view.state.collapsed.has('folder:root'), false);
	assert.equal(persisted.at(-1).method, 'SET_VIEW_STATE');
	view.state.rows = model.buildRows({data, projects, summaries: new Map()});
	view.scroll = {scrollTop: 0};
	view.reveal('p1', 'two');
	assert.equal(view.state.collapsed.has('folder:two'), false);
	assert.equal(view.state.collapsed.has('project:p1'), false);
	assert.ok(0 < view.scroll.scrollTop);
	view.reportAction('Temporary failure');
	assert.equal(view.inspect().state, 'error');
	view.reportAction(null);
	view.scroll.scrollTop = 64;
	view.dispose();
	assert.equal(adapterDisposed, true);
	assert.equal(win.__FOLDERS_RESTORE_SCROLL__, 64);
	assert.equal(win.__PROJECT_FOLDERS_VIEW__, undefined);
});
