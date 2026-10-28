const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {validateTree} = require('./folders-manager');
module.exports = async ({bundlePath} = {}) => {
	const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'folders.json'), 'utf8'));
	validateTree(data.folders);
	for (const filename of ['folders-bootstrap.js', 'folders-host.js', 'folders-store.js', 'folders-model.js', 'antigravity-adapter.js', 'folders-client.js', 'folders-view.js', 'folders-manager.js', 'legacy-migration.js', 'renderer-source.js', 'runtime-health.js']) {
		new vm.Script(fs.readFileSync(path.join(__dirname, filename), 'utf8'), {filename});
	}
	new vm.Script(require('./renderer-source').rendererSource(data));
	let message = 'модель, хранилище и независимый компонент проверены; клиентский main.js не изменяется.';
	if (bundlePath) {
		const source = fs.readFileSync(bundlePath, 'utf8');
		if (require('./legacy-migration').applyFolderPatch(source) !== source) throw Error('Vendor client bytes must not be changed');
		message += ' Переданный клиентский файл сохранён побайтно.';
	}
	const runtime = await require('./runtime-health').inspectRuntime();
	if (runtime.state === 'ready') message += ` API и дерево проверены через CDP во всех открытых окнах (${runtime.windows.length}).`;
	else message += ' Проверка работающего интерфейса не выполнена: Antigravity/CDP сейчас недоступен.';
	return {message, runtime};
};
