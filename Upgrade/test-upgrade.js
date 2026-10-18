const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const archive = require('./archive');
const host = require('./host');
const {discover} = require('./registry');
const {assertCompatibleExecutable, assertStopped, isNodeProcess, run} = require('./upgrade');
const workRoot = path.join(__dirname, 'work');

test('all later windows, including fourth and sixth, receive modules once through native creation events', () => {
	const app = new EventEmitter(), module = {exports: {}}, existing = [];
	const make = (url = '') => {
		const win = new EventEmitter();win.loaded = [];win.isDestroyed = () => false;
		win.webContents = new EventEmitter();win.webContents.getURL = () => url;
		win.navigate = value => {url = value;win.webContents.emit('did-start-navigation', {}, url, false, true);win.webContents.emit('dom-ready');};
		return win;
	};
	const main = make('https://127.0.0.1:54321/');existing.push(main);
	const loader = vm.compileFunction(fs.readFileSync(path.join(__dirname, 'bootstrap.js'), 'utf8'), ['require', 'module', 'console']);
	loader(name => 'electron' === name ? {app, BrowserWindow: {getAllWindows: () => existing}} : './registry' === name ? {discover: () => [{id: 'css', entry: 'css'}, {id: 'folders', entry: 'folders'}]} : win => win.loaded.push(name), module, console);
	module.exports(main);
	for (let index = 2; index <= 6; index++) {
		const win = make();app.emit('browser-window-created', {}, win);
		win.navigate('https://127.0.0.1:54321/');module.exports(win);
		assert.deepEqual(win.loaded, ['css', 'folders'], `Window ${index}`);
		win.emit('closed');assert.equal(win.webContents.listenerCount('dom-ready'), 0);
	}
	assert.deepEqual(main.loaded, ['css', 'folders']);assert.equal(app.listenerCount('browser-window-created'), 1);
	const external = make();app.emit('browser-window-created', {}, external);external.navigate('https://example.com/');assert.deepEqual(external.loaded, []);
});

