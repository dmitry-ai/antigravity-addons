// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {CDP, openTargetSession} = require('../Upgrade/cdp-client');
const {readJsonSafe} = require('../Upgrade/process-io');
const {probeProfileEndpoint} = require('../Upgrade/profile-endpoints');
const {readProfiles} = require('./profiles');
const {ensureSharedSkills} = require('./skills-manifest');
const {appendLauncherLog, isLockfileHeld} = require('./update-state');
const mainBootstrapPath = path.join(__dirname, 'main-bootstrap.js');
const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
// 2026-10-28
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
/**
 * @used-by {@link import('./launcher.js')}
 * @used-by {@link import('./launcher.test.js')}
 * @used-by {@link launch}
 */
const activateExisting = async (profile, options = {}) => {
	let r = null;
	const fileSystem = options.fs || fs;
	const cdpClient = options.CDP || CDP;
	const request = options.fetch || globalThis.fetch;
	const locked = options.isLockfileHeld || (dir => isLockfileHeld(dir, fileSystem));
	// 2026-11-19
	// "Bridge Upgrade and OAuth renderer attach through main-process WebContents debugger":
	// https://github.com/dmitry-ai/antigravity-addons/issues/52
	const extraArgs = Array.isArray(options.args) ? options.args.filter(arg => 'string' === typeof arg && arg.length) : [];
	// 2026-11-14
	// "Replace bootstrap.toString() injection with require, deduplicate Electron window hooks, split update-guard.js, and parameterize scripts from profiles.json":
	// https://github.com/dmitry-ai/antigravity-addons/issues/26
	const record = readJsonSafe(path.join(profile.userDataDir, 'main-runtime.json'), fileSystem);
	if (record && record.id === profile.id && record.userDataDir === profile.userDataDir && /^ws:\/\/127\.0\.0\.1:\d+\/[\da-f-]+$/i.test(record.inspector)) {
		let cdp;
		try {
			cdp = await cdpClient.open(record.inspector);
			const state = await cdp.evaluate('({pid:process.pid,account:globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__})');
			// 2026-11-05
			// "Implement cross-profile auto-update guard (M-2) and unified main-process bootstrap for A0 and A6":
			// https://github.com/dmitry-ai/antigravity-addons/issues/20
			const expectedTokenStorage = 'A0' === profile.id ? 'native-credential-manager' : 'server-headless-file-store';
			if (state?.pid === record.pid && state.account?.id === profile.id && state.account.userDataDir === profile.userDataDir && state.account.tokenStorage === expectedTokenStorage) {
				const activated = await cdp.evaluate(`globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__(${JSON.stringify(extraArgs)})`);
				// 2026-11-10
				// "Support Electron BaseWindow + WebContentsView in Antigravity 2.30.0 for existing-window activation, taskbar badge identity, [A6] window title prefix, and update-guard focus lookup":
				// https://github.com/dmitry-ai/antigravity-addons/issues/22
				if (activated?.windows > 0) {
					r = activated;
				}
			}
		}
		catch {
			r = null;
		}
		finally {
			cdp?.close();
		}
	}
	// 2026-11-10
	// "Fix main-process EPIPE crash on closed launcher stderr pipe, disable differential .blockmap requests, and preserve managed shortcuts and profile bootstrap across updates":
	// https://github.com/dmitry-ai/antigravity-addons/issues/21
	if (!r && 'A0' === profile.id && locked(profile.userDataDir) && 'function' === typeof request) {
		// 2026-11-13
		// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
		// https://github.com/dmitry-ai/antigravity-addons/issues/25
		const endpoint = await probeProfileEndpoint(profile, {fetch: request, fs: fileSystem});
		if ('available' === endpoint.state && endpoint.pages.length) {
			try {
				for (const page of endpoint.pages) {
					// 2026-11-19
					// "Bridge Upgrade and OAuth renderer attach through main-process WebContents debugger":
					// https://github.com/dmitry-ai/antigravity-addons/issues/52
					const pageCdp = await (options.CDP ? cdpClient.open(page.webSocketDebuggerUrl) : openTargetSession(page));
					try {
						await pageCdp.call('Page.bringToFront');
					}
					finally {
						pageCdp.close();
					}
				}
				r = {id: profile.id, port: endpoint.port, windows: endpoint.pages.length};
			}
			catch {
				r = null;
			}
		}
	}
	return r;
};
// 2026-11-14
// "Break Upgrade and Multi-Account circular dependency, replace bootstrap.toString() with require, and split update-guard.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/40
/**
 * @used-by {@link import('./launcher.js')}
 * @used-by {@link import('./launcher.test.js')}
 * @used-by {@link launch}
 * @uses {@link import('./main-bootstrap.js').bootstrap}
 */
