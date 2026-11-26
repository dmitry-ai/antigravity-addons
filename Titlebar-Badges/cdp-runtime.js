// 2026-11-25 Dmitrii Fediuk https://github.com/dmitrii-fediuk
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const disposeExpression = 'window.__ANTIGRAVITY_TITLEBAR_BADGES__?.dispose();delete window.__TITLEBAR_BADGES_RUNTIME_VERSION__;';
const filenames = ['badges-client.js'];
const inspectExpression = "window.__ANTIGRAVITY_TITLEBAR_BADGES__?.inspect()||{state:'missing',reason:'Titlebar-Badges runtime is not attached'}";
const watchedNames = new Set([...filenames, 'badges-view.css']);
// 2026-11-25
// "Relocate titlebar update and announcement badges into the Antigravity app menu":
// https://github.com/dmitry-ai/antigravity-addons/issues/67
/**
 * @used-by Titlebar-Badges/tool.json
 * @used-by {@link import('../Upgrade/cdp-companion.js').Companion#loadModules}
 * @used-by {@link import('./badges.test.js')}
 * @used-by {@link import('./browser.test.js')}
 * @used-by {@link import('./cdp-runtime.js')}
 * @used-by {@link import('./verify.js')}
 */
const createTitlebarBadgesRuntime = ({invalidate, report} = {}) => {
	let timer;
	const watcher = fs.watch(__dirname, (_event, name) => {
		if (null === name || watchedNames.has(String(name))) {
			clearTimeout(timer);
			timer = setTimeout(() => {
				try {
					styleSheet();
					rendererSource();
					invalidate?.();
					report?.(null);
				}
				catch (error) {
					report?.(error.message);
				}
			}, 75);
		}
	});
	watcher.on('error', error => report?.(error.message));
	return {
		dispose() {
			clearTimeout(timer);
			watcher.close();
		},
		disposeExpression,
		inspectExpression,
		source: rendererSource,
		styleSheet
	};
};
/**
 * @used-by {@link createTitlebarBadgesRuntime}
 * @used-by {@link import('./browser.test.js')}
 * @used-by {@link import('./browser.test.js')} (openFixture)
 * @used-by {@link import('./cdp-runtime.js')}
 * @used-by {@link import('./verify.js')}
 * @uses {@link import('./badges-client.js').TitlebarBadgesController#dispose}
 * @uses {@link import('./badges-client.js').TitlebarBadgesController#sync}
 * @uses {@link import('./badges-client.js').installTitlebarBadges}
 */
const rendererSource = () => {
	const entries = filenames.map(name => `${JSON.stringify('./' + path.basename(name, '.js'))}:(module,exports,require)=>{\n${fs.readFileSync(path.join(__dirname, name), 'utf8')}\n}`).join(',');
	const bundle = `(()=>{const mods={${entries}},cache={},req=id=>{let m=cache[id];if(!m){m=cache[id]={exports:{}};mods[id](m,m.exports,req);}return m.exports;};req('./badges-client').installTitlebarBadges(window);})()`;
	const version = crypto.createHash('sha256').update(bundle).digest('hex');
	return `(() => {let r;if('/onboarding'===location.pathname||location.pathname.startsWith('/onboarding/')){window.__ANTIGRAVITY_TITLEBAR_BADGES__?.dispose();delete window.__TITLEBAR_BADGES_RUNTIME_VERSION__;r={attached:false,reason:'onboarding'};}else if(${JSON.stringify(version)}===window.__TITLEBAR_BADGES_RUNTIME_VERSION__){window.__ANTIGRAVITY_TITLEBAR_BADGES__?.sync?.();r={attached:true};}else{window.__ANTIGRAVITY_TITLEBAR_BADGES__?.dispose();${bundle}\n;window.__TITLEBAR_BADGES_RUNTIME_VERSION__=${JSON.stringify(version)};r={attached:true};}return r;})()`;
};
/**
 * @used-by {@link createTitlebarBadgesRuntime}
 * @used-by {@link import('./browser.test.js')}
 * @used-by {@link import('./browser.test.js')} (openFixture)
 * @used-by {@link import('./cdp-runtime.js')}
 * @used-by {@link import('./verify.js')}
 */
const styleSheet = () => fs.readFileSync(path.join(__dirname, 'badges-view.css'), 'utf8');
Object.assign(createTitlebarBadgesRuntime, {disposeExpression, filenames, inspectExpression, rendererSource, styleSheet});
module.exports = createTitlebarBadgesRuntime;