test('a failed module is retried on ready without duplicating successful modules', () => {
	const app = new EventEmitter(), module = {exports: {}}, win = new EventEmitter();
	win.isDestroyed = () => false;win.webContents = new EventEmitter();win.webContents.getURL = () => 'https://localhost:54321/';
	let attempts = 0, applied = 0;
	const loader = vm.compileFunction(fs.readFileSync(path.join(__dirname, 'bootstrap.js'), 'utf8'), ['require', 'module', 'console']);
	loader(name => 'electron' === name ? {app, BrowserWindow: {getAllWindows: () => [win]}} : './registry' === name ? {discover: () => [{id: 'css', entry: 'css'}, {id: 'folders', entry: 'folders'}]} : 'css' === name ? () => applied++ : () => {if (++attempts === 1) throw Error('temporary');}, module, {error() {}});
	module.exports(win);win.webContents.emit('dom-ready');
	assert.equal(attempts, 2);assert.equal(applied, 1);
});
const fixture = async (context, version = '2.23.0', filename = 'window.js') => {
	fs.mkdirSync(workRoot, {recursive: true});
	const directory = fs.mkdtempSync(path.join(workRoot, 'upgrade-тест-'));
	context.after(() => {
		const resolved = path.resolve(directory);
		assert.ok(resolved.startsWith(`${path.resolve(workRoot)}${path.sep}`));
		fs.rmSync(resolved, {force: true, recursive: true});
	});
	const source = path.join(directory, 'source');
	fs.mkdirSync(path.join(source, 'dist'), {recursive: true});
	fs.mkdirSync(path.join(source, 'native'), {recursive: true});
	fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({name: 'antigravity', version, main: `dist/${filename}`}));
	fs.writeFileSync(path.join(source, 'dist', filename), 'const electron = require(\'electron\'); function makeWindow(location) { const view = new electron.BrowserWindow(); void view.loadURL(location); return view; } module.exports = makeWindow;');
	fs.writeFileSync(path.join(source, 'native/worker.dll'), Buffer.from([0, 1, 255, 42]));
	fs.writeFileSync(path.join(source, 'other.js'), 'module.exports = 42;');
	const archivePath = path.join(directory, 'app.asar');
	const asar = await import('@electron/asar');
	await asar.createPackageWithOptions(source, archivePath, {unpack: '*.dll'});
	const raw = asar.getRawHeader(archivePath);
	raw.header.files['other.js'].executable = true;
	fs.writeFileSync(archivePath, Buffer.concat([archive.encodeHeader(raw.header), fs.readFileSync(archivePath).subarray(8 + raw.headerSize)]));
	asar.uncache(archivePath);
	const toolsRoot = path.join(directory, 'tools');
	const tool = path.join(toolsRoot, 'Alpha/code');
	fs.mkdirSync(tool, {recursive: true});
	fs.writeFileSync(path.join(tool, 'tool.json'), JSON.stringify({schemaVersion: 1, id: 'alpha', entry: 'entry.js'}));
	fs.writeFileSync(path.join(tool, 'entry.js'), 'module.exports = win => { win.loaded.push(\'alpha\'); };');
	return {directory, archivePath, toolsRoot, stateRoot: path.join(directory, 'state'), workRoot: path.join(directory, 'scratch'), asar, assertStopped: () => {}, log: () => {}};
};
test('Install, repeat, and restore preserve bytes, executable flags, and separately unpacked files', async context => {
	const options = await fixture(context);
	const before = archive.read(options.asar, options.archivePath);
	const result = await run(options);
	assert.equal(result.status, 'applied');
	const after = archive.read(options.asar, options.archivePath);
	assert.notEqual(after.hash, before.hash);
	assert.equal(after.unpackedHash, before.unpackedHash);
	assert.equal(after.entries.find(entry => 'other.js' === entry.path).record.executable, true);
	assert.equal(after.entries.find(entry => 'other.js' === entry.path).hash, before.entries.find(entry => 'other.js' === entry.path).hash);
	assert.equal(after.entries.find(entry => 'dist/window.js' === entry.path).record.integrity.hash, after.entries.find(entry => 'dist/window.js' === entry.path).hash);
	const repeated = await run(options);
	assert.equal(repeated.status, 'ready');
	assert.equal(archive.read(options.asar, options.archivePath).hash, after.hash);
	const restored = await run({...options, mode: 'restore'});
	assert.equal(restored.status, 'restored');
	assert.equal(archive.read(options.asar, options.archivePath).hash, before.hash);
});
test('An update never restores an older backup and uses the new file name and window variable', async context => {
	const old = await fixture(context, '2.22.0', 'old-host.js');
	await run(old);
	const updated = await fixture(context, '2.23.0', 'new-host.js');
	fs.copyFileSync(updated.archivePath, old.archivePath);
	const clean = archive.read(old.asar, old.archivePath);
	const restored = await run({...old, mode: 'restore'});
	assert.equal(restored.status, 'clean');
	assert.equal(archive.read(old.asar, old.archivePath).hash, clean.hash);
	const applied = await run(old);
	assert.equal(applied.version, '2.23.0');
	assert.equal(applied.file, 'dist/new-host.js');
	await run({...old, mode: 'restore'});
	assert.equal(archive.read(old.asar, old.archivePath).hash, clean.hash);
});
test('Unknown host layout and a running process leave the installed archive unchanged', async context => {
	const options = await fixture(context);
	const before = archive.read(options.asar, options.archivePath);
	await assert.rejects(run({...options, assertStopped: () => {throw new Error('running');}}), /running/);
	assert.equal(archive.read(options.asar, options.archivePath).hash, before.hash);
	const modified = new Map([['dist/window.js', Buffer.from('module.exports = 0;')]]);
	const unsupported = path.join(options.directory, 'unsupported.asar');
	await archive.pack(options.asar, before, modified, unsupported);
	fs.copyFileSync(unsupported, options.archivePath);
	const hash = archive.digest(fs.readFileSync(options.archivePath));
	await assert.rejects(run(options), /Не поддерживается/);
	assert.equal(archive.digest(fs.readFileSync(options.archivePath)), hash);
});
test('Check and dry run perform no installation or backup writes', async context => {
	const options = await fixture(context);
	const before = archive.digest(fs.readFileSync(options.archivePath));
	assert.equal((await run({...options, mode: 'check'})).status, 'needs-upgrade');
	assert.equal((await run({...options, mode: 'dry-run'})).status, 'dry-run');
	assert.equal(archive.digest(fs.readFileSync(options.archivePath)), before);
	assert.equal(fs.existsSync(options.stateRoot), false);
});
test('New modules are discovered automatically, ordered by dependencies, and run once per window', async context => {
	const options = await fixture(context);
	const beta = path.join(options.toolsRoot, 'Beta/code');
	fs.mkdirSync(beta, {recursive: true});
	fs.writeFileSync(path.join(beta, 'tool.json'), JSON.stringify({schemaVersion: 1, id: 'beta', entry: 'entry.js', dependsOn: ['alpha'], order: 0}));
	fs.writeFileSync(path.join(beta, 'entry.js'), 'module.exports = win => { win.loaded.push(\'beta\'); };');
	assert.deepEqual(discover(options.toolsRoot).map(tool => tool.id), ['alpha', 'beta']);
	const module = {exports: {}};
	const loader = vm.compileFunction(fs.readFileSync(path.join(__dirname, 'bootstrap.js'), 'utf8'), ['require', 'module', 'console']);
	loader(name => './registry' === name ? {discover: () => discover(options.toolsRoot)} : 'electron' === name ? {} : require(name), module, console);
	const win = {loaded: [], isDestroyed: () => false};
	module.exports(win);
	module.exports(win);
	assert.deepEqual(win.loaded, ['alpha', 'beta']);
	const broken = path.join(options.toolsRoot, 'Broken/code');
	fs.mkdirSync(broken, {recursive: true});
	fs.writeFileSync(path.join(broken, 'entry.js'), 'module.exports = () => {};');
	assert.throws(() => discover(options.toolsRoot), /tool.json/);
});
test('Dependency cycles, duplicate IDs, and missing entry files stop installation', async context => {
	const options = await fixture(context);
	const manifest = path.join(options.toolsRoot, 'Alpha/code/tool.json');
	fs.writeFileSync(manifest, JSON.stringify({schemaVersion: 1, id: 'alpha', entry: 'entry.js', dependsOn: ['alpha']}));
	await assert.rejects(run(options), /цикл/);
	fs.writeFileSync(manifest, JSON.stringify({schemaVersion: 1, id: 'alpha', entry: '../outside.js'}));
	assert.throws(() => discover(options.toolsRoot), /внутри code/);
	fs.writeFileSync(manifest, JSON.stringify({schemaVersion: 1, id: 'alpha', entry: 'missing.js'}));
	assert.throws(() => discover(options.toolsRoot), /ENOENT/);
	fs.writeFileSync(manifest, JSON.stringify({schemaVersion: 1, id: 'alpha', entry: 'entry.js'}));
	const duplicate = path.join(options.toolsRoot, 'Duplicate/code');
	fs.mkdirSync(duplicate, {recursive: true});
	fs.writeFileSync(path.join(duplicate, 'tool.json'), JSON.stringify({schemaVersion: 1, id: 'alpha', entry: 'entry.js'}));
	fs.writeFileSync(path.join(duplicate, 'entry.js'), 'module.exports = () => {};');
	assert.throws(() => discover(options.toolsRoot), /повторяющийся/);
});
test('A concurrent updater changing the archive before replacement is detected', async context => {
	const options = await fixture(context);
	let calls = 0;
	const stop = () => {
		calls++;
		if (2 === calls) {
			fs.appendFileSync(options.archivePath, Buffer.from([99]));
		}
	};
	await assert.rejects(run({...options, assertStopped: stop}), /изменилась во время/);
	assert.equal(fs.readFileSync(options.archivePath).at(-1), 99);
});
test('An unpacked file changed after installation blocks rollback', async context => {
	const options = await fixture(context);
	await run(options);
	const before = archive.digest(fs.readFileSync(options.archivePath));
	fs.appendFileSync(path.join(`${options.archivePath}.unpacked`, 'native/worker.dll'), Buffer.from([88]));
	await assert.rejects(run({...options, mode: 'restore'}), /распакованные файлы/);
	assert.equal(archive.digest(fs.readFileSync(options.archivePath)), before);
});
test('Legacy CSS hooks migrate to one shared loader', () => {
	const source = "const electron = require('electron'); function createWindow(url) { const win = new electron.BrowserWindow(); try { require('C:/old/CSS/code/bootstrap.js')(win); } catch (e) { console.error(e); } void win.loadURL(url); return win; }";
	const snapshot = {manifest: {version: '2.22.0'}, entries: [{path: 'renamed/host.js', type: 'file', record: {}, content: Buffer.from(source)}]};
	const patched = host.transform(snapshot).replacements.get('renamed/host.js').toString();
	assert.equal(patched.includes('C:/old/CSS/code/bootstrap.js'), false);
	assert.equal(patched.split(host.loaderPath).length - 1, 1);
	assert.equal(host.transform({...snapshot, entries: [{...snapshot.entries[0], content: Buffer.from(patched)}]}).changed, false);
});
test('Native Electron integrity checks stop unsupported modification before any archive write', async context => {
	const options = await fixture(context);
	const executable = path.join(options.directory, 'Antigravity.exe');
	const location = path.join(options.directory, 'resources/app.asar');
	const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
	const before = archive.digest(fs.readFileSync(options.archivePath));
	fs.writeFileSync(executable, Buffer.concat([sentinel, Buffer.from([1, 9]), Buffer.from('101100011')]));
	assert.doesNotThrow(() => assertCompatibleExecutable(location));
	fs.writeFileSync(executable, Buffer.concat([sentinel, Buffer.from([1, 9]), Buffer.from('101110011')]));
	assert.throws(() => assertCompatibleExecutable(location), /контроль встроенного ASAR/);
	fs.writeFileSync(executable, Buffer.from('unknown format'));
	assert.throws(() => assertCompatibleExecutable(location), /Требуется адаптация/);
	assert.equal(archive.digest(fs.readFileSync(options.archivePath)), before);
});
const nodeSidecar = context => {
	fs.mkdirSync(workRoot, {recursive: true});
	const directory = fs.mkdtempSync(path.join(workRoot, 'процессы-тест-'));
	context.after(() => {
		const resolved = path.resolve(directory);
		assert.ok(resolved.startsWith(`${path.resolve(workRoot)}${path.sep}`));
		fs.rmSync(resolved, {force: true, recursive: true});
	});
	const wrapper = path.join(directory, 'Antigravity/bin/agy-node.cmd');
	fs.mkdirSync(path.dirname(wrapper), {recursive: true});
	const executable = 'C:\\Users\\Имя пользователя\\Programs\\antigravity\\Antigravity.exe';
	fs.writeFileSync(wrapper, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${executable}" %*\r\n`);
	const args = '--import=file:///C:/Users/user/.gemini/antigravity/lib/node_modules/sidecar_sdk/register_loader.js dist/server.cjs';
	const info = {ProcessId: 34068, CommandLine: `"${executable}"  ${args}`, ParentName: 'cmd.exe', ParentCommandLine: `C:\\Windows\\system32\\cmd.exe /c "${wrapper}" ${args}`};
	return {wrapper, executable, info};
};
test('The official Node wrapper identifies a sidecar without treating windowless Electron as stopped', {skip: 'win32' !== process.platform}, context => {
	const {wrapper, executable, info} = nodeSidecar(context);
	assert.equal(isNodeProcess(info), true);
	assert.equal(isNodeProcess({...info, ParentCommandLine: info.ParentCommandLine.replace(`"${wrapper}"`, wrapper)}), true);
	assert.equal(isNodeProcess({...info, CommandLine: `"${executable}"`}), false);
	assert.equal(isNodeProcess({...info, CommandLine: `"${executable}" --type=utility`}), false);
	assert.equal(isNodeProcess({...info, ParentName: 'Antigravity.exe'}), false);
	assert.equal(isNodeProcess({...info, ParentCommandLine: null}), false);
	assert.equal(isNodeProcess({...info, CommandLine: null}), false);
	assert.equal(isNodeProcess({...info, ParentCommandLine: info.ParentCommandLine + ' --extra'}), false);
	fs.writeFileSync(wrapper, `@echo off\n"${executable}" %*\n`);
	assert.equal(isNodeProcess(info), false);
	fs.writeFileSync(wrapper, '@echo off\nset ELECTRON_RUN_AS_NODE=1\n"C:\\Other\\Antigravity.exe" %*\n');
	assert.equal(isNodeProcess(info), false);
	fs.rmSync(wrapper);
	assert.equal(isNodeProcess(info), false);
});
test('Process checks allow the Node sidecar and still block GUI or inaccessible processes with their PIDs', {skip: 'win32' !== process.platform}, context => {
	const {info} = nodeSidecar(context);
	let processes = [info];
	context.mock.method(childProcess, 'execFileSync', () => JSON.stringify(processes));
	assert.doesNotThrow(() => assertStopped());
	processes = [];
	assert.doesNotThrow(() => assertStopped());
	processes = [info, {ProcessId: 456, CommandLine: '"C:\\Programs\\Antigravity.exe"', ParentName: 'explorer.exe'}];
	assert.throws(() => assertStopped(), /Antigravity работает \(PID: 456\)/);
	processes = [{ProcessId: 789, CommandLine: null}];
	assert.throws(() => assertStopped(), /PID: 789/);
	processes = {};
	assert.throws(() => assertStopped(), /неверный ответ Windows/);
});
