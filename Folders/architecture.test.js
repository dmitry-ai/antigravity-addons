const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const model = require('./folders-model');
const createAdapter = require('./antigravity-adapter');
const manager = require('./folders-manager');
const {FoldersStore} = require('./folders-store');
const config = () => ({folders: [{id: 'root', name: 'Work', parentId: null}, {id: 'ten', name: '10', parentId: 'root'}, {id: 'two', name: '2', parentId: 'root'}, {id: 'empty', name: 'Empty', parentId: null}], projectFolderMap: {p1: 'two', p2: 'two'}, futureMetadata: {preserve: true}});
const projects = [{id: 'p2', name: 'Project 10', newField: {}}, {id: 'p1', name: 'Project 2'}, {id: 'p3', name: 'Unassigned'}];
const summary = (projectId, title = 'Conversation') => ({annotations: {title}, trajectoryMetadata: {projectId}, status: 'CASCADE_RUN_STATUS_IDLE', lastModifiedTime: '2026-10-28T10:00:00Z'});
const scratch = context => {
	const parent = os.tmpdir();
	const directory = fs.mkdtempSync(path.join(parent, 'antigravity-folders-'));
	context.after(() => { const resolved = path.resolve(directory); assert.ok(resolved.startsWith(path.resolve(parent) + path.sep)); fs.rmSync(resolved, {recursive: true, force: true}); });
	const filename = path.join(directory, 'folders.json'); fs.writeFileSync(filename, JSON.stringify(config()));
	return {directory, filename};
};
test('The independent model sorts nested folders and projects and preserves conversation identities', () => {
	const data = config(), before = JSON.stringify(data);
	const rows = model.buildRows({data, projects, summaries: new Map([['c1', summary('p1')], ['standalone', summary(null)]])});
	assert.deepEqual(rows.filter(row => row.kind === 'folder').map(row => row.id), ['empty', 'root', 'two', 'ten']);
	assert.deepEqual(rows.filter(row => row.kind === 'project').map(row => row.id), ['p1', 'p2', 'p3']);
	assert.equal(rows.find(row => row.id === 'c1').depth, 3);
	assert.equal(rows.find(row => row.id === 'c1').projectId, 'p1');
	assert.equal(rows.some(row => row.kind === 'empty' && row.folderId === 'root'), false);
	assert.equal(rows.some(row => row.kind === 'empty' && row.folderId === 'empty'), true);
	assert.equal(JSON.stringify(data), before);
});
test('Collapsed parents never leak assigned projects, subfolders, or conversations to the root', () => {
	const rows = model.buildRows({data: config(), projects, summaries: new Map([['c1', summary('p1')]]), collapsed: new Set(['folder:root'])});
	assert.equal(rows.some(row => ['two', 'ten', 'p1', 'p2', 'c1'].includes(row.id)), false);
	assert.equal(rows.some(row => row.id === 'p3'), true);
});

test('Hiding Outside of Project changes only visible rows and preserves conversations and exact project identities', () => {
	const data = config();
	const nativeProjects = [...projects, {id: 'outside-of-project', name: 'Outside of Project'}, {id: 'ordinary', name: 'Outside of Project'}];
	const summaries = new Map([['outside-chat', summary('outside-of-project')], ['kept-chat', summary('p1')], ['pinned-outside', {...summary('outside-of-project'), annotations: {pinned: true}}]]);
	const before = structuredClone({data, projects: nativeProjects, summaries});
	const options = {data, projects: nativeProjects, summaries};
	const visible = model.buildRows(options), hidden = model.buildRows({...options, hideOutsideProject: true});
	assert.ok(visible.some(row => row.id === 'outside-of-project'));
	assert.ok(visible.some(row => row.id === 'outside-chat'));
	assert.equal(hidden.some(row => row.id === 'outside-of-project' || row.id === 'outside-chat'), false);
	assert.ok(hidden.some(row => row.id === 'ordinary'));
	assert.ok(hidden.some(row => row.id === 'kept-chat'));
	assert.ok(hidden.some(row => row.id === 'pinned-outside'));
	assert.equal(hidden.length, visible.length - 2);
	assert.deepEqual({data, projects: nativeProjects, summaries}, before);
});

