// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
// 2026-11-13
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
/**
 * @used-by {@link import('../Multi-Account/update-runner.js').UpdateRunner#constructor}
 * @used-by {@link import('../Multi-Account/update-runner.js').UpdateRunner#run}
 * @used-by {@link import('../Multi-Account/update-runner.js')}
 * @used-by {@link import('../Multi-Account/update-state.js').activeSiblingProfiles}
 * @used-by {@link import('../Multi-Account/update-state.js')}
 * @used-by {@link import('./cdp-companion.js').Companion#start}
 * @used-by {@link import('./cdp-companion.js')}
 * @used-by {@link import('./process-io.js')}
 * @used-by {@link import('./profile-endpoints.js')}
 * @used-by {@link import('./runtime-control.js').alive}
 * @used-by {@link import('./runtime-control.js')}
 */
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
/**
 * @used-by {@link import('../Folders/cdp-runtime.js')}
 * @used-by {@link import('../Folders/cdp-runtime.js')} (createFoldersRuntime)
 * @used-by {@link import('../Multi-Account/launcher.js').activateExisting}
 * @used-by {@link import('../Multi-Account/launcher.js').readChromeShortcut}
 * @used-by {@link import('../Multi-Account/launcher.js')}
 * @used-by {@link import('../Multi-Account/main-bootstrap.js').bootstrap}
 * @used-by {@link import('../Multi-Account/main-bootstrap.js').configureSecondaryProfile}
 * @used-by {@link import('../Multi-Account/main-bootstrap.js')}
 * @used-by {@link import('../Multi-Account/update-guard.js')}
 * @used-by {@link import('../Multi-Account/update-guard.js')} (UpdateGuard#resolveInstaller)
 * @used-by {@link import('../Multi-Account/update-state.js').activeSiblingProfiles}
 * @used-by {@link import('../Multi-Account/update-state.js').readDeferredManifest}
 * @used-by {@link import('../Multi-Account/update-state.js')}
 * @used-by {@link import('./process-io.js')}
 * @used-by {@link import('./profile-endpoints.js').probeProfileEndpoint}
 * @used-by {@link import('./profile-endpoints.js')}
 * @used-by {@link import('./runtime-control.js').readState}
 * @used-by {@link import('./runtime-control.js')}
 */
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
/**
 * @used-by {@link import('../Folders/cdp-runtime.js')}
 * @used-by {@link import('../Folders/cdp-runtime.js')} (createFoldersRuntime)
 * @used-by {@link import('../Folders/folders-manager.js').FoldersCliManager#setEnabled}
 * @used-by {@link import('../Folders/folders-manager.js').persistConfig}
 * @used-by {@link import('../Folders/folders-manager.js')}
 * @used-by {@link import('../Multi-Account/main-bootstrap.js').bootstrap}
 * @used-by {@link import('../Multi-Account/main-bootstrap.js').configureSecondaryProfile}
 * @used-by {@link import('../Multi-Account/main-bootstrap.js')}
 * @used-by {@link import('../Multi-Account/skills-manifest.js').ensureSharedSkills}
 * @used-by {@link import('../Multi-Account/skills-manifest.js')}
 * @used-by {@link import('../Multi-Account/update-state.js').writeDeferredManifest}
 * @used-by {@link import('../Multi-Account/update-state.js')}
 * @used-by {@link import('./cdp-companion.js').Companion#writeState}
 * @used-by {@link import('./cdp-companion.js')}
 * @used-by {@link import('./process-io.js')}
 * @used-by {@link import('./runtime-control.js').stopRuntime}
 * @used-by {@link import('./runtime-control.js')}
 */
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
// 2026-11-19
// "Fail closed when active Antigravity profiles lack a reachable inspector endpoint":
// https://github.com/dmitry-ai/antigravity-addons/issues/53
/**
 * @used-by {@link import('../Multi-Account/update-state.js').activeSiblingProfiles}
 * @used-by {@link import('../Multi-Account/update-state.js')}
 * @used-by {@link import('./process-io.js')}
 * @used-by {@link import('./profile-endpoints.js')}
 */
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
