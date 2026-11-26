// 2026-11-26 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Keep composer send button visible with long input under elevated zoom":
// https://github.com/dmitry-ai/antigravity-addons/issues/70
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const BROWSER_ARGS = ['--disable-background-networking', '--disable-renderer-backgrounding', '--no-first-run', '--no-default-browser-check'];
const LONG_LINES = Array.from({length: 40}, (_, index) => `Line ${index + 1}: long user prompt text under elevated zoom`).join('\n');
const SHORT_LINES = 'Line 1\nLine 2\nLine 3';
const resolvePlaywright = () => {
	let r = null;
	const candidates = [path.join(__dirname, '../Upgrade/node_modules/playwright-core')];
	const gitEntry = path.join(__dirname, '../.git');
	if (fs.existsSync(gitEntry) && fs.statSync(gitEntry).isFile()) {
		const match = fs.readFileSync(gitEntry, 'utf8').match(/^gitdir:\s*(.+)$/m);
		if (match) {
			candidates.push(path.resolve(path.dirname(gitEntry), match[1].trim(), '../../..', 'Upgrade/node_modules/playwright-core'));
		}
	}
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			r = require(candidate);
			break;
		}
	}
	if (!r) {
		throw Error('playwright-core was not found in Upgrade/node_modules');
	}
	return r;
};
const {chromium} = resolvePlaywright();
const {styleSheet: cssStyleSheet} = require('./cdp-runtime');
const resolveLaunchOptions = () => {
	let r = {args: BROWSER_ARGS, headless: true};
	const envBrowser = process.env.FOLDERS_TEST_BROWSER;
	if (envBrowser) {
		r = {args: BROWSER_ARGS, executablePath: envBrowser, headless: true};
	}
	else {
		const binary = 'win32' === process.platform ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
		let found = null;
		for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
			const candidate = path.join(dir, binary);
			if (fs.existsSync(candidate)) {
				found = candidate;
				break;
			}
		}
		const toolsRoot = 'C:/tools/chrome-headless-shell';
		if (!found && fs.existsSync(toolsRoot)) {
			for (const version of fs.readdirSync(toolsRoot).sort().reverse()) {
				const candidate = path.join(toolsRoot, version, binary);
				if (fs.existsSync(candidate)) {
					found = candidate;
					break;
				}
			}
		}
		if (found) {
			r = {args: BROWSER_ARGS, executablePath: found, headless: true};
		}
		else if ('win32' === process.platform) {
			r = {args: BROWSER_ARGS, channel: 'chrome', headless: true};
		}
	}
	return r;
};
let sharedBrowser = null;
const getBrowser = async () => {
	if (!sharedBrowser || !sharedBrowser.isConnected()) {
		sharedBrowser = await chromium.launch(resolveLaunchOptions());
	}
	return sharedBrowser;
};
test.after(async () => {
	const current = sharedBrowser;
	sharedBrowser = null;
	if (current) {
		await current.close().catch(() => {});
	}
});
const NATIVE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; font-family: system-ui, sans-serif; font-size: 14px; line-height: 20px; }
.relative { position: relative; }
.absolute { position: absolute; }
.inset-y-0 { top: 0; bottom: 0; }
.left-0 { left: 0; }
.left-2 { left: 8px; }
.right-2 { right: 8px; }
.top-2 { top: 8px; }
.bottom-full { bottom: 100%; }
.z-10 { z-index: 10; }
.isolate { isolation: isolate; }
.flex { display: flex; }
.grid { display: grid; }
.contents { display: contents; }
.flex-col { flex-direction: column; }
.flex-wrap { flex-wrap: wrap; }
.flex-1 { flex: 1 1 0%; }
.flex-grow { flex-grow: 1; }
.basis-0 { flex-basis: 0px; }
.shrink { flex-shrink: 1; }
.shrink-0, .flex-shrink-0 { flex-shrink: 0; }
.items-center { align-items: center; }
.justify-between { justify-content: space-between; }
.justify-center { justify-content: center; }
.self-stretch { align-self: stretch; }
.w-full { width: 100%; }
.w-7 { width: 28px; }
.h-full { height: 100%; }
.h-fit { height: fit-content; }
.h-7 { height: 28px; }
.h-16 { height: 64px; }
.min-h-0 { min-height: 0px; }
.min-w-0 { min-width: 0px; }
.max-h-full { max-height: 100%; }
.max-h-300 { max-height: 300px; }
.overflow-hidden { overflow: hidden; }
.overflow-x-hidden { overflow-x: hidden; }
.overflow-y-auto { overflow-y: auto; }
.p-px { padding: 1px; }
.p-0\\.5 { padding: 2px; }
.p-1 { padding: 4px; }
.p-2 { padding: 8px; }
.px-4 { padding-inline: 16px; }
.py-1 { padding-block: 4px; }
.pt-6 { padding-top: 24px; }
.pb-4 { padding-bottom: 16px; }
.pb-6 { padding-bottom: 24px; }
.pl-1 { padding-left: 4px; }
.pr-2 { padding-right: 8px; }
.gap-0 { gap: 0px; }
.gap-1 { gap: 4px; }
.gap-2 { gap: 8px; }
.gap-6 { gap: 24px; }
.mt-auto { margin-top: auto; }
.-mb-6 { margin-bottom: -24px; }
.leading-6 { line-height: 24px; }
.rounded-2xl { border-radius: 16px; }
.rounded-lg { border-radius: 8px; }
.rounded-md { border-radius: 6px; }
.rounded-full { border-radius: 9999px; }
.border-b { border-bottom: 1px solid #d4d4d8; }
.text-3xl { font-size: 30px; line-height: 36px; margin: 0; }
.bg-card { background: #ffffff; }
.bg-card-border { background: #e4e4e7; }
.bg-primary { background: #2563eb; color: #ffffff; border: 0; }
.pointer-events-none { pointer-events: none; }
.shell { display: flex; flex-direction: column; height: 100%; }
.chrome-header { flex-shrink: 0; height: 70px; }
.pane-host { flex: 1 1 0%; min-height: 0; overflow: hidden; }
.toolbar-pill { height: 32px; display: inline-flex; align-items: center; padding: 4px 8px; }
.attachment-thumb { width: 88px; height: 56px; background: #cbd5e1; border-radius: 6px; }
`;
const buildComposerMarkup = ({attachments = 0, text = '', topToolbar = false} = {}) => {
	const topBarHtml = topToolbar
		? `<div class="grid" style="grid-template-rows: 1fr;"><div class="min-h-0 overflow-hidden"><div class="h-fit"><div data-testid="input-box-bottom-toolbar" class="relative z-10 flex w-full items-center justify-between py-1 gap-2 pl-1 pr-2"><div class="flex items-center gap-1 min-w-0 flex-1"><button type="button" class="toolbar-pill">This Computer</button><button type="button" class="toolbar-pill">Harness</button><button type="button" class="toolbar-pill">main</button></div></div></div></div></div>`
		: '';
	const attachmentsHtml = 0 < attachments
		? `<div class="flex items-center flex-wrap gap-1 border-b p-1">${Array.from({length: attachments}, (_, index) => `<div class="attachment-thumb">img-${index + 1}</div>`).join('')}</div>`
		: '';
	const linesHtml = text
		? text.split('\n').map(line => `<p style="margin: 0;">${line}</p>`).join('')
		: '<p style="margin: 0;"><br></p>';
	return `<div class="relative z-10 flex flex-col gap-1 min-h-0"><div class="contents"><div data-testid="agent-input-box" class="flex flex-col w-full shrink-0"><div class="surface-composer relative flex flex-col p-px rounded-2xl bg-card-border">${topBarHtml}<div class="surface-composer-card relative z-10 flex flex-col gap-0 p-1 rounded-2xl bg-card"><div class="relative w-full">${attachmentsHtml}<div class="w-full rounded-lg"><div class="relative w-full"><div class="relative w-full"><div contenteditable="true" aria-label="Message input" class="max-h-300 rounded-md overflow-x-hidden overflow-y-auto leading-6 p-2" style="white-space: pre-wrap; word-break: break-word;">${linesHtml}</div><p class="pointer-events-none absolute left-2 right-2 top-2" style="margin: 0;">Ask anything</p><div data-mention-menu="" class="absolute left-0 bottom-full" style="height: 60px; width: 200px;"></div></div></div></div></div><div class="agy-composer-footer flex w-full items-center justify-between gap-1 p-0.5"><div class="flex min-w-0 flex-1 items-center gap-1"><button type="button" aria-label="Add context" class="w-7 h-7 rounded-full">+</button><button type="button" data-testid="model-selector-trigger">Gemini 4 Neon</button></div><div class="shrink-0 flex items-center gap-1"><button type="button" data-testid="permissions-selector-trigger">Turbo</button><button type="button" aria-label="Send message" data-testid="send-button" class="agy-send-button flex items-center justify-center w-7 h-7 rounded-full bg-primary">-></button></div></div></div></div></div></div></div>`;
};
const buildHomeHtml = options => `<div class="shell"><div class="chrome-header"></div><div class="pane-host"><div class="agy-home relative isolate w-full h-full flex"><div data-media-drop-scope="" class="w-full h-full flex flex-col items-center overflow-hidden"><div class="w-full flex-1 min-h-0 overflow-y-auto flex flex-col items-center px-4 gap-6 pt-6 pb-4"><div aria-hidden="true" class="shrink min-h-0 -mb-6" style="flex-basis: clamp(72px, calc(32vh - 66px), 264px);"></div><div data-testid="home-greeting" class="flex flex-col items-center"><h1 class="home-greeting-title text-3xl">Welcome back, Dmitrii. Where should we pick up?</h1></div><div class="mt-auto flex flex-col gap-3 w-full"></div></div><div class="z-10 shrink-0 w-full flex flex-col items-center px-4 pb-6"><div class="flex flex-col gap-2 w-full" style="max-width: 768px;"><div class="relative w-full">${buildComposerMarkup({...options, topToolbar: true})}</div></div></div></div></div></div></div>`;
const buildConversationHtml = ({paneHeight = null, ...options} = {}) => `<div class="shell"><div class="chrome-header"></div><div class="pane-host" ${paneHeight ? `style="flex: none; height: ${paneHeight}px;"` : ''}><div data-testid="conversation-view" data-media-drop-scope="" class="w-full flex h-full min-h-0 flex-col items-center relative overflow-y-auto"><div class="relative self-stretch flex-grow basis-0 min-h-0"><div data-testid="autoscroll-viewport" class="h-full overflow-y-auto"><p>Earlier assistant reply</p></div></div><div class="relative w-full px-4 pb-4 flex-shrink-0 flex flex-col items-center gap-2 max-h-full min-h-0"><div class="w-full flex flex-col min-h-0" style="max-width: 768px;"><div class="flex flex-col w-full gap-2 min-h-0"><div class="flex flex-col w-full gap-2 min-h-0">${buildComposerMarkup({...options, topToolbar: false})}</div></div></div></div></div></div></div>`;
const openFixture = async (context, {html, viewport}) => {
	const browser = await getBrowser();
	const browserContext = await browser.newContext({viewport});
	context.after(() => browserContext.close().catch(() => {}));
	const page = await browserContext.newPage();
	await page.setContent(`<!doctype html><html><head><style>${NATIVE_CSS}</style></head><body><div id="root">${html}</div></body></html>`);
	await page.addStyleTag({content: cssStyleSheet()});
	return page;
};
const measureLayout = async page => page.evaluate(() => {
	const rect = selector => {
		const el = document.querySelector(selector);
		let r = null;
		if (el) {
			const box = el.getBoundingClientRect();
			const cs = getComputedStyle(el);
			r = {
				bottom: box.bottom,
				clientHeight: el.clientHeight,
				height: box.height,
				maxHeight: cs.maxHeight,
				overflowY: cs.overflowY,
				scrollHeight: el.scrollHeight,
				top: box.top,
				width: box.width
			};
		}
		return r;
	};
	return {
		autoscroll: rect('[data-testid="autoscroll-viewport"]'),
		composer: rect('[data-testid="agent-input-box"]'),
		convView: rect('[data-testid="conversation-view"]'),
		editor: rect('[data-testid="agent-input-box"] [contenteditable="true"]'),
		footer: rect('.agy-composer-footer'),
		pane: rect('.pane-host'),
		sendButton: rect('[data-testid="send-button"]'),
		surfaceComposer: rect('.surface-composer'),
		surfaceComposerCard: rect('.surface-composer-card'),
		topToolbar: rect('[data-testid="input-box-bottom-toolbar"]'),
		viewportHeight: window.innerHeight
	};
});
test('Home composer keeps send button and footer inside viewport with long input across elevated zoom viewports', async context => {
	for (const scenario of [
		{attachments: 0, label: '144% zoom (888x462)', viewport: {height: 462, width: 888}},
		{attachments: 2, label: '144% zoom with attachments (888x462)', viewport: {height: 462, width: 888}},
		{attachments: 0, label: '172% zoom (744x385)', viewport: {height: 385, width: 744}},
		{attachments: 0, label: '200% zoom (640x333)', viewport: {height: 333, width: 640}}
	]) {
		const page = await openFixture(context, {
			html: buildHomeHtml({attachments: scenario.attachments, text: LONG_LINES}),
			viewport: scenario.viewport
		});
		const m = await measureLayout(page);
		assert.ok(26 <= m.sendButton.height && 26 <= m.sendButton.width, `${scenario.label}: send button was squished (${JSON.stringify(m.sendButton)})`);
		assert.ok(m.pane.top <= m.sendButton.top && m.sendButton.bottom <= m.pane.bottom + 0.5, `${scenario.label}: send button clipped outside pane (${JSON.stringify({pane: m.pane, sendButton: m.sendButton})})`);
		assert.ok(m.sendButton.bottom <= m.viewportHeight + 0.5, `${scenario.label}: send button pushed past viewport bottom`);
		assert.ok(m.footer.bottom <= m.pane.bottom + 0.5, `${scenario.label}: composer footer clipped outside pane`);
		assert.ok(24 <= m.topToolbar.height, `${scenario.label}: top toolbar was squished`);
		assert.ok(m.editor.scrollHeight > m.editor.clientHeight, `${scenario.label}: editor must scroll internally`);
		assert.ok(36 <= m.editor.clientHeight, `${scenario.label}: editor height collapsed too far (${m.editor.clientHeight})`);
	}
	const shortPage = await openFixture(context, {
		html: buildHomeHtml({text: SHORT_LINES}),
		viewport: {height: 462, width: 888}
	});
	const shortMetrics = await measureLayout(shortPage);
	assert.ok(220 > shortMetrics.composer.height, `Short prompt stretched composer unnecessarily (${shortMetrics.composer.height})`);
	assert.ok(shortMetrics.sendButton.bottom <= shortMetrics.pane.bottom + 0.5);
});
test('Conversation view keeps send button visible under elevated zoom, attachments, and split-height panes without overflowing outer container', async context => {
	for (const scenario of [
		{attachments: 0, label: '144% zoom long text', minHistory: 60, paneHeight: null, viewport: {height: 462, width: 888}},
		{attachments: 2, label: '144% zoom long text + attachments', minHistory: 0, paneHeight: null, viewport: {height: 462, width: 888}},
		{attachments: 0, label: '200% zoom long text', minHistory: 60, paneHeight: null, viewport: {height: 333, width: 640}},
		{attachments: 0, label: 'Split-height pane (220px) inside 888x462', minHistory: 0, paneHeight: 220, viewport: {height: 462, width: 888}}
	]) {
		const page = await openFixture(context, {
			html: buildConversationHtml({attachments: scenario.attachments, paneHeight: scenario.paneHeight, text: LONG_LINES}),
			viewport: scenario.viewport
		});
		const m = await measureLayout(page);
		assert.ok(26 <= m.sendButton.height && 26 <= m.sendButton.width, `${scenario.label}: send button was squished`);
		assert.ok(m.convView.top <= m.sendButton.top && m.sendButton.bottom <= m.convView.bottom + 0.5, `${scenario.label}: send button clipped outside conversation-view (${JSON.stringify({convView: m.convView, sendButton: m.sendButton})})`);
		assert.ok(m.sendButton.bottom <= m.viewportHeight + 0.5, `${scenario.label}: send button past viewport bottom`);
		assert.ok(m.convView.scrollHeight <= m.convView.clientHeight + 1, `${scenario.label}: conversation-view overflowed vertically (${m.convView.scrollHeight} > ${m.convView.clientHeight})`);
		assert.ok(m.editor.scrollHeight > m.editor.clientHeight, `${scenario.label}: editor must scroll internally`);
		if (0 < scenario.minHistory) {
			assert.ok(scenario.minHistory <= m.autoscroll.height, `${scenario.label}: conversation history squeezed to ${m.autoscroll.height}px`);
		}
	}
});
test('Default 100% zoom preserves 300px editor ceiling and keeps composer overflow visible for popups', async context => {
	const page = await openFixture(context, {
		html: buildHomeHtml({text: LONG_LINES}),
		viewport: {height: 666, width: 1280}
	});
	const m = await measureLayout(page);
	assert.equal(m.editor.maxHeight, '300px');
	assert.ok(m.sendButton.bottom <= m.pane.bottom + 0.5);
	assert.equal(m.surfaceComposer.overflowY, 'visible');
	assert.equal(m.surfaceComposerCard.overflowY, 'visible');
});
