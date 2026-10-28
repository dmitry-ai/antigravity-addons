const fs = require('node:fs');
const path = require('node:path');
const build = require('./build');
module.exports = ({report}) => {
	let timer;
	const rebuild = () => { clearTimeout(timer); timer = setTimeout(() => build().then(() => report(null)).catch(error => report(error.message)), 100); };
	const watchers = [fs.watch(__dirname, (_event, name) => {if (String(name) === 'style.less') rebuild();}), fs.watch(path.join(__dirname, 'less'), rebuild)];
	for (const watcher of watchers) watcher.on('error', error => report(error.message));
	return {
		styleSheet: () => fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8'),
		dispose() {clearTimeout(timer); for (const watcher of watchers) watcher.close();}
	};
};
