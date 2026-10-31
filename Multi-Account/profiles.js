// 2026-10-11 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Prototype multi-account Antigravity instances A1 and A2 with Windows user isolation, composite profile badge icons, and Chrome OAuth routing":
// https://github.com/dmitry-ai/antigravity-addons/issues/1
// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
const fs = require('node:fs');
const path = require('node:path');
const configFile = path.join(__dirname, 'profiles.json');
const readProfiles = ({roaming = process.env.APPDATA, filename = configFile} = {}) => {
	if (!roaming) {
		throw Error('APPDATA is required');
	}
	const config = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
	if (1 !== config.schemaVersion || !Array.isArray(config.profiles) || !path.isAbsolute(config.skillsRoot)) {
		throw Error('Invalid Multi-Account configuration');
	}
	const ids = new Set();
	const directories = new Set();
	const r = config.profiles.map(profile => {
		if (!/^A\d+$/.test(profile.id) || ids.has(profile.id) || !/^[a-z0-9-]+$/i.test(profile.userData) || directories.has(profile.userData.toLowerCase())) {
			throw Error('Invalid or duplicate Antigravity profile');
		}
		ids.add(profile.id);
		directories.add(profile.userData.toLowerCase());
		if ('A0' !== profile.id && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email || '') || !/^\d+$/.test(profile.chromeShortcut || ''))) {
			throw Error('Managed profiles require email and Chrome shortcut');
		}
		const userDataDir = path.join(roaming, profile.userData);
		return {
			...profile,
			userDataDir,
			homeDir: path.join(userDataDir, 'home'),
			portFile: path.join(userDataDir, 'DevToolsActivePort'),
			skillsRoot: config.skillsRoot
		};
	});
	if (!ids.has('A0')) {
		throw Error('The existing A0 profile must remain registered');
	}
	return r;
};
module.exports = {readProfiles, configFile};
