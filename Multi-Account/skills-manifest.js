// 2026-11-02 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Preserve inherited shared skills during A6 profile preparation":
// https://github.com/dmitry-ai/antigravity-addons/issues/19
const fs = require('node:fs');
const path = require('node:path');
const object = value => value && 'object' === typeof value && !Array.isArray(value);
const identity = value => 'win32' === process.platform ? value.toLowerCase() : value;
const canonical = value => identity(fs.realpathSync(value));
const location = (filename, value) => path.resolve('.agents' === path.basename(path.dirname(filename)) ? path.dirname(path.dirname(filename)) : path.dirname(filename), value);
const validate = (manifest, filename) => {
	if (!object(manifest)) {
		throw Error('Invalid skills manifest object: ' + filename);
	}
	for (const field of ['entries', 'inherits']) {
		if (undefined !== manifest[field] && !Array.isArray(manifest[field])) {
			throw Error('Invalid ' + field + ' in skills manifest: ' + filename);
		}
		for (const entry of manifest[field] || []) {
			if (!object(entry) || 'string' !== typeof entry.path || !entry.path.trim() || /\0/.test(entry.path)) {
				throw Error('Invalid ' + field + ' path in skills manifest: ' + filename);
			}
			for (const filter of ['include_only', 'exclude']) {
				if (undefined !== entry[filter] && (!Array.isArray(entry[filter]) || entry[filter].some(value => 'string' !== typeof value))) {
					throw Error('Invalid ' + field + ' ' + filter + ' in skills manifest: ' + filename);
				}
			}
		}
	}
	if (undefined !== manifest.exclude && (!Array.isArray(manifest.exclude) || manifest.exclude.some(value => 'string' !== typeof value))) {
		throw Error('Invalid exclude in skills manifest: ' + filename);
	}
};
const read = filename => {
	let data;
	try {
		data = fs.readFileSync(filename);
	}
	catch (error) {
		throw Error('Cannot read inherited skills manifest ' + filename + ': ' + error.message, {cause: error});
	}
	let manifest;
	try {
		manifest = JSON.parse(data.toString('utf8').replace(/^\uFEFF/, ''));
	}
	catch (error) {
		throw Error('Invalid JSON in skills manifest ' + filename + ': ' + error.message, {cause: error});
	}
	validate(manifest, filename);
	return {data, manifest};
};
const ensureSharedSkills = (filename, skillsRoot) => {
	filename = path.resolve(filename);
	const original = fs.existsSync(filename) ? read(filename) : {data: null, manifest: {entries: []}};
	const target = canonical(skillsRoot);
	const active = new Set();
	const visited = new Map();
	const visit = (current, manifest) => {
		let key;
		try {
			key = canonical(current);
		}
		catch (error) {
			throw Error('Cannot resolve inherited skills manifest ' + current + ': ' + error.message, {cause: error});
		}
		if (active.has(key)) {
			throw Error('Cyclic skills manifest inheritance: ' + current);
		}
		if (visited.has(key)) {
			return visited.get(key);
		}
		active.add(key);
		let found = (manifest.entries || []).some(entry => {
			const source = location(current, entry.path);
			return fs.existsSync(source) && canonical(source) === target;
		});
		for (const inherited of manifest.inherits || []) {
			const source = location(current, inherited.path);
			const value = read(source).manifest;
			found = visit(source, value) || found;
		}
		active.delete(key);
		visited.set(key, found);
		return found;
	};
	let found;
	if (original.data) {
		found = visit(filename, original.manifest);
	}
	else {
		found = false;
	}
	if (found) {
		return {changed: false, filename};
	}
	for (let current = filename; ; current = path.dirname(current)) {
		if (fs.lstatSync(current, {throwIfNoEntry: false})?.isSymbolicLink()) {
			throw Error('Linked skills manifest path requires explicit configuration; preserved: ' + filename);
		}
		if (path.dirname(current) === current) {
			break;
		}
	}
	const current = fs.existsSync(filename) ? fs.readFileSync(filename) : null;
	if (null === original.data ? null !== current : !current || !original.data.equals(current)) {
		throw Error('Skills manifest changed during profile preparation; preserved: ' + filename);
	}
	const manifest = original.manifest;
	manifest.entries = [...(manifest.entries || []), {path: skillsRoot}];
	fs.mkdirSync(path.dirname(filename), {recursive: true});
	fs.writeFileSync(filename, JSON.stringify(manifest, null, 2));
	return {changed: true, filename};
};
module.exports = {ensureSharedSkills};
