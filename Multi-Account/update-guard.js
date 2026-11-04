// 2026-11-05 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement cross-profile auto-update guard (M-2) and unified main-process bootstrap for A0 and A6":
// https://github.com/dmitry-ai/antigravity-addons/issues/20
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const {readProfiles} = require('./profiles');
const isPidAlive = pid => {
	let r = false;
	if (Number.isInteger(pid) && 0 < pid) {
		try {
			process.kill(pid, 0);
			r = true;
		}
		catch (error) {
			r = 'EPERM' === error?.code;
		}
	}
	return r;
};
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
			let activePid = null;
			let reason = null;
			try {
				const record = JSON.parse(fileSystem.readFileSync(path.join(dir, 'main-runtime.json'), 'utf8'));
				if (record?.pid && record.pid !== currentPid && alive(record.pid)) {
					activePid = record.pid;
					reason = 'main-runtime';
				}
			}
			catch {}
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
const readJson = (fileSystem, filename) => {
	let r = null;
	try {
		r = JSON.parse(fileSystem.readFileSync(filename, 'utf8'));
	}
	catch {}
	return r;
};
const installUpdateGuard = (appRequire, config, options = {}) => {
	globalThis.__ANTIGRAVITY_UPDATE_GUARD__?.dispose?.();
	const fileSystem = options.fs || fs;
	const processes = options.cp || cp;
	const electron = resolveModule(appRequire, 'electron') || {};
	const {app, dialog, BrowserWindow, Menu} = electron;
	const electronUpdater = resolveModule(appRequire, 'electron-updater');
	const autoUpdater = options.autoUpdater || electronUpdater?.autoUpdater;
	const getUpdater = () => options.updater || resolveModule(appRequire, './updater');
	const pendingDir = options.pendingDir || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'antigravity-updater/pending');
	const deferredFile = path.join(pendingDir, 'deferred-update.json');
	const updateInfoFile = path.join(pendingDir, 'update-info.json');
	const log = message => {
		try {
			fileSystem.appendFileSync(path.join(config.userDataDir, 'launcher.log'), new Date().toISOString() + ' [UpdateGuard] ' + message + '\n');
		}
		catch {}
	};
	const currentVersion = () => app?.getVersion?.() || '0.0.0';
	let downloadedVersion = getUpdater()?.getLastState?.()?.update?.version || readJson(fileSystem, deferredFile)?.version || null;
	if (downloadedVersion && downloadedVersion === currentVersion()) {
		downloadedVersion = null;
		try {
			fileSystem.rmSync(deferredFile, {force: true});
		}
		catch {}
	}
	const resolveInstaller = version => {
		let r = null;
		const direct = autoUpdater?.installerPath;
		const deferred = readJson(fileSystem, deferredFile);
		const info = readJson(fileSystem, updateInfoFile);
		const candidate = direct || (deferred?.fileName ? path.join(pendingDir, path.basename(deferred.fileName)) : null) || (info?.fileName ? path.join(pendingDir, path.basename(info.fileName)) : null);
		if (candidate && fileSystem.existsSync(candidate)) {
			r = {
				installerPath: candidate,
				fileName: path.basename(candidate),
				version: version || downloadedVersion || deferred?.version || null
			};
		}
		return r;
	};
	const recordDeferredUpdate = version => {
		let r = null;
		const targetVersion = version || downloadedVersion || getUpdater()?.getLastState?.()?.update?.version || readJson(fileSystem, deferredFile)?.version || null;
		const installer = resolveInstaller(targetVersion);
		if (targetVersion && targetVersion !== currentVersion() && installer) {
			r = {
				version: targetVersion,
				fileName: installer.fileName,
				installerPath: installer.installerPath,
				deferredBy: config.id,
				deferredAt: new Date().toISOString()
			};
			try {
				fileSystem.mkdirSync(pendingDir, {recursive: true});
				fileSystem.writeFileSync(deferredFile, JSON.stringify(r));
			}
			catch {}
		}
		return r;
	};
	const clearDeferredUpdate = () => {
		try {
			fileSystem.rmSync(deferredFile, {force: true});
		}
		catch {}
	};
	let quitting = false;
	let configuredAutoInstall = Boolean(autoUpdater?.autoInstallOnAppQuit ?? true);
	let lastBlockedSiblings = [];
	const markQuitting = () => {
		quitting = true;
		setImmediate(() => {
			quitting = false;
		});
	};
	const originalDescriptor = autoUpdater ? Object.getOwnPropertyDescriptor(autoUpdater, 'autoInstallOnAppQuit') : undefined;
	const originalInstall = autoUpdater?.install ? autoUpdater.install.bind(autoUpdater) : null;
	const originalQuitAndInstall = autoUpdater?.quitAndInstall ? autoUpdater.quitAndInstall.bind(autoUpdater) : null;
	const onUpdateDownloaded = info => {
		if (info?.version && info.version !== currentVersion()) {
			downloadedVersion = info.version;
			recordDeferredUpdate(info.version);
		}
	};
	const restoreReadyState = () => {
		if (downloadedVersion && downloadedVersion !== currentVersion() && resolveInstaller(downloadedVersion)) {
			setImmediate(() => {
				if (downloadedVersion && downloadedVersion !== currentVersion() && resolveInstaller(downloadedVersion)) {
					const updater = getUpdater();
					if (updater?.broadcastState && 'ready' !== updater.getLastState?.()?.type) {
						updater.broadcastState({type: 'ready', update: {version: downloadedVersion}});
					}
					const item = Menu?.getApplicationMenu?.()?.getMenuItemById?.('check-for-updates');
					const label = updater?.MenuUpdateStep?.RestartToUpdate || 'Restart to Update';
					if (item) {
						item.label = label;
						item.enabled = true;
					}
				}
			});
		}
	};
	if (autoUpdater) {
		Object.defineProperty(autoUpdater, 'autoInstallOnAppQuit', {
			configurable: true,
			enumerable: true,
			get() {
				let r = configuredAutoInstall;
				if (quitting && configuredAutoInstall) {
					const siblings = activeSiblingProfiles(config, options);
					if (siblings.length) {
						lastBlockedSiblings = siblings;
						recordDeferredUpdate();
						log('Deferred autoInstallOnAppQuit while sibling profiles are active: ' + siblings.map(item => item.id).join(', '));
						r = false;
					}
				}
				return r;
			},
			set(value) {
				configuredAutoInstall = Boolean(value);
			}
		});
		if (originalInstall) {
			autoUpdater.install = (isSilent = false, isForceRunAfter = false) => {
				let r = false;
				const siblings = activeSiblingProfiles(config, options);
				if (siblings.length) {
					lastBlockedSiblings = siblings;
					recordDeferredUpdate();
					autoUpdater.quitAndInstallCalled = false;
					log('Blocked autoUpdater.install while sibling profiles are active: ' + siblings.map(item => item.id).join(', '));
				}
				else {
					clearDeferredUpdate();
					r = originalInstall(isSilent, isForceRunAfter);
				}
				return r;
			};
		}
		if (originalQuitAndInstall) {
			autoUpdater.quitAndInstall = (isSilent = false, isForceRunAfter = false) => {
				let r = false;
				const siblings = activeSiblingProfiles(config, options);
				if (siblings.length) {
					lastBlockedSiblings = siblings;
					recordDeferredUpdate();
					autoUpdater.quitAndInstallCalled = false;
					log('Blocked autoUpdater.quitAndInstall while sibling profiles are active: ' + siblings.map(item => item.id).join(', '));
					if (!isSilent && dialog?.showMessageBox) {
						const names = siblings.map(item => item.id).join(', ');
						const boxOptions = {
							type: 'info',
							title: 'Update Deferred',
							message: 'Antigravity update is ready and will be installed automatically when all profiles (' + names + ') are closed.',
							buttons: ['OK']
						};
						const win = BrowserWindow?.getFocusedWindow?.() || BrowserWindow?.getAllWindows?.()?.[0];
						void (win ? dialog.showMessageBox(win, boxOptions) : dialog.showMessageBox(boxOptions));
					}
				}
				else {
					clearDeferredUpdate();
					r = originalQuitAndInstall(isSilent, isForceRunAfter);
				}
				return r;
			};
		}
		autoUpdater.on?.('update-downloaded', onUpdateDownloaded);
		autoUpdater.on?.('error', restoreReadyState);
		autoUpdater.on?.('update-not-available', restoreReadyState);
	}
	const onQuit = (_event, exitCode = 0) => {
		quitting = true;
		if (0 === exitCode && !autoUpdater?.quitAndInstallCalled && !(autoUpdater?.quitHandlerAdded && configuredAutoInstall && autoUpdater?.installerPath)) {
			const siblings = activeSiblingProfiles(config, options);
			if (!siblings.length) {
				const deferred = readJson(fileSystem, deferredFile);
				if (deferred?.version && deferred.version !== currentVersion()) {
					const installer = resolveInstaller(deferred.version);
					if (installer) {
						if (autoUpdater) {
							autoUpdater.quitAndInstallCalled = true;
						}
						clearDeferredUpdate();
						log('Spawning deferred update ' + deferred.version + ' on last profile quit: ' + installer.installerPath);
						try {
							const child = processes.spawn(installer.installerPath, ['--updated', '/S'], {
								detached: true,
								stdio: 'ignore',
								windowsHide: true
							});
							child.unref?.();
						}
						catch (error) {
							log('Failed to spawn deferred update: ' + error.message);
						}
					}
				}
			}
		}
	};
	app?.on?.('before-quit', markQuitting);
	app?.on?.('will-quit', markQuitting);
	app?.on?.('quit', onQuit);
	const guard = {
		id: config.id,
		pendingDir,
		deferredFile,
		activeSiblings: () => activeSiblingProfiles(config, options),
		status: () => ({
			id: config.id,
			configuredAutoInstall,
			downloadedVersion,
			deferred: readJson(fileSystem, deferredFile),
			activeSiblings: activeSiblingProfiles(config, options),
			lastBlockedSiblings
		}),
		dispose: () => {
			app?.removeListener?.('before-quit', markQuitting);
			app?.removeListener?.('will-quit', markQuitting);
			app?.removeListener?.('quit', onQuit);
			if (autoUpdater) {
				autoUpdater.removeListener?.('update-downloaded', onUpdateDownloaded);
				autoUpdater.removeListener?.('error', restoreReadyState);
				autoUpdater.removeListener?.('update-not-available', restoreReadyState);
				if (originalDescriptor) {
					Object.defineProperty(autoUpdater, 'autoInstallOnAppQuit', originalDescriptor);
				}
				else {
					delete autoUpdater.autoInstallOnAppQuit;
					autoUpdater.autoInstallOnAppQuit = configuredAutoInstall;
				}
				if (originalInstall) {
					autoUpdater.install = originalInstall;
				}
				if (originalQuitAndInstall) {
					autoUpdater.quitAndInstall = originalQuitAndInstall;
				}
			}
			if (globalThis.__ANTIGRAVITY_UPDATE_GUARD__ === guard) {
				delete globalThis.__ANTIGRAVITY_UPDATE_GUARD__;
			}
		}
	};
	globalThis.__ANTIGRAVITY_UPDATE_GUARD__ = guard;
	return guard;
};
module.exports = {installUpdateGuard, activeSiblingProfiles, isLockfileHeld, isPidAlive};
