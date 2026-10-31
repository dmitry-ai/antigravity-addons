// 2026-10-18 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Add folder-scoped project creation, 80%-height tree folder picker, multi-window UI injection (4th+ windows), and context-only action menus":
// https://github.com/dmitry-ai/antigravity-addons/issues/8
const test = require('node:test');
const assert = require('node:assert/strict');
const createAdapter = require('./antigravity-adapter');
const model = require('./folders-model');
test('A project committed before a lost response is recovered by exact UUID and retry creates no duplicate', async () => {
	const projects = [];
	const created = [];
	const adapter = createAdapter({
		window: {__APP_CONFIG__: {csrfToken: 'fixture'}},
		model,
		fetch: async (url, options) => {
			let r;
			if (url.endsWith('/ListProjects')) {
				r = Response.json({projectIds: projects.map(project => project.id)});
			}
			else if (url.endsWith('/ReadProjects')) {
				r = Response.json({projects});
			}
			else if (url.endsWith('/CreateProject')) {
				const project = JSON.parse(options.body).project;
				created.push(project.id);
				projects.push(project);
				throw Error('Reply lost after commit');
			}
			else {
				throw Error('Unexpected RPC');
			}
			return r;
		}
	});
	try {
		assert.equal(await adapter.createProject({id: 'dialog-owned-uuid', name: 'Work'}), 'dialog-owned-uuid');
		assert.equal(await adapter.createProject({id: 'dialog-owned-uuid', name: 'Work'}), 'dialog-owned-uuid');
		assert.deepEqual(created, ['dialog-owned-uuid']);
	}
	finally {
		adapter.dispose();
	}
});
test('Creation errors cannot be mistaken for an unrelated project with the same display name', async () => {
	const other = {id: 'unrelated-id', name: 'Same name'};
	const adapter = createAdapter({
		window: {__APP_CONFIG__: {csrfToken: 'fixture'}},
		model,
		fetch: async url => {
			let r;
			if (url.endsWith('/ListProjects')) {
				r = Response.json({projectIds: [other.id]});
			}
			else if (url.endsWith('/ReadProjects')) {
				r = Response.json({projects: [other]});
			}
			else {
				r = new Response('Unavailable', {status: 503});
			}
			return r;
		}
	});
	try {
		await assert.rejects(adapter.createProject({id: 'exact-dialog-id', name: other.name}), /HTTP 503/);
	}
	finally {
		adapter.dispose();
	}
});
