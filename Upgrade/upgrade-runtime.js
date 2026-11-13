// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace Less build pipeline and tracked CSS/style.css with native Chromium CSS concatenated in memory":
// https://github.com/dmitry-ai/antigravity-addons/issues/43
const registry = require('./registry');
const control = require('./runtime-control');
const {inspectRuntime} = require('./runtime-health');
const run = async (options = {}) => {
	let r;
	result: {
		const mode = options.mode || 'apply';
		const log = options.log || console.log;
		if ('restore' === mode) {
			await control.stopRuntime();
			const cp = require('node:child_process');
			const path = require('node:path');
			cp.execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'install-startup.ps1'), '-Remove', '-NodePath', process.execPath], {windowsHide: true});
			log('Background Tools loader stopped and removed from startup. Antigravity was not terminated.');
			r = {status: 'stopped'};
			break result;
		}
		if (!['apply', 'check', 'dry-run'].includes(mode)) {
			throw Error(`Unknown mode: ${mode}`);
		}
		const tools = registry.discover(options.toolsRoot);
		for (const tool of tools) {
			if (!tool.cdp) {
				throw Error(`Module ${tool.id} does not declare a CDP adapter`);
			}
		}
		if ('apply' === mode) {
			const startup = control.installStartup();
			await control.ensureRunning();
			log(`Tools startup registered: ${startup}`);
		}
		for (const tool of tools) {
			if (tool.validate) {
				const validation = await require(tool.validate)();
				if (validation?.message) {
					log(`${tool.name}: ${validation.message}`);
				}
			}
		}
		const state = control.readState();
		if ('dry-run' === mode) {
			log('Sources and configuration verified. Antigravity installation was not modified.');
			r = {status: 'dry-run'};
			break result;
		}
		if (!control.alive(state)) {
			throw Error('Background Tools loader is not running. Run Upg.');
		}
		if ('error' === state.state) {
			throw Error(`Tools loader error: ${JSON.stringify(state.errors)}`);
		}
		const deadline = Date.now() + ('apply' === mode ? 15000 : 0);
		let runtime;
		for (;;) {
			try {
				runtime = await inspectRuntime({expectedTools: tools.map(tool => tool.id), toolsRoot: options.toolsRoot});
				break;
			}
			catch (error) {
				if (Date.now() >= deadline) {
					throw error;
				}
				await new Promise(resolve => setTimeout(resolve, 300));
			}
		}
		if ('ready' !== runtime.state) {
			log('waiting-for-sign-in' === runtime.state ? `Tools is waiting for sign-in to complete: ${runtime.windows.filter(window => 'ready' !== window.state).map(window => window.profile).join(', ')}. CSS is connected; Folders is waiting for the main interface.` : 'Tools is waiting for Antigravity to open. Modules will attach via CDP on launch; app.asar is not modified.');
			r = {status: 'waiting', tools: tools.map(tool => tool.id), runtime};
			break result;
		}
		log(`${tools.map(tool => tool.id).join(', ')} running via CDP; windows checked: ${runtime.windows.length}. Antigravity installation was not modified.`);
		r = {status: 'ready', tools: tools.map(tool => tool.id), runtime};
	}
	return r;
};
module.exports = {run};
