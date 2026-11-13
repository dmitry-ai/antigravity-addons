// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
const fs = require('node:fs');
const path = require('node:path');
const build = require('./build');
module.exports = ({invalidate, report}) => {
	let timer;
	const rebuild = () => {
		clearTimeout(timer);
		timer = setTimeout(() => build().then(() => {
			invalidate?.();
			report(null);
		}).catch(error => report(error.message)), 100);
	};
	const watchers = [
		fs.watch(__dirname, (_event, name) => {
			if ('style.less' === String(name)) {
				rebuild();
			}
		}),
		fs.watch(path.join(__dirname, 'less'), rebuild)
	];
	for (const watcher of watchers) {
		watcher.on('error', error => report(error.message));
	}
	return {
		dispose() {
			clearTimeout(timer);
			for (const watcher of watchers) {
				watcher.close();
			}
		},
		styleSheet: () => fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8')
	};
};
