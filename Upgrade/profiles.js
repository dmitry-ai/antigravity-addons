// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Break Upgrade and Multi-Account circular dependency, replace bootstrap.toString() with require, and split update-guard.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/40
const fs = require('node:fs');
const path = require('node:path');
const toolsRoot = path.resolve(__dirname, '..');
const readProfiles = ({roaming = process.env.APPDATA, filename = resolveConfigFile()} = {}) => {
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
const resolveConfigFile = (root = toolsRoot) => {
	const folder = fs.existsSync(root) ? fs.readdirSync(root, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).find(item => item.isDirectory() && fs.existsSync(path.join(root, item.name, 'profiles.json'))) : null;
	return folder ? path.join(root, folder.name, 'profiles.json') : path.join(root, 'profiles.json');
};
module.exports = {readProfiles, resolveConfigFile};