const buildBootstrapExpression = settings => `require(${JSON.stringify(mainBootstrapPath)}).bootstrap(require,${JSON.stringify(settings)})`;
// 2026-10-16
// "Distinguish background agy-node.cmd sidecar (ELECTRON_RUN_AS_NODE=1) from GUI processes in Upg during Antigravity 2.24.0 upgrade":
// https://github.com/dmitry-ai/antigravity-addons/issues/7
/**
 * @used-by {@link import('./launcher.js')}
 * @used-by {@link import('./launcher.test.js')}
 * @used-by {@link spawnOptions}
 */
const childEnvironment = (profile, original = process.env) => {
	const realHome = original.ANTIGRAVITY_ORIGINAL_USERPROFILE || original.USERPROFILE;
	const r = {...original};
	for (const key of Object.keys(r)) {
		if (/^(USERPROFILE|ELECTRON_RUN_AS_NODE|NODE_OPTIONS)$/i.test(key)) {
			delete r[key];
		}
	}
	r.USERPROFILE = 'A0' === profile.id ? realHome : profile.homeDir;
	r.ANTIGRAVITY_ORIGINAL_USERPROFILE = realHome;
	r.ANTIGRAVITY_ACCOUNT = profile.id;
	r.ANTIGRAVITY_VSCODE_HOST = '1';
	return r;
};
// 2026-11-18
// "Fix Desktop launcher starting Antigravity hidden in system tray without opening Hub window":
// https://github.com/dmitry-ai/antigravity-addons/issues/50
/**
 * @used-by {@link import('./launcher.js')}
 * @used-by {@link import('./launcher.test.js')}
 * @used-by {@link launch}
 */
const spawnOptions = (executable, profile, original = process.env) => ({
	cwd: path.dirname(executable),
	env: childEnvironment(profile, original),
	windowsHide: false,
	detached: true,
	stdio: ['ignore', 'ignore', 'pipe']
});
// 2026-10-28
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
/**
 * @used-by Multi-Account/launch.vbs
 * @used-by {@link import('./launcher.js')}
 * @used-by {@link import('./update-runner.js').UpdateRunner#run}
 */
