(function(factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory;
	else window.AntigravityFoldersAdapter = factory;
})(function createAdapter({window: win, fetch: request = win.fetch.bind(win), model = win.AntigravityFoldersModel, onProjects = () => {}, onSummaries = () => {}, onStatus = () => {}}) {
	const service = '/exa.language_server_pb.LanguageServerService/';
	const lifetime = new AbortController();
	let summaries = new Map(), poll, stopped = false, retryDelay = 1000;
	const headers = type => {
		if (typeof win.__APP_CONFIG__?.csrfToken !== 'string') throw Error('Antigravity API contract: csrfToken is unavailable');
		return {'content-type': type, 'x-codeium-csrf-token': win.__APP_CONFIG__.csrfToken, 'connect-protocol-version': '1'};
	};
	const rpc = async (method, body) => {
		const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)]);
		const response = await request(service + method, {method: 'POST', headers: headers('application/json'), body: JSON.stringify(body), signal});
		if (!response.ok) throw Error(`${method}: HTTP ${response.status}`);
		const result = await response.json();
		if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error(`${method}: invalid response schema`);
		return result;
	};
	const readProjects = async () => {
		const listed = await rpc('ListProjects', {});
		const ids = listed.projectIds || [];
		if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id)) throw Error('ListProjects: projectIds contract changed');
		if (new Set(ids).size !== ids.length) throw Error('ListProjects: duplicate project IDs');
		if (!ids.length && Object.keys(listed).some(key => key !== 'projectIds')) throw Error('ListProjects: unknown project list schema');
		const result = ids.length ? await rpc('ReadProjects', {ids}) : {projects: []};
		const projects = result.projects || [];
		if (!Array.isArray(projects) || projects.some(project => !project || typeof project.id !== 'string' || !project.id || project.name !== undefined && typeof project.name !== 'string')) throw Error('ReadProjects: project schema changed');
		if (projects.length !== ids.length) throw Error(`ReadProjects: expected ${ids.length} projects, received ${projects.length}; refusing to hide missing projects`);
		if (new Set(projects.map(project => project.id)).size !== ids.length || projects.some(project => !ids.includes(project.id))) throw Error('ReadProjects: project IDs do not match the request');
		onProjects(projects); onStatus('projects', null);
		return projects;
	};
	const streamOnce = async () => {
		const body = new TextEncoder().encode('{}');
		const frame = new Uint8Array(5 + body.length);
		new DataView(frame.buffer).setUint32(1, body.length); frame.set(body, 5);
		const response = await request(service + 'JetboxSubscribeToSummaries', {method: 'POST', headers: headers('application/connect+json'), body: frame, signal: lifetime.signal});
		if (!response.ok || !response.headers.get('content-type')?.startsWith('application/connect+json')) throw Error(`Conversation stream: HTTP ${response.status}, incompatible content type`);
		const reader = response.body.getReader();
		let pending = new Uint8Array(0);
		let incoming = new Map();
		try {
			while (!stopped) {
				const {value, done} = await reader.read();
				if (done) throw Error('Conversation stream disconnected');
				const buffer = new Uint8Array(pending.length + value.length); buffer.set(pending); buffer.set(value, pending.length); pending = buffer;
				while (pending.length >= 5) {
					const size = new DataView(pending.buffer, pending.byteOffset).getUint32(1);
					if (size > 32 * 1024 * 1024) throw Error('Conversation stream frame exceeds contract limit');
					if (pending.length < size + 5) break;
					const flags = pending[0], message = JSON.parse(new TextDecoder().decode(pending.slice(5, size + 5)));
					pending = pending.slice(size + 5);
					if (flags !== 0) throw Error(message.error?.message || 'Conversation stream ended or changed encoding');
					incoming = model.applySummaryUpdate(incoming, message); summaries = incoming;
					retryDelay = 1000;
					onSummaries(summaries); onStatus('conversations', null);
				}
			}
		} finally { await reader.cancel().catch(() => {}); }
	};
	const watchSummaries = async () => {
		while (!stopped) {
			try { await streamOnce(); }
			catch (error) { if (stopped) break; onStatus('conversations', error.message); }
			await new Promise(resolve => {
				const finish = () => { clearTimeout(timer); lifetime.signal.removeEventListener('abort', finish); resolve(); };
				const timer = setTimeout(finish, retryDelay);
				lifetime.signal.addEventListener('abort', finish, {once: true});
			});
			retryDelay = Math.min(retryDelay * 2, 30000);
		}
	};
	const navigate = ({projectId, conversationId}) => {
		const url = new URL(win.location.href);
		url.pathname = conversationId ? '/c/' + encodeURIComponent(conversationId) : '/'; url.searchParams.delete('cascadeId'); url.searchParams.delete('section');
		if (projectId) url.searchParams.set('section', projectId);
		win.history.pushState(null, '', url.pathname + url.search);
		win.dispatchEvent(new win.PopStateEvent('popstate', {state: null}));
	};
	const createProject = async ({id, name, resources = []}) => {
		if (!id || !name.trim()) throw Error('Project id and name are required');
		// A dialog owns one UUID. Retrying after an ambiguous network failure must
		// recover that exact project rather than create or capture another one.
		if (!(await readProjects()).some(project => project.id === id)) {
			try {await rpc('CreateProject', {project: {id, name: name.trim(), projectResources: {resources}, settings: {}}});}
			catch (error) {if (!(await readProjects()).some(project => project.id === id)) throw error;}
		}
		if (!(await readProjects()).some(project => project.id === id)) throw Error(`CreateProject: exact project ${id} is missing after creation`);
		return id;
	};
	const updateConversation = async (id, annotations) => {
		const current = summaries.get(id); if (!current) throw Error('Conversation is not present in the current snapshot');
		await rpc('UpdateConversationAnnotations', {cascadeIds: [id], annotations, mergeAnnotations: true});
		const latest = summaries.get(id); if (!latest) return;
		const summary = {...structuredClone(latest), annotations: {...structuredClone(latest.annotations || {}), ...annotations}};
		summaries = model.applySummaryUpdate(summaries, {updates: {[id]: summary}}); onSummaries(summaries);
	};
	return {
		contract: 'antigravity-local-rpc-v2', rpc, readProjects, navigate, createProject, updateConversation,
		selection() {const url = new URL(win.location.href), match = /^\/c\/([^/]+)\/?$/.exec(url.pathname); return {projectId: url.searchParams.get('section'), conversationId: match ? decodeURIComponent(match[1]) : null};},
		async start() {
			await readProjects();
			void watchSummaries();
			poll = setInterval(() => { if (!stopped) readProjects().catch(error => onStatus('projects', error.message)); }, 5000);
		},
		dispose() { stopped = true; lifetime.abort(); clearInterval(poll); }
	};
});
