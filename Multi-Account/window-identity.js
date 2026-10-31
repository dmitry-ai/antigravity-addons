// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
const installWindowIdentity = (require, config) => {
	if ('A0' === config.id || !/^A\d+$/.test(config.id || '')) {
		throw Error('Window identity is only for secondary accounts');
	}
	const fs = require('node:fs');
	const path = require('node:path');
	const {app, BrowserWindow, shell, nativeImage} = require('electron');
	const iconPath = path.join(config.codeRoot, config.id + '.ico');
	const imagePath = path.join(config.codeRoot, config.id + '.png');
	if (!fs.existsSync(iconPath) || !fs.existsSync(imagePath)) {
		throw Error('Build the account icon with build-icon.ps1');
	}
	const icon = nativeImage.createFromPath(imagePath);
	if (icon.isEmpty()) {
		throw Error('The account icon could not be decoded');
	}
	const appId = 'Google.Antigravity.' + config.id;
	const launcher = path.join(config.codeRoot, 'launch_' + config.id + '.vbs');
	const relaunchCommand = '"' + path.join(process.env.SystemRoot || 'C:/Windows', 'System32/wscript.exe') + '" "' + launcher + '"';
	globalThis.__ANTIGRAVITY_WINDOW_IDENTITY__?.dispose();
	const applied = new Map();
	const apply = win => {
		if (!win.isDestroyed()) {
			win.setIcon(icon);
			win.setAppDetails({appId, appIconPath: iconPath, appIconIndex: 0, relaunchCommand, relaunchDisplayName: 'Antigravity ' + config.id});
			applied.set(win.id, {id: win.id, iconPath, appId});
		}
	};
	const created = (_event, win) => {
		apply(win);
		win.once('ready-to-show', () => apply(win));
	};
	app.on('browser-window-created', created);
	const ready = () => {
		const shortcutPath = path.join(app.getPath('desktop'), config.id + '.lnk');
		if (fs.existsSync(shortcutPath)) {
			if (!shell.writeShortcutLink(shortcutPath, 'update', {icon: iconPath, iconIndex: 0, appUserModelId: appId})) {
				throw Error('The account shortcut could not be updated');
			}
		}
		for (const win of BrowserWindow.getAllWindows()) {
			apply(win);
		}
	};
	if (app.isReady()) {
		ready();
	}
	else {
		app.once('ready', ready);
	}
	const r = {
		status: () => ({id: config.id, appId, iconPath, imageSize: icon.getSize(), windows: [...applied.values()]}),
		dispose: () => {
			app.removeListener('browser-window-created', created);
			app.removeListener('ready', ready);
		}
	};
	globalThis.__ANTIGRAVITY_WINDOW_IDENTITY__ = r;
	return r;
};
module.exports = {installWindowIdentity};
