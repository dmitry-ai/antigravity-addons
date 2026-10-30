const test = require('node:test');
const assert = require('node:assert/strict');
const {openFixture} = require('./browser-fixture');
const data = {folders: [{id: 'root', name: 'Work', parentId: null}, {id: 'child', name: '2026', parentId: 'root'}, {id: 'other', name: 'Other', parentId: null}], projectFolderMap: {p1: 'child'}};
const projects = [{id: 'p1', name: 'Project One'}, {id: 'p2', name: 'Project Two'}];
test('A real browser mounts the independent tree on unrelated vendor markup and keeps the event loop responsive', {timeout: 15000}, async context => {
	const fixture = await openFixture({data, projects}); context.after(() => fixture.close());
	await fixture.page.waitForTimeout(300);
	const report = await fixture.page.evaluate(() => ({status: window.__PROJECT_FOLDERS_VIEW__?.inspect(), observers: window.__foldersFixture.observers, runaway: window.__foldersFixture.observerRunaway, draft: document.querySelector('#untouched-draft').value}));
	console.log(JSON.stringify(report));
	assert.equal(report.runaway, undefined); assert.equal(report.status.state, 'ready'); assert.equal(report.draft, 'Unsaved draft'); assert.deepEqual(fixture.errors, []);
	const geometry = await fixture.page.locator('.fg-row').evaluateAll(rows => rows.slice(0, 5).map(el => {const box=el.getBoundingClientRect();return {y:box.y,height:box.height};}));
	assert.ok(geometry.every(row => Math.abs(row.height - 16) < 0.1));
	assert.ok(geometry.slice(1).every((row,index) => Math.abs(row.y - geometry[index].y - row.height) < 0.1), 'Virtual positions and CSS heights must use the same compact metric');
	await fixture.page.locator('.fg-native').click();
	assert.equal(await fixture.page.locator('[data-testid="conversation-list-sidebar"]').isVisible(), true);
	const nativeTop = await fixture.page.locator('.new-future-vendor-class').evaluate(el => el.getBoundingClientRect().top);
	const toolbarBottom = await fixture.page.locator('.fg-toolbar').evaluate(el => el.getBoundingClientRect().bottom);
	assert.ok(nativeTop >= toolbarBottom, 'The native list header must remain accessible below the Tools toolbar');
	await fixture.page.locator('.fg-native').click();
});
test('A missing native mount produces a visible fault without starving the event loop or hiding the native UI', {timeout: 15000}, async context => {
	const fixture = await openFixture({data, projects, missingAnchor: true}); context.after(() => fixture.close());
	await fixture.page.waitForTimeout(400);
	const report = await fixture.page.evaluate(() => ({state: window.__PROJECT_FOLDERS_STATUS__, runaway: window.__foldersFixture.observerRunaway, text: document.querySelector('.fg-fault')?.textContent, nativeVisible: !!document.querySelector('[data-testid="changed-sidebar-contract"]').getClientRects().length}));
	assert.equal(report.runaway, undefined); assert.equal(report.state.state, 'error'); assert.match(report.text, /Expected one native sidebar/); assert.equal(report.nativeVisible, true); assert.deepEqual(fixture.errors, []);
});
test('A sidebar created after asynchronous native startup recovers automatically without a reload', {timeout: 15000}, async context => {
	const fixture = await openFixture({data, projects, delayedAnchor: true}); context.after(() => fixture.close());
	await fixture.page.waitForFunction(() => window.__PROJECT_FOLDERS_STATUS__?.state === 'ready', {timeout: 5000});
	assert.equal(await fixture.page.locator('.fg-fault').count(), 0);
	assert.equal(await fixture.page.locator('[data-folders-root]').count(), 1);
	assert.equal(await fixture.page.evaluate(() => window.__foldersFixture.observerRunaway), undefined);
	assert.deepEqual(fixture.errors, []);
});
test('Early CDP attachment during native shell and skeleton boot never flashes a mount fault before the sidebar renders', {timeout: 15000}, async context => {
	const fixture = await openFixture({data, projects, bootingShell: true}); context.after(() => fixture.close());
	await fixture.page.waitForFunction(() => window.__PROJECT_FOLDERS_VIEW__?.state.haveConfig && window.__PROJECT_FOLDERS_VIEW__?.state.haveProjects);
	await fixture.page.waitForTimeout(150);
	const duringAuthSpinner = await fixture.page.evaluate(() => ({status: window.__PROJECT_FOLDERS_STATUS__, fault: document.querySelector('.fg-fault')?.textContent || null}));
	assert.equal(duringAuthSpinner.status.state, 'loading');
	assert.deepEqual(duringAuthSpinner.status.errors, {});
	assert.equal(duringAuthSpinner.fault, null);
	await fixture.page.evaluate(() => {
		document.querySelector('#root').innerHTML = '<div class="agy-shell"><nav role="navigation" style="position:relative;width:340px;height:680px"><div data-testid="sidebar-list-skeleton">Loading conversations...</div></nav></div>';
	});
	await fixture.page.waitForTimeout(150);
	const duringSkeleton = await fixture.page.evaluate(() => ({status: window.__PROJECT_FOLDERS_STATUS__, fault: document.querySelector('.fg-fault')?.textContent || null}));
	assert.equal(duringSkeleton.status.state, 'loading');
	assert.deepEqual(duringSkeleton.status.errors, {});
	assert.equal(duringSkeleton.fault, null);
	await fixture.page.evaluate(() => {
		const skeleton = document.querySelector('[data-testid="sidebar-list-skeleton"]');
		const list = document.createElement('div');
		list.dataset.testid = 'conversation-list-sidebar';
		list.style.height = '100%';
		list.innerHTML = '<article class="new-future-vendor-class">Native project list</article>';
		skeleton.replaceWith(list);
	});
	await fixture.page.waitForFunction(() => window.__PROJECT_FOLDERS_STATUS__?.state === 'ready', {timeout: 5000});
	assert.equal(await fixture.page.locator('.fg-fault').count(), 0);
	assert.equal(await fixture.page.locator('[data-folders-root]').count(), 1);
	assert.deepEqual(fixture.errors, []);
});
test('Real UI menus create a project in the exact chosen folder and cancellation does not capture a later project', {timeout: 20000}, async context => {
	const fixture = await openFixture({data, projects}); context.after(() => fixture.close());
	await fixture.page.waitForFunction(() => window.__PROJECT_FOLDERS_STATUS__?.state === 'ready');
	const folder = fixture.page.locator('[data-folders-row="folder:root"]');
	await folder.click({button: 'right'});
	const menuGeometry=await fixture.page.locator('.antigravity-folder-menu-item').evaluateAll(items=>items.map(el=>el.getBoundingClientRect().height));
	assert.ok(menuGeometry.every(height=>height<=16.1),'Own context menu actions must retain compact 16px rows');
	await fixture.page.getByRole('menuitem', {name: /Создать проект в этой папке/}).click();
	await fixture.page.getByRole('dialog', {name: 'Создать проект'}).getByRole('button', {name: 'Отмена'}).click();
	assert.equal(await fixture.page.evaluate(() => window.__foldersFixture.calls.some(call => call.method === 'CreateProject')), false);
	await folder.click({button: 'right'}); await fixture.page.getByRole('menuitem', {name: /Создать проект в этой папке/}).click();
	await fixture.page.getByRole('textbox', {name: 'Название проекта', exact: true}).fill('Fixture-created');
	await fixture.page.getByRole('dialog', {name: 'Создать проект'}).getByRole('button', {name: 'Создать', exact: true}).click();
	await fixture.page.waitForFunction(() => window.__foldersFixture.calls.some(call => call.method === 'project-folders' && call.body.action === 'assign-project'));
	const proof = await fixture.page.evaluate(() => {const created=window.__foldersFixture.calls.find(call=>call.method==='CreateProject').body.project;return {createdId:created.id,assigned:window.__foldersFixture.data.projectFolderMap[created.id],draft:document.querySelector('#untouched-draft').value}});
	assert.equal(proof.assigned, 'root'); assert.ok(proof.createdId); assert.equal(proof.draft, 'Unsaved draft'); assert.deepEqual(fixture.errors, []);
});
test('New vendor API schemas produce a visible fault and preserve the original project list', {timeout: 15000}, async context => {
	const fixture = await openFixture({data, projects, badProjects: true}); context.after(() => fixture.close());
	await fixture.page.waitForFunction(() => window.__PROJECT_FOLDERS_STATUS__?.state === 'error');
	assert.match(await fixture.page.locator('.fg-fault').textContent(), /unknown project list schema/);
	assert.equal(await fixture.page.locator('[data-folders-root]').count(), 0);
	assert.equal(await fixture.page.locator('[data-testid="conversation-list-sidebar"]').isVisible(), true);
	assert.deepEqual(fixture.errors, []);
});

