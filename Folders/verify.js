const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {validateTree} = require('./folders-manager');
module.exports = async () => {
	const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'folders.json'), 'utf8'));
	validateTree(data.folders);
	for (const filename of ['cdp-runtime.js', 'folders-store.js', 'folders-model.js', 'antigravity-adapter.js', 'folders-client.js', 'folders-view.js', 'folders-manager.js', 'renderer-source.js', 'runtime-health.js']) {
		new vm.Script(fs.readFileSync(path.join(__dirname, filename), 'utf8'), {filename});
	}
	new vm.Script(require('./renderer-source').rendererSource(data));
	const message = 'модель, хранилище и независимый компонент проверены; клиентский main.js не изменяется.';
	return {message};
};
