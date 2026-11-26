// 2026-11-25 Dmitrii Fediuk https://github.com/dmitrii-fediuk
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
/**
 * @used-by {@link import('./browser.test.js')}
 */
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
const {styleSheet: cssStyleSheet} = require('../CSS/cdp-runtime');
const {rendererSource, styleSheet: badgesStyleSheet} = require('./cdp-runtime');
const BROWSER_ARGS = ['--disable-background-networking', '--disable-renderer-backgrounding', '--no-first-run', '--no-default-browser-check'];
/**
 * @used-by {@link getBrowser}
 * @used-by {@link import('./browser.test.js')}
 */
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
/**
 * @used-by {@link import('./browser.test.js')}
 * @used-by {@link openFixture}
 */
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
/**
 * @used-by {@link import('./browser.test.js')}
 */
const openFixture = async (context, {badges = ['app-update'], updaterState = {type: 'ready', update: {version: '2.35.2'}}} = {}) => {
	const browser = await getBrowser();
	const browserContext = await browser.newContext({viewport: {width: 1000, height: 700}});
	context.after(() => browserContext.close().catch(() => {}));
	const page = await browserContext.newPage();
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.route('https://badges-fixture.invalid/**', route => route.fulfill({
		contentType: 'text/html',
		body: `<!doctype html><html><head><style>
			body { margin: 0; font-family: system-ui, sans-serif; }
			.relative { position: relative; }
			.absolute { position: absolute; }
			.flex { display: flex; }
			.items-center { align-items: center; }
			.justify-between { justify-content: space-between; }
			.rounded-full { border-radius: 9999px; }
			.bg-primary { background: #2563eb; color: #fff; }
			.bg-secondary { background: #e5e7eb; color: #111; }
			.cursor-pointer { cursor: pointer; }
			.cursor-default { cursor: default; }
			.px-3 { padding-inline: 12px; }
			.h-7 { height: 28px; }
			.w-7 { width: 28px; }
		</style></head><body><div id="root"></div></body></html>`
	}));
	await page.addInitScript(({badges, updaterState}) => {
		const fixture = window.__badgesFixture = {
			badges: [...badges],
			clicks: [],
			dismissed: 0,
			openMenu: null,
			observers: [],
			updaterState,
			updaterListeners: []
		};
		const NativeObserver = window.MutationObserver;
		window.MutationObserver = class extends NativeObserver {
			constructor(callback) {
				const rec = {calls: 0, targets: []};
				super((records, observer) => {
					rec.calls++;
					callback(records, observer);
				});
				const origObserve = this.observe.bind(this);
				this.observe = (target, opts) => {
					rec.targets.push(target?.getAttribute?.('data-testid') || target?.getAttribute?.('data-main-content-header') || target?.tagName || 'unknown');
					return origObserve(target, opts);
				};
				fixture.observers.push(rec);
			}
		};
		window.electronUpdater = {
			getState: async () => fixture.updaterState,
			onStateChanged: cb => {
				fixture.updaterListeners.push(cb);
				return () => {
					const idx = fixture.updaterListeners.indexOf(cb);
					if (0 <= idx) {
						fixture.updaterListeners.splice(idx, 1);
					}
				};
			}
		};
	}, {badges, updaterState});
	await page.goto('https://badges-fixture.invalid/c/test-chat');
	await page.evaluate(() => {
		const fixture = window.__badgesFixture;
		const root = document.getElementById('root');
		const mk = (tag, attrs = {}, text = '') => {
			const el = document.createElement(tag);
			for (const [k, v] of Object.entries(attrs)) {
				el.setAttribute(k, v);
			}
			if (text) {
				el.textContent = text;
			}
			return el;
		};
		const menuBarWrap = mk('div', {class: 'shrink-0', style: 'height: 35px;'});
		const menuBar = mk('div', {'data-testid': 'title-menu-bar', class: 'flex items-center gap-1 px-2 h-full w-full'});
		menuBarWrap.appendChild(menuBar);
		const renderMenu = (title, items) => {
			const wrap = mk('div', {class: 'relative', 'data-menu-wrap': title});
			const btn = mk('button', {type: 'button', 'data-testid': 'title-menu-bar-item', class: 'agy-button'}, title);
			let popup = null;
			const close = () => {
				if (popup) {
					popup.remove();
					popup = null;
				}
				if (fixture.openMenu === title) {
					fixture.openMenu = null;
				}
			};
			const open = () => {
				close();
				fixture.openMenu = title;
				popup = mk('div', {'data-browser-occluder': 'true', class: 'absolute top-full left-0 border rounded shadow-lg py-1 min-w-[225px] z-[8000]'});
				for (const item of items) {
					const row = mk('div');
					const opt = mk('button', {type: 'button', 'data-testid': 'title-menu-bar-option', class: 'w-full px-3 py-1.5 text-left flex justify-between items-center'});
					opt.appendChild(mk('span', {}, item.label));
					if (!item.nonSelectable) {
						opt.addEventListener('click', e => {
							e.stopPropagation();
							fixture.clicks.push(`menu:${item.label}`);
							close();
						});
					}
					row.appendChild(opt);
					popup.appendChild(row);
				}
				wrap.appendChild(popup);
			};
			btn.addEventListener('click', () => {
				if (popup) {
					close();
				}
				else {
					open();
				}
			});
			wrap.appendChild(btn);
			menuBar.appendChild(wrap);
		};
		renderMenu('Antigravity', [{label: 'Version 2.34.0', nonSelectable: true}, {label: 'Check for Updates'}]);
		renderMenu('Workspace', [{label: 'New Conversation'}, {label: 'Create Project'}]);
		const header = mk('div', {'data-main-content-header': 'true', class: 'shrink-0', style: 'height: 40px;'});
		const headerRow = mk('div', {class: 'flex w-full items-center justify-between'});
		const crumb = mk('div', {class: 'flex items-center'}, 'Project / Chat');
		const annSlot = mk('div', {'data-testid': 'titlebar-service-announcement-slot', class: 'flex-1'});
		const toolbar = mk('div', {'data-testid': 'pane-titlebar-toolbar', class: 'flex items-center'});
		const inner = mk('div', {class: 'flex items-center gap-1'});
		toolbar.appendChild(inner);
		headerRow.append(crumb, annSlot, toolbar);
		header.appendChild(headerRow);
		const viewport = mk('div', {'data-testid': 'autoscroll-viewport'});
		root.append(menuBarWrap, header, viewport);
		const renderBadges = () => {
			while (annSlot.firstChild) {
				annSlot.removeChild(annSlot.firstChild);
			}
			while (inner.firstChild) {
				inner.removeChild(inner.firstChild);
			}
			for (const kind of fixture.badges) {
				if ('app-update' === kind) {
					const wrap = mk('div', {class: 'animate-nudge-bounce flex items-center'});
					const btn = mk('div', {role: 'button', 'data-testid': 'app-update-button', class: 'px-3 py-[0.25rem] rounded-full bg-primary text-primary-foreground cursor-pointer'});
					btn.append(mk('span', {}, 'Restart to Update'), mk('span', {}, '→'));
					btn.addEventListener('click', () => fixture.clicks.push('app-update-button'));
					wrap.appendChild(btn);
					inner.appendChild(wrap);
				}
				else if ('app-downloading' === kind) {
					const btn = mk('div', {role: 'button', 'data-testid': 'app-update-button', class: 'px-3 py-[0.25rem] rounded-full bg-secondary text-secondary-foreground cursor-default'});
					btn.append(mk('span', {}, 'Downloading Update'), mk('span', {class: 'update-spinner border-secondary-foreground'}));
					btn.addEventListener('click', () => fixture.clicks.push('app-downloading'));
					inner.appendChild(btn);
				}
				else if ('manual-update' === kind) {
					const btn = mk('div', {role: 'button', 'data-testid': 'manual-update-button', 'aria-label': 'Update Available', class: 'update-nudge update-nudge-pill rounded-full bg-primary cursor-pointer'});
					const lbl = mk('span', {class: 'update-nudge-label'});
					lbl.appendChild(mk('span', {class: 'update-nudge-label-text'}, 'Update Available'));
					btn.appendChild(lbl);
					btn.addEventListener('click', () => fixture.clicks.push('manual-update-button'));
					inner.appendChild(btn);
				}
				else if ('generic-pill' === kind) {
					const btn = mk('div', {role: 'button', class: 'px-3 rounded-full bg-primary cursor-pointer'}, 'New Promo');
					btn.addEventListener('click', () => fixture.clicks.push('generic-pill'));
					inner.appendChild(btn);
				}
				else if ('announcement' === kind) {
					const banner = mk('div', {role: 'status', 'data-testid': 'jetbox-service-announcement-banner'});
					const body = mk('div');
					body.append(document.createTextNode('Notice: '), mk('a', {href: 'https://antigravity.google/status'}, 'Status'));
					const dismiss = mk('button', {type: 'button', 'aria-label': 'Dismiss service announcement'}, 'x');
					dismiss.addEventListener('click', () => {
						fixture.dismissed++;
						fixture.badges = fixture.badges.filter(item => 'announcement' !== item);
						renderBadges();
					});
					banner.append(body, dismiss);
					annSlot.appendChild(banner);
				}
			}
			inner.appendChild(mk('button', {type: 'button', 'data-testid': 'titlebar-more-actions', 'aria-label': 'More actions', class: 'agy-button h-7 w-7'}, '...'));
			inner.appendChild(mk('button', {type: 'button', 'data-testid': 'toggle-overview-panel', 'aria-label': 'Toggle Overview Panel', class: 'agy-button h-7 w-7'}, 'doc'));
			inner.appendChild(mk('button', {type: 'button', 'data-testid': 'open-editor-single', class: 'agy-button h-7'}, 'Open IDE'));
		};
		fixture.setBadges = next => {
			fixture.badges = [...next];
			renderBadges();
		};
		renderBadges();
	});
	await page.addStyleTag({content: `${cssStyleSheet()}\n${badgesStyleSheet()}`});
	await page.addScriptTag({content: `${rendererSource()}\n//# sourceURL=titlebar-badges-fixture.js`});
	return {page, errors};
};
// 2026-11-25
// "Relocate titlebar update and announcement badges into the Antigravity app menu":
// https://github.com/dmitry-ai/antigravity-addons/issues/67
test('CSS hides all distracting titlebar badges while keeping normal toolbar buttons visible', async context => {
	const {page, errors} = await openFixture(context, {badges: ['app-update', 'manual-update', 'generic-pill', 'announcement']});
	const metrics = await page.evaluate(() => {
		const box = selector => {
			const el = document.querySelector(selector);
			const rect = el.getBoundingClientRect();
			return {display: getComputedStyle(el).display, w: rect.width, h: rect.height};
		};
		return {
			appUpdate: box('[data-testid="app-update-button"]'),
			bounceWrap: box('.animate-nudge-bounce'),
			manualUpdate: box('[data-testid="manual-update-button"]'),
			genericPill: box('[data-testid="pane-titlebar-toolbar"] div[role="button"].rounded-full:not([data-testid])'),
			announcement: box('[data-testid="jetbox-service-announcement-banner"]'),
			moreBtn: box('[data-testid="titlebar-more-actions"]'),
			overviewBtn: box('[data-testid="toggle-overview-panel"]'),
			ideBtn: box('[data-testid="open-editor-single"]'),
			menuTriggerText: document.querySelector('[data-testid="title-menu-bar-item"]').textContent.trim()
		};
	});
	assert.equal(metrics.appUpdate.display, 'none');
	assert.equal(metrics.appUpdate.w, 0);
	assert.equal(metrics.bounceWrap.display, 'none');
	assert.equal(metrics.manualUpdate.display, 'none');
	assert.equal(metrics.genericPill.display, 'none');
	assert.equal(metrics.announcement.display, 'none');
	assert.notEqual(metrics.moreBtn.display, 'none');
	assert.ok(0 < metrics.moreBtn.w && 0 < metrics.moreBtn.h);
	assert.notEqual(metrics.overviewBtn.display, 'none');
	assert.notEqual(metrics.ideBtn.display, 'none');
	assert.equal(metrics.menuTriggerText, 'Antigravity');
	assert.deepEqual(errors, []);
});
test('Antigravity dropdown shows relocated badges, forwards clicks, dismisses announcements, and ignores Workspace menu', async context => {
	const {page, errors} = await openFixture(context, {badges: ['app-update', 'manual-update', 'announcement']});
	await page.click('[data-menu-wrap="Antigravity"] [data-testid="title-menu-bar-item"]');
	await page.waitForSelector('[data-menu-wrap="Antigravity"] [data-antigravity-relocated-badges="true"]');
	const snapshot = await page.evaluate(() => {
		const popup = document.querySelector('[data-menu-wrap="Antigravity"] [data-browser-occluder="true"]');
		const annLink = popup.querySelector('.antigravity-relocated-announcement-link');
		return {
			annLink: annLink ? {href: annLink.getAttribute('href'), text: annLink.textContent.trim()} : null,
			nativeOptions: [...popup.querySelectorAll(':scope > div > [data-testid="title-menu-bar-option"]')].map(el => el.textContent.trim()),
			relocatedLabels: [...popup.querySelectorAll('[data-antigravity-relocated-badge]')].map(el => ({
				key: el.getAttribute('data-antigravity-relocated-badge'),
				text: el.textContent.trim(),
				visible: 0 < el.getBoundingClientRect().height
			}))
		};
	});
	assert.deepEqual(snapshot.nativeOptions, ['Version 2.34.0', 'Check for Updates']);
	assert.equal(snapshot.relocatedLabels.length, 3);
	assert.ok(snapshot.relocatedLabels[0].text.includes('Restart to Update'));
	assert.ok(snapshot.relocatedLabels[0].text.includes('2.35.2'));
	assert.equal(snapshot.relocatedLabels[0].visible, true);
	assert.ok(snapshot.relocatedLabels[1].text.includes('Update Available'));
	assert.ok(snapshot.relocatedLabels[2].text.includes('Notice: Status'));
	assert.deepEqual(snapshot.annLink, {href: 'https://antigravity.google/status', text: 'Status'});
	await page.click('[data-antigravity-relocated-badge="app-update-button"]');
	const afterClick = await page.evaluate(() => ({
		clicks: window.__badgesFixture.clicks,
		popupOpen: Boolean(document.querySelector('[data-menu-wrap="Antigravity"] [data-browser-occluder="true"]'))
	}));
	assert.deepEqual(afterClick.clicks, ['app-update-button']);
	assert.equal(afterClick.popupOpen, false);
	await page.click('[data-menu-wrap="Antigravity"] [data-testid="title-menu-bar-item"]');
	await page.waitForSelector('.antigravity-relocated-dismiss');
	await page.click('.antigravity-relocated-dismiss');
	await page.waitForFunction(() => !document.querySelector('[data-antigravity-relocated-badge="jetbox-service-announcement-banner"]'));
	const dismissedCount = await page.evaluate(() => window.__badgesFixture.dismissed);
	assert.equal(dismissedCount, 1);
	await page.click('[data-menu-wrap="Workspace"] [data-testid="title-menu-bar-item"]');
	const wsRelocated = await page.evaluate(() => document.querySelector('[data-menu-wrap="Workspace"] [data-antigravity-relocated-badges="true"]'));
	assert.equal(wsRelocated, null);
	assert.deepEqual(errors, []);
});
test('Live badge transitions update an open dropdown without errors, ignore chat viewport mutations, and restore cleanly on dispose', async context => {
	const {page, errors} = await openFixture(context, {badges: ['app-downloading'], updaterState: {type: 'downloading'}});
	await page.click('[data-menu-wrap="Antigravity"] [data-testid="title-menu-bar-item"]');
	await page.waitForSelector('[data-antigravity-relocated-badge="app-update-button"]');
	const downloadingState = await page.evaluate(() => {
		const btn = document.querySelector('[data-antigravity-relocated-badge="app-update-button"]');
		btn.click();
		return {
			disabled: btn.disabled,
			text: btn.textContent.trim(),
			clicks: window.__badgesFixture.clicks.length,
			popupStillOpen: Boolean(document.querySelector('[data-menu-wrap="Antigravity"] [data-browser-occluder="true"]'))
		};
	});
	assert.equal(downloadingState.disabled, true);
	assert.ok(downloadingState.text.includes('Downloading Update'));
	assert.equal(downloadingState.clicks, 0);
	assert.equal(downloadingState.popupStillOpen, true);
	await page.evaluate(() => {
		window.__badgesFixture.updaterState = {type: 'ready', update: {version: '2.35.2'}};
		window.__badgesFixture.setBadges(['app-update']);
	});
	await page.waitForFunction(() => {
		const btn = document.querySelector('[data-antigravity-relocated-badge="app-update-button"]');
		return btn && !btn.disabled && btn.textContent.includes('Restart to Update');
	});
	await page.evaluate(() => {
		window.__badgesFixture.updaterState = {type: 'idle'};
		window.__badgesFixture.setBadges([]);
	});
	await page.waitForFunction(() => !document.querySelector('[data-antigravity-relocated-badges="true"]'));
	const beforeStream = await page.evaluate(() => window.__badgesFixture.observers.reduce((sum, item) => sum + item.calls, 0));
	await page.evaluate(() => {
		const vp = document.querySelector('[data-testid="autoscroll-viewport"]');
		for (let i = 0; 100 > i; i++) {
			const p = document.createElement('p');
			p.textContent = `Token ${i}`;
			vp.appendChild(p);
		}
	});
	await page.waitForTimeout(80);
	const afterStream = await page.evaluate(() => window.__badgesFixture.observers.reduce((sum, item) => sum + item.calls, 0));
	assert.equal(afterStream, beforeStream, 'Chat viewport streaming must not trigger titlebar badge MutationObservers');
	await page.evaluate(() => {
		window.__badgesFixture.setBadges(['app-update']);
		window.__ANTIGRAVITY_TITLEBAR_BADGES__?.dispose();
		for (const tag of document.querySelectorAll('style')) {
			if (tag.textContent.includes('antigravity-relocated-badges')) {
				tag.remove();
			}
		}
	});
	const restored = await page.evaluate(() => ({
		controller: window.__ANTIGRAVITY_TITLEBAR_BADGES__,
		display: getComputedStyle(document.querySelector('[data-testid="app-update-button"]')).display
	}));
	assert.equal(restored.controller, undefined);
	assert.notEqual(restored.display, 'none');
	assert.deepEqual(errors, []);
});
