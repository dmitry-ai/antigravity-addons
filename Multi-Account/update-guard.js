// 2026-11-05 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement cross-profile auto-update guard (M-2) and unified main-process bootstrap for A0 and A6":
// https://github.com/dmitry-ai/antigravity-addons/issues/20
// 2026-11-10 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Fix main-process EPIPE crash on closed launcher stderr pipe, disable differential .blockmap requests, and preserve managed shortcuts and profile bootstrap across updates":
// https://github.com/dmitry-ai/antigravity-addons/issues/21
// 2026-11-10 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Support Electron BaseWindow + WebContentsView in Antigravity 2.30.0 for existing-window activation, taskbar badge identity, [A6] window title prefix, and update-guard focus lookup":
// https://github.com/dmitry-ai/antigravity-addons/issues/22
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Extract UpdateGuard and DeferredUpdateStore ES6 classes from installUpdateGuard and applyUpdate in Multi-Account/update-guard.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/29
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const {isPidAlive, readJsonSafe, writeFileAtomic} = require('../Upgrade/process-io');
const {readProfiles} = require('./profiles');
const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
class UpdateGuard {
	constructor(appRequire, config, options = {}) {
		this.appRequire = appRequire;
		this.config = config;
		this.options = options;
		this.id = config.id;
		this.fileSystem = options.fs || fs;
		this.processes = options.cp || cp;
		this.electron = resolveModule(appRequire, 'electron') || {};
		this.autoUpdater = options.autoUpdater || resolveModule(appRequire, 'electron-updater')?.autoUpdater;
		this.pendingDir = options.pendingDir || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'antigravity-updater/pending');
		this.deferredFile = path.join(this.pendingDir, 'deferred-update.json');
		this.updateInfoFile = path.join(this.pendingDir, 'update-info.json');
		this.quitting = false;
		this.configuredAutoInstall = true;
		this.lastBlockedSiblings = [];
		this.downloadedVersion = this.getUpdater()?.getLastState?.()?.update?.version || readJsonSafe(this.deferredFile, this.fileSystem)?.version || null;
		if (this.downloadedVersion && this.downloadedVersion === this.currentVersion()) {
			this.downloadedVersion = null;
			this.clearDeferredUpdate();
		}
		this.onClearQuitting = () => this.clearQuitting();
		this.onMarkQuitting = () => this.markQuitting();
		this.onQuit = (event, exitCode) => this.handleQuit(event, exitCode);
		this.onRestoreReadyState = () => this.restoreReadyState();
		this.onUpdateAvailable = () => this.handleUpdateAvailable();
		this.onUpdateDownloaded = info => this.handleUpdateDownloaded(info);
		this.onWebContentsCreated = (event, contents) => this.handleWebContentsCreated(event, contents);
	}
	activeSiblings() {
		return activeSiblingProfiles(this.config, this.options);
	}
	blockForSiblings(siblings, action, {resetQuitFlag = false, restoreReady = false} = {}) {
		let r = false;
		if (siblings.length) {
			this.lastBlockedSiblings = siblings;
			this.recordDeferredUpdate();
			if (resetQuitFlag && this.autoUpdater) {
				this.autoUpdater.quitAndInstallCalled = false;
			}
			if (restoreReady) {
				this.restoreReadyState();
			}
			this.log(action + ' while sibling profiles are active: ' + siblings.map(item => item.id).join(', '));
			r = true;
		}
		return r;
	}
	clearDeferredUpdate() {
		try {
			this.fileSystem.rmSync(this.deferredFile, {force: true});
		}
		catch {}
	}
	clearQuitting() {
		this.quitting = false;
	}
	currentVersion() {
		return this.electron.app?.getVersion?.() || '0.0.0';
	}
	dispose() {
		const {app} = this.electron;
		app?.removeListener?.('before-quit', this.onMarkQuitting);
		app?.removeListener?.('will-quit', this.onMarkQuitting);
		app?.removeListener?.('browser-window-focus', this.onClearQuitting);
		app?.removeListener?.('web-contents-created', this.onWebContentsCreated);
		app?.removeListener?.('quit', this.onQuit);
		if (this.autoUpdater) {
			this.autoUpdater.removeListener?.('update-available', this.onUpdateAvailable);
			this.autoUpdater.removeListener?.('update-downloaded', this.onUpdateDownloaded);
			this.autoUpdater.removeListener?.('error', this.onRestoreReadyState);
			this.autoUpdater.removeListener?.('update-not-available', this.onRestoreReadyState);
			this.autoUpdater.disableDifferentialDownload = this.originalDisableDifferential;
			this.autoUpdater.disableWebInstaller = this.originalDisableWebInstaller;
			if (this.originalDescriptor) {
				Object.defineProperty(this.autoUpdater, 'autoInstallOnAppQuit', this.originalDescriptor);
			}
			else {
				delete this.autoUpdater.autoInstallOnAppQuit;
				this.autoUpdater.autoInstallOnAppQuit = this.configuredAutoInstall;
			}
			if (this.originalInstall) {
				this.autoUpdater.install = this.originalInstall;
			}
			if (this.originalQuitAndInstall) {
				this.autoUpdater.quitAndInstall = this.originalQuitAndInstall;
			}
		}
		if (globalThis.__ANTIGRAVITY_UPDATE_GUARD__ === this) {
			delete globalThis.__ANTIGRAVITY_UPDATE_GUARD__;
		}
	}
	getAutoInstallOnAppQuit() {
		let r = this.configuredAutoInstall;
		if (this.configuredAutoInstall && (this.quitting || Boolean(this.autoUpdater?.quitHandlerAdded))) {
			if (this.blockForSiblings(this.activeSiblings(), 'Deferred autoInstallOnAppQuit')) {
				r = false;
			}
		}
		return r;
	}
	getUpdater() {
		return this.options.updater || resolveModule(this.appRequire, './updater');
	}
	handleInstall(isSilent = false, isForceRunAfter = false) {
		let r = false;
		if (!this.blockForSiblings(this.activeSiblings(), 'Blocked autoUpdater.install', {resetQuitFlag: true, restoreReady: true}) && !this.autoUpdater.quitAndInstallCalled) {
			r = this.spawnManagedUpdate({relaunchProfile: isForceRunAfter ? this.config.id : null});
			if (!r && this.originalInstall) {
				this.clearDeferredUpdate();
				r = this.originalInstall(isSilent, isForceRunAfter);
			}
		}
		return r;
	}
	handleQuit(_event, exitCode = 0) {
		this.quitting = true;
		if (0 === exitCode && !this.autoUpdater?.quitAndInstallCalled && !(this.autoUpdater?.quitHandlerAdded && this.configuredAutoInstall && this.autoUpdater?.installerPath)) {
			if (!this.activeSiblings().length) {
				const deferred = readJsonSafe(this.deferredFile, this.fileSystem);
				if (deferred?.version && deferred.version !== this.currentVersion()) {
					this.spawnManagedUpdate({version: deferred.version, relaunchProfile: null});
				}
			}
		}
	}
	handleQuitAndInstall(isSilent = false, isForceRunAfter = false) {
		let r = false;
		const siblings = this.activeSiblings();
		if (this.blockForSiblings(siblings, 'Blocked autoUpdater.quitAndInstall', {resetQuitFlag: true, restoreReady: true})) {
			if (!isSilent) {
				this.showDeferredDialog(siblings);
			}
		}
		else {
			const shouldRelaunch = isSilent ? Boolean(isForceRunAfter) : Boolean(this.autoUpdater.autoRunAppAfterInstall ?? true);
			r = this.spawnManagedUpdate({relaunchProfile: shouldRelaunch ? this.config.id : null});
			if (!r) {
				this.clearDeferredUpdate();
				r = this.originalQuitAndInstall ? this.originalQuitAndInstall(isSilent, isForceRunAfter) : false;
			}
			else {
				setImmediate(() => {
					this.electron.autoUpdater?.emit?.('before-quit-for-update');
					this.electron.app?.quit?.();
				});
			}
		}
		return r;
	}
	handleUpdateAvailable() {
		if (false !== this.autoUpdater?.autoDownload) {
			setImmediate(() => {
				const updater = this.getUpdater();
				if ('available for download' === updater?.getLastState?.()?.type) {
					updater.broadcastState?.({type: 'downloading'});
				}
			});
		}
	}
	handleUpdateDownloaded(info) {
		if (info?.version && info.version !== this.currentVersion()) {
			this.downloadedVersion = info.version;
			this.recordDeferredUpdate(info.version);
		}
	}
	handleWebContentsCreated(_event, contents) {
		contents?.on?.('focus', this.onClearQuitting);
	}
	install() {
		globalThis.__ANTIGRAVITY_UPDATE_GUARD__?.dispose?.();
		silenceBrokenStdio(this.options.process || process);
		this.patchAutoUpdater();
		const {app} = this.electron;
		app?.on?.('before-quit', this.onMarkQuitting);
		app?.on?.('will-quit', this.onMarkQuitting);
		app?.on?.('browser-window-focus', this.onClearQuitting);
		app?.on?.('web-contents-created', this.onWebContentsCreated);
		app?.on?.('quit', this.onQuit);
		globalThis.__ANTIGRAVITY_UPDATE_GUARD__ = this;
		return this;
	}
	log(message) {
		appendGuardLog(this.config.userDataDir, message, this.fileSystem);
	}
	markQuitting() {
		this.quitting = true;
	}
	patchAutoUpdater() {
		this.configuredAutoInstall = Boolean(this.autoUpdater?.autoInstallOnAppQuit ?? true);
		this.originalDescriptor = this.autoUpdater ? Object.getOwnPropertyDescriptor(this.autoUpdater, 'autoInstallOnAppQuit') : undefined;
		this.originalDisableDifferential = this.autoUpdater ? this.autoUpdater.disableDifferentialDownload : undefined;
		this.originalDisableWebInstaller = this.autoUpdater ? this.autoUpdater.disableWebInstaller : undefined;
		this.originalInstall = this.autoUpdater?.install ? this.autoUpdater.install.bind(this.autoUpdater) : null;
		this.originalQuitAndInstall = this.autoUpdater?.quitAndInstall ? this.autoUpdater.quitAndInstall.bind(this.autoUpdater) : null;
		if (this.autoUpdater) {
			const guard = this;
			this.autoUpdater.disableDifferentialDownload = true;
			this.autoUpdater.disableWebInstaller = true;
			Object.defineProperty(this.autoUpdater, 'autoInstallOnAppQuit', {
				configurable: true,
				enumerable: true,
				get() {
					return guard.getAutoInstallOnAppQuit();
				},
				set(value) {
					guard.configuredAutoInstall = Boolean(value);
				}
			});
			if (this.originalInstall) {
				this.autoUpdater.install = (isSilent = false, isForceRunAfter = false) => this.handleInstall(isSilent, isForceRunAfter);
			}
			if (this.originalQuitAndInstall) {
				this.autoUpdater.quitAndInstall = (isSilent = false, isForceRunAfter = false) => this.handleQuitAndInstall(isSilent, isForceRunAfter);
			}
			this.autoUpdater.on?.('update-available', this.onUpdateAvailable);
			this.autoUpdater.on?.('update-downloaded', this.onUpdateDownloaded);
			this.autoUpdater.on?.('error', this.onRestoreReadyState);
			this.autoUpdater.on?.('update-not-available', this.onRestoreReadyState);
		}
	}
	recordDeferredUpdate(version) {
		let r = null;
		const targetVersion = version || this.downloadedVersion || this.getUpdater()?.getLastState?.()?.update?.version || readJsonSafe(this.deferredFile, this.fileSystem)?.version || null;
		const installer = this.resolveInstaller(targetVersion);
		if (targetVersion && targetVersion !== this.currentVersion() && installer) {
			r = writeDeferredManifest({
				deferredBy: this.config.id,
				deferredFile: this.deferredFile,
				fs: this.fileSystem,
				installerPath: installer.installerPath,
				version: targetVersion
			});
		}
		return r;
	}
	resolveInstaller(version) {
		let r = null;
		const direct = this.autoUpdater?.installerPath;
		const deferred = readJsonSafe(this.deferredFile, this.fileSystem);
		const info = readJsonSafe(this.updateInfoFile, this.fileSystem);
		const candidate = direct || (deferred?.fileName ? path.join(this.pendingDir, path.basename(deferred.fileName)) : null) || (info?.fileName ? path.join(this.pendingDir, path.basename(info.fileName)) : null);
		if (candidate && this.fileSystem.existsSync(candidate)) {
			r = {
				installerPath: candidate,
				fileName: path.basename(candidate),
				version: version || this.downloadedVersion || deferred?.version || null
			};
		}
		return r;
	}
	restoreReadyState() {
		if (this.downloadedVersion && this.downloadedVersion !== this.currentVersion() && this.resolveInstaller(this.downloadedVersion)) {
			setImmediate(() => {
				if (this.downloadedVersion && this.downloadedVersion !== this.currentVersion() && this.resolveInstaller(this.downloadedVersion)) {
					const updater = this.getUpdater();
					if (updater?.broadcastState && 'ready' !== updater.getLastState?.()?.type) {
						updater.broadcastState({type: 'ready', update: {version: this.downloadedVersion}});
					}
					const item = this.electron.Menu?.getApplicationMenu?.()?.getMenuItemById?.('check-for-updates');
					const label = updater?.MenuUpdateStep?.RestartToUpdate || 'Restart to Update';
					if (item) {
						item.label = label;
						item.enabled = true;
					}
				}
			});
		}
	}
	showDeferredDialog(siblings) {
		const {dialog, BaseWindow, BrowserWindow} = this.electron;
		if (dialog?.showMessageBox) {
			const names = siblings.map(item => item.id).join(', ');
			const boxOptions = {
				type: 'info',
				title: 'Update Deferred',
				message: 'Antigravity update is ready and will be installed automatically when all profiles (' + names + ') are closed.',
				buttons: ['OK']
			};
			const win = BaseWindow?.getFocusedWindow?.() || BrowserWindow?.getFocusedWindow?.() || BaseWindow?.getAllWindows?.()?.[0] || BrowserWindow?.getAllWindows?.()?.[0];
			void (win ? dialog.showMessageBox(win, boxOptions) : dialog.showMessageBox(boxOptions));
		}
	}
	spawnManagedUpdate({version = null, relaunchProfile = null} = {}) {
		let r = false;
		const installer = this.resolveInstaller(version);
		if (installer) {
			if (this.autoUpdater) {
				this.autoUpdater.quitAndInstallCalled = true;
			}
			this.clearDeferredUpdate();
			const nodeExecutable = this.options.nodeExecutable || defaultNodeExecutable();
			const runnerScript = this.options.runnerScript || __filename;
			const targetVersion = installer.version || version || this.downloadedVersion || null;
			const args = [
				runnerScript,
				'--apply-update',
				'--installer=' + installer.installerPath,
				'--wait-pid=' + (this.options.pid ?? process.pid),
				'--profile=' + this.config.id,
				'--user-data-dir=' + this.config.userDataDir,
				'--pending-dir=' + this.pendingDir,
				...(targetVersion ? ['--version=' + targetVersion] : []),
				...(relaunchProfile ? ['--relaunch=' + relaunchProfile] : [])
			];
			this.log('Spawning post-update runner for ' + (targetVersion || installer.fileName) + (relaunchProfile ? ' with relaunch=' + relaunchProfile : '') + ': ' + installer.installerPath);
			try {
				const env = {...process.env};
				if ('node.exe' !== path.basename(nodeExecutable).toLowerCase()) {
					env.ELECTRON_RUN_AS_NODE = '1';
				}
				const child = this.processes.spawn(nodeExecutable, args, {
					detached: true,
					stdio: 'ignore',
					windowsHide: true,
					env
				});
				child?.unref?.();
				r = true;
			}
			catch (error) {
				if (this.autoUpdater) {
					this.autoUpdater.quitAndInstallCalled = false;
				}
				this.recordDeferredUpdate(targetVersion);
				this.log('Failed to spawn post-update runner: ' + error.message);
			}
		}
		return r;
	}
	status() {
		return {
			id: this.config.id,
			configuredAutoInstall: this.configuredAutoInstall,
			disableDifferentialDownload: Boolean(this.autoUpdater?.disableDifferentialDownload),
			disableWebInstaller: Boolean(this.autoUpdater?.disableWebInstaller),
			downloadedVersion: this.downloadedVersion,
			deferred: readJsonSafe(this.deferredFile, this.fileSystem),
			activeSiblings: this.activeSiblings(),
			lastBlockedSiblings: this.lastBlockedSiblings
		};
	}
}
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
		this.version = options.version || readJsonSafe(this.deferredFile, this.fileSystem)?.version || null;
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
			try {
				this.fileSystem.rmSync(this.deferredFile, {force: true});
			}
			catch {}
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
const activeSiblingProfiles = (config, options = {}) => {
	const fileSystem = options.fs || fs;
	const alive = options.isPidAlive || isPidAlive;
	const locked = options.isLockfileHeld || (dir => isLockfileHeld(dir, fileSystem));
	const currentPid = options.pid ?? process.pid;
	let profiles = options.profiles;
	if (!profiles) {
		try {
			profiles = readProfiles({roaming: options.roaming, filename: options.profilesFile});
		}
		catch {
			profiles = [];
		}
	}
	const selfDir = config?.userDataDir ? path.resolve(config.userDataDir).toLowerCase() : '';
	const r = [];
	for (const profile of profiles) {
		const dir = path.resolve(profile.userDataDir);
		if (profile.id !== config?.id && dir.toLowerCase() !== selfDir) {
			const record = readJsonSafe(path.join(dir, 'main-runtime.json'), fileSystem);
			let activePid = null;
			let reason = null;
			if (record?.pid && record.pid !== currentPid && alive(record.pid)) {
				activePid = record.pid;
				reason = 'main-runtime';
			}
			if (!reason && locked(dir)) {
				reason = 'lockfile';
			}
			if (reason) {
				r.push({id: profile.id, userDataDir: profile.userDataDir, pid: activePid, reason});
			}
		}
	}
	return r;
};
const appendGuardLog = (userDataDir, message, fileSystem = fs) => {
	if (userDataDir) {
		try {
			fileSystem.appendFileSync(path.join(userDataDir, 'launcher.log'), new Date().toISOString() + ' [UpdateGuard] ' + message + '\n');
		}
		catch {}
	}
};
const applyUpdate = async (options = {}) => new UpdateRunner(options).run();
const defaultNodeExecutable = () => fs.existsSync('C:/tools/nodejs/node.exe') ? 'C:/tools/nodejs/node.exe' : process.execPath;
const installUpdateGuard = (appRequire, config, options = {}) => new UpdateGuard(appRequire, config, options).install();
const isLockfileHeld = (userDataDir, fileSystem = fs) => {
	let r = false;
	if (userDataDir) {
		const lockfile = path.join(userDataDir, 'lockfile');
		let fd;
		try {
			fd = fileSystem.openSync(lockfile, 'r+');
		}
		catch (error) {
			r = ['EBUSY', 'EPERM', 'EACCES'].includes(error?.code);
		}
		finally {
			if (undefined !== fd) {
				try {
					fileSystem.closeSync(fd);
				}
				catch {}
			}
		}
	}
	return r;
};
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
const resolveModule = (appRequire, id) => {
	let r = null;
	if ('function' === typeof appRequire) {
		try {
			r = appRequire(id);
		}
		catch {}
	}
	if (!r && process.resourcesPath) {
		try {
			const {createRequire} = require('node:module');
			r = createRequire(path.join(process.resourcesPath, 'app.asar/dist/main.js'))(id);
		}
		catch {}
	}
	return r;
};
const silenceBrokenStdio = (proc = process) => {
	for (const name of ['stderr', 'stdout']) {
		const stream = proc?.[name];
		if (stream && 'object' === typeof stream) {
			if ('function' === typeof stream.on && !stream.__antigravityErrorSilenced) {
				stream.on('error', () => {});
				stream.__antigravityErrorSilenced = true;
			}
			if ('function' === typeof stream.write && !stream.__antigravityWriteSilenced) {
				stream.write = (chunk, encoding, callback) => {
					if ('function' === typeof encoding) {
						encoding();
					}
					else if ('function' === typeof callback) {
						callback();
					}
					return true;
				};
				stream.__antigravityWriteSilenced = true;
			}
		}
	}
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const writeDeferredManifest = ({deferredBy, deferredFile, fs: fileSystem = fs, installerPath, version}) => {
	const r = {
		version: version || 'pending',
		fileName: path.basename(installerPath),
		installerPath,
		deferredBy,
		deferredAt: new Date().toISOString()
	};
	try {
		writeFileAtomic(deferredFile, JSON.stringify(r), {fs: fileSystem});
	}
	catch {}
	return r;
};
if (module === require.main) {
	const cli = parseCliOptions();
	if (cli.applyUpdate) {
		applyUpdate(cli).catch(() => {
			process.exitCode = 1;
		});
	}
}
module.exports = {
	UpdateGuard,
	UpdateRunner,
	activeSiblingProfiles,
	applyUpdate,
	defaultNodeExecutable,
	installUpdateGuard,
	isLockfileHeld,
	isPidAlive,
	parseCliOptions,
	repairShortcuts,
	resolveModule,
	silenceBrokenStdio,
	writeDeferredManifest
};