const launch = async (id, extraArgs = [], options = {}) => {
	result: {
		// 2026-11-20
		// "Record pre-spawn profile preparation failures in Multi-Account launcher.log":
		// https://github.com/dmitry-ai/antigravity-addons/issues/61
		const profilesOptions = {};
		if (options.roaming || process.env.ANTIGRAVITY_ROAMING_DIR) {
			profilesOptions.roaming = options.roaming || process.env.ANTIGRAVITY_ROAMING_DIR;
		}
		if (options.profilesFile || process.env.ANTIGRAVITY_PROFILES_FILE) {
			profilesOptions.filename = options.profilesFile || process.env.ANTIGRAVITY_PROFILES_FILE;
		}
		const profile = readProfiles(profilesOptions).find(item => item.id === id);
		if (!profile) {
			throw Error('Unknown profile: ' + id);
		}
		const cleanArgs = Array.isArray(extraArgs) ? extraArgs.filter(arg => 'string' === typeof arg && arg.length) : [];
		const log = message => appendLauncherLog(profile.userDataDir, message, {fs});
		let chrome = null;
		let executable = '';
		try {
			chrome = 'A0' === profile.id ? null : (options.readChrome || readChromeShortcut)(profile);
			prepareProfile(profile);
			// 2026-10-28
			// "Diagnose Tools companion stop timeout, verify automatic Tools recovery via A6 launcher, and consolidate 14 legacy journals into Unified Journal":
			// https://github.com/dmitry-ai/antigravity-addons/issues/13
			// 2026-11-21
			// "Launch Antigravity profiles even when the addons CDP runtime fails to start":
			// https://github.com/dmitry-ai/antigravity-addons/issues/66
			try {
				await (options.ensureRuntime || (() => require('../Upgrade/runtime-control').ensureRunning()))();
			}
			catch (error) {
				log('WARNING: Addons runtime unavailable (' + error.message + '); launching without addons');
			}
			const activated = await activateExisting(profile, {args: cleanArgs});
			if (activated) {
				console.log(JSON.stringify(activated));
				break result;
			}
			executable = options.executable || path.join(process.env.LOCALAPPDATA, 'Programs/antigravity/Antigravity.exe');
			if (!fs.existsSync(executable)) {
				throw Error('Antigravity is not installed at ' + executable);
			}
		}
		catch (error) {
			log('ERROR: ' + error.message);
			throw error;
		}
		log('Launch requested for ' + id);
		// 2026-10-30
		// "Extract Antigravity Addons into standalone code and meta (_) repositories, flatten tool directories, and prevent A6 working-directory locks":
		// https://github.com/dmitry-ai/antigravity-addons/issues/15
		const child = cp.spawn(executable, ['--user-data-dir=' + profile.userDataDir, '--inspect-brk=127.0.0.1:0', ...cleanArgs], spawnOptions(executable, profile));
		let inspector;
		let exited;
		let spawnError;
		child.once('error', error => {
			spawnError = error;
		});
		child.once('exit', code => {
			exited = code;
		});
		child.stderr.setEncoding('utf8');
		let stderr = '';
		child.stderr.on('data', data => {
			stderr = (stderr + data).slice(-16000);
			inspector ||= stderr.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];
		});
		let cdp;
		let resumed = false;
		try {
			const deadline = Date.now() + 20000;
			while (!inspector) {
				if (spawnError) {
					throw spawnError;
				}
				if (undefined !== exited) {
					throw Error('Antigravity exited before the profile bootstrap: ' + exited);
				}
				if (Date.now() > deadline) {
					throw Error('Main-process CDP was not published');
				}
				await sleep(50);
			}
			cdp = await CDP.open(inspector);
			await cdp.call('Debugger.enable');
			const paused = new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(Error('Antigravity did not pause at app entry')), 10000);
				cdp.on('Debugger.paused', event => {
					clearTimeout(timer);
					resolve(event);
				});
			});
			await cdp.call('Runtime.runIfWaitingForDebugger');
			const frame = (await paused).callFrames[0];
			const settings = {
				...profile,
				chrome,
				codeRoot: __dirname,
				inspector,
				browserEnvironment: {USERPROFILE: process.env.ANTIGRAVITY_ORIGINAL_USERPROFILE || process.env.USERPROFILE}
			};
			const evaluation = await cdp.call('Debugger.evaluateOnCallFrame', {
				callFrameId: frame.callFrameId,
				expression: buildBootstrapExpression(settings),
				returnByValue: true
			});
			if (evaluation.exceptionDetails) {
				throw Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text);
			}
			if (evaluation.result?.value?.id !== id) {
				throw Error('Account bootstrap was not confirmed');
			}
			await cdp.call('Debugger.resume');
			resumed = true;
			log(chrome ? 'Isolated profile configured; browser shortcut ' + profile.chromeShortcut : 'Primary profile configured with update guard');
			console.log(JSON.stringify({id, homeDir: 'A0' === profile.id ? process.env.ANTIGRAVITY_ORIGINAL_USERPROFILE || process.env.USERPROFILE : profile.homeDir, userDataDir: profile.userDataDir, email: profile.email || null, chromeProfile: chrome?.directory || null}));
		}
		catch (error) {
			log('ERROR: ' + error.message);
			throw error;
		}
		finally {
			if (cdp) {
				if (!resumed) {
					await cdp.call('Debugger.resume').catch(() => {});
				}
				await cdp.call('Debugger.disable').catch(() => {});
				cdp.close();
			}
			child.stderr.destroy();
			child.unref();
		}
	}
};
/**
 * @used-by {@link import('./launcher.js')}
 * @used-by {@link import('./launcher.test.js')}
 * @used-by {@link import('./skills-manifest.test.js')}
 * @used-by {@link launch}
 */
