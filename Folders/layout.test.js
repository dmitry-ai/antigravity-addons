const test = require('node:test');
const assert = require('node:assert/strict');
const {parse} = require('../../Upgrade/code/node_modules/acorn');
const {collectProjectLoop} = require('./folders-layout');
const selection = 'h?.isCollapsed?b.filter(item=>item.id==="standalone"):b';
const fixture = body => {
	const source = `function rows(a){var b=a.groups,h=a.sectionHeader;${body}}`;
	const row = {node: parse(source, {ecmaVersion: 'latest'}).body[0], fields: new Map([['groups', 'b'], ['sectionHeader', 'h']])};
	return {source, row};
};
test('Project selection supports both the inline loop and the assigned selection in 2.27', () => {
	for (const body of [
		`(${selection}).forEach(item=>{});`,
		`var selected=false;selected=${selection};selected.forEach(item=>{});`,
		`const selected=${selection};const alias=selected;alias.forEach(item=>{});`
	]) {
		const {source, row} = fixture(body);
		const loop = collectProjectLoop(row);
		assert.equal(source.slice(loop.start, loop.end).endsWith('.forEach(item=>{})'), true);
	}
});
test('Project selection ignores unrelated iterations and nested function bindings', () => {
	const {source, row} = fixture(`b.forEach(item=>{});var selected=${selection};function nested(){selected=b;selected.forEach(item=>{});}selected.forEach(project=>{});`);
	const loop = collectProjectLoop(row);
	assert.equal(source.slice(loop.start, loop.end), 'selected.forEach(project=>{})');
});
test('A reassigned, missing, or ambiguous project selection is rejected', () => {
	for (const body of [
		`var selected=${selection};selected=b;selected.forEach(item=>{});`,
		`function nested(){var selected=${selection};selected.forEach(item=>{});}`,
		`var selected=h?.isCollapsed?b.filter(item=>true):other;selected.forEach(item=>{});`,
		`var selected=${selection};selected.forEach(item=>{});selected.forEach(item=>{});`
	]) {
		const {row} = fixture(body);
		assert.throws(() => collectProjectLoop(row), /цикл проектов; совпадений: [02]/);
	}
});
