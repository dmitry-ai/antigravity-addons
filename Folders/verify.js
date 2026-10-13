const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {validateTree} = require('./folders-manager');
module.exports = ({bundlePath} = {}) => {
	const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'folders.json'), 'utf8'));
	validateTree(data.folders);
	for (const filename of ['folders-bootstrap.js', 'folders-client.js', 'folders-layout.js', 'folders-manager.js', 'folders-patch.js']) {
		new vm.Script(fs.readFileSync(path.join(__dirname, filename), 'utf8'), {filename});
	}
	let r = {message: 'конфигурация и синтаксис проверены; структура main.js будет проверена при загрузке интерфейса.'};
	if (bundlePath) {
		const source = fs.readFileSync(bundlePath, 'utf8');
		const patched = require('./folders-patch').applyFolderPatch(source, data, {strict: true});
		if (patched === source) {
			throw new Error('Folders не преобразовал клиентский код');
		}
		new vm.Script(patched);
		r = {message: 'преобразование предоставленного main.js и его синтаксис проверены.'};
	}
	return r;
};
