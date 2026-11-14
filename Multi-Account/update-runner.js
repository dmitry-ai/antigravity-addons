// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Break Upgrade and Multi-Account circular dependency, replace bootstrap.toString() with require, and split update-guard.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/40
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {isPidAlive} = require('../Upgrade/process-io');
const {activeSiblingProfiles, appendGuardLog, clearDeferredManifest, readDeferredManifest, writeDeferredManifest} = require('./update-state');
const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
class UpdateRunner {
	constructor(options = {}) {
		this.options = options;
		this.fileSystem = options.fs || fs;
		this.processes = options.cp || cp;
		this.alive = options.isPidAlive || isPidAlive;
		this.pause = options.sleep || sleep;
		this.profileId = options.profileId || 'A0';
		this.userDataDir = options.userDataDir || '';
		this.pendingDir = options.pendingDir || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'antigravity-updater/pending');
		this.deferredFile = path.join(this.pendingDir, 'deferred-update.json');
		this.installerPath = options.installerPath || '';
		this.version = options.version || readDeferredManifest(this.deferredFile, this.fileSystem)?.version || null;
		this.relaunchProfile = options.relaunchProfile || null;
		this.waitPid = Number(options.waitPid);
		this.waitTimeoutMs = options.waitTimeoutMs ?? 30000;
		this.pollMs = options.pollMs ?? 100;
	}
	log(message) {
		appendGuardLog(this.userDataDir, message, this.fileSystem);
	}
	async run() {
		let r = {status: 'noop'};
		result: {
			if (!(await this.waitForProcessExit())) {
				this.saveDeferred();
				this.log('Timed out waiting for exiting PID ' + this.waitPid + '; update deferred');
				r = {status: 'timeout', waitPid: this.waitPid};
				break result;
			}
			const siblings = activeSiblingProfiles({id: this.profileId, userDataDir: this.userDataDir}, {
				fs: this.fileSystem,
				isPidAlive: this.alive,
				isLockfileHeld: this.options.isLockfileHeld,
				profiles: this.options.profiles,
				roaming: this.options.roaming,
				profilesFile: this.options.profilesFile,
				pid: this.options.pid ?? process.pid
			});
			if (siblings.length) {
				this.saveDeferred();
				this.log('Post-update runner deferred because sibling profiles are active: ' + siblings.map(item => item.id).join(', '));
				r = {status: 'deferred', siblings};
				break result;
			}
			if (!this.installerPath || !this.fileSystem.existsSync(this.installerPath)) {
				this.log('Installer is missing at ' + this.installerPath);
				r = {status: 'missing-installer', installerPath: this.installerPath};
				break result;
			}
			clearDeferredManifest(this.deferredFile, this.fileSystem);
			this.log('Running silent installer: ' + this.installerPath + (this.relaunchProfile ? ' (relaunch ' + this.relaunchProfile + ')' : ''));
			const exitCode = await this.runInstaller();
			if (0 !== exitCode) {
				this.saveDeferred();
				this.log('Installer exited with non-zero code: ' + exitCode);
				r = {status: 'installer-failed', exitCode};
				break result;
			}
			const shortcutsRepaired = (this.options.repairShortcuts || repairShortcuts)({
				codeRoot: this.options.codeRoot || __dirname,
				cp: this.processes,
				fs: this.fileSystem,
				log: message => this.log(message)
			});
			if (this.relaunchProfile) {
				const launchProfile = this.options.launchProfile || (id => require('./launcher').launch(id));
				await launchProfile(this.relaunchProfile);
			}
			r = {status: 'installed', exitCode: 0, shortcutsRepaired, relaunched: this.relaunchProfile};
		}
		return r;
	}
	runInstaller() {
		return new Promise((resolve, reject) => {
			const child = this.processes.spawn(this.installerPath, ['--updated', '/S'], {
				windowsHide: true,
				stdio: 'ignore'
			});
			if (!child || 'function' !== typeof child.once) {
				resolve(0);
			}
			else {
				child.once('error', reject);
				child.once('exit', code => resolve(code ?? 0));
			}
		});
	}
	saveDeferred() {
		if (this.installerPath && this.fileSystem.existsSync(this.installerPath)) {
			writeDeferredManifest({
				deferredBy: this.profileId,
				deferredFile: this.deferredFile,
				fs: this.fileSystem,
				installerPath: this.installerPath,
				version: this.version || 'pending'
			});
		}
	}
	async waitForProcessExit() {
		let r = true;
		if (Number.isInteger(this.waitPid) && 0 < this.waitPid) {
			const deadline = Date.now() + this.waitTimeoutMs;
			while (this.alive(this.waitPid)) {
				if (Date.now() >= deadline) {
					r = false;
					break;
				}
				await this.pause(this.pollMs);
			}
		}
		return r;
	}
}
const applyUpdate = async (options = {}) => new UpdateRunner(options).run();
const parseCliOptions = (argv = process.argv.slice(2)) => {
	const flags = {
		'--installer=': ['installerPath', String],
		'--pending-dir=': ['pendingDir', String],
		'--profile=': ['profileId', String],
		'--relaunch=': ['relaunchProfile', String],
		'--user-data-dir=': ['userDataDir', String],
		'--version=': ['version', String],
		'--wait-pid=': ['waitPid', Number]
	};
	const r = {};
	for (const arg of argv) {
		if ('--apply-update' === arg) {
			r.applyUpdate = true;
		}
		else {
			for (const [prefix, [key, parse]] of Object.entries(flags)) {
				if (arg.startsWith(prefix)) {
					r[key] = parse(arg.slice(prefix.length));
					break;
				}
			}
		}
	}
	return r;
};
const repairShortcuts = ({codeRoot = __dirname, cp: processes = cp, fs: fileSystem = fs, log = () => {}} = {}) => {
	let r = false;
	const script = path.join(codeRoot, 'install.ps1');
	if (fileSystem.existsSync(script) && 'function' === typeof processes?.execFileSync) {
		try {
			processes.execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
				encoding: 'utf8',
				windowsHide: true
			});
			r = true;
		}
		catch (error) {
			log('Failed to repair shortcuts: ' + error.message);
		}
	}
	return r;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
if (module === require.main) {
	const cli = parseCliOptions();
	if (cli.applyUpdate) {
		applyUpdate(cli).catch(() => {
			process.exitCode = 1;
		});
	}
}
module.exports = {UpdateRunner, applyUpdate, parseCliOptions, repairShortcuts};