test('Hiding the standalone Conversations section preserves its source summaries and project chats', () => {
	const summaries = new Map([['no-project', summary(null)], ['missing-project', summary('missing')], ['project-chat', summary('p1')]]);
	const before = structuredClone(summaries), options = {data: config(), projects, summaries};
	const visible = model.buildRows(options), hidden = model.buildRows({...options, hideStandaloneConversations: true});
	assert.ok(visible.some(row => row.key === 'standalone'));
	assert.equal(hidden.some(row => row.key === 'standalone' || row.id === 'no-project' || row.id === 'missing-project'), false);
	assert.ok(hidden.some(row => row.id === 'project-chat'));
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
	assert.equal(next.folders.find(folder => folder.id === 'child').parentId, 'root');
	assert.equal(next.projectFolderMap.p1, 'root');
	assert.deepEqual(next.futureMetadata, original.futureMetadata);
	assert.equal(original.folders.some(folder => folder.id === 'two'), true);
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
	const {filename, directory} = scratch(context); const store = new FoldersStore(filename); context.after(() => store.dispose());
	const snapshot = manager.readConfig(filename), oldRevision = store.revision;
	store.dispatch({action: 'rename-folder', id: 'ten', newName: 'Ten', revision: oldRevision});
	assert.throws(() => store.dispatch({action: 'rename-folder', id: 'two', newName: 'Lost', revision: oldRevision}), /concurrently/);
	snapshot.folders[0].name = 'Stale CLI';
	assert.throws(() => manager.writeConfig(snapshot, filename), /concurrently/);
	assert.equal(manager.readConfig(filename).folders.find(folder => folder.id === 'ten').name, 'Ten');
	assert.deepEqual(fs.readdirSync(directory), ['folders.json']);
});
test('Invalid external JSON retains the last valid tree and reports an error, then recovers after atomic replacement', async context => {
	const {filename, directory} = scratch(context); const store = new FoldersStore(filename); context.after(() => store.dispose());
	const before = store.data;
	fs.writeFileSync(filename, '{'); store.reload();
	assert.equal(store.data, before); assert.ok(store.error);
	assert.throws(() => store.dispatch({action: 'remove-folder', id: 'root'}));
	const next = config(); next.folders[0].name = 'External';
	const temporary = path.join(directory, 'next.json'); fs.writeFileSync(temporary, JSON.stringify(next)); fs.renameSync(temporary, filename);
	await new Promise(resolve => setTimeout(resolve, 160));
	assert.equal(store.error, null); assert.equal(store.data.folders[0].name, 'External');
});
const fakeWindow = () => {
	const win = {__APP_CONFIG__: {csrfToken: 'fixture-only'}, location: {href: 'https://127.0.0.1:12345/'}, history: {pushState(_state, _title, url) { win.lastUrl = url; }}, dispatchEvent(event) { win.lastEvent = event; }, PopStateEvent: class {constructor(type) {this.type = type;}}};
	return win;
};
test('Native API adapter tolerates added DTO fields and uses the declared project endpoints and IDs', async () => {
	const calls = [], win = fakeWindow(), native = [projects[1]];
	const adapter = createAdapter({window: win, model, fetch: async (url, options) => { calls.push({url, options}); if(url.endsWith('/CreateProject'))native.push(JSON.parse(options.body).project); return Response.json(url.endsWith('/ListProjects') ? {projectIds: native.map(project => project.id), future: {}} : url.endsWith('/ReadProjects') ? {projects: native, future: true} : {}); }});
	try {
		assert.equal((await adapter.readProjects())[0].id, 'p1');
		assert.deepEqual(JSON.parse(calls[1].options.body), {ids: ['p1']});
		assert.equal(calls[0].options.headers['x-codeium-csrf-token'], 'fixture-only');
		await adapter.createProject({id: 'exact-new-id', name: 'New', resources: []});
		assert.equal(JSON.parse(calls.find(call => call.url.endsWith('/CreateProject')).options.body).project.id, 'exact-new-id');
		adapter.navigate({projectId: 'p1', conversationId: 'c1'});
		assert.equal(win.lastUrl, '/c/c1?section=p1'); assert.equal(win.lastEvent.type, 'popstate');
	} finally { adapter.dispose(); }
});
test('Native API errors and missing records are surfaced instead of reporting an empty successful tree', async () => {
	const adapter = createAdapter({window: fakeWindow(), model, fetch: async url => Response.json(url.endsWith('/ListProjects') ? {projectIds: ['p1']} : {projects: []})});
	await assert.rejects(adapter.readProjects(), /refusing to hide missing projects/); adapter.dispose();
	const failed = createAdapter({window: fakeWindow(), model, fetch: async () => new Response('changed', {status: 404})});
	await assert.rejects(failed.createProject({id: 'p-new', name: 'New'}), /HTTP 404/); failed.dispose();
});
const encode = value => { const data = new TextEncoder().encode(JSON.stringify(value)), bytes = new Uint8Array(data.length + 5); new DataView(bytes.buffer).setUint32(1, data.length); bytes.set(data, 5); return bytes; };
test('Live conversation stream decodes fragmented/coalesced frames and preserves updates and deletions', async () => {
	const a = encode({updates: {c1: summary('p1')}}), b = encode({updates: {c2: summary('p1')}, deletes: ['c1']});
	const frames = new Uint8Array(a.length + b.length); frames.set(a); frames.set(b, a.length);
	let finish;
	const complete = new Promise(resolve => {finish = resolve;});
	const received = [];
	const adapter = createAdapter({window: fakeWindow(), model, onSummaries: value => { received.push([...value.keys()]); if (received.length === 2) { adapter.dispose(); finish(); } }, fetch: async url => {
		if (!url.endsWith('/JetboxSubscribeToSummaries')) return Response.json(url.endsWith('/ListProjects') ? {projectIds: []} : {});
		return new Response(new ReadableStream({start(controller) {controller.enqueue(frames.slice(0, 3)); controller.enqueue(frames.slice(3, 17)); controller.enqueue(frames.slice(17));}}), {headers: {'content-type': 'application/connect+json'}});
	}});
	await adapter.start(); await complete; adapter.dispose();
	assert.deepEqual(received, [['c1'], ['c2']]);
});

