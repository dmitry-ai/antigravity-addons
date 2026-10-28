const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const {readProfiles} = require('./profiles');
const {CDP} = require('../../tools/Upgrade/code/cdp-client');
const {bootstrap} = require('./main-bootstrap');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const readChromeShortcut = profile => {
	const script = "$p=Join-Path ([Environment]::GetFolderPath('Desktop')) '" + profile.chromeShortcut + ".lnk'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($p); @{executable=$s.TargetPath;command=$s.Arguments}|ConvertTo-Json -Compress";
	const shortcut = JSON.parse(cp.execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {encoding: 'utf8', windowsHide: true}).replace(/^\uFEFF/, ''));
	if (!fs.existsSync(shortcut.executable) || path.basename(shortcut.executable).toLowerCase() !== 'chrome.exe') throw Error('Chrome shortcut is missing or invalid');
	const value = flag => shortcut.command.match(new RegExp('(?:^|\\s)--' + flag + '=(?:"([^"]+)"|([^\\s]+))'))?.slice(1).find(Boolean);
	const userData = value('user-data-dir'), directory = value('profile-directory');
	const debugPort = Number(value('remote-debugging-port'));
	if (!userData || !path.isAbsolute(userData) || !directory || /[\\/]/.test(directory)) throw Error('Chrome shortcut must specify its user-data-dir and profile-directory');
	if (!Number.isInteger(debugPort) || debugPort < 1 || debugPort > 65535) throw Error('Chrome shortcut must specify its CDP port for the OAuth callback');
	const state = JSON.parse(fs.readFileSync(path.join(userData, 'Local State'), 'utf8'));
	if (state.profile?.info_cache?.[directory]?.user_name?.toLowerCase() !== profile.email.toLowerCase()) throw Error('Chrome shortcut account does not match ' + profile.email);
	return {executable: shortcut.executable, arguments: ['--user-data-dir=' + userData, '--profile-directory=' + directory, '--remote-debugging-port=' + debugPort, '--disable-features=ExtensionManifestV2Unsupported,ExtensionManifestV2Disable'], directory, userData, debugPort};
};
const prepareProfile = profile => {
	if (profile.id === 'A0') throw Error('Use the original A0 shortcut');
	if (!fs.existsSync(profile.skillsRoot) || !fs.readdirSync(profile.skillsRoot).some(name => fs.existsSync(path.join(profile.skillsRoot, name, 'SKILL.md')))) throw Error('The shared skills source is unavailable');
	const config = path.join(profile.homeDir, '.gemini/config');
	fs.mkdirSync(config, {recursive: true});
	const filename = path.join(config, 'skills.json');
	const skills = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {entries: []};
	if (!Array.isArray(skills.entries)) throw Error('Invalid skills.json');
	if (!skills.entries.some(entry => path.resolve(entry.path).toLowerCase() === path.resolve(profile.skillsRoot).toLowerCase())) {
		skills.entries.push({path: profile.skillsRoot});
		fs.writeFileSync(filename, JSON.stringify(skills, null, 2));
	}
	fs.mkdirSync(path.join(profile.userDataDir, 'logs'), {recursive: true});
};
const childEnvironment = (profile, original = process.env) => {
	const result = {...original};
	for (const key of Object.keys(result)) if (/^(USERPROFILE|ELECTRON_RUN_AS_NODE|NODE_OPTIONS)$/i.test(key)) delete result[key];
	result.USERPROFILE = profile.homeDir;
	result.ANTIGRAVITY_ORIGINAL_USERPROFILE = original.ANTIGRAVITY_ORIGINAL_USERPROFILE || original.USERPROFILE;
	result.ANTIGRAVITY_ACCOUNT = profile.id;
	// The server delegates browser URLs back to Electron, where the account's Chrome routing is installed.
	result.ANTIGRAVITY_VSCODE_HOST = '1';
	return result;
};
const launch = async id => {
	const profile = readProfiles().find(item => item.id === id);
	if (!profile) throw Error('Unknown profile: ' + id);
	const chrome = readChromeShortcut(profile);
	prepareProfile(profile);
	const log = message => fs.appendFileSync(path.join(profile.userDataDir, 'launcher.log'), new Date().toISOString() + ' ' + message + '\n');
	await require('../../tools/Upgrade/code/runtime-control').ensureRunning();
	const activated = await activateExisting(profile);
	if (activated) {console.log(JSON.stringify(activated)); return;}
	const executable = path.join(process.env.LOCALAPPDATA, 'Programs/antigravity/Antigravity.exe');
	if (!fs.existsSync(executable)) throw Error('Antigravity is not installed at ' + executable);
	// Start Tools in the real user's environment before changing the app's child environment.
	log('Launch requested for ' + id);
	const child = cp.spawn(executable, ['--user-data-dir=' + profile.userDataDir, '--inspect-brk=127.0.0.1:0'], {env: childEnvironment(profile), windowsHide: true, detached: true, stdio: ['ignore', 'ignore', 'pipe']});
	let inspector, exited, spawnError;
	child.once('error', error => {spawnError = error;});
	child.once('exit', code => {exited = code;});
	child.stderr.setEncoding('utf8');
	let stderr = '';
	child.stderr.on('data', data => {stderr = (stderr + data).slice(-16000); inspector ||= stderr.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];});
	let cdp, resumed = false;
	try {
		const deadline = Date.now() + 20000;
		while (!inspector) {if (spawnError) throw spawnError; if (exited !== undefined) throw Error('Antigravity exited before the profile bootstrap: ' + exited); if (Date.now() > deadline) throw Error('Main-process CDP was not published'); await sleep(50);}
		cdp = await CDP.open(inspector);
		await cdp.call('Debugger.enable');
		const paused = new Promise((resolve, reject) => {const timer = setTimeout(() => reject(Error('Antigravity did not pause at app entry')), 10000); cdp.on('Debugger.paused', event => {clearTimeout(timer); resolve(event);});});
		await cdp.call('Runtime.runIfWaitingForDebugger');
		const frame = (await paused).callFrames[0];
		const settings = {...profile, chrome, codeRoot: __dirname, inspector, browserEnvironment: {USERPROFILE: process.env.ANTIGRAVITY_ORIGINAL_USERPROFILE || process.env.USERPROFILE}};
		const result = await cdp.call('Debugger.evaluateOnCallFrame', {callFrameId: frame.callFrameId, expression: '(' + bootstrap.toString() + ')(require,' + JSON.stringify(settings) + ')', returnByValue: true});
		if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
		if (result.result?.value?.id !== id) throw Error('Account bootstrap was not confirmed');
		await cdp.call('Debugger.resume'); resumed = true;
		log('Isolated profile configured; browser shortcut ' + profile.chromeShortcut);
		console.log(JSON.stringify({id, homeDir: profile.homeDir, userDataDir: profile.userDataDir, email: profile.email, chromeProfile: chrome.directory}));
	} catch (error) {log('ERROR: ' + error.message); throw error;}
	finally {
		// Never stop Antigravity. On bootstrap errors leave the isolated process available for diagnosis.
		if (cdp) {if (!resumed) await cdp.call('Debugger.resume').catch(() => {}); await cdp.call('Debugger.disable').catch(() => {}); cdp.close();}
		child.stderr.destroy(); child.unref();
	}
};
const activateExisting = async profile => {
	let record; try {record = JSON.parse(fs.readFileSync(path.join(profile.userDataDir, 'main-runtime.json'), 'utf8'));} catch {return null;}
	if (record.id !== profile.id || record.userDataDir !== profile.userDataDir || !/^ws:\/\/127\.0\.0\.1:\d+\/[\da-f-]+$/i.test(record.inspector)) return null;
	let cdp;
	try {
		cdp = await CDP.open(record.inspector);
		const state = await cdp.evaluate('({pid:process.pid,account:globalThis.__ANTIGRAVITY_MANAGED_ACCOUNT__})');
		if (state?.pid !== record.pid || state.account?.id !== profile.id || state.account.userDataDir !== profile.userDataDir || state.account.tokenStorage !== 'server-headless-file-store') return null;
		return await cdp.evaluate('globalThis.__ANTIGRAVITY_MANAGED_ACTIVATE__()');
	} catch {return null;} finally {cdp?.close();}
};
if (require.main === module) launch(process.argv[2] || 'A6').catch(error => {console.error(error.message); process.exitCode = 1;});
module.exports = {launch, prepareProfile, childEnvironment, readChromeShortcut, activateExisting};
