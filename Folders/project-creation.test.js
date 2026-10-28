const test = require('node:test');
const assert = require('node:assert/strict');
const createAdapter = require('./antigravity-adapter');
const model = require('./folders-model');

test('A project committed before a lost response is recovered by exact UUID and retry creates no duplicate', async () => {
	const projects = [], created = [];
	const adapter = createAdapter({window: {__APP_CONFIG__: {csrfToken: 'fixture'}}, model, fetch: async (url, options) => {
		if (url.endsWith('/ListProjects')) return Response.json({projectIds: projects.map(project => project.id)});
		if (url.endsWith('/ReadProjects')) return Response.json({projects});
		if (url.endsWith('/CreateProject')) {
			const project = JSON.parse(options.body).project;
			created.push(project.id); projects.push(project); throw Error('Reply lost after commit');
		}
		throw Error('Unexpected RPC');
	}});
	try {
		assert.equal(await adapter.createProject({id: 'dialog-owned-uuid', name: 'Work'}), 'dialog-owned-uuid');
		assert.equal(await adapter.createProject({id: 'dialog-owned-uuid', name: 'Work'}), 'dialog-owned-uuid');
		assert.deepEqual(created, ['dialog-owned-uuid']);
	} finally {adapter.dispose();}
});

test('Creation errors cannot be mistaken for an unrelated project with the same display name', async () => {
	const other = {id: 'unrelated-id', name: 'Same name'};
	const adapter = createAdapter({window: {__APP_CONFIG__: {csrfToken: 'fixture'}}, model, fetch: async url => {
		if (url.endsWith('/ListProjects')) return Response.json({projectIds: [other.id]});
		if (url.endsWith('/ReadProjects')) return Response.json({projects: [other]});
		return new Response('Unavailable', {status: 503});
	}});
	try {await assert.rejects(adapter.createProject({id: 'exact-dialog-id', name: other.name}), /HTTP 503/);}
	finally {adapter.dispose();}
});