test('Thousands of projects remain virtualized and live conversation updates keep the selected route and draft', {timeout: 20000}, async context => {
	const many = Array.from({length: 5000}, (_, index) => ({id: `p${index}`, name: `Project ${index}`}));
	const fixture = await openFixture({data: {folders: [], projectFolderMap: {}}, projects: many}); context.after(() => fixture.close());
	await fixture.page.waitForFunction(() => window.__PROJECT_FOLDERS_STATUS__?.state === 'ready');
	const report = await fixture.page.evaluate(() => window.__PROJECT_FOLDERS_VIEW__.inspect());
	assert.equal(report.rowCount, 5000); assert.ok(report.renderedRows < 70);
	await fixture.page.locator('[data-folders-row="project:p0"] .fg-label').click();
	await fixture.page.locator('[data-folders-row="project:p0"] .fg-toggle').click();
	await fixture.page.evaluate(() => window.__foldersFixture.emit({updates: {c1: {summary: 'Live conversation', status: 'RUNNING', trajectoryMetadata: {projectId: 'p0'}}}}));
	await fixture.page.getByRole('button', {name: /Live conversation/}).click();
	await fixture.page.evaluate(() => window.__foldersFixture.emit({updates: {c1: {summary: 'Updated conversation', status: 'IDLE', trajectoryMetadata: {projectId: 'p0'}, futureMetadata: {untouched: true}}}}));
	await fixture.page.getByRole('button', {name: /Updated conversation/}).waitFor();
	assert.match(fixture.page.url(), /\/c\/c1\?section=p0/);
	assert.equal(await fixture.page.locator('[data-folders-row="conversation:c1"]').getAttribute('aria-selected'), 'true');
	assert.equal(await fixture.page.locator('#untouched-draft').inputValue(), 'Unsaved draft');
	assert.deepEqual(fixture.errors, []);
});

