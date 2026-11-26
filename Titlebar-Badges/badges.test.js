// 2026-11-25 Dmitrii Fediuk https://github.com/dmitrii-fediuk
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {discover} = require('../Upgrade/registry');
const createBadgesRuntime = require('./cdp-runtime');
const {TitlebarBadgesController, extractTitlebarBadges, labelForUpdaterState} = require('./badges-client');
const verifyBadges = require('./verify');
/**
 * @used-by {@link createDoc}
 * @used-by {@link import('./badges.test.js')}
 */
const createElement = (tag, {attrs = {}, children = [], className = '', dataset = {}, text = ''} = {}) => {
	const el = {
		attributes: {...attrs},
		children: [],
		className,
		dataset: {...dataset},
		listeners: {},
		nodeType: 1,
		parentElement: null,
		style: {},
		tagName: tag.toUpperCase(),
		_text: text,
		appendChild(child) {
			child.parentElement = this;
			this.children.push(child);
			return child;
		},
		click() {
			this.clicked = (this.clicked || 0) + 1;
			this.listeners.click?.({preventDefault() {}, stopPropagation() {}, target: this});
		},
		closest(selector) {
			let cur = this;
			let r = null;
			while (cur) {
				if (cur.matches(selector)) {
					r = cur;
					break;
				}
				cur = cur.parentElement;
			}
			return r;
		},
		contains(node) {
			let cur = node;
			let r = false;
			while (cur) {
				if (cur === this) {
					r = true;
					break;
				}
				cur = cur.parentElement;
			}
			return r;
		},
		getAttribute(name) {
			let r = null;
			if (name in this.attributes) {
				r = this.attributes[name];
			}
			else if ('class' === name) {
				r = this.className;
			}
			else if (name.startsWith('data-')) {
				const camel = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
				if (camel in this.dataset) {
					r = this.dataset[camel];
				}
			}
			return r;
		},
		addEventListener(type, fn) {
			this.listeners[type] = fn;
		},
		matches(selector) {
			return selector.split(',').map(part => part.trim()).some(part => matchSingle(this, part));
		},
		querySelector(selector) {
			return this.querySelectorAll(selector)[0] || null;
		},
		querySelectorAll(selector) {
			const r = [];
			const visit = node => {
				for (const child of node.children) {
					if (child.matches(selector)) {
						r.push(child);
					}
					visit(child);
				}
			};
			visit(this);
			return r;
		},
		remove() {
			if (this.parentElement) {
				const index = this.parentElement.children.indexOf(this);
				if (0 <= index) {
					this.parentElement.children.splice(index, 1);
				}
				this.parentElement = null;
			}
		},
		setAttribute(name, value) {
			const str = String(value);
			this.attributes[name] = str;
			if ('class' === name) {
				this.className = str;
			}
			else if (name.startsWith('data-')) {
				const camel = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
				this.dataset[camel] = str;
			}
		},
		get textContent() {
			return this.children.length ? this.children.map(child => child.textContent).join('') : this._text;
		},
		set textContent(value) {
			this.children = [];
			this._text = String(value);
		}
	};
	for (const child of children) {
		el.appendChild(child);
	}
	return el;
};
/**
 * @used-by {@link createElement}
 * @used-by {@link import('./badges.test.js')}
 */
const matchSingle = (el, selector) => {
	let r = true;
	const tokens = selector.trim().split(/\s+/);
	if (1 < tokens.length) {
		const last = tokens[tokens.length - 1];
		if (!matchSimple(el, last)) {
			r = false;
		}
		else {
			let cur = el.parentElement;
			let idx = tokens.length - 2;
			while (cur && 0 <= idx) {
				if (matchSimple(cur, tokens[idx])) {
					idx--;
				}
				cur = cur.parentElement;
			}
			r = 0 > idx;
		}
	}
	else {
		r = matchSimple(el, tokens[0]);
	}
	return r;
};
/**
 * @used-by {@link import('./badges.test.js')}
 * @used-by {@link matchSingle}
 */
const matchSimple = (el, simple) => {
	let r = true;
	let rest = simple;
	const tagMatch = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
	if (tagMatch) {
		if (el.tagName !== tagMatch[0].toUpperCase()) {
			r = false;
		}
		rest = rest.slice(tagMatch[0].length);
	}
	if (r) {
		const attrRe = /\[([^\]=*~|^$]+)(?:(\*?=)['"]?([^'"\]]*)['"]?)?\]/g;
		let match;
		while (null !== (match = attrRe.exec(rest))) {
			const val = el.getAttribute(match[1]);
			if (!match[2]) {
				if (null === val) {
					r = false;
					break;
				}
			}
			else if ('=' === match[2] && val !== match[3]) {
				r = false;
				break;
			}
			else if ('*=' === match[2] && (null === val || !val.includes(match[3]))) {
				r = false;
				break;
			}
		}
		rest = rest.replace(attrRe, '');
	}
	if (r) {
		const classes = new Set(String(el.className || '').split(/\s+/).filter(Boolean));
		for (const cls of rest.split('.').filter(Boolean)) {
			if (!classes.has(cls)) {
				r = false;
				break;
			}
		}
	}
	return r;
};
/**
 * @used-by {@link import('./badges.test.js')}
 */
