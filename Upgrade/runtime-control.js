// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const {stateRoot, runtimeVersion} = require('./cdp-companion');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const readState = () => {
	let r = null;
	try {
		r = JSON.parse(fs.readFileSync(path.join(stateRoot, 'runtime.json'), 'utf8'));
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
const ensureRunning = async () => {
	let r;
	result: {
		const existing = readState();
		if (alive(existing) && existing.version === runtimeVersion() && existing.runtimePath === path.join(__dirname, 'cdp-companion.js')) {
			r = existing;
			break result;
		}
		if (alive(existing)) {
			await stopRuntime();
		}
		fs.mkdirSync(stateRoot, {recursive: true});
		const child = cp.spawn(process.execPath, [path.join(__dirname, 'cdp-companion.js')], {detached: true, windowsHide: true, stdio: 'ignore'});
		child.unref();
		for (let attempt = 0; 30 > attempt; attempt++) {
			await pause(200);
			const current = readState();
			if (alive(current)) {
				r = current;
				break result;
			}
		}
		throw Error(`CDP runtime did not start; inspect ${stateRoot}`);
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
const stopRuntime = async () => {
	result: {
		const state = readState();
		if (!alive(state)) {
			break result;
		}
		fs.writeFileSync(path.join(stateRoot, 'control.json'), JSON.stringify({instance: state.instance, action: 'stop'}));
		for (let attempt = 0; 40 > attempt; attempt++) {
			await pause(200);
			if ('stopped' === readState()?.state) {
				break result;
			}
		}
		throw Error('The Tools runtime did not acknowledge shutdown; Antigravity was left running');
	}
};
module.exports = {readState, alive, ensureRunning, installStartup, stopRuntime};
