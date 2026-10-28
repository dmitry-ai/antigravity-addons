const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const toolsRoot = path.resolve(__dirname, '../..');
const discover = (root = toolsRoot) => {
	const r = [];
	const ids = new Set();
	for (const folder of fs.readdirSync(root, {withFileTypes: true}).filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
		const code = path.join(root, folder.name, 'code');
		const manifest = path.join(code, 'tool.json');
		if (!fs.existsSync(manifest)) {
			if ('Upgrade' !== folder.name && fs.existsSync(code) && fs.readdirSync(code).some(file => /\.[cm]?js$/.test(file))) {
				throw new Error(`Добавьте code/tool.json для инструмента ${folder.name}: ${code}`);
			}
		}
		else {
			const tool = JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, ''));
			if (1 !== tool.schemaVersion || 'string' !== typeof tool.id || !/^[a-z][a-z0-9-]*$/.test(tool.id) || ids.has(tool.id)) {
				throw new Error(`Некорректный или повторяющийся id модуля: ${manifest}`);
			}
			ids.add(tool.id);
			if (tool.dependsOn && (!Array.isArray(tool.dependsOn) || tool.dependsOn.some(id => 'string' !== typeof id)) || undefined !== tool.order && !Number.isFinite(tool.order) || undefined !== tool.enabled && 'boolean' !== typeof tool.enabled) {
				throw new Error(`Некорректные enabled, order или dependsOn: ${manifest}`);
			}
			if (false !== tool.enabled) {
				if (tool.runtimeFiles !== undefined && (!Array.isArray(tool.runtimeFiles) || tool.runtimeFiles.some(file => typeof file !== 'string'))) throw Error(`Некорректный runtimeFiles: ${manifest}`);
				tool.runtimeFiles = (tool.runtimeFiles || []).map(file => resolveFile(code, file));
				for (const field of ['entry', 'prepare', 'validate', 'cdp']) {
					if (tool[field]) {
						tool[field] = resolveFile(code, tool[field]);
						new vm.Script(fs.readFileSync(tool[field], 'utf8'), {filename: tool[field]});
					}
				}
				if (!tool.entry && !tool.cdp) {
					throw new Error(`У модуля нет entry или cdp: ${manifest}`);
				}
				r.push({...tool, code, manifest, order: tool.order ?? 100, dependsOn: tool.dependsOn ?? []});
			}
		}
	}
	const pending = r.splice(0).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
	while (pending.length) {
		const index = pending.findIndex(tool => tool.dependsOn.every(id => r.some(dependency => dependency.id === id)));
		if (0 > index) {
			throw new Error(`Не найдены зависимости или обнаружен цикл: ${pending.map(tool => tool.id).join(', ')}`);
		}
		r.push(pending.splice(index, 1)[0]);
	}
	return r;
};
const resolveFile = (code, relative) => {
	const r = path.resolve(code, relative);
	if (!r.startsWith(`${path.resolve(code)}${path.sep}`) || !fs.statSync(r).isFile()) {
		throw new Error(`Файл модуля должен находиться внутри code: ${relative}`);
	}
	return r;
};
module.exports = {discover, resolveFile, toolsRoot};
