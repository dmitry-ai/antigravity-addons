const path = require('node:path');
const {parse} = require('acorn');
const walk = require('acorn-walk');
const loaderPath = path.join(__dirname, 'bootstrap.js').replace(/\\/g, '/');
const applyEdits = (source, edits) => {
	let r = source;
	for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
		r = r.slice(0, edit.start) + edit.text + r.slice(edit.end);
	}
	return r;
};
const findWindows = source => {
	const ast = parse(source, {ecmaVersion: 'latest'});
	const r = [];
	walk.fullAncestor(ast, (node, state, ancestors) => {
		if ('CallExpression' === node.type && 'loadURL' === member(node.callee) && 'Identifier' === node.callee.object?.type) {
			const func = [...ancestors].reverse().find(parent => /Function/.test(parent.type));
			if (func && 'BlockStatement' === func.body.type) {
				const object = node.callee.object.name;
				const definitions = func.body.body.filter(statement => 'VariableDeclaration' === statement.type).flatMap(statement => statement.declarations);
				const browser = definitions.find(declaration => object === declaration.id.name && 'NewExpression' === declaration.init?.type && 'BrowserWindow' === (member(declaration.init.callee) ?? declaration.init.callee.name));
				const statement = [...ancestors].reverse().find(parent => 'ExpressionStatement' === parent.type);
				if (browser && statement && 'Identifier' === node.arguments[0]?.type && func.params.some(parameter => node.arguments[0].name === parameter.name)) {
					r.push({node, func, object, statement});
				}
			}
		}
	});
	return r;
};
const member = node => node?.computed ? node.property?.value : node?.property?.name;
const quote = value => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`;
const transform = (snapshot, toolsRoot) => {
	const root = toolsRoot ? path.resolve(toolsRoot).replace(/\\/g, '/') : undefined;
	const candidates = [];
	for (const entry of snapshot.entries.filter(item => 'file' === item.type && !item.record.unpacked && !item.path.startsWith('node_modules/') && /\.js$/.test(item.path))) {
		const source = entry.content.toString('utf8');
		if (source.includes('loadURL') && source.includes('BrowserWindow')) {
			for (const window of findWindows(source)) {
				candidates.push({entry, source, window});
			}
		}
	}
	if (1 !== candidates.length || 'module' === snapshot.manifest.type) {
		throw new Error(`Не поддерживается точка создания окна Antigravity ${snapshot.manifest.version}; совпадений: ${candidates.length}. Архив не изменён.`);
	}
	const {entry, source, window} = candidates[0];
	const edits = [];
	let hooked = false;
	let connected = false;
	for (const statement of window.func.body.body.filter(node => 'TryStatement' === node.type && node.start < window.statement.start)) {
		const requires = [];
		walk.simple(statement.block, {CallExpression: node => {
			if ('require' === node.callee.callee?.name && 'string' === typeof node.callee.arguments[0]?.value) {
				requires.push({filename: node.callee.arguments[0].value.replace(/\\/g, '/'), root: node.arguments[1]?.properties?.find(property => 'root' === (property.key?.name ?? property.key?.value))?.value?.value});
			}
		}});
		const own = requires.find(item => loaderPath === item.filename);
		if (own) {
			hooked = true;
		}
		if (own && root === own.root) {
			connected = true;
		}
		else if (1 === statement.block.body.length && requires.some(item => /\/CSS\/code\/bootstrap\.js$/.test(item.filename) || /\/Upgrade\/code\/bootstrap\.js$/.test(item.filename))) {
			edits.push({start: statement.start, end: statement.end, text: ''});
		}
	}
	if (!connected) {
		const indentation = source.slice(source.lastIndexOf('\n', window.statement.start - 1) + 1, window.statement.start).match(/^\s*/)[0];
		edits.push({start: window.statement.start, end: window.statement.start, text: `try { require(${quote(loaderPath)})(${window.object}${root ? `, {root: ${quote(root)}}` : ''}); } catch (error) { console.error('[antigravity-upgrade]', error); }\n${indentation}`});
	}
	const patched = applyEdits(source, edits);
	parse(patched, {ecmaVersion: 'latest'});
	return {changed: source !== patched, file: entry.path, hooked, replacements: new Map([[entry.path, Buffer.from(patched)]])};
};
module.exports = {findWindows, loaderPath, transform};
