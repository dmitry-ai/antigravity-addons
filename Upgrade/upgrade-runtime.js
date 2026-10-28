const registry = require('./registry');
const control = require('./runtime-control');
const run = async (options = {}) => {
	const mode = options.mode || 'apply', log = options.log || console.log;
	if (mode === 'restore') {
		await control.stopRuntime();
		const cp = require('node:child_process'), path = require('node:path');
		cp.execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'install-startup.ps1'), '-Remove', '-NodePath', process.execPath], {windowsHide: true});
		log('Фоновый загрузчик Tools остановлен и убран из автозагрузки. Antigravity не завершался.');
		return {status: 'stopped'};
	}
	if (!['apply', 'check', 'dry-run'].includes(mode)) throw Error(`Неизвестный режим: ${mode}`);
	const tools = registry.discover(options.toolsRoot);
	for (const tool of tools) {
		if (!tool.cdp) throw Error(`Модуль ${tool.id} не объявляет адаптер CDP`);
		if (tool.prepare) await require(tool.prepare)({dryRun: mode !== 'apply'});
	}
	if (mode === 'apply') {const startup = control.installStartup(); await control.ensureRunning(); log(`Автозагрузка Tools: ${startup}`);}
	for (const tool of tools) if (tool.validate) {const result = await require(tool.validate)(); if (result?.message) log(`${tool.name}: ${result.message}`);}
	const state = control.readState();
	if (mode === 'dry-run') {log('Исходники и конфигурация проверены. Установка Antigravity не изменялась.'); return {status: 'dry-run'};}
	if (!control.alive(state)) throw Error('Фоновый загрузчик Tools не работает. Запустите Upg.');
	if (state.state === 'error') throw Error(`Ошибка загрузчика Tools: ${JSON.stringify(state.errors)}`);
	const deadline = Date.now() + (mode === 'apply' ? 15000 : 0);
	let runtime;
	for (;;) {
		try {runtime = await require('../../Folders/code/runtime-health').inspectRuntime({expectedTools: tools.map(tool => tool.id)}); break;}
		catch (error) {if (Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 300));}
	}
	if (runtime.state !== 'ready') {log(runtime.state === 'waiting-for-sign-in' ? `Tools ожидает завершения входа: ${runtime.windows.filter(window => window.state !== 'ready').map(window => window.profile).join(', ')}. CSS подключён; Folders ожидает основной интерфейс.` : 'Tools ожидает открытия Antigravity. При запуске модули подключатся через CDP; app.asar не изменяется.'); return {status: 'waiting', tools: tools.map(tool => tool.id), runtime};}
	log(`${tools.map(tool => tool.id).join(', ')} работают через CDP; проверено окон: ${runtime.windows.length}. Установка Antigravity не изменялась.`);
	return {status: 'ready', tools: tools.map(tool => tool.id), runtime};
};
module.exports = {run};
