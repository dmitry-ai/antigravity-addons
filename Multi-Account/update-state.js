// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
const fs = require('node:fs');
const path = require('node:path');
// 2026-11-19
// "Fail closed when active Antigravity profiles lack a reachable inspector endpoint":
// https://github.com/dmitry-ai/antigravity-addons/issues/53
const {isLockfileHeld, isPidAlive, readJsonSafe, writeFileAtomic} = require('../Upgrade/process-io');
const {readProfiles} = require('./profiles');
// 2026-11-14
// "Break Upgrade and Multi-Account circular dependency, replace bootstrap.toString() with require, and split update-guard.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/40
/**
 * @used-by {@link import('./update-guard.js')} (UpdateGuard#activeSiblings)
 * @used-by {@link import('./update-runner.js').UpdateRunner#run}
 * @used-by {@link import('./update-runner.js')}
 * @used-by {@link import('./update-state.js')}
 */
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
/**
 * @used-by {@link import('./update-guard.js')} (UpdateGuard#log)
 * @used-by {@link import('./update-runner.js').UpdateRunner#log}
 * @used-by {@link import('./update-runner.js')}
 * @used-by {@link import('./update-state.js')}
 */
const appendGuardLog = (userDataDir, message, fileSystem = fs) => appendLauncherLog(userDataDir, message, {fs: fileSystem, prefix: '[UpdateGuard] '});
/**
 * @used-by {@link appendGuardLog}
 * @used-by {@link import('./launcher.js').launch}
 * @used-by {@link import('./launcher.js')}
 * @used-by {@link import('./main-bootstrap.js').configureSecondaryProfile}
 * @used-by {@link import('./main-bootstrap.js')}
 * @used-by {@link import('./update-state.js')}
 */
const appendLauncherLog = (userDataDir, message, {fs: fileSystem = fs, prefix = ''} = {}) => {
	if (userDataDir) {
		try {
			// 2026-11-20
			// "Record pre-spawn profile preparation failures in Multi-Account launcher.log":
			// https://github.com/dmitry-ai/antigravity-addons/issues/61
			fileSystem.mkdirSync(userDataDir, {recursive: true});
			fileSystem.appendFileSync(path.join(userDataDir, 'launcher.log'), new Date().toISOString() + ' ' + prefix + message + '\n');
		}
		catch {}
	}
};
/**
 * @used-by {@link import('./update-guard.js')} (UpdateGuard#clearDeferredUpdate)
 * @used-by {@link import('./update-runner.js').UpdateRunner#run}
 * @used-by {@link import('./update-runner.js')}
 * @used-by {@link import('./update-state.js')}
 */
const clearDeferredManifest = (deferredFile, fileSystem = fs) => {
	try {
		fileSystem.rmSync(deferredFile, {force: true});
	}
	catch {}
};
/**
 * @used-by {@link import('./update-guard.js')} (UpdateGuard#spawnManagedUpdate)
 * @used-by {@link import('./update-state.js')}
 */
const defaultNodeExecutable = () => fs.existsSync('C:/tools/nodejs/node.exe') ? 'C:/tools/nodejs/node.exe' : process.execPath;
/**
 * @used-by {@link import('./update-guard.js')} (UpdateGuard#constructor)
 * @used-by {@link import('./update-guard.js')} (UpdateGuard#handleQuit)
 * @used-by {@link import('./update-guard.js')} (UpdateGuard#recordDeferredUpdate)
 * @used-by {@link import('./update-guard.js')} (UpdateGuard#resolveInstaller)
 * @used-by {@link import('./update-guard.js')} (UpdateGuard#status)
 * @used-by {@link import('./update-runner.js').UpdateRunner#constructor}
 * @used-by {@link import('./update-runner.js')}
 * @used-by {@link import('./update-state.js')}
 */
const readDeferredManifest = (deferredFile, fileSystem = fs) => readJsonSafe(deferredFile, fileSystem);
/**
 * @used-by {@link import('./main-bootstrap.js').bootstrap}
 * @used-by {@link import('./main-bootstrap.js').configureSecondaryProfile}
 * @used-by {@link import('./main-bootstrap.js').ensureInitialWindowVisible}
 * @used-by {@link import('./main-bootstrap.js').listManagedWindows}
 * @used-by {@link import('./main-bootstrap.js')}
 * @used-by {@link import('./oauth-bridge.js').refreshInitialPage}
 * @used-by {@link import('./oauth-bridge.js')}
 * @used-by {@link import('./update-guard.js')} (UpdateGuard#constructor)
 * @used-by {@link import('./update-guard.js')} (UpdateGuard#getUpdater)
 * @used-by {@link import('./update-state.js')}
 */
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
/**
 * @used-by {@link import('./main-bootstrap.js').bootstrap}
 * @used-by {@link import('./main-bootstrap.js')}
 * @used-by {@link import('./update-guard.js')} (UpdateGuard#install)
 * @used-by {@link import('./update-state.js')}
 */
const silenceBrokenStdio = (proc = process) => {
	for (const name of ['stderr', 'stdout']) {
		const stream = proc?.[name];
		if (stream && 'object' === typeof stream) {
			if ('function' === typeof stream.on && !stream.__antigravityErrorSilenced) {
				stream.on('error', () => {});
				stream.__antigravityErrorSilenced = true;
			}
			if ('function' === typeof stream.write && !stream.__antigravityWriteSilenced) {
				stream.write = (_chunk, encoding, callback) => {
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
/**
 * @used-by {@link import('./update-guard.js')} (UpdateGuard#recordDeferredUpdate)
 * @used-by {@link import('./update-runner.js').UpdateRunner#saveDeferred}
 * @used-by {@link import('./update-runner.js')}
 * @used-by {@link import('./update-state.js')}
 */
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
module.exports = {
	activeSiblingProfiles,
	appendGuardLog,
	appendLauncherLog,
	clearDeferredManifest,
	defaultNodeExecutable,
	isLockfileHeld,
	isPidAlive,
	readDeferredManifest,
	resolveModule,
	silenceBrokenStdio,
	writeDeferredManifest
};
