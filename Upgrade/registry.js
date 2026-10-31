// 2026-10-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Build unified Upgrade tool (Upg), module registry (tool.json), Less stylesheet build pipeline, and verification runner after Antigravity 2.23.0 update":
// https://github.com/dmitry-ai/antigravity-addons/issues/6
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// 2026-10-30 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Extract Antigravity Addons into standalone code and meta (_) repositories, flatten tool directories, and prevent A6 working-directory locks":
// https://github.com/dmitry-ai/antigravity-addons/issues/15
const toolsRoot = path.resolve(__dirname, '..');
const discover = (root = toolsRoot) => {
	const r = [];
	const ids = new Set();
	for (const folder of fs.readdirSync(root, {withFileTypes: true}).filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
		const code = path.join(root, folder.name);
		const manifest = path.join(code, 'tool.json');
		if (!fs.existsSync(manifest)) {
			if (!['Upgrade', 'Multi-Account'].includes(folder.name) && fs.existsSync(code) && fs.readdirSync(code).some(file => /\.[cm]?js$/.test(file))) {
				throw new Error(`Add tool.json for tool ${folder.name}: ${code}`);
			}
		}
		else {
			const tool = JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, ''));
			if (1 !== tool.schemaVersion || 'string' !== typeof tool.id || !/^[a-z][a-z0-9-]*$/.test(tool.id) || ids.has(tool.id)) {
				throw new Error(`Invalid or duplicate module id: ${manifest}`);
			}
			ids.add(tool.id);
			if (tool.dependsOn && (!Array.isArray(tool.dependsOn) || tool.dependsOn.some(id => 'string' !== typeof id)) || undefined !== tool.order && !Number.isFinite(tool.order) || undefined !== tool.enabled && 'boolean' !== typeof tool.enabled) {
				throw new Error(`Invalid enabled, order, or dependsOn: ${manifest}`);
			}
			if (false !== tool.enabled) {
				if (undefined !== tool.runtimeFiles && (!Array.isArray(tool.runtimeFiles) || tool.runtimeFiles.some(file => 'string' !== typeof file))) {
					throw Error(`Invalid runtimeFiles: ${manifest}`);
				}
				tool.runtimeFiles = (tool.runtimeFiles || []).map(file => resolveFile(code, file));
				for (const field of ['prepare', 'validate', 'cdp']) {
					if (tool[field]) {
						tool[field] = resolveFile(code, tool[field]);
						new vm.Script(fs.readFileSync(tool[field], 'utf8'), {filename: tool[field]});
					}
				}
				if (!tool.cdp || tool.entry) {
					throw new Error(`Module requires cdp without legacy entry: ${manifest}`);
				}
				r.push({...tool, code, manifest, order: tool.order ?? 100, dependsOn: tool.dependsOn ?? []});
			}
		}
	}
	const pending = r.splice(0).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
	while (pending.length) {
		const index = pending.findIndex(tool => tool.dependsOn.every(id => r.some(dependency => dependency.id === id)));
		if (0 > index) {
			throw new Error(`Missing dependencies or cycle detected: ${pending.map(tool => tool.id).join(', ')}`);
		}
		r.push(pending.splice(index, 1)[0]);
	}
	return r;
};
const resolveFile = (code, relative) => {
	const r = path.resolve(code, relative);
	if (!r.startsWith(`${path.resolve(code)}${path.sep}`) || !fs.statSync(r).isFile()) {
		throw new Error(`Module file must be inside code: ${relative}`);
	}
	return r;
};
module.exports = {discover, resolveFile, toolsRoot};
