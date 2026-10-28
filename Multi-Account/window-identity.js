// Uses the same Windows properties as the Codex launcher through Electron's
// supported APIs. Loaded only inside the managed A6 main process via CDP.
const installWindowIdentity = (require, config) => {
	if (config.id === 'A0' || !/^A\d+$/.test(config.id || '')) throw Error('Window identity is only for secondary accounts');
	const fs = require('node:fs'), path = require('node:path');
	const {app, BrowserWindow, shell, nativeImage} = require('electron');
	const iconPath = path.join(config.codeRoot, config.id + '.ico');
	const imagePath = path.join(config.codeRoot, config.id + '.png');
	if (!fs.existsSync(iconPath) || !fs.existsSync(imagePath)) throw Error('Build the account icon with build-icon.ps1');
	const icon = nativeImage.createFromPath(imagePath);
	if (icon.isEmpty()) throw Error('The account icon could not be decoded');
	const appId = 'Google.Antigravity.' + config.id;
	const launcher = path.join(config.codeRoot, 'launch_' + config.id + '.vbs');
	const relaunchCommand = '"' + path.join(process.env.SystemRoot || 'C:/Windows', 'System32/wscript.exe') + '" "' + launcher + '"';
	globalThis.__ANTIGRAVITY_WINDOW_IDENTITY__?.dispose();
	const applied = new Map();
	const apply = win => {
		if (win.isDestroyed()) return;
		win.setIcon(icon);
		win.setAppDetails({appId, appIconPath: iconPath, appIconIndex: 0, relaunchCommand, relaunchDisplayName: 'Antigravity ' + config.id});
		applied.set(win.id, {id: win.id, iconPath, appId});
	};
	const created = (_event, win) => {apply(win); win.once('ready-to-show', () => apply(win));};
	app.on('browser-window-created', created);
	const ready = () => {
		const shortcutPath = path.join(app.getPath('desktop'), config.id + '.lnk');
		if (fs.existsSync(shortcutPath)) {
			if (!shell.writeShortcutLink(shortcutPath, 'update', {icon: iconPath, iconIndex: 0, appUserModelId: appId})) throw Error('The account shortcut could not be updated');
		}
		for (const win of BrowserWindow.getAllWindows()) apply(win);
	};
	if (app.isReady()) ready(); else app.once('ready', ready);
	const identity = {
		status: () => ({id: config.id, appId, iconPath, imageSize: icon.getSize(), windows: [...applied.values()]}),
		dispose: () => {app.removeListener('browser-window-created', created); app.removeListener('ready', ready);}
	};
	globalThis.__ANTIGRAVITY_WINDOW_IDENTITY__ = identity;
	return identity;
};
module.exports = {installWindowIdentity};
