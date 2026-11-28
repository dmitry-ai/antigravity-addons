// 2026-11-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Add ProfileRepository and ProfileProvisioner CLI with duplicate checks":
// https://github.com/dmitry-ai/antigravity-addons/issues/77
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {writeFileAtomic} = require('../Upgrade/process-io');
const {readProfiles, validateProfilesConfig} = require('../Upgrade/profiles');
const {isLinkedWorktree} = require('../Upgrade/runtime-control');
const {prepareProfile, readChromeShortcut} = require('./launcher');
const {configFile} = require('./profiles');
const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
/**
 * @used-by {@link ProfileProvisioner#add}
 * @used-by {@link ProfileRepository#save}
 * @used-by {@link import('./profile-manager.js')}
 */
const sortProfiles = profiles => [...profiles].sort((a, b) => 'A0' === a.id ? -1 : 'A0' === b.id ? 1 : Number(a.id.slice(1)) - Number(b.id.slice(1)));
class ProfileRepository {
	/**
	 * @used-by {@link import('./profile-manager.js')}
	 * @used-by {@link import('./profile-manager.test.js')}
	 * @used-by {@link runCli}
	 */
	constructor(filename = configFile, {fs: fileSystem = fs} = {}) {
		this.filename = path.resolve(filename);
		this.fs = fileSystem;
	}
	/**
	 * @used-by {@link import('./profile-manager.test.js')}
	 */
	add(entry) {
		const current = this.load();
		if (current.profiles.some(item => item.id === entry.id)) {
			throw Error('Profile already exists: ' + entry.id);
		}
		return this.upsert(entry);
	}
	/**
	 * @used-by {@link ProfileProvisioner#add}
	 * @used-by {@link ProfileProvisioner#list}
	 * @used-by {@link ProfileRepository#add}
	 * @used-by {@link ProfileRepository#upsert}
	 * @used-by {@link import('./profile-manager.js')}
	 * @used-by {@link import('./profile-manager.test.js')}
	 */
	load() {
		return JSON.parse(this.fs.readFileSync(this.filename, 'utf8').replace(/^\uFEFF/, ''));
	}
	/**
	 * @used-by {@link ProfileRepository#upsert}
	 */
	save(config) {
		const validated = validateProfilesConfig({...config, profiles: sortProfiles(config.profiles)});
		writeFileAtomic(this.filename, JSON.stringify(validated, null, '\t') + '\n', {fs: this.fs});
		return validated;
	}
	/**
	 * @used-by {@link ProfileProvisioner#add}
	 * @used-by {@link ProfileRepository#add}
	 * @used-by {@link import('./profile-manager.test.js')}
	 */
	upsert(entry) {
		const current = this.load();
		const nextProfiles = [...current.profiles.filter(item => item.id !== entry.id), entry];
		return this.save({...current, profiles: nextProfiles});
	}
	/**
	 * @used-by {@link ProfileProvisioner#validate}
	 */
	validate(config = this.load()) {
		return validateProfilesConfig(config);
	}
}
class ProfileProvisioner {
	/**
	 * @used-by {@link import('./profile-manager.test.js')}
	 * @used-by {@link runCli}
	 */
	constructor({canonicalProfilesFile = configFile, checkoutDir = __dirname, fs: fileSystem = fs, isLinkedWorktree: checkWorktree = isLinkedWorktree, prepareProfile: prep = prepareProfile, readChrome = readChromeShortcut, repository = new ProfileRepository(), roaming = process.env.APPDATA, runInstall} = {}) {
		this.canonicalProfilesFile = path.resolve(canonicalProfilesFile);
		this.checkoutDir = path.resolve(checkoutDir);
		this.fs = fileSystem;
		this.isLinkedWorktree = checkWorktree;
		this.prepareProfile = prep;
		this.readChrome = readChrome;
		this.repository = repository;
		this.roaming = roaming;
		this.runInstall = runInstall;
	}
	/**
	 * @used-by {@link import('./profile-manager.test.js')}
	 * @used-by {@link runCli}
	 */
	add({chromeProfile, chromeShortcut, email, enabled, id, label, skipInstall = false, update = false, userData}) {
		const nonCanonical = path.resolve(this.repository.filename).toLowerCase() !== this.canonicalProfilesFile.toLowerCase();
		if (!skipInstall && 'function' !== typeof this.runInstall && (this.isLinkedWorktree(this.checkoutDir) || nonCanonical)) {
			throw Error('Refusing to run host install.ps1 from a linked Git worktree or non-canonical profiles.json; pass --skip-install');
		}
		const entry = {id, userData: userData || `Antigravity-${id}`};
		if (undefined !== email) {
			entry.email = email;
		}
		if (undefined !== chromeShortcut) {
			entry.chromeShortcut = String(chromeShortcut);
		}
		if (undefined !== label) {
			entry.label = label;
		}
		if (undefined !== enabled) {
			entry.enabled = enabled;
		}
		const current = this.repository.load();
		if (!update && current.profiles.some(item => item.id === entry.id)) {
			throw Error('Profile already exists: ' + entry.id);
		}
		validateProfilesConfig({...current, profiles: sortProfiles([...current.profiles.filter(item => item.id !== entry.id), entry])});
		const chrome = 'A0' === entry.id ? null : this.readChrome(entry, {expectedDirectory: chromeProfile, fs: this.fs});
		if (update) {
			this.repository.upsert(entry);
		}
		else {
			this.repository.add(entry);
		}
		const resolved = readProfiles({filename: this.repository.filename, roaming: this.roaming}).find(item => item.id === entry.id);
		this.prepareProfile(resolved);
		let installed = false;
		if (!skipInstall) {
			if ('function' === typeof this.runInstall) {
				this.runInstall({checkoutDir: this.checkoutDir, profile: resolved});
			}
			else {
				cp.execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.checkoutDir, 'install.ps1')], {encoding: 'utf8', windowsHide: true});
			}
			installed = true;
		}
		return {chrome, installed, profile: resolved, profilesFile: this.repository.filename};
	}
	/**
	 * @used-by {@link runCli}
	 */
	list() {
		const config = this.repository.load();
		return {profilesFile: this.repository.filename, profiles: config.profiles};
	}
	/**
	 * @used-by {@link runCli}
	 * @uses {@link ProfileRepository#validate}
	 */
	validate() {
		const validated = this.repository.validate();
		return {valid: true, count: validated.profiles.length, profilesFile: this.repository.filename};
	}
}
/**
 * @used-by {@link import('./profile-manager.js')}
 * @used-by {@link import('./profile-manager.test.js')}
 * @used-by {@link runCli}
 */
