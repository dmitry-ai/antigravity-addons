// 2026-11-05 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement cross-profile auto-update guard (M-2) and unified main-process bootstrap for A0 and A6":
// https://github.com/dmitry-ai/antigravity-addons/issues/20
// 2026-11-10 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Fix main-process EPIPE crash on closed launcher stderr pipe, disable differential .blockmap requests, and preserve managed shortcuts and profile bootstrap across updates":
// https://github.com/dmitry-ai/antigravity-addons/issues/21
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const {readProfiles} = require('./profiles');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const defaultNodeExecutable = () => fs.existsSync('C:/tools/nodejs/node.exe') ? 'C:/tools/nodejs/node.exe' : process.execPath;
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
const applyUpdate = async (options = {}) => {
	let r = {status: 'noop'};
	result: {
		const fileSystem = options.fs || fs;
		const processes = options.cp || cp;
		const alive = options.isPidAlive || isPidAlive;
		const pause = options.sleep || sleep;
		const profileId = options.profileId || 'A0';
		const userDataDir = options.userDataDir || '';
		const pendingDir = options.pendingDir || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'antigravity-updater/pending');
		const deferredFile = path.join(pendingDir, 'deferred-update.json');
		const installerPath = options.installerPath || '';
		const version = options.version || readJson(fileSystem, deferredFile)?.version || null;
		const relaunchProfile = options.relaunchProfile || null;
		const waitPid = Number(options.waitPid);
		const waitTimeoutMs = options.waitTimeoutMs ?? 30000;
		const pollMs = options.pollMs ?? 100;
		const log = message => {
			if (userDataDir) {
				try {
					fileSystem.appendFileSync(path.join(userDataDir, 'launcher.log'), new Date().toISOString() + ' [UpdateGuard] ' + message + '\n');
				}
				catch {}
			}
		};
		const saveDeferred = () => {
			if (installerPath && fileSystem.existsSync(installerPath)) {
				try {
					fileSystem.mkdirSync(pendingDir, {recursive: true});
					fileSystem.writeFileSync(deferredFile, JSON.stringify({
						version: version || 'pending',
						fileName: path.basename(installerPath),
						installerPath,
						deferredBy: profileId,
						deferredAt: new Date().toISOString()
					}));
				}
				catch {}
			}
		};
		if (Number.isInteger(waitPid) && 0 < waitPid) {
			const deadline = Date.now() + waitTimeoutMs;
			while (alive(waitPid)) {
				if (Date.now() >= deadline) {
					saveDeferred();
					log('Timed out waiting for exiting PID ' + waitPid + '; update deferred');
					r = {status: 'timeout', waitPid};
					break result;
				}
				await pause(pollMs);
			}
		}
		const siblings = activeSiblingProfiles({id: profileId, userDataDir}, {
			fs: fileSystem,
			isPidAlive: alive,
			isLockfileHeld: options.isLockfileHeld,
			profiles: options.profiles,
			roaming: options.roaming,
			profilesFile: options.profilesFile,
			pid: options.pid ?? process.pid
		});
		if (siblings.length) {
			saveDeferred();
			log('Post-update runner deferred because sibling profiles are active: ' + siblings.map(item => item.id).join(', '));
			r = {status: 'deferred', siblings};
			break result;
		}
		if (!installerPath || !fileSystem.existsSync(installerPath)) {
			log('Installer is missing at ' + installerPath);
			r = {status: 'missing-installer', installerPath};
			break result;
		}
		try {
			fileSystem.rmSync(deferredFile, {force: true});
		}
		catch {}
		log('Running silent installer: ' + installerPath + (relaunchProfile ? ' (relaunch ' + relaunchProfile + ')' : ''));
		const exitCode = await new Promise((resolve, reject) => {
			const child = processes.spawn(installerPath, ['--updated', '/S'], {
				windowsHide: true,
				stdio: 'ignore'
			});
			if (!child || 'function' !== typeof child.once) {
				resolve(0);
				return;
			}
			child.once('error', reject);
			child.once('exit', code => resolve(code ?? 0));
		});
		if (0 !== exitCode) {
			saveDeferred();
			log('Installer exited with non-zero code: ' + exitCode);
			r = {status: 'installer-failed', exitCode};
			break result;
		}
		const shortcutsRepaired = (options.repairShortcuts || repairShortcuts)({
			codeRoot: options.codeRoot || __dirname,
			cp: processes,
			fs: fileSystem,
			log
		});
		if (relaunchProfile) {
			const launchProfile = options.launchProfile || (id => require('./launcher').launch(id));
			await launchProfile(relaunchProfile);
		}
		r = {status: 'installed', exitCode: 0, shortcutsRepaired, relaunched: relaunchProfile};
	}
	return r;
};
const installUpdateGuard = (appRequire, config, options = {}) => {
	globalThis.__ANTIGRAVITY_UPDATE_GUARD__?.dispose?.();
	silenceBrokenStdio(options.process || process);
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
	const spawnManagedUpdate = ({version = null, relaunchProfile = null} = {}) => {
		let r = false;
		const installer = resolveInstaller(version);
		if (installer) {
			if (autoUpdater) {
				autoUpdater.quitAndInstallCalled = true;
			}
			clearDeferredUpdate();
			const nodeExecutable = options.nodeExecutable || defaultNodeExecutable();
			const runnerScript = options.runnerScript || __filename;
			const targetVersion = installer.version || version || downloadedVersion || null;
			const args = [
				runnerScript,
				'--apply-update',
				'--installer=' + installer.installerPath,
				'--wait-pid=' + (options.pid ?? process.pid),
				'--profile=' + config.id,
				'--user-data-dir=' + config.userDataDir,
				'--pending-dir=' + pendingDir,
				...(targetVersion ? ['--version=' + targetVersion] : []),
				...(relaunchProfile ? ['--relaunch=' + relaunchProfile] : [])
			];
			log('Spawning post-update runner for ' + (targetVersion || installer.fileName) + (relaunchProfile ? ' with relaunch=' + relaunchProfile : '') + ': ' + installer.installerPath);
			try {
				const env = {...process.env};
				if (path.basename(nodeExecutable).toLowerCase() !== 'node.exe') {
					env.ELECTRON_RUN_AS_NODE = '1';
				}
				const child = processes.spawn(nodeExecutable, args, {
					detached: true,
					stdio: 'ignore',
					windowsHide: true,
					env
				});
				child?.unref?.();
				r = true;
			}
			catch (error) {
				if (autoUpdater) {
					autoUpdater.quitAndInstallCalled = false;
				}
				recordDeferredUpdate(targetVersion);
				log('Failed to spawn post-update runner: ' + error.message);
			}
		}
		return r;
	};
	let quitting = false;
	let configuredAutoInstall = Boolean(autoUpdater?.autoInstallOnAppQuit ?? true);
	let lastBlockedSiblings = [];
	const markQuitting = () => {
		quitting = true;
	};
	const clearQuitting = () => {
		quitting = false;
	};
	const originalDescriptor = autoUpdater ? Object.getOwnPropertyDescriptor(autoUpdater, 'autoInstallOnAppQuit') : undefined;
	const originalDisableDifferential = autoUpdater ? autoUpdater.disableDifferentialDownload : undefined;
	const originalDisableWebInstaller = autoUpdater ? autoUpdater.disableWebInstaller : undefined;
	const originalInstall = autoUpdater?.install ? autoUpdater.install.bind(autoUpdater) : null;
	const originalQuitAndInstall = autoUpdater?.quitAndInstall ? autoUpdater.quitAndInstall.bind(autoUpdater) : null;
	const onUpdateAvailable = () => {
		if (false !== autoUpdater?.autoDownload) {
			setImmediate(() => {
				const updater = getUpdater();
				if ('available for download' === updater?.getLastState?.()?.type) {
					updater.broadcastState?.({type: 'downloading'});
				}
			});
		}
	};
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
		autoUpdater.disableDifferentialDownload = true;
		autoUpdater.disableWebInstaller = true;
		Object.defineProperty(autoUpdater, 'autoInstallOnAppQuit', {
			configurable: true,
			enumerable: true,
			get() {
				let r = configuredAutoInstall;
				if (configuredAutoInstall && (quitting || Boolean(autoUpdater.quitHandlerAdded))) {
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
					restoreReadyState();
					log('Blocked autoUpdater.install while sibling profiles are active: ' + siblings.map(item => item.id).join(', '));
				}
				else if (!autoUpdater.quitAndInstallCalled) {
					r = spawnManagedUpdate({relaunchProfile: isForceRunAfter ? config.id : null});
					if (!r) {
						clearDeferredUpdate();
						r = originalInstall(isSilent, isForceRunAfter);
					}
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
					restoreReadyState();
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
					const shouldRelaunch = isSilent ? Boolean(isForceRunAfter) : Boolean(autoUpdater.autoRunAppAfterInstall ?? true);
					r = spawnManagedUpdate({relaunchProfile: shouldRelaunch ? config.id : null});
					if (r) {
						setImmediate(() => {
							electron.autoUpdater?.emit?.('before-quit-for-update');
							app?.quit?.();
						});
					}
					else {
						clearDeferredUpdate();
						r = originalQuitAndInstall(isSilent, isForceRunAfter);
					}
				}
				return r;
			};
		}
		autoUpdater.on?.('update-available', onUpdateAvailable);
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
					spawnManagedUpdate({version: deferred.version, relaunchProfile: null});
				}
			}
		}
	};
	app?.on?.('before-quit', markQuitting);
	app?.on?.('will-quit', markQuitting);
	app?.on?.('browser-window-focus', clearQuitting);
	app?.on?.('quit', onQuit);
	const guard = {
		id: config.id,
		pendingDir,
		deferredFile,
		activeSiblings: () => activeSiblingProfiles(config, options),
		status: () => ({
			id: config.id,
			configuredAutoInstall,
			disableDifferentialDownload: Boolean(autoUpdater?.disableDifferentialDownload),
			disableWebInstaller: Boolean(autoUpdater?.disableWebInstaller),
			downloadedVersion,
			deferred: readJson(fileSystem, deferredFile),
			activeSiblings: activeSiblingProfiles(config, options),
			lastBlockedSiblings
		}),
		dispose: () => {
			app?.removeListener?.('before-quit', markQuitting);
			app?.removeListener?.('will-quit', markQuitting);
			app?.removeListener?.('browser-window-focus', clearQuitting);
			app?.removeListener?.('quit', onQuit);
			if (autoUpdater) {
				autoUpdater.removeListener?.('update-available', onUpdateAvailable);
				autoUpdater.removeListener?.('update-downloaded', onUpdateDownloaded);
				autoUpdater.removeListener?.('error', restoreReadyState);
				autoUpdater.removeListener?.('update-not-available', restoreReadyState);
				autoUpdater.disableDifferentialDownload = originalDisableDifferential;
				autoUpdater.disableWebInstaller = originalDisableWebInstaller;
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
const parseCliOptions = (argv = process.argv.slice(2)) => {
	const r = {};
	for (const arg of argv) {
		if ('--apply-update' === arg) {
			r.applyUpdate = true;
		}
		else if (arg.startsWith('--installer=')) {
			r.installerPath = arg.slice('--installer='.length);
		}
		else if (arg.startsWith('--wait-pid=')) {
			r.waitPid = Number(arg.slice('--wait-pid='.length));
		}
		else if (arg.startsWith('--profile=')) {
			r.profileId = arg.slice('--profile='.length);
		}
		else if (arg.startsWith('--user-data-dir=')) {
			r.userDataDir = arg.slice('--user-data-dir='.length);
		}
		else if (arg.startsWith('--pending-dir=')) {
			r.pendingDir = arg.slice('--pending-dir='.length);
		}
		else if (arg.startsWith('--version=')) {
			r.version = arg.slice('--version='.length);
		}
		else if (arg.startsWith('--relaunch=')) {
			r.relaunchProfile = arg.slice('--relaunch='.length);
		}
	}
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
	installUpdateGuard,
	activeSiblingProfiles,
	isLockfileHeld,
	isPidAlive,
	silenceBrokenStdio,
	repairShortcuts,
	applyUpdate,
	parseCliOptions
};