const prepareProfile = profile => {
	// 2026-11-05
	// "Implement cross-profile auto-update guard (M-2) and unified main-process bootstrap for A0 and A6":
	// https://github.com/dmitry-ai/antigravity-addons/issues/20
	if ('A0' !== profile.id) {
		if (!fs.existsSync(profile.skillsRoot) || !fs.readdirSync(profile.skillsRoot).some(name => fs.existsSync(path.join(profile.skillsRoot, name, 'SKILL.md')))) {
			throw Error('The shared skills source is unavailable');
		}
		const config = path.join(profile.homeDir, '.gemini/config');
		fs.mkdirSync(config, {recursive: true});
		const filename = path.join(config, 'skills.json');
		// 2026-11-02
		// "Preserve inherited shared skills during A6 profile preparation":
		// https://github.com/dmitry-ai/antigravity-addons/issues/19
		ensureSharedSkills(filename, profile.skillsRoot);
	}
	fs.mkdirSync(path.join(profile.userDataDir, 'logs'), {recursive: true});
};
// 2026-11-28 "Remove hardcoded A6 profile defaults from OAuthBridge and launchers": https://github.com/dmitry-ai/antigravity-addons/issues/76
/**
 * @used-by {@link import('./launcher.js')}
 * @used-by {@link launch}
 */
const readChromeShortcut = (profile, options = {}) => {
	const fileSystem = options.fs || fs;
	const readShortcut = options.readShortcut || (() => {
		const script = "$p=Join-Path ([Environment]::GetFolderPath('Desktop')) '" + profile.chromeShortcut + ".lnk'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($p); @{executable=$s.TargetPath;command=$s.Arguments}|ConvertTo-Json -Compress";
		return JSON.parse(cp.execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {encoding: 'utf8', windowsHide: true}).replace(/^\uFEFF/, ''));
	});
	const shortcut = readShortcut(profile);
	if (!shortcut?.executable || !fileSystem.existsSync(shortcut.executable) || 'chrome.exe' !== path.basename(shortcut.executable).toLowerCase()) {
		throw Error('Chrome shortcut is missing or invalid');
	}
	const command = String(shortcut.command || '');
	const value = flag => command.match(new RegExp('(?:^|\\s)--' + flag + '=(?:"([^"]+)"|([^\\s]+))'))?.slice(1).find(Boolean);
	const userData = value('user-data-dir');
	const directory = value('profile-directory');
	const debugPort = Number(value('remote-debugging-port'));
	const disableFeatures = value('disable-features') || 'ExtensionManifestV2Unsupported,ExtensionManifestV2Disabled';
	if (!userData || !path.isAbsolute(userData) || !directory || /[\\/]/.test(directory)) {
		throw Error('Chrome shortcut must specify its user-data-dir and profile-directory');
	}
	if (options.expectedDirectory && directory !== options.expectedDirectory) {
		throw Error('Chrome shortcut profile directory does not match ' + options.expectedDirectory);
	}
	if (!Number.isInteger(debugPort) || 1 > debugPort || 65535 < debugPort) {
		throw Error('Chrome shortcut must specify its CDP port for the OAuth callback');
	}
	const state = readJsonSafe(path.join(userData, 'Local State'), fileSystem);
	if (state?.profile?.info_cache?.[directory]?.user_name?.toLowerCase() !== profile.email.toLowerCase()) {
		throw Error('Chrome shortcut account does not match ' + profile.email);
	}
	return {
		executable: shortcut.executable,
		arguments: ['--user-data-dir=' + userData, '--profile-directory=' + directory, '--remote-debugging-port=' + debugPort, '--disable-features=' + disableFeatures],
		directory,
		userData,
		debugPort
	};
};
/**
 * @used-by {@link import('./launcher.js')}
 * @used-by {@link launch}
 */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
if (module === require.main) {
	const targetProfile = process.argv[2];
	(targetProfile ? launch(targetProfile, process.argv.slice(3)) : Promise.reject(Error('Profile ID argument is required'))).catch(error => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
module.exports = {activateExisting, buildBootstrapExpression, childEnvironment, launch, prepareProfile, readChromeShortcut, spawnOptions};
