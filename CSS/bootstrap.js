const fs = require('fs');
const path = require('path');
const cssFile = 'style.css';
const cssPath = path.join(__dirname, cssFile);
module.exports = win => {
	try { require('C:/work/research/provision/code/Software/Google/AI/Antigravity/primary/tools/Folders/code/folders-bootstrap.js')(win); } catch (e) { console.error('[folders-bootstrap]', e); }
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
	});
	watcher.on('error', log);
	wc.on('dom-ready', () => {
		queue = queue.then(() => {
			key = '';
		});
		apply();
	});
	win.on('closed', () => {
		clearTimeout(timer);
		watcher.close();
	});
};
