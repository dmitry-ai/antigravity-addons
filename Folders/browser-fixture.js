// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace msedge fallback with chrome-headless-shell/chrome, share browser instance across subtests, and enforce teardown on test timeout":
// https://github.com/dmitry-ai/antigravity-addons/issues/18
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders UI layer (folders-client.js and folders-view.js) with unified modal builder, direct selection lookup, and removal of non-CDP fallbacks":
// https://github.com/dmitry-ai/antigravity-addons/issues/30
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Unify Folders domain validation, tree traversal helpers, store checks, and CLI listing/mutations around folders-model.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/31
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace Less build pipeline and tracked CSS/style.css with native Chromium CSS concatenated in memory":
// https://github.com/dmitry-ai/antigravity-addons/issues/43
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Consolidate Folders module loader, tree indexer, declarative DOM helper, and CAS store/CLI wrappers":
// https://github.com/dmitry-ai/antigravity-addons/issues/44
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('../Upgrade/node_modules/playwright-core');
const {styleSheet: cssStyleSheet} = require('../CSS/cdp-runtime');
const {rendererSource, styleSheet: foldersStyleSheet} = require('./cdp-runtime');
const {applyAction} = require('./folders-model');
const BROWSER_ARGS = [
	'--disable-background-networking',
	'--disable-renderer-backgrounding',
	'--no-first-run',
	'--no-default-browser-check'
];
const resolveHeadlessShell = () => {
	let r = null;
	const binary = 'win32' === process.platform ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
	const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
	for (const dir of pathDirs) {
		const candidate = path.join(dir, binary);
		if (fs.existsSync(candidate)) {
			r = candidate;
			break;
		}
	}
	const toolsRoot = 'C:/tools/chrome-headless-shell';
	if (!r && fs.existsSync(toolsRoot)) {
		const versions = fs.readdirSync(toolsRoot).sort().reverse();
		for (const version of versions) {
			const candidate = path.join(toolsRoot, version, binary);
			if (fs.existsSync(candidate)) {
				r = candidate;
				break;
			}
		}
	}
	return r;
};
const resolveLaunchOptions = () => {
	let r;
	const envBrowser = process.env.FOLDERS_TEST_BROWSER;
	const headlessShell = envBrowser ? null : resolveHeadlessShell();
	if (envBrowser) {
		r = {headless: true, executablePath: envBrowser, args: BROWSER_ARGS};
	}
	else if (headlessShell) {
		r = {headless: true, executablePath: headlessShell, args: BROWSER_ARGS};
	}
	else if ('win32' === process.platform) {
		r = {headless: true, channel: 'chrome', args: BROWSER_ARGS};
	}
	else {
		r = {headless: true, args: BROWSER_ARGS};
	}
	return r;
};
let sharedBrowser = null;
const getSharedBrowser = async () => {
	if (!sharedBrowser || !sharedBrowser.isConnected()) {
		sharedBrowser = await chromium.launch(resolveLaunchOptions());
	}
	return sharedBrowser;
};
const closeSharedBrowser = async () => {
	const current = sharedBrowser;
	sharedBrowser = null;
	if (current) {
		await current.close().catch(() => {});
	}
};
const openFixture = async ({
	data,
	projects,
	summaries = {},
	missingAnchor = false,
	badProjects = false,
	delayedAnchor = false,
	bootingShell = false,
	context = null
} = {}) => {
	const browser = await getSharedBrowser();
	const browserContext = await browser.newContext({viewport: {width: 900, height: 700}});
	let closed = false;
	const close = async () => {
		if (!closed) {
			closed = true;
			await browserContext.close().catch(() => {});
		}
	};
	if (context?.signal) {
		if (context.signal.aborted) {
			await close();
			throw context.signal.reason || Error('Fixture aborted before page setup');
		}
		context.signal.addEventListener('abort', () => {
			close();
		}, {once: true});
	}
	if ('function' === typeof context?.after) {
		context.after(() => close());
	}
	try {
		const page = await browserContext.newPage();
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		const body = bootingShell
			? '<div id="root"><div class="w-full h-full flex items-center justify-center">Loading auth...</div></div><textarea id="untouched-draft" style="position:absolute;left:400px;top:50px">Unsaved draft</textarea>'
			: `<nav role="navigation" style="position:relative;width:340px;height:680px"><div data-testid="${missingAnchor || delayedAnchor ? 'changed-sidebar-contract' : 'conversation-list-sidebar'}" style="height:100%"><article class="new-future-vendor-class">Native project list</article></div></nav><textarea id="untouched-draft" style="position:absolute;left:400px;top:50px">Unsaved draft</textarea>`;
		await page.route('https://folders-fixture.invalid/**', route => route.fulfill({
			contentType: 'text/html',
			body: `<!doctype html><html><head></head><body style="margin:0">${body}</body></html>`
		}));
		await page.exposeFunction('__foldersFixtureApply', applyAction);
		await page.addInitScript(({data, projects, summaries, badProjects}) => {
			window.__APP_CONFIG__ = {csrfToken: 'isolated-fixture', appVersion: 'future-fixture'};
			const fixture = window.__foldersFixture = {
				data,
				projects,
				summaries,
				calls: [],
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
				if ('ListProjects' === method) {
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
					const body = message.body || {};
					fixture.calls.push({method: 'project-folders', body});
					if ('POST' !== message.method) {
						r = {schemaVersion: 2, data: fixture.data, revision: String(fixture.revision)};
					}
					else {
						fixture.data = await window.__foldersFixtureApply(fixture.data, body);
						fixture.revision++;
						r = {
							success: true,
							schemaVersion: 2,
							data: fixture.data,
							revision: String(fixture.revision)
						};
					}
				}
				return r;
			};
		}, {data, projects, summaries, badProjects});
		await page.goto('https://folders-fixture.invalid/');
		await page.addStyleTag({content: `${cssStyleSheet()}\n${foldersStyleSheet()}`});
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
		return {browser, browserContext, page, errors, close};
	}
	catch (error) {
		await close();
		throw error;
	}
};
module.exports = {openFixture, closeSharedBrowser, resolveLaunchOptions};
