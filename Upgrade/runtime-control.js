// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
// 2026-11-26 "Isolate launcher test state and block worktree companion hijacking": https://github.com/dmitry-ai/antigravity-addons/issues/74
const {resolveStateRoot, runtimeVersion} = require('./cdp-companion');
const {isPidAlive, readJsonSafe, writeFileAtomic} = require('./process-io');
// 2026-11-26 "Isolate launcher test state and block worktree companion hijacking": https://github.com/dmitry-ai/antigravity-addons/issues/74
/**
 * @used-by {@link ensureRunning}
 * @used-by {@link stopRuntime}
 */
const assertSafeWorktreeTarget = (explicitRoot, checkoutDir, env = process.env) => {
	if (!explicitRoot && !String(env?.ANTIGRAVITY_TOOLS_STATE_DIR || '').trim() && isLinkedWorktree(checkoutDir)) {
		throw Error('Refusing to manage canonical AntigravityTools companion from a linked Git worktree without an isolated root or ANTIGRAVITY_TOOLS_STATE_DIR');
	}
};
// 2026-11-26 "Isolate launcher test state and block worktree companion hijacking": https://github.com/dmitry-ai/antigravity-addons/issues/74
/**
 * @used-by {@link assertSafeWorktreeTarget}
 * @used-by {@link import('./test-cdp-runtime.js')}
 */
const isLinkedWorktree = (dir = __dirname) => {
	let r = false;
	let cur = path.resolve(dir);
	for (;;) {
		const dotGit = path.join(cur, '.git');
		if (fs.existsSync(dotGit)) {
			try {
				r = fs.statSync(dotGit).isFile();
			}
			catch {
				r = false;
			}
			break;
		}
		const parent = path.dirname(cur);
		if (parent === cur) {
			break;
		}
		cur = parent;
	}
	return r;
};
// 2026-10-28
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
// 2026-11-13
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
// 2026-11-26 "Isolate launcher test state and block worktree companion hijacking": https://github.com/dmitry-ai/antigravity-addons/issues/74
const readState = (root = resolveStateRoot()) => readJsonSafe(path.join(root, 'runtime.json'));
// 2026-11-13
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
const alive = state => Boolean(state?.pid && isPidAlive(state.pid) && 'stopped' !== state.state && 30000 > Date.now() - Date.parse(state.updated));
// 2026-11-26 "Isolate launcher test state and block worktree companion hijacking": https://github.com/dmitry-ai/antigravity-addons/issues/74
const ensureRunning = async ({root, delay = 200, checkoutDir = __dirname} = {}) => {
	let r;
	result: {
		assertSafeWorktreeTarget(root, checkoutDir);
		const targetRoot = root ? path.resolve(root) : resolveStateRoot();
		const expectedVersion = runtimeVersion();
		const expectedPath = path.join(__dirname, 'cdp-companion.js');
		const existing = readState(targetRoot);
		if (alive(existing) && existing.version === expectedVersion && existing.runtimePath === expectedPath) {
			r = existing;
			break result;
		}
		if (alive(existing)) {
			await stopRuntime({root: targetRoot, delay, checkoutDir});
		}
		fs.mkdirSync(targetRoot, {recursive: true});
		// 2026-10-31
		// "Add Project settings action to project context menu in Folders":
		// https://github.com/dmitry-ai/antigravity-addons/issues/17
		const shortcut = 'win32' === process.platform ? path.join(process.env.APPDATA || '', 'Microsoft/Windows/Start Menu/Programs/Startup/Antigravity Tools (CDP).lnk') : '';
		const explorer = 'win32' === process.platform ? path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe') : '';
		const spawnDirect = () => {
			const child = cp.spawn(process.execPath, [expectedPath], {detached: true, windowsHide: true, stdio: 'ignore', env: {...process.env, ANTIGRAVITY_TOOLS_STATE_DIR: targetRoot}});
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
			const current = readState(targetRoot);
			if (alive(current) && current.version === expectedVersion && current.instance !== existing?.instance) {
				r = current;
				break result;
			}
		}
		throw Error(`CDP runtime did not start; inspect ${targetRoot}`);
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
// 2026-10-28
// "Diagnose Tools companion stop timeout, verify automatic Tools recovery via A6 launcher, and consolidate 14 legacy journals into Unified Journal":
// https://github.com/dmitry-ai/antigravity-addons/issues/13
// 2026-11-26 "Isolate launcher test state and block worktree companion hijacking": https://github.com/dmitry-ai/antigravity-addons/issues/74
const stopRuntime = async ({root, delay = 200, checkoutDir = __dirname} = {}) => {
	result: {
		assertSafeWorktreeTarget(root, checkoutDir);
		const targetRoot = root ? path.resolve(root) : resolveStateRoot();
		const state = readState(targetRoot);
		if (!alive(state)) {
			break result;
		}
		// 2026-11-13
		// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
		// https://github.com/dmitry-ai/antigravity-addons/issues/25
		writeFileAtomic(path.join(targetRoot, 'control.json'), JSON.stringify({instance: state.instance, action: 'stop'}));
		for (let attempt = 0; 40 > attempt; attempt++) {
			await pause(delay);
			if ('stopped' === readState(targetRoot)?.state) {
				break result;
			}
		}
		throw Error('The Tools runtime did not acknowledge shutdown; Antigravity was left running');
	}
};
module.exports = {alive, ensureRunning, installStartup, isLinkedWorktree, readState, stopRuntime};
