const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {validateTree} = require('./folders-manager');
module.exports = async ({bundlePath} = {}) => {
	const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'folders.json'), 'utf8'));
	validateTree(data.folders);
	for (const filename of ['cdp-runtime.js', 'folders-store.js', 'folders-model.js', 'antigravity-adapter.js', 'folders-client.js', 'folders-view.js', 'folders-manager.js', 'renderer-source.js', 'runtime-health.js']) {
		new vm.Script(fs.readFileSync(path.join(__dirname, filename), 'utf8'), {filename});
	}
	new vm.Script(require('./renderer-source').rendererSource(data));
	let message = 'модель, хранилище и независимый компонент проверены; клиентский main.js не изменяется.';
	if (bundlePath) {
		const digest = require('node:crypto').createHash('sha256').update(fs.readFileSync(bundlePath)).digest('hex');
		message += ` Контрольный SHA-256 клиентского файла: ${digest}; его структура не используется.`;
	}
	return {message};
};
