// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders module loader, tree indexer, declarative DOM helper, and CAS store/CLI wrappers":
// https://github.com/dmitry-ai/antigravity-addons/issues/44
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Convert createAdapter in Folders/antigravity-adapter.js into ConnectSummaryStream and AntigravityAdapter ES6 classes":
// https://github.com/dmitry-ai/antigravity-addons/issues/36
const defaultModel = require('./folders-model');
class AntigravityAdapter {
	constructor({window: win, fetch: request = win.fetch.bind(win), model = defaultModel, onProjects = () => {}, onSummaries = () => {}, onStatus = () => {}}) {
		this.contract = 'antigravity-local-rpc-v2';
		this.service = '/exa.language_server_pb.LanguageServerService/';
		this.lifetime = new AbortController();
		this.summaries = new Map();
		Object.assign(this, {
			cachedIdsKey: null,
			cachedPolls: 0,
			cachedProjects: null,
			model,
			onProjects,
			onStatus,
			onSummaries,
			poll: null,
			projectsPromise: null,
			request,
			stopped: false,
			win
		});
		this.stream = new ConnectSummaryStream({
			headers: type => this.headers(type),
			lifetime: this.lifetime,
			model,
			onStatus,
			onSummaries: next => {
				this.summaries = next;
				onSummaries(next);
			},
			request,
			url: this.service + 'JetboxSubscribeToSummaries'
		});
	}
	async createProject({id, name, resources = []}) {
		if (!id || !name.trim()) {
			throw Error('Project id and name are required');
		}
		if (!(await this.hasProject(id))) {
			let verified = false;
			try {
				await this.rpc('CreateProject', {project: {id, name: name.trim(), projectResources: {resources}, settings: {}}});
			}
			catch (error) {
				verified = await this.hasProject(id);
				if (!verified) {
					throw error;
				}
			}
			if (!verified && !(await this.hasProject(id))) {
				throw Error(`CreateProject: exact project ${id} is missing after creation`);
			}
		}
		return id;
	}
	dispose() {
		this.stopped = true;
		this.stream.dispose();
		this.lifetime.abort();
		clearInterval(this.poll);
	}
	async fetchProjects(force = false) {
		const ids = this.validateProjectIds(await this.rpc('ListProjects', {}));
		const idsKey = JSON.stringify(ids);
		let projects;
		if (!force && this.cachedProjects && idsKey === this.cachedIdsKey && 12 > this.cachedPolls) {
			this.cachedPolls++;
			projects = this.cachedProjects;
		}
		else {
			const result = ids.length ? await this.rpc('ReadProjects', {ids}) : {projects: []};
			projects = this.validateProjects(ids, result);
			this.cachedIdsKey = idsKey;
			this.cachedProjects = projects;
			this.cachedPolls = 0;
		}
		this.onProjects(projects);
		this.onStatus('projects', null);
		return projects;
	}
	async hasProject(id) {
		return (await this.readProjects()).some(project => id === project.id);
	}
	headers(type) {
		if ('string' !== typeof this.win.__APP_CONFIG__?.csrfToken) {
			throw Error('Antigravity API contract: csrfToken is unavailable');
		}
		return {'content-type': type, 'x-codeium-csrf-token': this.win.__APP_CONFIG__.csrfToken, 'connect-protocol-version': '1'};
	}
	navigate({projectId, conversationId}) {
		this.pushUrl(url => {
			url.pathname = conversationId ? '/c/' + encodeURIComponent(conversationId) : '/';
			url.searchParams.delete('cascadeId');
			url.searchParams.delete('section');
			if (projectId) {
				url.searchParams.set('section', projectId);
			}
		});
	}
	// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
	// "Add Project settings action to project context menu in Folders":
	// https://github.com/dmitry-ai/antigravity-addons/issues/17
	openProjectSettings(projectId, screen) {
		if (!projectId || 'string' !== typeof projectId) {
			throw Error('Project id is required');
		}
		this.pushUrl(url => {
			url.searchParams.set('settingsOpen', 'true');
			url.searchParams.set('settingsProjectId', projectId);
			screen ? url.searchParams.set('settingsScreen', screen) : url.searchParams.delete('settingsScreen');
			url.searchParams.delete('settingsSection');
		});
	}
	pushUrl(mutate) {
		const url = new URL(this.win.location.href);
		mutate(url);
		this.win.history.pushState(null, '', url.pathname + url.search);
		this.win.dispatchEvent(new this.win.PopStateEvent('popstate', {state: null}));
	}
	readProjects({force = false} = {}) {
		if (!this.projectsPromise || force) {
			const prev = this.projectsPromise;
			const run = (prev ? prev.catch(() => {}).then(() => this.fetchProjects(true)) : this.fetchProjects(force)).finally(() => {
				if (run === this.projectsPromise) {
					this.projectsPromise = null;
				}
			});
			this.projectsPromise = run;
		}
		return this.projectsPromise;
	}
	async rpc(method, body) {
		const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(15000)]);
		const response = await this.request(this.service + method, {
			method: 'POST',
			headers: this.headers('application/json'),
			body: JSON.stringify(body),
			signal
		});
		if (!response.ok) {
			throw Error(`${method}: HTTP ${response.status}`);
		}
		const result = await response.json();
		if (!result || 'object' !== typeof result || Array.isArray(result)) {
			throw Error(`${method}: invalid response schema`);
		}
		if ('CreateProject' === method || 'UpdateProject' === method) {
			this.cachedProjects = null;
		}
		return result;
	}
	selection() {
		const url = new URL(this.win.location.href);
		const match = /^\/c\/([^/]+)\/?$/.exec(url.pathname);
		return {projectId: url.searchParams.get('section'), conversationId: match ? decodeURIComponent(match[1]) : null};
	}
	async start() {
		await this.readProjects({force: true});
		void this.stream.watch();
		this.poll = setInterval(() => {
			if (!this.stopped) {
				this.readProjects().catch(error => this.onStatus('projects', error.message));
			}
		}, 5000);
	}
	async updateConversation(id, annotations) {
		if (!this.summaries.get(id)) {
			throw Error('Conversation is not present in the current snapshot');
		}
		await this.rpc('UpdateConversationAnnotations', {cascadeIds: [id], annotations, mergeAnnotations: true});
		const latest = this.summaries.get(id);
		if (latest) {
			const summary = {...structuredClone(latest), annotations: {...structuredClone(latest.annotations || {}), ...annotations}};
			this.summaries = this.model.applySummaryUpdate(this.summaries, {updates: {[id]: summary}});
			this.onSummaries(this.summaries);
		}
	}
	validateProjectIds(listed) {
		const ids = listed.projectIds || [];
		if (!Array.isArray(ids) || ids.some(id => 'string' !== typeof id || !id)) {
			throw Error('ListProjects: projectIds contract changed');
		}
		if (ids.length !== new Set(ids).size) {
			throw Error('ListProjects: duplicate project IDs');
		}
		if (!ids.length && Object.keys(listed).some(key => 'projectIds' !== key)) {
			throw Error('ListProjects: unknown project list schema');
		}
		return ids;
	}
	validateProjects(ids, result) {
		const projects = result.projects || [];
		if (!Array.isArray(projects) || projects.some(project => !project || 'string' !== typeof project.id || !project.id || (undefined !== project.name && 'string' !== typeof project.name))) {
			throw Error('ReadProjects: project schema changed');
		}
		if (ids.length !== projects.length) {
			throw Error(`ReadProjects: expected ${ids.length} projects, received ${projects.length}; refusing to hide missing projects`);
		}
		if (ids.length !== new Set(projects.map(project => project.id)).size || projects.some(project => !ids.includes(project.id))) {
			throw Error('ReadProjects: project IDs do not match the request');
		}
		return projects;
	}
}
class ConnectSummaryStream {
	constructor({headers, lifetime, model, onStatus, onSummaries, request, url}) {
		Object.assign(this, {headers, lifetime, model, onStatus, onSummaries, request, retryDelay: 1000, stopped: false, url});
	}
	appendChunk(pending, value) {
		const buffer = new Uint8Array(pending.length + value.length);
		buffer.set(pending);
		buffer.set(value, pending.length);
		return buffer;
	}
	decodeFrames(pending, onFrame) {
		let r = pending;
		while (5 <= r.length) {
			const size = new DataView(r.buffer, r.byteOffset).getUint32(1);
			if (32 * 1024 * 1024 < size) {
				throw Error('Conversation stream frame exceeds contract limit');
			}
			if (5 + size > r.length) {
				break;
			}
			const flags = r[0];
			const message = JSON.parse(new TextDecoder().decode(r.subarray(5, 5 + size)));
			r = r.subarray(5 + size);
			if (0 !== flags) {
				throw Error(message.error?.message || 'Conversation stream ended or changed encoding');
			}
			onFrame(message);
		}
		return r;
	}
	dispose() {
		this.stopped = true;
	}
	static encodeFrame(value = {}) {
		const data = 'string' === typeof value ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new TextEncoder().encode(JSON.stringify(value));
		const frame = new Uint8Array(5 + data.length);
		new DataView(frame.buffer).setUint32(1, data.length);
		frame.set(data, 5);
		return frame;
	}
	async readOnce() {
		const response = await this.request(this.url, {
			method: 'POST',
			headers: this.headers('application/connect+json'),
			body: ConnectSummaryStream.encodeFrame(),
			signal: this.lifetime.signal
		});
		if (!response.ok || !response.headers.get('content-type')?.startsWith('application/connect+json')) {
			throw Error(`Conversation stream: HTTP ${response.status}, incompatible content type`);
		}
		const reader = response.body.getReader();
		let incoming = new Map();
		let pending = new Uint8Array(0);
		try {
			while (!this.stopped) {
				const {done, value} = await reader.read();
				if (done) {
					throw Error('Conversation stream disconnected');
				}
				pending = this.decodeFrames(this.appendChunk(pending, value), message => {
					incoming = this.model.applySummaryUpdate(incoming, message);
					this.retryDelay = 1000;
					this.onSummaries(incoming);
					this.onStatus('conversations', null);
				});
			}
		}
		finally {
			await reader.cancel().catch(() => {});
		}
	}
	waitRetry() {
		return this.lifetime.signal.aborted ? Promise.resolve() : new Promise(resolve => {
			const guard = new AbortController();
			const timer = setTimeout(() => (guard.abort(), resolve()), this.retryDelay);
			this.lifetime.signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), {once: true, signal: guard.signal});
		});
	}
	async watch() {
		while (!this.stopped) {
			try {
				await this.readOnce();
			}
			catch (error) {
				if (this.stopped) {
					break;
				}
				this.onStatus('conversations', error.message);
			}
			await this.waitRetry();
			this.retryDelay = Math.min(this.retryDelay * 2, 30000);
		}
	}
}
const createAdapter = options => new AntigravityAdapter(options);
Object.assign(createAdapter, {AntigravityAdapter, ConnectSummaryStream});
module.exports = createAdapter;
