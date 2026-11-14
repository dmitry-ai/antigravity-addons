// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Break Upgrade and Multi-Account circular dependency, replace bootstrap.toString() with require, and split update-guard.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/40
const fs = require('node:fs');
const path = require('node:path');
const {isPidAlive, readJsonSafe, writeFileAtomic} = require('../Upgrade/process-io');
const {readProfiles} = require('./profiles');
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
const appendGuardLog = (userDataDir, message, fileSystem = fs) => appendLauncherLog(userDataDir, message, {fs: fileSystem, prefix: '[UpdateGuard] '});
const appendLauncherLog = (userDataDir, message, {fs: fileSystem = fs, prefix = ''} = {}) => {
	if (userDataDir) {
		try {
			fileSystem.appendFileSync(path.join(userDataDir, 'launcher.log'), new Date().toISOString() + ' ' + prefix + message + '\n');
		}
		catch {}
	}
};
const clearDeferredManifest = (deferredFile, fileSystem = fs) => {
	try {
		fileSystem.rmSync(deferredFile, {force: true});
	}
	catch {}
};
const defaultNodeExecutable = () => fs.existsSync('C:/tools/nodejs/node.exe') ? 'C:/tools/nodejs/node.exe' : process.execPath;
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
const readDeferredManifest = (deferredFile, fileSystem = fs) => readJsonSafe(deferredFile, fileSystem);
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