test('The conversation rename UI keeps its ID, native route, project name, live progress, and unsaved input', {timeout:20000}, async context=>{
	const summary={summary:'Before rename',annotations:{title:'Before rename'},status:'CASCADE_RUN_STATUS_RUNNING',stepCount:120,trajectoryId:'same-analysis',trajectoryMetadata:{projectId:'p1',rootConversationId:'c1'}};
	const fixture=await openFixture({data,projects,summaries:{c1:summary}});context.after(()=>fixture.close());
	await fixture.page.waitForFunction(()=>window.__PROJECT_FOLDERS_STATUS__?.state==='ready');
	await fixture.page.locator('[data-folders-row="project:p1"] .fg-toggle').click();
	await fixture.page.getByRole('button',{name:/Before rename/}).click({button:'right'});
	await fixture.page.getByRole('menuitem',{name:'Переименовать…',exact:true}).click();
	await fixture.page.getByRole('textbox',{name:'Название разговора'}).fill('52');
	await fixture.page.getByRole('button',{name:'Сохранить',exact:true}).click();
	await fixture.page.getByRole('button',{name:/52/}).click();
	assert.match(fixture.page.url(),/\/c\/c1\?section=p1/);
	await fixture.page.evaluate(()=>{const s=window.__foldersFixture.summaries.c1;window.__foldersFixture.emit({updates:{c1:{...s,stepCount:121}}});});
	await fixture.page.waitForFunction(()=>window.__PROJECT_FOLDERS_VIEW__.state.summaries.get('c1').stepCount===121);
	const proof=await fixture.page.evaluate(()=>({ids:[...window.__PROJECT_FOLDERS_VIEW__.state.summaries.keys()],project:window.__foldersFixture.projects.find(p=>p.id==='p1').name,methods:window.__foldersFixture.calls.map(c=>c.method),state:window.__PROJECT_FOLDERS_STATUS__.state}));
	assert.deepEqual(proof.ids,['c1']);assert.equal(proof.project,'Project One');assert.equal(proof.state,'ready');assert.equal(proof.methods.includes('JetboxWriteSummary'),false);
	assert.equal(await fixture.page.locator('#untouched-draft').inputValue(),'Unsaved draft');assert.deepEqual(fixture.errors,[]);
});
