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
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Break Upgrade and Multi-Account circular dependency, replace bootstrap.toString() with require, and split update-guard.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/40
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {readJsonSafe} = require('../Upgrade/process-io');
const state = require('./update-state');
const {allWindows} = require('./window-identity');
const defaultRunnerScript = path.join(__dirname, 'update-runner.js');
class UpdateGuard {
	constructor(appRequire, config, options = {}) {
		Object.assign(this, {
			appRequire,
			autoUpdater: options.autoUpdater || state.resolveModule(appRequire, 'electron-updater')?.autoUpdater,
			config,
			configuredAutoInstall: true,
			electron: state.resolveModule(appRequire, 'electron') || {},
			fileSystem: options.fs || fs,
			id: config.id,
			lastBlockedSiblings: [],
			options,
			pendingDir: options.pendingDir || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'antigravity-updater/pending'),
			processes: options.cp || cp,
			quitting: false
		});
		this.deferredFile = path.join(this.pendingDir, 'deferred-update.json');
		this.updateInfoFile = path.join(this.pendingDir, 'update-info.json');
		this.downloadedVersion = this.getUpdater()?.getLastState?.()?.update?.version || state.readDeferredManifest(this.deferredFile, this.fileSystem)?.version || null;
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
		return state.activeSiblingProfiles(this.config, this.options);
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
		state.clearDeferredManifest(this.deferredFile, this.fileSystem);
	}
	clearQuitting() {
		this.quitting = false;
	}
	currentVersion() {
		return this.electron.app?.getVersion?.() || '0.0.0';
	}
	dispose() {
		const {app} = this.electron;
		for (const [event, handler] of [['before-quit', this.onMarkQuitting], ['will-quit', this.onMarkQuitting], ['browser-window-focus', this.onClearQuitting], ['web-contents-created', this.onWebContentsCreated], ['quit', this.onQuit]]) {
			app?.removeListener?.(event, handler);
		}
		if (this.autoUpdater) {
			for (const [event, handler] of [['update-available', this.onUpdateAvailable], ['update-downloaded', this.onUpdateDownloaded], ['error', this.onRestoreReadyState], ['update-not-available', this.onRestoreReadyState]]) {
				this.autoUpdater.removeListener?.(event, handler);
			}
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
		if (this === globalThis.__ANTIGRAVITY_UPDATE_GUARD__) {
			delete globalThis.__ANTIGRAVITY_UPDATE_GUARD__;
		}
	}
	getAutoInstallOnAppQuit() {
		let r = this.configuredAutoInstall;
		if (this.configuredAutoInstall && (this.quitting || Boolean(this.autoUpdater?.quitHandlerAdded)) && this.blockForSiblings(this.activeSiblings(), 'Deferred autoInstallOnAppQuit')) {
			r = false;
		}
		return r;
	}
	getUpdater() {
		return this.options.updater || state.resolveModule(this.appRequire, './updater');
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
		if (0 === exitCode && !this.autoUpdater?.quitAndInstallCalled && !(this.autoUpdater?.quitHandlerAdded && this.configuredAutoInstall && this.autoUpdater?.installerPath) && !this.activeSiblings().length) {
			const deferred = state.readDeferredManifest(this.deferredFile, this.fileSystem);
			if (deferred?.version && deferred.version !== this.currentVersion()) {
				this.spawnManagedUpdate({version: deferred.version, relaunchProfile: null});
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
		state.silenceBrokenStdio(this.options.process || process);
		this.patchAutoUpdater();
		const {app} = this.electron;
		for (const [event, handler] of [['before-quit', this.onMarkQuitting], ['will-quit', this.onMarkQuitting], ['browser-window-focus', this.onClearQuitting], ['web-contents-created', this.onWebContentsCreated], ['quit', this.onQuit]]) {
			app?.on?.(event, handler);
		}
		globalThis.__ANTIGRAVITY_UPDATE_GUARD__ = this;
		return this;
	}
	log(message) {
		state.appendGuardLog(this.config.userDataDir, message, this.fileSystem);
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
			for (const [event, handler] of [['update-available', this.onUpdateAvailable], ['update-downloaded', this.onUpdateDownloaded], ['error', this.onRestoreReadyState], ['update-not-available', this.onRestoreReadyState]]) {
				this.autoUpdater.on?.(event, handler);
			}
		}
	}
	recordDeferredUpdate(version) {
		let r = null;
		const targetVersion = version || this.downloadedVersion || this.getUpdater()?.getLastState?.()?.update?.version || state.readDeferredManifest(this.deferredFile, this.fileSystem)?.version || null;
		const installer = this.resolveInstaller(targetVersion);
		if (targetVersion && targetVersion !== this.currentVersion() && installer) {
			r = state.writeDeferredManifest({deferredBy: this.config.id, deferredFile: this.deferredFile, fs: this.fileSystem, installerPath: installer.installerPath, version: targetVersion});
		}
		return r;
	}
	resolveInstaller(version) {
		let r = null;
		const direct = this.autoUpdater?.installerPath;
		const deferred = state.readDeferredManifest(this.deferredFile, this.fileSystem);
		const info = readJsonSafe(this.updateInfoFile, this.fileSystem);
		const candidate = direct || (deferred?.fileName ? path.join(this.pendingDir, path.basename(deferred.fileName)) : null) || (info?.fileName ? path.join(this.pendingDir, path.basename(info.fileName)) : null);
		if (candidate && this.fileSystem.existsSync(candidate)) {
			r = {installerPath: candidate, fileName: path.basename(candidate), version: version || this.downloadedVersion || deferred?.version || null};
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
					if (item) {
						item.label = updater?.MenuUpdateStep?.RestartToUpdate || 'Restart to Update';
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
			const boxOptions = {type: 'info', title: 'Update Deferred', message: 'Antigravity update is ready and will be installed automatically when all profiles (' + names + ') are closed.', buttons: ['OK']};
			const win = allWindows({BaseWindow, BrowserWindow, include: [BaseWindow?.getFocusedWindow?.(), BrowserWindow?.getFocusedWindow?.()]})[0];
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
			const nodeExecutable = this.options.nodeExecutable || state.defaultNodeExecutable();
			const runnerScript = this.options.runnerScript || defaultRunnerScript;
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
				const child = this.processes.spawn(nodeExecutable, args, {detached: true, stdio: 'ignore', windowsHide: true, env});
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
			deferred: state.readDeferredManifest(this.deferredFile, this.fileSystem),
			activeSiblings: this.activeSiblings(),
			lastBlockedSiblings: this.lastBlockedSiblings
		};
	}
}
const installUpdateGuard = (appRequire, config, options = {}) => new UpdateGuard(appRequire, config, options).install();
if (module === require.main) {
	const runner = require('./update-runner');
	const cli = runner.parseCliOptions();
	if (cli.applyUpdate) {
		runner.applyUpdate(cli).catch(() => {
			process.exitCode = 1;
		});
	}
}
const exportsObject = {...state, UpdateGuard, installUpdateGuard};
for (const key of ['UpdateRunner', 'applyUpdate', 'parseCliOptions', 'repairShortcuts']) {
	Object.defineProperty(exportsObject, key, {enumerable: true, get: () => require('./update-runner')[key]});
}
module.exports = exportsObject;