const parseArgs = argv => {
	const valueFlags = {
		'--chrome': 'chromeShortcut',
		'--chrome-profile': 'chromeProfile',
		'--email': 'email',
		'--id': 'id',
		'--label': 'label',
		'--profiles': 'profilesFile',
		'--roaming': 'roaming',
		'--user-data': 'userData'
	};
	const r = {command: argv[0] || ''};
	for (let i = 1; i < argv.length; i++) {
		const token = argv[i];
		if ('--skip-install' === token) {
			r.skipInstall = true;
		}
		else if ('--update' === token) {
			r.update = true;
		}
		else if ('--disabled' === token) {
			r.enabled = false;
		}
		else {
			const eq = token.indexOf('=');
			const key = -1 !== eq ? token.slice(0, eq) : token;
			const target = valueFlags[key];
			if (!target) {
				throw Error('Unknown option: ' + token);
			}
			if (-1 !== eq) {
				r[target] = token.slice(eq + 1);
			}
			else if (i + 1 < argv.length) {
				r[target] = argv[++i];
			}
			else {
				throw Error('Missing value for ' + key);
			}
		}
	}
	return r;
};
/**
 * @used-by {@link import('./profile-manager.js')}
 * @used-by {@link import('./profile-manager.test.js')}
 */
const runCli = (argv, options = {}) => {
	const parsed = parseArgs(argv);
	const repository = new ProfileRepository(parsed.profilesFile || options.profilesFile || configFile, {fs: options.fs || fs});
	const provisioner = new ProfileProvisioner({...options, repository, roaming: parsed.roaming || options.roaming || process.env.APPDATA});
	let r;
	if ('list' === parsed.command) {
		r = provisioner.list();
	}
	else if ('validate' === parsed.command) {
		r = provisioner.validate();
	}
	else if ('add' === parsed.command) {
		r = provisioner.add(parsed);
	}
	else {
		throw Error('Usage: profile-manager.js <list|validate|add> [options]');
	}
	return r;
};
if (module === require.main) {
	try {
		console.log(JSON.stringify(runCli(process.argv.slice(2)), null, '\t'));
	}
	catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
module.exports = {ProfileProvisioner, ProfileRepository, parseArgs, runCli, sortProfiles};
