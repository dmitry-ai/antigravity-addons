// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const {stateRoot, runtimeVersion} = require('./cdp-companion');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const readState = (root = stateRoot) => {
	let r = null;
	try {
		r = JSON.parse(fs.readFileSync(path.join(root, 'runtime.json'), 'utf8'));
	}
	catch {
		r = null;
	}
	return r;
};
const alive = state => {
	let r = false;
	if (state?.pid) {
		try {
			process.kill(state.pid, 0);
			r = 'stopped' !== state.state && 30000 > Date.now() - Date.parse(state.updated);
		}
		catch {
			r = false;
		}
	}
	return r;
};
const ensureRunning = async ({root = stateRoot, delay = 200} = {}) => {
	let r;
	result: {
		const expectedVersion = runtimeVersion();
		const expectedPath = path.join(__dirname, 'cdp-companion.js');
		const existing = readState(root);
		if (alive(existing) && existing.version === expectedVersion && existing.runtimePath === expectedPath) {
			r = existing;
			break result;
		}
		if (alive(existing)) {
			await stopRuntime({root, delay});
		}
		fs.mkdirSync(root, {recursive: true});
		// 2026-10-31 Dmitrii Fediuk https://github.com/dmitrii-fediuk
		// "Add Project settings action to project context menu in Folders":
		// https://github.com/dmitry-ai/antigravity-addons/issues/17
		const shortcut = 'win32' === process.platform ? path.join(process.env.APPDATA || '', 'Microsoft/Windows/Start Menu/Programs/Startup/Antigravity Tools (CDP).lnk') : '';
		const explorer = 'win32' === process.platform ? path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe') : '';
		const spawnDirect = () => {
			const child = cp.spawn(process.execPath, [expectedPath], {detached: true, windowsHide: true, stdio: 'ignore'});
			child.unref();
		};
		const viaShell = Boolean(shortcut && fs.existsSync(shortcut) && fs.existsSync(explorer));
		if (viaShell) {
			cp.spawn(explorer, [shortcut], {detached: true, windowsHide: true, stdio: 'ignore'}).unref();
		}
		else {
			spawnDirect();
		}
		for (let attempt = 0; 30 > attempt; attempt++) {
			if (10 === attempt && viaShell) {
				spawnDirect();
			}
			await pause(delay);
			const current = readState(root);
			if (alive(current) && current.version === expectedVersion && current.instance !== existing?.instance) {
				r = current;
				break result;
			}
		}
		throw Error(`CDP runtime did not start; inspect ${root}`);
	}
	return r;
};
const installStartup = () => {
	if ('win32' !== process.platform) {
		throw Error('This setup is for Windows');
	}
	const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
	return cp.execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'install-startup.ps1'), '-NodePath', process.execPath], {encoding: 'utf8', windowsHide: true, timeout: 10000}).trim();
};
// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Diagnose Tools companion stop timeout, verify automatic Tools recovery via A6 launcher, and consolidate 14 legacy journals into Unified Journal":
// https://github.com/dmitry-ai/antigravity-addons/issues/13
const stopRuntime = async ({root = stateRoot, delay = 200} = {}) => {
	result: {
		const state = readState(root);
		if (!alive(state)) {
			break result;
		}
		fs.writeFileSync(path.join(root, 'control.json'), JSON.stringify({instance: state.instance, action: 'stop'}));
		for (let attempt = 0; 40 > attempt; attempt++) {
			await pause(delay);
			if ('stopped' === readState(root)?.state) {
				break result;
			}
		}
		throw Error('The Tools runtime did not acknowledge shutdown; Antigravity was left running');
	}
};
module.exports = {readState, alive, ensureRunning, installStartup, stopRuntime};
