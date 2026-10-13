const {parse, tokenizer} = require('../../Upgrade/code/node_modules/acorn');
const walk = require('../../Upgrade/code/node_modules/acorn-walk');
const addProperties = (edits, node, properties) => {
	edits.push({start: node.end - 1, end: node.end - 1, text: `${node.properties.length ? ',' : ''}${properties}`});
};
const applyEdits = (source, edits) => {
	let r = source;
	let boundary = source.length + 1;
	for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
		if (edit.end > boundary) {
			throw new Error('Пересекающиеся изменения клиентского кода');
		}
		r = r.slice(0, edit.start) + edit.text + r.slice(edit.end);
		boundary = edit.start;
	}
	return r;
};
const applyLayout = (source, layout, replacement, prefix) => {
	const edits = [{start: layout.row.loop.start, end: layout.row.loop.end, text: remap(replacement, layout.row.names).replace('__ORIGINAL_LOOP_BODY__', layout.row.body)}];
	const {section, header, project, empty, virtual, hook, memo, react} = layout;
	const row = getProperty(section.node.arguments[1], 'data-title').object.name;
	addProperties(edits, section.node.arguments[1], `'data-folder-id':${row}.folderId,'data-folder-depth':${row}.folderDepth`);
	addProperties(edits, section.node.arguments[2].arguments[1], `folderId:${row}.folderId,folderDepth:${row}.folderDepth`);
	addProperties(edits, header.func.params[0], 'folderId:__folderId,folderDepth:__folderDepth');
	const title = getValue(getProperty(header.func.params[0], 'title'));
	addProperties(edits, header.node.arguments[1], `'data-title':${title},'data-folder-id':__folderId,'data-folder-depth':__folderDepth`);
	const item = getValue(getProperty(project.func.params[0], 'item'));
	const projectId = getValue(getProperty(project.func.params[0], 'projectId'));
	addProperties(edits, project.node.arguments[1], `'data-project-id':${projectId},'data-folder-id':${item}?.folderId,'data-folder-depth':${item}?.folderDepth`);
	addProperties(edits, empty.node.arguments[1], `'data-testid':'empty-placeholder','data-folder-id':${row}.folderId,'data-folder-depth':${row}.folderDepth`);
	addProperties(edits, virtual.node.arguments[1], `'data-group-id':${row}.groupId,'data-folder-id':${row}.folderId,'data-folder-depth':${row}.folderDepth`);
	const style = getProperty(virtual.node.arguments[1], 'style');
	const styleText = source.slice(style.start, style.end);
	edits.push({start: style.start, end: style.end, text: `null!=${row}.folderDepth?{...(${styleText}),'--folder-depth':${row}.folderDepth}:(${styleText})`});
	edits.push({start: hook.body.start + 1, end: hook.body.start + 1, text: `const [__folderRevision,__setFolderRevision]=(0,${react}.useState)(0);(0,${react}.useEffect)(()=>{const __listener=()=>__setFolderRevision(__v=>__v+1);window.addEventListener('antigravity-folders-updated',__listener);return()=>window.removeEventListener('antigravity-folders-updated',__listener)},[]);`});
	edits.push({start: memo.end - 1, end: memo.end - 1, text: ',__folderRevision'});
	return prefix + applyEdits(source, edits);
};
const collectLayout = source => {
	const ast = parse(source, {ecmaVersion: 'latest'});
	const rows = [];
	const sites = {section: [], header: [], project: [], empty: [], virtual: []};
	const calls = [];
	walk.fullAncestor(ast, (node, state, ancestors) => {
		if ('FunctionDeclaration' === node.type) {
			const declarations = node.body.body.filter(statement => 'VariableDeclaration' === statement.type).flatMap(statement => statement.declarations);
			const fields = new Map(declarations.filter(declaration => 'MemberExpression' === declaration.init?.type).map(declaration => [getMember(declaration.init), declaration.id.name]));
			const returned = node.body.body.find(statement => 'ReturnStatement' === statement.type)?.argument;
			if (fields.has('groups') && fields.has('groupBy') && fields.has('variant') && fields.has('sectionHeader') && 'Identifier' === returned?.type) {
				rows.push({node, declarations, fields, returned});
			}
		}
		if ('CallExpression' === node.type) {
			if ('Identifier' === node.callee.type) {
				calls.push({node, ancestors: [...ancestors]});
			}
			if ('createElement' === getMember(node.callee)) {
				const options = node.arguments[1];
				const firstClass = getProperty(options, 'className')?.arguments?.[0]?.value;
				const site = {node, func: getFunction(ancestors)};
				if (getProperty(options, 'data-project-card')) {
					sites.project.push(site);
				}
				if ('section-header' === getProperty(options, 'data-testid')?.value && getProperty(node.arguments[2]?.arguments?.[1], 'title')) {
					sites.section.push(site);
				}
				if (firstClass?.startsWith('group/section-header ')) {
					sites.header.push(site);
				}
				if (firstClass?.startsWith('pr-2.5 select-none ') && firstClass.includes('opacity-30')) {
					sites.empty.push(site);
				}
				if (getProperty(options, 'data-index') && 'id' === getMember(getProperty(options, 'key'))) {
					sites.virtual.push(site);
				}
			}
		}
	});
	const row = requireOne(rows, 'генератор строк');
	const loopCandidates = [];
	walk.simple(row.node.body, {CallExpression: node => {
		if ('forEach' === getMember(node.callee) && 'ConditionalExpression' === node.callee.object?.type && source.slice(node.callee.object.test.start, node.callee.object.test.end).includes(`${row.fields.get('sectionHeader')}?.isCollapsed`)) {
			loopCandidates.push(node);
		}
	}});
	const loop = requireOne(loopCandidates, 'цикл проектов');
	const collapse = row.declarations.filter(declaration => 'ArrowFunctionExpression' === declaration.init?.type && source.slice(declaration.init.start, declaration.init.end).includes(`${row.fields.get('collapsedSectionHeaderIds')}.includes(`));
	const caller = requireOne(calls.filter(call => call.node.callee.name === row.node.id.name), 'вызов генератора строк');
	const memoCall = requireOne(caller.ancestors.filter(node => 'CallExpression' === node.type && 'useMemo' === getMember(node.callee)), 'React useMemo');
	const hook = requireOne(caller.ancestors.filter(node => /Function/.test(node.type) && getProperty(node.params[0], 'includePinnedSection')), 'React hook списка');
	const react = memoCall.callee.expressions?.at(-1)?.object?.name ?? memoCall.callee.object?.name;
	const r = {
		...Object.fromEntries(Object.entries(sites).map(([name, matches]) => [name, requireOne(matches, name)])),
		hook,
		memo: memoCall.arguments[1],
		react,
		row: {
			node: row.node,
			loop,
			body: source.slice(loop.arguments[0].body.start + 1, loop.arguments[0].body.end - 1),
			names: {b: row.fields.get('groups'), c: row.fields.get('groupBy'), h: row.fields.get('sectionHeader'), l: row.fields.get('variant'), q: row.returned.name, t: requireOne(collapse, 'состояние раскрытия папок').id.name, v: loop.arguments[0].params[0].name}
		}
	};
	if (!react || 'ArrayExpression' !== r.memo?.type || 'ObjectPattern' !== r.header.func.params[0]?.type || 'ObjectPattern' !== r.project.func.params[0]?.type) {
		throw new Error('Изменилась структура React-компонентов Antigravity');
	}
	return r;
};
const getFunction = ancestors => [...ancestors].reverse().find(node => /Function/.test(node.type));
const getMember = node => 'SequenceExpression' === node?.type ? getMember(node.expressions.at(-1)) : node?.computed ? node.property?.value : node?.property?.name;
const getProperty = (node, name) => node?.properties?.find(property => name === (property.key?.name ?? property.key?.value))?.value;
const getValue = node => 'AssignmentPattern' === node?.type ? node.left.name : node?.name;
const remap = (source, names) => {
	const edits = [];
	for (const token of tokenizer(source, {ecmaVersion: 'latest'})) {
		if ('name' === token.type.label && names[token.value] && token.value !== names[token.value]) {
			edits.push({start: token.start, end: token.end, text: names[token.value]});
		}
	}
	return applyEdits(source, edits);
};
const requireOne = (matches, description) => {
	if (1 !== matches.length) {
		throw new Error(`Неоднозначная или неподдерживаемая структура: ${description}; совпадений: ${matches.length}`);
	}
	return matches[0];
};
module.exports = {applyLayout, collectLayout, remap};
