const fs = require('fs');
const path = require('path');
const build = require('./build');
const cssFile = 'style.css';
const cssPath = path.join(__dirname, cssFile);
module.exports = win => {
	const wc = win.webContents;
	let key = '';
	let queue = Promise.resolve();
	let timer = null;
	const apply = () => {
		queue = queue.then(replace).catch(log);
	};
	const debounce = () => {
		clearTimeout(timer);
		timer = setTimeout(apply, 100);
	};
	const log = e => {
		console.error('[custom-ui]', e);
	};
	const rebuild = () => {
		build().catch(log);
	};
	const replace = async () => {
		if (false === wc.isDestroyed() && true === fs.existsSync(cssPath)) {
			const css = fs.readFileSync(cssPath, 'utf8');
			if ('' !== key) {
				await wc.removeInsertedCSS(key);
			}
			key = await wc.insertCSS(css);
		}
	};
	const watcher = fs.watch(__dirname, (_, f) => {
		if (cssFile === f) {
			debounce();
		}
		if ('style.less' === f || null === f) {
			rebuild();
		}
	});
	watcher.on('error', log);
	const lessWatcher = fs.watch(path.join(__dirname, 'less'), rebuild);
	lessWatcher.on('error', log);
	wc.on('dom-ready', () => {
		queue = queue.then(() => {
			key = '';
		});
		apply();
	});
	win.on('closed', () => {
		clearTimeout(timer);
		watcher.close();
		lessWatcher.close();
	});
	rebuild();
};
