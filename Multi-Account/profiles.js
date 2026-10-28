const fs = require('node:fs');
const path = require('node:path');
const configFile = path.join(__dirname, 'profiles.json');
const readProfiles = ({roaming = process.env.APPDATA, filename = configFile} = {}) => {
	if (!roaming) throw Error('APPDATA is required');
	const config = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
	if (config.schemaVersion !== 1 || !Array.isArray(config.profiles) || !path.isAbsolute(config.skillsRoot)) throw Error('Invalid Multi-Account configuration');
	const ids = new Set(), directories = new Set();
	const profiles = config.profiles.map(profile => {
		if (!/^A\d+$/.test(profile.id) || ids.has(profile.id) || !/^[a-z0-9-]+$/i.test(profile.userData) || directories.has(profile.userData.toLowerCase())) throw Error('Invalid or duplicate Antigravity profile');
		ids.add(profile.id); directories.add(profile.userData.toLowerCase());
		if (profile.id !== 'A0' && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email || '') || !/^\d+$/.test(profile.chromeShortcut || ''))) throw Error('Managed profiles require email and Chrome shortcut');
		const userDataDir = path.join(roaming, profile.userData);
		return {...profile, userDataDir, homeDir: path.join(userDataDir, 'home'), portFile: path.join(userDataDir, 'DevToolsActivePort'), skillsRoot: config.skillsRoot};
	});
	if (!ids.has('A0')) throw Error('The existing A0 profile must remain registered');
	return profiles;
};
module.exports = {readProfiles, configFile};
