// 2026-11-19 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Fail closed when active Antigravity profiles lack a reachable inspector endpoint":
// https://github.com/dmitry-ai/antigravity-addons/issues/53
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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
const readJsonSafe = (filename, fileSystem = fs) => {
	let r = null;
	try {
		r = JSON.parse(fileSystem.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
	}
	catch {
		r = null;
	}
	return r;
};
const writeFileAtomic = (filename, content, {beforeRename, fs: fileSystem = fs, sync = false} = {}) => {
	const dir = path.dirname(filename);
	fileSystem.mkdirSync(dir, {recursive: true});
	const temporary = path.join(dir, `.${path.basename(filename)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
	try {
		if (!sync) {
			fileSystem.writeFileSync(temporary, content, 'utf8');
		}
		else {
			const descriptor = fileSystem.openSync(temporary, 'wx');
			try {
				fileSystem.writeFileSync(descriptor, content);
				fileSystem.fsyncSync(descriptor);
			}
			finally {
				fileSystem.closeSync(descriptor);
			}
		}
		beforeRename?.();
		fileSystem.renameSync(temporary, filename);
	}
	finally {
		fileSystem.rmSync(temporary, {force: true});
	}
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
module.exports = {isLockfileHeld, isPidAlive, readJsonSafe, writeFileAtomic};
