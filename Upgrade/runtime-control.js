const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const {stateRoot, runtimeVersion} = require('./cdp-companion');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const readState = () => { try {return JSON.parse(fs.readFileSync(path.join(stateRoot, 'runtime.json'), 'utf8'));} catch {return null;} };
const alive = state => { try {if (!state?.pid) return false; process.kill(state.pid, 0); return state.state !== 'stopped' && Date.now() - Date.parse(state.updated) < 30000;} catch {return false;} };
const ensureRunning = async () => {
	const existing = readState();
	if (alive(existing) && existing.version === runtimeVersion() && existing.runtimePath === path.join(__dirname, 'cdp-companion.js')) return existing;
	if (alive(existing)) await stopRuntime();
	fs.mkdirSync(stateRoot, {recursive: true});
	const child = cp.spawn(process.execPath, [path.join(__dirname, 'cdp-companion.js')], {detached: true, windowsHide: true, stdio: 'ignore'});
	child.unref();
	for (let attempt = 0; attempt < 30; attempt++) { await pause(200); const current = readState(); if (alive(current)) return current; }
	throw Error(`CDP runtime did not start; inspect ${stateRoot}`);
};
const installStartup = () => {
	if (process.platform !== 'win32') throw Error('This setup is for Windows');
	const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
	return cp.execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'install-startup.ps1'), '-NodePath', process.execPath], {encoding: 'utf8', windowsHide: true, timeout: 10000}).trim();
};
const stopRuntime = async () => {
	const state = readState();
	if (!alive(state)) return;
	fs.writeFileSync(path.join(stateRoot, 'control.json'), JSON.stringify({instance: state.instance, action: 'stop'}));
	for (let attempt = 0; attempt < 40; attempt++) { await pause(200); if (readState()?.state === 'stopped') return; }
	throw Error('The Tools runtime did not acknowledge shutdown; Antigravity was left running');
};
module.exports = {readState, alive, ensureRunning, installStartup, stopRuntime};
