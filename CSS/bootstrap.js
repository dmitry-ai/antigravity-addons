const fs = require('fs');
const path = require('path');
const build = require('./build');
const cssFile = 'style.css';
const cssPath = path.join(__dirname, cssFile);
module.exports = win => {
	const wc = win.webContents;
	wc.__antigravityCustomUi?.dispose();
	let key = '';
	let queue = Promise.resolve();
	let timer = null;
	let disposed = false;
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
		if (!disposed && false === wc.isDestroyed() && true === fs.existsSync(cssPath)) {
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
	const ready = () => {
		queue = queue.then(() => {
			key = '';
		});
		apply();
	};
	wc.on('dom-ready', ready);
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		clearTimeout(timer);
		watcher.close();
		lessWatcher.close();
		wc.removeListener('dom-ready', ready);
		win.removeListener('closed', dispose);
		if (wc.__antigravityCustomUi?.dispose === dispose) delete wc.__antigravityCustomUi;
		queue = queue.then(async () => { if (key && !wc.isDestroyed()) await wc.removeInsertedCSS(key); key = ''; }).catch(log);
	};
	wc.__antigravityCustomUi = {dispose, apply};
	win.on('closed', dispose);
	rebuild();
	// A window discovered after dom-ready still needs its initial stylesheet.
	if (wc.getURL?.() && !wc.isLoading?.()) apply();
};
