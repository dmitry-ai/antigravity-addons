// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('../Upgrade/node_modules/playwright-core');
const {rendererSource} = require('./renderer-source');
const openFixture = async ({
	data,
	projects,
	summaries = {},
	missingAnchor = false,
	badProjects = false,
	delayedAnchor = false,
	bootingShell = false
} = {}) => {
	const browser = await chromium.launch({
		headless: true,
		...(process.env.FOLDERS_TEST_BROWSER
			? {executablePath: process.env.FOLDERS_TEST_BROWSER}
			: 'win32' === process.platform
				? {channel: 'msedge'}
				: {})
	});
	const page = await browser.newPage({viewport: {width: 900, height: 700}});
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	const body = bootingShell
		? '<div id="root"><div class="w-full h-full flex items-center justify-center">Loading auth...</div></div><textarea id="untouched-draft" style="position:absolute;left:400px;top:50px">Unsaved draft</textarea>'
		: `<nav role="navigation" style="position:relative;width:340px;height:680px"><div data-testid="${missingAnchor || delayedAnchor ? 'changed-sidebar-contract' : 'conversation-list-sidebar'}" style="height:100%"><article class="new-future-vendor-class">Native project list</article></div></nav><textarea id="untouched-draft" style="position:absolute;left:400px;top:50px">Unsaved draft</textarea>`;
	await page.route('https://folders-fixture.invalid/**', route => route.fulfill({
		contentType: 'text/html',
		body: `<!doctype html><html><head></head><body style="margin:0">${body}</body></html>`
	}));
	await page.addInitScript(({data, projects, summaries, badProjects}) => {
		window.__APP_CONFIG__ = {csrfToken: 'isolated-fixture', appVersion: 'future-fixture'};
		const fixture = window.__foldersFixture = {
			data,
			projects,
			summaries,
			calls: [],
			storage: {},
			listeners: new Set(),
			streams: new Set(),
			revision: 1,
			observers: [],
			badProjects
		};
		const NativeObserver = window.MutationObserver;
		window.MutationObserver = class extends NativeObserver {
			constructor(callback) {
				const record = {calls: 0, burst: 0, since: performance.now(), callback: callback.toString().slice(0, 120)};
				super((changes, observer) => {
					record.calls++;
					if (100 < performance.now() - record.since) {
						record.burst = 0;
						record.since = performance.now();
					}
					if (200 < ++record.burst) {
						observer.disconnect();
						fixture.observerRunaway = true;
						throw Error('Mutation observer did not settle: ' + record.callback);
					}
					callback(changes, observer);
				});
				fixture.observers.push(record);
			}
		};
		window.nativeStorage = {
			getItems: async () => structuredClone(fixture.storage),
			updateItems: async changes => {
				Object.assign(fixture.storage, changes);
				for (const listener of fixture.listeners) {
					listener(changes);
				}
			},
			onChanged: listener => {
				fixture.listeners.add(listener);
				return () => fixture.listeners.delete(listener);
			}
		};
		window.dialog = {showOpenDialog: async () => 'C:\\fixture\\project'};
		const frame = message => {
			const body = new TextEncoder().encode(JSON.stringify(message));
			const result = new Uint8Array(5 + body.length);
			new DataView(result.buffer).setUint32(1, body.length);
			result.set(body, 5);
			return result;
		};
		fixture.emit = message => {
			for (const stream of fixture.streams) {
				stream.enqueue(frame(message));
			}
		};
		window.fetch = async (url, options = {}) => {
			let r;
			const method = String(url).split('/').at(-1);
			let body = {};
			if ('string' === typeof options.body) {
				body = JSON.parse(options.body);
			}
			fixture.calls.push({method, body});
			if ('project-folders' === method) {
				if ('POST' !== options.method) {
					r = Response.json({schemaVersion: 2, data: fixture.data, revision: String(fixture.revision)});
				}
				else {
					try {
						fixture.data = window.AntigravityFoldersModel.applyAction(fixture.data, body);
						fixture.revision++;
						r = Response.json({
							success: true,
							schemaVersion: 2,
							data: fixture.data,
							revision: String(fixture.revision)
						});
					}
					catch (error) {
						r = Response.json({success: false, error: error.message}, {status: 400});
					}
				}
			}
			else if ('ListProjects' === method) {
				r = Response.json(
					fixture.badProjects
						? {changedProjectSchema: []}
						: {projectIds: fixture.projects.map(project => project.id)}
				);
			}
			else if ('ReadProjects' === method) {
				r = Response.json({projects: fixture.projects.filter(project => body.ids.includes(project.id))});
			}
			else if ('CreateProject' === method) {
				fixture.projects.push(body.project);
				r = Response.json({});
			}
			else if ('UpdateConversationAnnotations' === method) {
				for (const id of body.cascadeIds) {
					const summary = fixture.summaries[id];
					if (!summary) {
						throw Error('Conversation not found');
					}
					summary.annotations = {...summary.annotations, ...body.annotations};
					fixture.emit({updates: {[id]: summary}});
				}
				r = Response.json({});
			}
			else if ('JetboxSubscribeToSummaries' === method) {
				let controller;
				const stream = new ReadableStream({
					start(value) {
						controller = value;
						fixture.streams.add(value);
						value.enqueue(frame({updates: fixture.summaries}));
					},
					cancel() {
						fixture.streams.delete(controller);
					}
				});
				options.signal.addEventListener('abort', () => {
					fixture.streams.delete(controller);
					try {
						controller.close();
					}
					catch {}
				}, {once: true});
				r = new Response(stream, {headers: {'content-type': 'application/connect+json'}});
			}
			else {
				r = new Response('Unknown fixture method', {status: 404});
			}
			return r;
		};
		window.__ANTIGRAVITY_TOOLS_REQUEST__ = async (tool, message) => {
			let r;
			if ('folders' !== tool) {
				throw Error('Unknown fixture tool');
			}
			if ('GET_VIEW_STATE' === message.method) {
				r = fixture.viewState || {schemaVersion: 1};
			}
			else if ('SET_VIEW_STATE' === message.method) {
				fixture.viewState = {schemaVersion: 1, ...message.body};
				window.dispatchEvent(new CustomEvent('antigravity-folders-view-state', {detail: fixture.viewState}));
				r = fixture.viewState;
			}
			else {
				const response = await window.fetch('/api/project-folders', {
					method: message.method,
					body: message.body ? JSON.stringify(message.body) : undefined
				});
				const result = await response.json();
				if (!response.ok || result.error) {
					throw Error(result.error || 'Fixture request failed');
				}
				r = result;
			}
			return r;
		};
	}, {data, projects, summaries, badProjects});
	await page.goto('https://folders-fixture.invalid/');
	await page.addStyleTag({content: fs.readFileSync(path.resolve(__dirname, '../CSS/style.css'), 'utf8')});
	await page.addScriptTag({content: rendererSource(data) + '\n//# sourceURL=folders-runtime-fixture.js'});
	if (delayedAnchor) {
		await page.evaluate(() => {
			setTimeout(() => {
				const old = document.querySelector('[data-testid="changed-sidebar-contract"]');
				const next = old.cloneNode(true);
				next.dataset.testid = 'conversation-list-sidebar';
				old.replaceWith(next);
			}, 500);
		});
	}
	return {
		browser,
		page,
		errors,
		async close() {
			await browser.close();
		}
	};
};
module.exports = {openFixture};