test('Renaming a running conversation sends an annotation patch without writing or cloning its trajectory summary', async () => {
	const original={...summary('p1'),status:'CASCADE_RUN_STATUS_RUNNING',stepCount:120,trajectoryId:'same-trajectory',futureMetadata:{kept:true}},calls=[];
	let ready,latest,stream;const received=new Promise(resolve=>{ready=resolve;});
	const adapter=createAdapter({window:fakeWindow(),model,onSummaries:value=>{latest=value;ready();},fetch:async(url,options)=>{
		calls.push({method:url.split('/').at(-1),body:typeof options.body==='string'?JSON.parse(options.body):null});
		if(url.endsWith('/ListProjects'))return Response.json({projectIds:[]});
		if(url.endsWith('/JetboxSubscribeToSummaries')){
			return new Response(new ReadableStream({start(controller){stream=controller;controller.enqueue(encode({updates:{c1:original}}));options.signal.addEventListener('abort',()=>controller.close(),{once:true});}}),{headers:{'content-type':'application/connect+json'}});
		}
		if(url.endsWith('/UpdateConversationAnnotations')){stream.enqueue(encode({updates:{c1:{...original,stepCount:121}}}));await new Promise(resolve=>setImmediate(resolve));return Response.json({});}
		throw Error('Unexpected RPC '+url);
	}});
	try{
		await adapter.start();await received;await adapter.updateConversation('c1',{title:'52'});
		assert.deepEqual(calls.find(call=>call.method==='UpdateConversationAnnotations').body,{cascadeIds:['c1'],annotations:{title:'52'},mergeAnnotations:true});
		assert.equal(calls.some(call=>call.method==='JetboxWriteSummary'),false);
		assert.equal(latest.size,1);assert.equal(latest.get('c1').trajectoryId,'same-trajectory');assert.equal(latest.get('c1').stepCount,121);assert.equal(latest.get('c1').status,'CASCADE_RUN_STATUS_RUNNING');
		assert.deepEqual(latest.get('c1').futureMetadata,{kept:true});assert.equal(latest.get('c1').annotations.title,'52');
	}finally{adapter.dispose();}
});

test('Subagent snapshots do not appear as duplicate root conversations in the project list',()=>{
	const root={...summary('p1','52'),trajectoryMetadata:{projectId:'p1',rootConversationId:'root'}},child={...summary('p1','52'),trajectoryMetadata:{projectId:'p1',rootConversationId:'root'}};
	const rows=model.buildRows({data:config(),projects,summaries:new Map([['root',root],['child',child]])});
	assert.deepEqual(rows.filter(row=>row.kind==='conversation').map(row=>row.id),['root']);
});
