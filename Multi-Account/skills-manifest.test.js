// 2026-11-02 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Preserve inherited shared skills during A6 profile preparation":
// https://github.com/dmitry-ai/antigravity-addons/issues/19
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {prepareProfile} = require('./launcher');
const fixture = context => {
	const parent = path.resolve(os.tmpdir());
	const root = fs.mkdtempSync(path.join(parent, 'antigravity-skills-manifest-'));
	context.after(() => {
		assert.ok(path.resolve(root).startsWith(parent + path.sep));
		fs.rmSync(root, {recursive: true, force: true});
	});
	const skillsRoot = path.join(root, 'shared skills');
	fs.mkdirSync(path.join(skillsRoot, 'upwork-init'), {recursive: true});
	fs.writeFileSync(path.join(skillsRoot, 'upwork-init/SKILL.md'), '---\nname: upwork-init\ndescription: fixture\n---\n');
	const profile = {id: 'A6', skillsRoot, homeDir: path.join(root, 'A6/home'), userDataDir: path.join(root, 'A6')};
	const filename = path.join(profile.homeDir, '.gemini/config/skills.json');
	const put = (relative, value) => {
		const file = path.join(root, relative);
		fs.mkdirSync(path.dirname(file), {recursive: true});
		fs.writeFileSync(file, 'string' === typeof value ? value : JSON.stringify(value));
		return file;
	};
	return {root, profile, filename, put};
};
test('Inherited shared skills remain inherited through repeated A6 preparation without rewriting bytes', context => {
	const {profile, filename, put} = fixture(context);
	const shared = put('shared manifests/skills.json', {entries: [{path: profile.skillsRoot}]});
	const bytes = '\uFEFF{\r\n\t"inherits": [{"path": ' + JSON.stringify(shared) + '}],\r\n\t"note": "preserve exact formatting"\r\n}\r\n';
	fs.mkdirSync(path.dirname(filename), {recursive: true});
	fs.writeFileSync(filename, bytes);
	prepareProfile(profile);
	prepareProfile(profile);
	assert.equal(fs.readFileSync(filename, 'utf8'), bytes);
	assert.equal(fs.existsSync(path.join(path.dirname(filename), 'skills')), false);
});
test('Direct filtered references preserve user fields and exact bytes', context => {
	const {profile, filename} = fixture(context);
	fs.mkdirSync(path.dirname(filename), {recursive: true});
	const bytes = JSON.stringify({entries: [{path: profile.skillsRoot, include_only: ['upwork-init'], exclude: ['private']}], exclude: ['hidden'], custom: {keep: true}}, null, '\t') + '\r\n';
	fs.writeFileSync(filename, bytes);
	prepareProfile(profile);
	assert.equal(fs.readFileSync(filename, 'utf8'), bytes);
});
test('Inherited filtered references do not gain an unfiltered direct entry', context => {
	const {profile, filename, put} = fixture(context);
	const shared = put('shared/skills.json', {entries: [{path: profile.skillsRoot, include_only: ['upwork-init']}]});
	const original = {inherits: [{path: shared, exclude: ['private']}], entries: [], custom: 'keep'};
	fs.mkdirSync(path.dirname(filename), {recursive: true});
	fs.writeFileSync(filename, JSON.stringify(original));
	prepareProfile(profile);
	assert.deepEqual(JSON.parse(fs.readFileSync(filename)), original);
});
test('A missing shared reference is added once while unrelated inheritance and filters survive', context => {
	const {profile, filename, put} = fixture(context);
	const other = put('other/skills.json', {entries: [{path: path.join(profile.homeDir, 'private-skills'), include_only: ['private']}]});
	const original = {inherits: [{path: other}], entries: [{path: 'local-skills', exclude: ['hidden']}], custom: {keep: 'value'}};
	fs.mkdirSync(path.dirname(filename), {recursive: true});
	fs.writeFileSync(filename, JSON.stringify(original));
	prepareProfile(profile);
	const installed = JSON.parse(fs.readFileSync(filename));
	assert.deepEqual(installed, {...original, entries: [...original.entries, {path: profile.skillsRoot}]});
	const bytes = fs.readFileSync(filename);
	prepareProfile(profile);
	assert.deepEqual(fs.readFileSync(filename), bytes);
});
test('Nested inherited project manifests resolve paths from the directory containing .agents', context => {
	const {root, profile, filename, put} = fixture(context);
	put('team/.agents/leaf.json', {entries: [{path: path.relative(path.join(root, 'team'), profile.skillsRoot)}]});
	const shared = put('team/.agents/skills.json', {inherits: [{path: '.agents/leaf.json'}]});
	fs.mkdirSync(path.dirname(filename), {recursive: true});
	const original = JSON.stringify({inherits: [{path: shared}]});
	fs.writeFileSync(filename, original);
	prepareProfile(profile);
	assert.equal(fs.readFileSync(filename, 'utf8'), original);
});
test('Cyclic inherited manifests fail without rewriting the profile manifest', context => {
	const {profile, filename, put} = fixture(context);
	const first = put('shared/first.json', {inherits: [{path: 'second.json'}]});
	put('shared/second.json', {inherits: [{path: first}]});
	fs.mkdirSync(path.dirname(filename), {recursive: true});
	const original = JSON.stringify({inherits: [{path: first}]});
	fs.writeFileSync(filename, original);
	assert.throws(() => prepareProfile(profile), /Cyclic skills manifest inheritance/);
	assert.equal(fs.readFileSync(filename, 'utf8'), original);
});
test('Missing inherited manifests fail even when a direct shared reference exists', context => {
	const {profile, filename} = fixture(context);
	fs.mkdirSync(path.dirname(filename), {recursive: true});
	const original = JSON.stringify({entries: [{path: profile.skillsRoot}], inherits: [{path: 'missing.json'}]});
	fs.writeFileSync(filename, original);
	assert.throws(() => prepareProfile(profile), /Cannot read inherited skills manifest.*missing.json/);
	assert.equal(fs.readFileSync(filename, 'utf8'), original);
});
test('Malformed inherited JSON fails without flattening inheritance', context => {
	const {profile, filename, put} = fixture(context);
	const inherited = put('shared/skills.json', '{');
	fs.mkdirSync(path.dirname(filename), {recursive: true});
	const original = JSON.stringify({inherits: [{path: inherited}]});
	fs.writeFileSync(filename, original);
	assert.throws(() => prepareProfile(profile), /Invalid JSON in skills manifest/);
	assert.equal(fs.readFileSync(filename, 'utf8'), original);
});
for (const invalid of [[], {entries: null}, {inherits: {}}, {entries: [{}]}, {inherits: [{path: 1}]}, {entries: [{path: 'private', exclude: 'hidden'}]}, {inherits: [{path: 'private', include_only: [1]}]}, {exclude: {hidden: true}}]) {
	test('Malformed manifest is rejected before adding a direct entry: ' + JSON.stringify(invalid), context => {
		const {profile, filename} = fixture(context);
		fs.mkdirSync(path.dirname(filename), {recursive: true});
		const original = JSON.stringify(invalid);
		fs.writeFileSync(filename, original);
		assert.throws(() => prepareProfile(profile), /Invalid .*skills manifest/);
		assert.equal(fs.readFileSync(filename, 'utf8'), original);
	});
}