const createDoc = children => {
	const root = createElement('body', {children});
	return {
		body: root,
		createElement: tag => createElement(tag),
		createTextNode: text => ({nodeType: 3, textContent: String(text), parentElement: null, matches: () => false, children: []}),
		listeners: {},
		addEventListener(type, fn) {
			this.listeners[type] = fn;
		},
		removeEventListener(type, fn) {
			if (this.listeners[type] === fn) {
				delete this.listeners[type];
			}
		},
		querySelector: selector => root.querySelector(selector),
		querySelectorAll: selector => root.querySelectorAll(selector)
	};
};
// 2026-11-25
// "Relocate titlebar update and announcement badges into the Antigravity app menu":
// https://github.com/dmitry-ai/antigravity-addons/issues/67
test('Registry discovers Titlebar-Badges between CSS and Folders and validates runtime assets', async context => {
	const toolsRoot = path.resolve(__dirname, '..');
	const tools = discover(toolsRoot);
	const ids = tools.map(tool => tool.id);
	assert.ok(ids.includes('titlebar-badges'));
	assert.ok(ids.indexOf('css') < ids.indexOf('titlebar-badges'));
	assert.ok(ids.indexOf('titlebar-badges') < ids.indexOf('folders'));
	const runtime = createBadgesRuntime({invalidate() {}, report() {}});
	context.after(() => runtime.dispose());
	assert.match(runtime.styleSheet(), /app-update-button/);
	assert.match(runtime.styleSheet(), /manual-update-button/);
	assert.match(runtime.styleSheet(), /jetbox-service-announcement-banner/);
	assert.ok('string' === typeof runtime.source() && 0 < runtime.source().length);
	assert.ok('string' === typeof runtime.disposeExpression && runtime.disposeExpression.includes('__ANTIGRAVITY_TITLEBAR_BADGES__'));
	assert.ok('string' === typeof runtime.inspectExpression && runtime.inspectExpression.includes('__ANTIGRAVITY_TITLEBAR_BADGES__'));
	const verified = await verifyBadges();
	assert.match(verified.message, /verified/i);
});
test('extractTitlebarBadges collects update, manual nudge, announcement, and generic pills while skipping normal toolbar controls', () => {
	const appUpdate = createElement('div', {
		attrs: {role: 'button', 'data-testid': 'app-update-button'},
		className: 'px-3 rounded-full bg-primary text-primary-foreground cursor-pointer',
		children: [createElement('span', {text: 'Restart to Update'}), createElement('span', {text: '→'})]
	});
	const bounceWrap = createElement('div', {className: 'animate-nudge-bounce flex items-center', children: [appUpdate]});
	const manualUpdate = createElement('div', {
		attrs: {role: 'button', 'data-testid': 'manual-update-button', 'aria-label': 'Update Available'},
		className: 'update-nudge update-nudge-pill rounded-full bg-primary cursor-pointer',
		children: [createElement('span', {className: 'update-nudge-label', children: [createElement('span', {className: 'update-nudge-label-text', text: 'Update Available'})]})]
	});
	const genericPill = createElement('div', {
		attrs: {role: 'button'},
		className: 'px-3 rounded-full bg-primary cursor-pointer',
		text: 'Try New Mode'
	});
	const moreBtn = createElement('button', {attrs: {type: 'button', 'data-testid': 'titlebar-more-actions', 'aria-label': 'More actions'}, className: 'agy-button rounded-lg'});
	const overviewBtn = createElement('button', {attrs: {type: 'button', 'data-testid': 'toggle-overview-panel', 'aria-label': 'Toggle Overview Panel'}, className: 'agy-button rounded-lg'});
	const ideBtn = createElement('button', {attrs: {type: 'button', 'data-testid': 'open-editor-single'}, text: 'Open IDE'});
	const dismissBtn = createElement('button', {attrs: {type: 'button', 'aria-label': 'Dismiss service announcement'}});
	const link = createElement('a', {attrs: {href: 'https://status.example.com'}, text: 'Status page'});
	const announcement = createElement('div', {
		attrs: {role: 'status', 'data-testid': 'jetbox-service-announcement-banner'},
		children: [createElement('div', {children: [createElement('span', {text: 'Scheduled maintenance. '}), link]}), dismissBtn]
	});
	const toolbar = createElement('div', {
		attrs: {'data-testid': 'pane-titlebar-toolbar'},
		children: [createElement('div', {children: [bounceWrap, manualUpdate, genericPill, moreBtn, overviewBtn, ideBtn]})]
	});
	const header = createElement('div', {
		attrs: {'data-main-content-header': 'true'},
		children: [createElement('div', {attrs: {'data-testid': 'titlebar-service-announcement-slot'}, children: [announcement]}), toolbar]
	});
	const doc = createDoc([header]);
	const badges = extractTitlebarBadges(doc, {updaterState: {type: 'ready', update: {version: '2.35.2'}}});
	assert.deepEqual(badges.map(b => b.key), ['app-update-button', 'manual-update-button', 'badge:Try New Mode', 'jetbox-service-announcement-banner']);
	assert.equal(badges[0].label, 'Restart to Update');
	assert.equal(badges[0].clickable, true);
	assert.equal(badges[0].loading, false);
	assert.equal(badges[0].version, '2.35.2');
	assert.equal(badges[1].label, 'Update Available');
	assert.equal(badges[1].clickable, true);
	assert.equal(badges[2].label, 'Try New Mode');
	assert.equal(badges[3].kind, 'announcement');
	assert.equal(badges[3].dismissButton, dismissBtn);
	assert.deepEqual(badges[3].links, [{href: 'https://status.example.com', text: 'Status page'}]);
	assert.equal(labelForUpdaterState('available for download'), 'Update Available');
	assert.equal(labelForUpdaterState('downloading'), 'Downloading Update');
	assert.equal(labelForUpdaterState('downloaded'), 'Install Update');
	assert.equal(labelForUpdaterState('updating'), 'Installing Update');
	assert.equal(labelForUpdaterState('ready'), 'Restart to Update');
	assert.equal(labelForUpdaterState('idle'), null);
});
test('TitlebarBadgesController populates only the Antigravity dropdown, closes before forwarding clicks, and cleans up on dispose', () => {
	const appUpdate = createElement('div', {
		attrs: {role: 'button', 'data-testid': 'app-update-button'},
		className: 'px-3 rounded-full bg-primary cursor-pointer',
		children: [createElement('span', {text: 'Restart to Update'}), createElement('span', {text: '→'})]
	});
	const events = [];
	appUpdate.addEventListener('click', () => events.push('native-update-click'));
	const trigger = createElement('button', {attrs: {'data-testid': 'title-menu-bar-item'}, text: 'Antigravity'});
	trigger.addEventListener('click', () => events.push('menu-toggle-click'));
	const dropdown = createElement('div', {
		attrs: {'data-browser-occluder': 'true'},
		children: [
			createElement('div', {children: [createElement('button', {attrs: {'data-testid': 'title-menu-bar-option'}, text: 'Version 2.34.0'})]}),
			createElement('div', {children: [createElement('button', {attrs: {'data-testid': 'title-menu-bar-option'}, text: 'Check for Updates'})]})
		]
	});
	const appMenuWrap = createElement('div', {className: 'relative', children: [trigger, dropdown]});
	const wsDropdown = createElement('div', {
		attrs: {'data-browser-occluder': 'true'},
		children: [createElement('div', {children: [createElement('button', {attrs: {'data-testid': 'title-menu-bar-option'}, text: 'New Conversation'})]})]
	});
	const wsWrap = createElement('div', {className: 'relative', children: [createElement('button', {attrs: {'data-testid': 'title-menu-bar-item'}, text: 'Workspace'}), wsDropdown]});
	const menuBar = createElement('div', {attrs: {'data-testid': 'title-menu-bar'}, children: [appMenuWrap, wsWrap]});
	const header = createElement('div', {
		attrs: {'data-main-content-header': 'true'},
		children: [createElement('div', {attrs: {'data-testid': 'pane-titlebar-toolbar'}, children: [appUpdate]})]
	});
	const doc = createDoc([menuBar, header]);
	let unsubscribed = false;
	const win = {
		electronUpdater: {
			getState: async () => ({type: 'ready', update: {version: '2.35.2'}}),
			onStateChanged: () => () => {
				unsubscribed = true;
			}
		},
		location: {pathname: '/c/test'}
	};
	const controller = new TitlebarBadgesController(win, {document: doc});
	controller.start();
	const inspected = controller.inspect();
	assert.equal(inspected.state, 'ready');
	assert.equal(inspected.menuBound, true);
	assert.equal(inspected.badgeCount, 1);
	const relocatedInApp = dropdown.querySelector('[data-antigravity-relocated-badges="true"]');
	assert.ok(relocatedInApp);
	assert.equal(wsDropdown.querySelector('[data-antigravity-relocated-badges="true"]'), null);
	const proxyBtn = relocatedInApp.querySelector('[data-antigravity-relocated-badge="app-update-button"]');
	assert.ok(proxyBtn);
	proxyBtn.click();
	assert.deepEqual(events, ['menu-toggle-click', 'native-update-click']);
	controller.dispose();
	assert.equal(unsubscribed, true);
	assert.equal(dropdown.querySelector('[data-antigravity-relocated-badges="true"]'), null);
});
