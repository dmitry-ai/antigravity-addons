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
});
