// 2026-11-25 Dmitrii Fediuk https://github.com/dmitrii-fediuk
const ANNOUNCEMENT_TEST_ID = 'jetbox-service-announcement-banner';
const APP_UPDATE_TEST_ID = 'app-update-button';
const BADGE_SELECTOR_HEADER = `[data-testid="${APP_UPDATE_TEST_ID}"], [data-testid="manual-update-button"], [data-testid="${ANNOUNCEMENT_TEST_ID}"]`;
const BADGE_SELECTOR_TOOLBAR = `[data-testid="${APP_UPDATE_TEST_ID}"], [data-testid="manual-update-button"], .update-nudge, [data-testid*="update"][role="button"], [data-testid*="nudge"], [data-testid*="banner"], [data-testid*="announcement"], div[role="button"].rounded-full`;
const HEADER_SELECTOR = '[data-main-content-header="true"]';
const MANUAL_UPDATE_TEST_ID = 'manual-update-button';
const MENU_BAR_SELECTOR = '[data-testid="title-menu-bar"]';
const MENU_ITEM_SELECTOR = '[data-testid="title-menu-bar-item"]';
const MENU_POPUP_SELECTOR = '[data-browser-occluder="true"]';
const RELOCATED_ATTR = 'data-antigravity-relocated-badges';
const RELOCATED_ITEM_ATTR = 'data-antigravity-relocated-badge';
const TOOLBAR_SELECTOR = '[data-testid="pane-titlebar-toolbar"]';
const UPDATER_LABELS = {
	'available for download': 'Update Available',
	downloaded: 'Install Update',
	downloading: 'Downloading Update',
	ready: 'Restart to Update',
	updating: 'Installing Update'
};
const cleanText = value => String(value || '').replace(/\s+/g, ' ').replace(/\s*→\s*$/, '').trim();
const collectAnnouncementLinks = el => {
	const r = [];
	for (const anchor of el.querySelectorAll('a[href]')) {
		const href = String(anchor.getAttribute('href') || '').trim();
		const text = cleanText(anchor.textContent);
		if (/^https?:\/\//i.test(href) && text) {
			r.push({href, text});
		}
	}
	return r;
};
const collectAnnouncementSegments = (node, dismissButton, out) => {
	if (!node || node === dismissButton || 'STYLE' === node.tagName || 'SVG' === node.tagName) {
		return;
	}
	if (3 === node.nodeType) {
		const value = String(node.textContent || '');
		if (value.trim()) {
			out.push({text: value, type: 'text'});
		}
	}
	else if ('A' === node.tagName) {
		const href = String(node.getAttribute('href') || '').trim();
		const text = cleanText(node.textContent);
		if (/^https?:\/\//i.test(href) && text) {
			out.push({href, text, type: 'link'});
		}
		else if (text) {
			out.push({text, type: 'text'});
		}
	}
	else if (node.childNodes?.length) {
		for (const child of node.childNodes) {
			collectAnnouncementSegments(child, dismissButton, out);
		}
	}
	else if (node.children?.length) {
		for (const child of node.children) {
			collectAnnouncementSegments(child, dismissButton, out);
		}
	}
	else {
		const value = String(node.textContent || '');
		if (value.trim()) {
			out.push({text: value, type: 'text'});
		}
	}
};
const collectElementText = el => {
	const parts = [];
	const visit = node => {
		if (!node || 'STYLE' === node.tagName || 'SVG' === node.tagName) {
			return;
		}
		if (3 === node.nodeType) {
			const chunk = cleanText(node.textContent);
			if (chunk) {
				parts.push(chunk);
			}
		}
		else if (node.childNodes?.length) {
			for (const child of node.childNodes) {
				visit(child);
			}
		}
		else if (node.children?.length) {
			for (const child of node.children) {
				visit(child);
			}
		}
		else {
			const chunk = cleanText(node.textContent);
			if (chunk) {
				parts.push(chunk);
			}
		}
	};
	visit(el);
	return cleanText(parts.join(' '));
};
const extractAnnouncement = el => {
	const dismissButton = el.querySelector('button[aria-label*="Dismiss"], button[aria-label*="dismiss"], button');
	const segments = [];
	collectAnnouncementSegments(el, dismissButton, segments);
	const links = collectAnnouncementLinks(el);
	const label = cleanText(segments.map(seg => seg.text).join(' ')) || cleanText(el.textContent);
	return {
		clickable: false,
		dismissButton: dismissButton || null,
		key: el.getAttribute('data-testid') || `announcement:${label}`,
		kind: 'announcement',
		label,
		links,
		loading: false,
		segments,
		source: el,
		version: ''
	};
};
const extractBadgeLabel = (el, {testId, updaterState}) => {
	let r = collectElementText(el);
	if (!r) {
		r = cleanText(el.getAttribute('aria-label') || el.getAttribute('title'));
	}
	if (!r && APP_UPDATE_TEST_ID === testId) {
		r = labelForUpdaterState(updaterState?.type) || '';
	}
	if (!r && MANUAL_UPDATE_TEST_ID === testId) {
		r = isLoadingBadge(el, {label: '', testId, updaterState}) ? 'Updating…' : 'Update Available';
	}
	return r;
};
const extractTitlebarBadges = (doc, {updaterState = null} = {}) => {
	const actionItems = [];
	const announcements = [];
	const seenElements = new Set();
	const seenKeys = new Set();
	const raw = [];
	const pushCandidate = el => {
		if (el && !seenElements.has(el) && !el.closest(`[${RELOCATED_ATTR}="true"]`)) {
			seenElements.add(el);
			raw.push(el);
		}
	};
	for (const toolbar of doc.querySelectorAll(TOOLBAR_SELECTOR)) {
		for (const el of toolbar.querySelectorAll(BADGE_SELECTOR_TOOLBAR)) {
			if (!isNormalToolbarButton(el)) {
				pushCandidate(el);
			}
		}
	}
	for (const header of doc.querySelectorAll(HEADER_SELECTOR)) {
		for (const el of header.querySelectorAll(BADGE_SELECTOR_HEADER)) {
			pushCandidate(el);
		}
	}
	const filtered = raw.filter(el => !raw.some(other => other !== el && other.contains?.(el)));
	for (const el of filtered) {
		const testId = el.getAttribute('data-testid') || '';
		if (ANNOUNCEMENT_TEST_ID === testId || 'status' === el.getAttribute('role')) {
			const item = extractAnnouncement(el);
			if (item.label && !seenKeys.has(item.key)) {
				seenKeys.add(item.key);
				announcements.push(item);
			}
		}
		else {
			const label = extractBadgeLabel(el, {testId, updaterState});
			if (label) {
				const loading = isLoadingBadge(el, {label, testId, updaterState});
				const key = testId || `badge:${label}`;
				if (!seenKeys.has(key)) {
					seenKeys.add(key);
					actionItems.push({
						clickable: !loading,
						dismissButton: null,
						key,
						kind: 'badge',
						label,
						links: [],
						loading,
						segments: [],
						source: el,
						version: APP_UPDATE_TEST_ID === testId && updaterState?.update?.version ? String(updaterState.update.version) : ''
					});
				}
			}
		}
	}
	return [...actionItems, ...announcements];
};
const isLoadingBadge = (el, {label = '', testId = '', updaterState = null} = {}) => {
	const cls = String(el.className || '');
	const hasSpinner = Boolean(el.querySelector?.('.update-spinner, .border-secondary-foreground, .border-primary-foreground'));
	const explicitActionLabel = Boolean(label) && !/^(downloading|installing|updating)/i.test(label);
	const updaterLoading = APP_UPDATE_TEST_ID === testId && !explicitActionLabel && ['downloading', 'updating'].includes(updaterState?.type);
	return cls.includes('cursor-default') || cls.includes('pointer-events-none') || hasSpinner || updaterLoading || /^(downloading|installing|updating)/i.test(label);
};
const isNormalToolbarButton = el => {
	let r = false;
	if ('BUTTON' === el.tagName) {
		const testId = el.getAttribute('data-testid') || '';
		r = !['app-update-button', 'manual-update-button', 'jetbox-service-announcement-banner'].includes(testId) && !/(?:update|nudge|banner|announcement)/i.test(testId);
	}
	return r;
};
const labelForUpdaterState = stateType => UPDATER_LABELS[stateType] || null;
const signatureFor = badges => JSON.stringify(badges.map(item => ({
	clickable: item.clickable,
	dismissable: Boolean(item.dismissButton),
	key: item.key,
	kind: item.kind,
	label: item.label,
	links: item.links,
	loading: item.loading,
	version: item.version
})));
// 2026-11-25
// "Relocate titlebar update and announcement badges into the Antigravity app menu":
// https://github.com/dmitry-ai/antigravity-addons/issues/67
class TitlebarBadgesController {
	constructor(win, {document: explicitDoc = null} = {}) {
		Object.assign(this, {
			bootObserver: null,
			disposed: false,
			doc: explicitDoc || win.document,
			headerObservers: new Map(),
			lastSignature: '',
			menuObserver: null,
			observedMenuBar: null,
			onDocumentClick: event => this.handleDocumentClick(event),
			onPopState: () => this.schedule(),
			scheduled: false,
			unsubscribeUpdater: null,
			updaterState: null,
			win
		});
	}
	bindObservers() {
		if (!this.disposed && 'function' === typeof this.win?.MutationObserver) {
			const menuBar = this.doc.querySelector(MENU_BAR_SELECTOR);
			if (menuBar !== this.observedMenuBar) {
				this.menuObserver?.disconnect();
				this.menuObserver = null;
				this.observedMenuBar = menuBar;
				if (menuBar) {
					this.menuObserver = new this.win.MutationObserver(records => this.handleMutations(records));
					this.menuObserver.observe(menuBar, {childList: true, subtree: true});
				}
			}
			const headers = new Set([...this.doc.querySelectorAll(HEADER_SELECTOR), ...this.doc.querySelectorAll(TOOLBAR_SELECTOR)]);
			const targets = [...headers].filter(node => ![...headers].some(other => other !== node && other.contains?.(node)));
			const targetSet = new Set(targets);
			for (const [node, observer] of this.headerObservers) {
				if (!targetSet.has(node)) {
					observer.disconnect();
					this.headerObservers.delete(node);
				}
			}
			for (const node of targets) {
				if (!this.headerObservers.has(node)) {
					const observer = new this.win.MutationObserver(records => this.handleMutations(records));
					observer.observe(node, {attributeFilter: ['aria-label', 'class', 'data-testid'], attributes: true, characterData: true, childList: true, subtree: true});
					this.headerObservers.set(node, observer);
				}
			}
			if (menuBar && targets.length) {
				this.bootObserver?.disconnect();
				this.bootObserver = null;
			}
			else if (!this.bootObserver) {
				const root = this.doc.getElementById?.('root') || this.doc.body;
				if (root) {
					this.bootObserver = new this.win.MutationObserver(records => this.handleMutations(records));
					this.bootObserver.observe(root, {childList: true, subtree: true});
				}
			}
		}
	}
	buildAnnouncementRow(badge) {
		const row = this.doc.createElement('div');
		row.className = 'antigravity-relocated-announcement';
		row.setAttribute(RELOCATED_ITEM_ATTR, badge.key);
		const body = this.doc.createElement('div');
		body.className = 'antigravity-relocated-announcement-body';
		if (badge.segments.length) {
			for (const seg of badge.segments) {
				if ('link' === seg.type) {
					const link = this.doc.createElement('a');
					link.className = 'antigravity-relocated-announcement-link';
					link.setAttribute('href', seg.href);
					link.setAttribute('target', '_blank');
					link.setAttribute('rel', 'noopener noreferrer');
					link.textContent = seg.text;
					body.appendChild(link);
				}
				else {
					body.appendChild(this.doc.createTextNode(seg.text));
				}
			}
		}
		else {
			body.textContent = badge.label;
		}
		row.appendChild(body);
		if (badge.dismissButton) {
			const dismiss = this.doc.createElement('button');
			dismiss.type = 'button';
			dismiss.className = 'antigravity-relocated-dismiss';
			dismiss.setAttribute('aria-label', badge.dismissButton.getAttribute('aria-label') || 'Dismiss announcement');
			dismiss.setAttribute('title', 'Dismiss');
			dismiss.textContent = '×';
			dismiss.addEventListener('click', event => {
				event.preventDefault();
				event.stopPropagation();
				badge.dismissButton.click();
				this.schedule();
			});
			row.appendChild(dismiss);
		}
		return row;
	}
	buildBadgeRow(badge, trigger) {
		const wrap = this.doc.createElement('div');
		const button = this.doc.createElement('button');
		button.type = 'button';
		button.className = `antigravity-relocated-badge ${badge.clickable ? 'is-actionable' : 'is-loading'}`;
		button.setAttribute('data-testid', 'title-menu-bar-option');
		button.setAttribute(RELOCATED_ITEM_ATTR, badge.key);
		if (!badge.clickable) {
			button.disabled = true;
			button.setAttribute('aria-disabled', 'true');
		}
		const labelSpan = this.doc.createElement('span');
		labelSpan.className = 'antigravity-relocated-badge-label';
		labelSpan.textContent = badge.label;
		button.appendChild(labelSpan);
		const metaText = badge.loading ? '…' : badge.version ? `${badge.version} →` : '→';
		const metaSpan = this.doc.createElement('span');
		metaSpan.className = 'antigravity-relocated-badge-meta';
		metaSpan.textContent = metaText;
		button.appendChild(metaSpan);
		if (badge.clickable) {
			button.addEventListener('click', event => {
				event.preventDefault();
				event.stopPropagation();
				trigger?.click?.();
				badge.source?.click?.();
			});
		}
		wrap.appendChild(button);
		return wrap;
	}
	dispose() {
		if (!this.disposed) {
			this.disposed = true;
			this.menuObserver?.disconnect();
			this.menuObserver = null;
			this.observedMenuBar = null;
			for (const observer of this.headerObservers.values()) {
				observer.disconnect();
			}
			this.headerObservers.clear();
			this.bootObserver?.disconnect();
			this.bootObserver = null;
			this.doc.removeEventListener?.('click', this.onDocumentClick, true);
			this.win.removeEventListener?.('popstate', this.onPopState);
			try {
				this.unsubscribeUpdater?.();
			}
			catch {}
			this.unsubscribeUpdater = null;
			for (const node of this.doc.querySelectorAll(`[${RELOCATED_ATTR}="true"]`)) {
				node.remove();
			}
			if (this === this.win.__ANTIGRAVITY_TITLEBAR_BADGES__) {
				delete this.win.__ANTIGRAVITY_TITLEBAR_BADGES__;
			}
		}
	}
	findAppMenuWrap() {
		const menuBar = this.doc.querySelector(MENU_BAR_SELECTOR);
		let wrap = null;
		let trigger = null;
		let dropdown = null;
		if (menuBar) {
			const wraps = [...menuBar.children].filter(child => child.querySelector?.(MENU_ITEM_SELECTOR));
			wrap = wraps.find(child => /^antigravity\b/i.test(cleanText(child.querySelector(MENU_ITEM_SELECTOR)?.textContent))) || wraps[0] || null;
			trigger = wrap?.querySelector(MENU_ITEM_SELECTOR) || null;
			dropdown = wrap?.querySelector(MENU_POPUP_SELECTOR) || null;
		}
		return {dropdown, menuBar, trigger, wrap};
	}
	handleDocumentClick(event) {
		if (!this.disposed && event?.target?.closest?.(MENU_BAR_SELECTOR)) {
			this.schedule();
		}
	}
	handleMutations(records) {
		const ownOnly = records.length && records.every(record => {
			const target = 1 === record.target?.nodeType ? record.target : record.target?.parentElement;
			return Boolean(target?.closest?.(`[${RELOCATED_ATTR}="true"]`));
		});
		if (!ownOnly) {
			this.schedule();
		}
	}
	inspect() {
		let r;
		if (this.isOnboardingRoute()) {
			r = {state: 'deferred', reason: 'onboarding'};
		}
		else {
			const {menuBar} = this.findAppMenuWrap();
			const badges = extractTitlebarBadges(this.doc, {updaterState: this.updaterState});
			r = {
				badgeCount: badges.length,
				badges: badges.map(item => ({
					clickable: item.clickable,
					key: item.key,
					kind: item.kind,
					label: item.label,
					loading: item.loading,
					version: item.version || null
				})),
				menuBound: Boolean(menuBar),
				state: 'ready'
			};
		}
		return r;
	}
	isOnboardingRoute() {
		const pathname = String(this.win?.location?.pathname || '');
		return '/onboarding' === pathname || pathname.startsWith('/onboarding/');
	}
	schedule() {
		if (!this.disposed && !this.scheduled) {
			this.scheduled = true;
			const flush = () => {
				this.scheduled = false;
				if (!this.disposed) {
					this.sync();
				}
			};
			if ('function' === typeof this.win?.requestAnimationFrame) {
				this.win.requestAnimationFrame(flush);
			}
			else {
				queueMicrotask(flush);
			}
		}
	}
	start() {
		this.doc.addEventListener?.('click', this.onDocumentClick, true);
		this.win.addEventListener?.('popstate', this.onPopState);
		const updater = this.win?.electronUpdater;
		if (updater) {
			if ('function' === typeof updater.onStateChanged) {
				this.unsubscribeUpdater = updater.onStateChanged(state => {
					this.updaterState = state || null;
					this.schedule();
				});
			}
			if ('function' === typeof updater.getState) {
				Promise.resolve(updater.getState()).then(state => {
					if (!this.disposed) {
						this.updaterState = state || null;
						this.schedule();
					}
				}).catch(() => {});
			}
		}
		this.sync();
		return this;
	}
	sync() {
		if (!this.disposed) {
			this.bindObservers();
			const {dropdown, trigger} = this.findAppMenuWrap();
			if (!dropdown) {
				this.lastSignature = '';
			}
			else {
				const badges = extractTitlebarBadges(this.doc, {updaterState: this.updaterState});
				const existing = dropdown.querySelector(`[${RELOCATED_ATTR}="true"]`);
				if (!badges.length) {
					existing?.remove();
					this.lastSignature = '';
				}
				else {
					const nextSignature = signatureFor(badges);
					if (!existing || nextSignature !== this.lastSignature || existing !== dropdown.children[dropdown.children.length - 1]) {
						const host = existing || this.doc.createElement('div');
						host.className = 'antigravity-relocated-badges';
						host.setAttribute(RELOCATED_ATTR, 'true');
						while (host.children.length) {
							host.children[host.children.length - 1].remove();
						}
						const separator = this.doc.createElement('div');
						separator.className = 'antigravity-relocated-badges-separator';
						host.appendChild(separator);
						for (const badge of badges) {
							host.appendChild('announcement' === badge.kind ? this.buildAnnouncementRow(badge) : this.buildBadgeRow(badge, trigger));
						}
						if (host.parentElement !== dropdown || host !== dropdown.children[dropdown.children.length - 1]) {
							dropdown.appendChild(host);
						}
						this.lastSignature = nextSignature;
					}
				}
			}
		}
	}
}
const installTitlebarBadges = (win = globalThis) => {
	win.__ANTIGRAVITY_TITLEBAR_BADGES__?.dispose?.();
	const r = new TitlebarBadgesController(win).start();
	win.__ANTIGRAVITY_TITLEBAR_BADGES__ = r;
	return r;
};
module.exports = {TitlebarBadgesController, extractTitlebarBadges, installTitlebarBadges, labelForUpdaterState};