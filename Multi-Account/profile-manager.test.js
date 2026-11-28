// 2026-11-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Add ProfileRepository and ProfileProvisioner CLI with duplicate checks":
// https://github.com/dmitry-ai/antigravity-addons/issues/77
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {createTempDir} = require('../Upgrade/test-helpers');
const {discoverEndpoints} = require('../Upgrade/profile-endpoints');
const {readProfiles, validateProfilesConfig} = require('../Upgrade/profiles');
const {launch} = require('./launcher');
const {ProfileProvisioner, ProfileRepository, parseArgs, runCli} = require('./profile-manager');
/**
 * @used-by {@link import('./profile-manager.test.js')}
 */
const baseConfig = skillsRoot => ({
	schemaVersion: 1,
	skillsRoot,
	profiles: [
		{id: 'A0', userData: 'Antigravity'},
		{id: 'A6', userData: 'Antigravity-A6', email: 'admin6@mage2.pro', chromeShortcut: '6'}
	]
});
/**
 * @used-by {@link import('./profile-manager.test.js')}
 */
const fixture = context => createTempDir(context, 'antigravity-profile-mgr-');
test('validateProfilesConfig enforces unique email and Chrome shortcut, safe userData, and enabled/label flags', () => {
	const ok = validateProfilesConfig({
		schemaVersion: 1,
		skillsRoot: '${HARNESS_SKILLS_DIR}',
		profiles: [
			{id: 'A0', userData: 'Antigravity', label: 'Primary'},
			{id: 'A5', userData: 'Antigravity-A5', email: 'admin5@mage2.pro', chromeShortcut: '5', enabled: false},
			{id: 'A6', userData: 'Antigravity-A6', email: 'admin6@mage2.pro', chromeShortcut: '6'}
		]
	});
	assert.equal(ok.profiles.length, 3);
	assert.equal(ok.profiles[1].enabled, false);
	const dupEmail = baseConfig('${HARNESS_SKILLS_DIR}');
	dupEmail.profiles.push({id: 'A5', userData: 'Antigravity-A5', email: 'ADMIN6@MAGE2.PRO', chromeShortcut: '5'});
	assert.throws(() => validateProfilesConfig(dupEmail), /email/i);
	const dupShortcut = baseConfig('${HARNESS_SKILLS_DIR}');
	dupShortcut.profiles.push({id: 'A5', userData: 'Antigravity-A5', email: 'admin5@mage2.pro', chromeShortcut: '6'});
	assert.throws(() => validateProfilesConfig(dupShortcut), /shortcut/i);
	const disabledA0 = baseConfig('${HARNESS_SKILLS_DIR}');
	disabledA0.profiles[0].enabled = false;
	assert.throws(() => validateProfilesConfig(disabledA0), /A0/);
	const badEnabled = baseConfig('${HARNESS_SKILLS_DIR}');
	badEnabled.profiles[1].enabled = 'no';
	assert.throws(() => validateProfilesConfig(badEnabled), /enabled/i);
	const badLabel = baseConfig('${HARNESS_SKILLS_DIR}');
	badLabel.profiles[1].label = '   ';
	assert.throws(() => validateProfilesConfig(badLabel), /label/i);
	const unsafeDir = baseConfig('${HARNESS_SKILLS_DIR}');
	unsafeDir.profiles[1].userData = '$APPDATA';
	assert.throws(() => validateProfilesConfig(unsafeDir), /profile/i);
});
test('Disabled profiles are excluded from discoverEndpoints and rejected by launcher.launch', async context => {
	const root = fixture(context);
	const roaming = path.join(root, 'roaming');
	const skillsRoot = path.join(root, 'skills');
	fs.mkdirSync(path.join(skillsRoot, 'sample'), {recursive: true});
	fs.writeFileSync(path.join(skillsRoot, 'sample/SKILL.md'), '---\nname: sample\ndescription: test\n---\n');
	fs.mkdirSync(roaming, {recursive: true});
	const cfgPath = path.join(root, 'profiles.json');
	fs.writeFileSync(cfgPath, JSON.stringify({
		schemaVersion: 1,
		skillsRoot,
		profiles: [
			{id: 'A0', userData: 'Antigravity'},
			{id: 'A5', userData: 'Antigravity-A5', email: 'admin5@mage2.pro', chromeShortcut: '5', enabled: false},
			{id: 'A6', userData: 'Antigravity-A6', email: 'admin6@mage2.pro', chromeShortcut: '6'}
		]
	}, null, '\t'));
	const loaded = readProfiles({roaming, filename: cfgPath});
	assert.equal(loaded.find(p => 'A5' === p.id).enabled, false);
	assert.equal(loaded.find(p => 'A6' === p.id).enabled, true);
	const endpoints = await discoverEndpoints({roaming, filename: cfgPath});
	assert.deepEqual(endpoints.map(item => item.id), ['A0', 'A6']);
	await assert.rejects(launch('A5', [], {roaming, profilesFile: cfgPath}), /disabled/i);
	for (const script of ['build-icon.ps1', 'install.ps1']) {
		const source = fs.readFileSync(path.join(__dirname, script), 'utf8');
		assert.match(source, /\$false\s+-(?:ne|eq)\s+\$(?:_|profile)\.enabled/);
	}
});
test('ProfileRepository preserves skillsRoot templates, sorts numerically, and blocks duplicate ids, emails, and shortcuts', context => {
	const root = fixture(context);
	const cfgPath = path.join(root, 'profiles.json');
	fs.writeFileSync(cfgPath, JSON.stringify(baseConfig('${HARNESS_SKILLS_DIR}'), null, '\t') + '\n');
	const repo = new ProfileRepository(cfgPath);
	repo.add({id: 'A10', userData: 'Antigravity-A10', email: 'admin10@mage2.pro', chromeShortcut: '10'});
	const saved = repo.add({id: 'A5', userData: 'Antigravity-A5', email: 'admin5@mage2.pro', chromeShortcut: '5'});
	assert.deepEqual(saved.profiles.map(p => p.id), ['A0', 'A5', 'A6', 'A10']);
	const rawText = fs.readFileSync(cfgPath, 'utf8');
	assert.match(rawText, /"skillsRoot": "\$\{HARNESS_SKILLS_DIR\}"/);
	assert.match(rawText, /^\t"schemaVersion": 1,/m);
	assert.throws(() => repo.add({id: 'A5', userData: 'Antigravity-A5b', email: 'other@mage2.pro', chromeShortcut: '9'}), /already exists/i);
	assert.throws(() => repo.add({id: 'A4', userData: 'Antigravity-A4', email: 'admin5@mage2.pro', chromeShortcut: '4'}), /email/i);
	assert.throws(() => repo.add({id: 'A4', userData: 'Antigravity-A4', email: 'admin4@mage2.pro', chromeShortcut: '5'}), /shortcut/i);
	const updated = repo.upsert({id: 'A5', userData: 'Antigravity-A5', email: 'admin5@mage2.pro', chromeShortcut: '5', label: 'Antigravity A5'});
	assert.equal(updated.profiles.find(p => 'A5' === p.id).label, 'Antigravity A5');
});
test('ProfileProvisioner verifies Chrome shortcut, prepares isolated profile, and enforces 4-step install guard precedence', context => {
	const root = fixture(context);
	const roaming = path.join(root, 'roaming');
	const skillsRoot = path.join(root, 'skills');
	fs.mkdirSync(path.join(skillsRoot, 'demo'), {recursive: true});
	fs.writeFileSync(path.join(skillsRoot, 'demo/SKILL.md'), '---\nname: demo\ndescription: test\n---\n');
	const cfgPath = path.join(root, 'profiles.json');
	fs.writeFileSync(cfgPath, JSON.stringify(baseConfig(skillsRoot), null, '\t') + '\n');
	const repo = new ProfileRepository(cfgPath);
	const guarded = new ProfileProvisioner({
		canonicalProfilesFile: path.join(root, 'canonical-profiles.json'),
		checkoutDir: root,
		isLinkedWorktree: () => true,
		readChrome: () => ({directory: 'Profile 7', userData: 'C:/ChromeU', debugPort: 9222}),
		repository: repo,
		roaming
	});
	assert.throws(() => guarded.add({id: 'A5', email: 'admin5@mage2.pro', chromeShortcut: '5', chromeProfile: 'Profile 7'}), /worktree|non-canonical/i);
	assert.deepEqual(repo.load().profiles.map(p => p.id), ['A0', 'A6']);
	const badChrome = new ProfileProvisioner({
		canonicalProfilesFile: cfgPath,
		checkoutDir: root,
		isLinkedWorktree: () => false,
		readChrome: () => { throw Error('Chrome shortcut profile directory does not match Profile 7'); },
		repository: repo,
		roaming
	});
	assert.throws(() => badChrome.add({id: 'A5', email: 'admin5@mage2.pro', chromeShortcut: '5', chromeProfile: 'Profile 7', skipInstall: true}), /Profile 7/);
	assert.deepEqual(repo.load().profiles.map(p => p.id), ['A0', 'A6']);
	const seenChromeCalls = [];
	const skipped = new ProfileProvisioner({
		canonicalProfilesFile: path.join(root, 'canonical-profiles.json'),
		checkoutDir: root,
		isLinkedWorktree: () => true,
		readChrome: (profile, opts) => {
			seenChromeCalls.push({profile, opts});
			return {directory: 'Profile 7', userData: 'C:/ChromeU', debugPort: 9222};
		},
		repository: repo,
		roaming
	});
	const skipResult = skipped.add({id: 'A5', email: 'admin5@mage2.pro', chromeShortcut: '5', chromeProfile: 'Profile 7', skipInstall: true});
	assert.equal(skipResult.installed, false);
	assert.equal(seenChromeCalls[0].opts.expectedDirectory, 'Profile 7');
	assert.equal(fs.existsSync(path.join(roaming, 'Antigravity-A5/logs')), true);
	assert.equal(fs.existsSync(path.join(roaming, 'Antigravity-A5/home/.gemini/config/skills.json')), true);
	assert.deepEqual(repo.load().profiles.map(p => p.id), ['A0', 'A5', 'A6']);
	const installCalls = [];
	const injected = new ProfileProvisioner({
		canonicalProfilesFile: path.join(root, 'canonical-profiles.json'),
		checkoutDir: root,
		isLinkedWorktree: () => true,
		readChrome: () => ({directory: 'Profile 4', userData: 'C:/ChromeU', debugPort: 9222}),
		repository: repo,
		roaming,
		runInstall: payload => installCalls.push(payload)
	});
	const injectedResult = injected.add({id: 'A4', email: 'admin4@mage2.pro', chromeShortcut: '4', chromeProfile: 'Profile 4'});
	assert.equal(injectedResult.installed, true);
	assert.equal(installCalls.length, 1);
	assert.equal(installCalls[0].profile.id, 'A4');
	assert.deepEqual(repo.load().profiles.map(p => p.id), ['A0', 'A4', 'A5', 'A6']);
});
test('parseArgs and runCli support list, validate, and add subcommands and reject invalid flags', context => {
	const root = fixture(context);
	const roaming = path.join(root, 'roaming');
	const skillsRoot = path.join(root, 'skills');
	fs.mkdirSync(path.join(skillsRoot, 'demo'), {recursive: true});
	fs.writeFileSync(path.join(skillsRoot, 'demo/SKILL.md'), '---\nname: demo\ndescription: test\n---\n');
	const cfgPath = path.join(root, 'profiles.json');
	fs.writeFileSync(cfgPath, JSON.stringify(baseConfig(skillsRoot), null, '\t') + '\n');
	const parsed = parseArgs(['add', '--id', 'A5', '--email=admin5@mage2.pro', '--chrome', '5', '--chrome-profile', 'Profile 7', '--skip-install']);
	assert.deepEqual(parsed, {
		command: 'add',
		id: 'A5',
		email: 'admin5@mage2.pro',
		chromeShortcut: '5',
		chromeProfile: 'Profile 7',
		skipInstall: true
	});
	assert.throws(() => parseArgs(['add', '--bogus']), /Unknown option/);
	const listed = runCli(['list', '--profiles', cfgPath]);
	assert.deepEqual(listed.profiles.map(p => p.id), ['A0', 'A6']);
	const validated = runCli(['validate', '--profiles', cfgPath]);
	assert.equal(validated.valid, true);
	assert.equal(validated.count, 2);
	const added = runCli(
		['add', '--id', 'A5', '--email', 'admin5@mage2.pro', '--chrome', '5', '--chrome-profile', 'Profile 7', '--skip-install', '--profiles', cfgPath, '--roaming', roaming],
		{readChrome: () => ({directory: 'Profile 7', userData: 'C:/ChromeU', debugPort: 9222})}
	);
	assert.equal(added.profile.id, 'A5');
	assert.equal(added.installed, false);
	const cliValidate = cp.spawnSync(process.execPath, [path.join(__dirname, 'profile-manager.js'), 'validate', '--profiles', cfgPath], {encoding: 'utf8', timeout: 10000});
	assert.equal(cliValidate.status, 0, cliValidate.stderr);
	assert.equal(JSON.parse(cliValidate.stdout).count, 3);
});
// 2026-11-28 "Register Antigravity profile A5 with generated badge icons": https://github.com/dmitry-ai/antigravity-addons/issues/78
test('Repository profiles.json registers A5 in numeric order with generated PNG and ICO badge assets', () => {
	const repo = new ProfileRepository(path.join(__dirname, 'profiles.json'));
	const config = repo.validate();
	assert.equal(config.skillsRoot, '${HARNESS_SKILLS_DIR}');
	const ids = config.profiles.map(p => p.id);
	const expectedOrder = [...ids].sort((a, b) => 'A0' === a ? -1 : 'A0' === b ? 1 : Number(a.slice(1)) - Number(b.slice(1)));
	assert.deepEqual(ids, expectedOrder);
	assert.deepEqual(config.profiles.find(p => 'A5' === p.id), {
		id: 'A5',
		userData: 'Antigravity-A5',
		email: 'admin5@mage2.pro',
		chromeShortcut: '5'
	});
	const png = fs.readFileSync(path.join(__dirname, 'A5.png'));
	assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
	const ico = fs.readFileSync(path.join(__dirname, 'A5.ico'));
	assert.deepEqual([...ico.subarray(0, 4)], [0x00, 0x00, 0x01, 0x00]);
});
