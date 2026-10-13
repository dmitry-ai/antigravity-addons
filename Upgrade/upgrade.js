const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const archive = require('./archive');
const host = require('./host');
const registry = require('./registry');
const acquireLock = directory => {
	fs.mkdirSync(directory, {recursive: true});
	const filename = path.join(directory, 'operation.lock');
	if (fs.existsSync(filename)) {
		const lock = JSON.parse(fs.readFileSync(filename, 'utf8'));
		let alive = true;
		try {
			process.kill(lock.pid, 0);
		}
		catch (error) {
			if ('ESRCH' === error.code) {
				alive = false;
			}
		}
		if (alive) {
			throw new Error(`Восстановление уже выполняется процессом ${lock.pid}`);
		}
		fs.rmSync(filename);
	}
	const descriptor = fs.openSync(filename, 'wx');
	try {
		fs.writeFileSync(descriptor, JSON.stringify({pid: process.pid, created: new Date().toISOString()}));
	}
	finally {
		fs.closeSync(descriptor);
	}
	return () => fs.rmSync(filename, {force: true});
};
const assertCompatibleExecutable = archivePath => {
	const executable = path.resolve(path.dirname(archivePath), '../Antigravity.exe');
	if (fs.existsSync(executable)) {
		const binary = fs.readFileSync(executable);
		const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
		const index = binary.indexOf(sentinel);
		const start = index + sentinel.length;
		if (0 > index || 1 !== binary[start] || 5 > binary[start + 1]) {
			throw new Error('Не удалось проверить ограничения этой версии Electron. Требуется адаптация Upgrade; архив не изменён.');
		}
		if (48 !== binary[start + 6]) {
			throw new Error('В этой версии Electron включён контроль встроенного ASAR. Требуется другой способ подключения инструментов; архив не изменён.');
		}
	}
};
const assertStopped = () => {
	if ('win32' !== process.platform) {
		throw new Error('Эта установка предназначена для Windows');
	}
	const output = childProcess.execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq Antigravity.exe', '/FO', 'CSV', '/NH'], {encoding: 'utf8', windowsHide: true, timeout: 15000});
	if (/^"Antigravity\.exe"/im.test(output)) {
		throw new Error('Antigravity работает. Сохраните работу и полностью выйдите через Ctrl+Q / Quit в трее во всех профилях Windows, затем запустите ярлык повторно.');
	}
};
const findArchive = appDirectory => {
	let r;
	const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local');
	const directories = appDirectory ? [path.resolve(appDirectory)] : [process.env.ANTIGRAVITY_APP_DIR, path.join(local, 'Programs/antigravity'), process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Antigravity')].filter(Boolean);
	const candidates = directories.flatMap(directory => [path.join(directory, 'resources/app.asar'), path.join(directory, 'app.asar')]);
	r = candidates.find(filename => fs.existsSync(filename));
	if (!r) {
		throw new Error('Antigravity не найден. Укажите --app-dir "папка установки Antigravity".');
	}
	return fs.realpathSync(r);
};
const parseArguments = argumentsList => {
	const r = {mode: 'apply'};
	const modes = [];
	for (let index = 0; index < argumentsList.length; index++) {
		const argument = argumentsList[index];
		if (['--check', '--dry-run', '--restore', '--help'].includes(argument)) {
			modes.push(argument.slice(2));
			r.mode = argument.slice(2);
		}
		else {
			const field = {'--app-dir': 'appDirectory', '--bundle': 'bundlePath', '--state-dir': 'stateRoot', '--tools-root': 'toolsRoot'}[argument];
			if (!field || !argumentsList[index + 1] || argumentsList[index + 1].startsWith('--')) {
				throw new Error(`Некорректный аргумент: ${argument}`);
			}
			r[field] = path.resolve(argumentsList[++index]);
		}
	}
	if (1 < modes.length) {
		throw new Error('Выберите один режим: --check, --dry-run или --restore');
	}
	return r;
};
const prepare = async (tools, context, log) => {
	for (const tool of tools) {
		if (tool.prepare) {
			await require(tool.prepare)(context);
		}
		if (tool.validate) {
			const validation = await require(tool.validate)(context);
			if (validation?.message) {
				log(`${tool.name || tool.id}: ${validation.message}`);
			}
		}
	}
};
const replace = (target, source, expectedHash, expectedUnpackedHash, asar, stop) => {
	const temporary = `${target}.upgrade-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
	try {
		fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
		const descriptor = fs.openSync(temporary, 'r+');
		try {
			fs.fsyncSync(descriptor);
		}
		finally {
			fs.closeSync(descriptor);
		}
		stop();
		const current = archive.read(asar, target);
		if (expectedHash !== current.hash || expectedUnpackedHash !== current.unpackedHash) {
			throw new Error('Установка изменилась во время восстановления. Запустите скрипт повторно.');
		}
		fs.renameSync(temporary, target);
		asar.uncache(target);
	}
	finally {
		fs.rmSync(temporary, {force: true});
	}
};
const restore = (asar, snapshot, directory, stop, log) => {
	const records = fs.existsSync(directory) ? fs.readdirSync(directory).filter(filename => filename.endsWith('.json')).map(filename => JSON.parse(fs.readFileSync(path.join(directory, filename), 'utf8'))) : [];
	const record = records.find(item => snapshot.hash === item.patchedHash && snapshot.manifest.version === item.version && snapshot.path === item.archivePath);
	let r = {status: 'clean', version: snapshot.manifest.version};
	if (!record) {
		if (host.transform(snapshot).hooked) {
			throw new Error('Для этого архива нет подходящей резервной копии Upgrade. Откат на чужую или предыдущую версию запрещён.');
		}
		log('Хук Upgrade не установлен: откат не требуется. Старые резервные копии не применяются.');
	}
	else {
		const backup = path.join(directory, `${record.originalHash}.asar`);
		if (record.originalHash !== archive.digest(fs.readFileSync(backup)) || record.unpackedHash !== snapshot.unpackedHash) {
			throw new Error('Резервная копия повреждена или распакованные файлы принадлежат другой установке');
		}
		replace(snapshot.path, backup, snapshot.hash, snapshot.unpackedHash, asar, stop);
		if (record.originalHash !== archive.read(asar, snapshot.path).hash) {
			throw new Error('Не удалось проверить восстановленный архив');
		}
		r = {status: 'restored', version: record.version, backup};
		log(`Восстановлен исходный архив Antigravity ${record.version}. Файлы инструментов сохранены.`);
	}
	return r;
};
const run = async (options = {}) => {
	const mode = options.mode || 'apply';
	if (!['apply', 'check', 'dry-run', 'restore'].includes(mode)) {
		throw new Error(`Неизвестный режим: ${mode}`);
	}
	const log = options.log || console.log;
	const stop = options.assertStopped || assertStopped;
	const archivePath = options.archivePath ? fs.realpathSync(options.archivePath) : findArchive(options.appDirectory);
	const stateRoot = path.resolve(options.stateRoot || path.join(__dirname, 'state'));
	const directory = path.join(stateRoot, archive.digest(archivePath.toLowerCase()).slice(0, 20));
	const workRoot = path.resolve(options.workRoot || path.join(__dirname, 'work'));
	const mutating = ['apply', 'restore'].includes(mode);
	let release;
	let scratch;
	let r;
	try {
		if (mutating) {
			stop();
			release = acquireLock(directory);
		}
		const asar = await import('@electron/asar');
		const snapshot = archive.read(asar, archivePath);
		log(`Antigravity ${snapshot.manifest.version}: ${archivePath}`);
		if ('restore' === mode) {
			r = restore(asar, snapshot, directory, stop, log);
		}
		else {
			assertCompatibleExecutable(archivePath);
			const tools = registry.discover(options.toolsRoot || registry.toolsRoot);
			if (!tools.length) {
				throw new Error('В реестре нет включённых инструментов');
			}
			await prepare(tools, {dryRun: true, version: snapshot.manifest.version, bundlePath: options.bundlePath}, log);
			const patch = host.transform(snapshot, options.toolsRoot);
			const common = {version: snapshot.manifest.version, tools: tools.map(tool => tool.id), file: patch.file, unpackedFiles: snapshot.entries.filter(entry => 'file' === entry.type && entry.record.unpacked).length};
			if ('check' === mode || !patch.changed) {
				if ('apply' === mode) {
					await prepare(tools, {dryRun: false, version: snapshot.manifest.version, bundlePath: options.bundlePath}, log);
				}
				r = {...common, status: patch.changed ? 'needs-upgrade' : 'ready'};
				log(patch.changed ? `Требуется восстановление: ${common.tools.join(', ')}.` : `Все включённые модули подключены: ${common.tools.join(', ')}.`);
			}
			else {
				fs.mkdirSync(workRoot, {recursive: true});
				scratch = fs.mkdtempSync(path.join(workRoot, 'upgrade-'));
				const stagedPath = path.join(scratch, 'app.asar');
				await archive.pack(asar, snapshot, patch.replacements, stagedPath);
				const staged = archive.read(asar, stagedPath, archivePath);
				archive.verify(snapshot, staged, patch.replacements);
				if ('dry-run' === mode) {
					r = {...common, status: 'dry-run', originalHash: snapshot.hash, patchedHash: staged.hash};
					log('Пробная сборка проверена. Установленный архив не изменён.');
				}
				else {
					const backup = path.join(directory, `${snapshot.hash}.asar`);
					if (!fs.existsSync(backup)) {
						fs.copyFileSync(archivePath, backup, fs.constants.COPYFILE_EXCL);
					}
					if (snapshot.hash !== archive.digest(fs.readFileSync(backup))) {
						throw new Error('Не удалось проверить резервную копию');
					}
					const record = {archivePath, originalHash: snapshot.hash, patchedHash: staged.hash, unpackedHash: snapshot.unpackedHash, version: snapshot.manifest.version, tools: common.tools, created: new Date().toISOString()};
					writeRecord(path.join(directory, `${snapshot.hash}-${staged.hash.slice(0, 12)}.json`), record);
					await prepare(tools, {dryRun: false, version: snapshot.manifest.version, bundlePath: options.bundlePath}, log);
					replace(archivePath, stagedPath, snapshot.hash, snapshot.unpackedHash, asar, stop);
					try {
						archive.verify(snapshot, archive.read(asar, archivePath), patch.replacements);
					}
					catch (error) {
						replace(archivePath, backup, staged.hash, snapshot.unpackedHash, asar, stop);
						throw new Error(`Проверка установки не прошла; исходный архив восстановлен: ${error.message}`);
					}
					r = {...common, status: 'applied', backup};
					log(`Восстановлено: ${common.tools.join(', ')}. Проверено файлов вне архива: ${common.unpackedFiles}.`);
					log(`Резервная копия: ${backup}`);
				}
			}
		}
	}
	finally {
		if (scratch) {
			const resolved = path.resolve(scratch);
			if (!resolved.startsWith(`${workRoot}${path.sep}`)) {
				throw new Error(`Путь очистки выходит за пределы work: ${resolved}`);
			}
			fs.rmSync(resolved, {force: true, recursive: true});
		}
		release?.();
	}
	return r;
};
const writeRecord = (filename, record) => {
	const temporary = `${filename}.${process.pid}.tmp`;
	try {
		fs.writeFileSync(temporary, JSON.stringify(record, null, '\t') + '\n');
		fs.renameSync(temporary, filename);
	}
	finally {
		fs.rmSync(temporary, {force: true});
	}
};
if (require.main === module) {
	Promise.resolve().then(() => {
		const options = parseArguments(process.argv.slice(2));
		return 'help' === options.mode ? console.log('node upgrade.js [--check | --dry-run | --restore] [--app-dir PATH] [--bundle main.js] [--state-dir PATH] [--tools-root PATH]') : run(options);
	}).then(result => {
		if ('needs-upgrade' === result?.status) {
			process.exitCode = 2;
		}
	}).catch(error => {
		console.error(`Ошибка: ${error.message}`);
		process.exitCode = 1;
	});
}
module.exports = {assertCompatibleExecutable, assertStopped, findArchive, parseArguments, run};
