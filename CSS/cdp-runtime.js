// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace Less build pipeline and tracked CSS/style.css with native Chromium CSS concatenated in memory":
// https://github.com/dmitry-ai/antigravity-addons/issues/43
const fs = require('node:fs');
const path = require('node:path');
const filenames = ['base.css', 'compact.css', 'folders.css', 'indent.css', 'chat.css'];
const watchedNames = new Set(filenames);
const styleSheet = () => filenames.map(filename => fs.readFileSync(path.join(__dirname, filename), 'utf8')).join('\n');
const createCssRuntime = ({invalidate, report} = {}) => {
	let timer;
	const watcher = fs.watch(__dirname, (_event, name) => {
		if (null === name || watchedNames.has(String(name))) {
			clearTimeout(timer);
			timer = setTimeout(() => {
				try {
					styleSheet();
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
		styleSheet
	};
};
Object.assign(createCssRuntime, {filenames, styleSheet});
module.exports = createCssRuntime;
