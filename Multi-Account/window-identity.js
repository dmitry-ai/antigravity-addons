// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
// 2026-11-10 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Support Electron BaseWindow + WebContentsView in Antigravity 2.30.0 for existing-window activation, taskbar badge identity, [A6] window title prefix, and update-guard focus lookup":
// https://github.com/dmitry-ai/antigravity-addons/issues/22
// 2026-11-10 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Fix main-process TypeError 'Object has been destroyed' on window close by capturing window id before closed event":
// https://github.com/dmitry-ai/antigravity-addons/issues/23
const installWindowIdentity = (require, config) => {
	if ('A0' === config.id || !/^A\d+$/.test(config.id || '')) {
		throw Error('Window identity is only for secondary accounts');
	}
	const fs = require('node:fs');
	const path = require('node:path');
	const {app, BrowserWindow, BaseWindow, shell, nativeImage} = require('electron');
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
	const prefix = '[' + config.id + '] ';
	const launcher = path.join(config.codeRoot, 'launch_' + config.id + '.vbs');
	const relaunchCommand = '"' + path.join(process.env.SystemRoot || 'C:/Windows', 'System32/wscript.exe') + '" "' + launcher + '"';
	globalThis.__ANTIGRAVITY_WINDOW_IDENTITY__?.dispose();
	const applied = new Map();
	const allWindows = () => {
		const seen = new Set();
		const r = [];
		for (const win of [...(BaseWindow?.getAllWindows?.() || []), ...(BrowserWindow?.getAllWindows?.() || [])]) {
			if (win && !seen.has(win) && !win.isDestroyed?.() && !win.__isWebviewPopupWindow) {
				seen.add(win);
				r.push(win);
			}
		}
		return r;
	};
	const apply = win => {
		if (win && !win.isDestroyed?.() && !win.__isWebviewPopupWindow) {
			win.setIcon?.(icon);
			win.setAppDetails?.({appId, appIconPath: iconPath, appIconIndex: 0, relaunchCommand, relaunchDisplayName: 'Antigravity ' + config.id});
			if ('function' === typeof win.setTitle && !win.__antigravityTitlePatched) {
				const originalSetTitle = win.setTitle.bind(win);
				win.__antigravityOriginalSetTitle = originalSetTitle;
				win.__antigravityTitlePatched = true;
				win.setTitle = title => {
					if (win.isDestroyed?.()) {
						return;
					}
					const text = String(title || '');
					return originalSetTitle(text.startsWith(prefix) ? text : prefix + text);
				};
			}
			if ('function' === typeof win.getTitle && 'function' === typeof win.setTitle) {
				const current = win.getTitle();
				if (current && !current.startsWith(prefix)) {
					win.setTitle(current);
				}
			}
			if (win.webContents?.on && !win.__antigravityTitleListener) {
				const onTitleUpdated = (event, title) => {
					if ('string' === typeof title && !title.startsWith(prefix) && !win.isDestroyed?.()) {
						event?.preventDefault?.();
						win.setTitle?.(prefix + title);
					}
				};
				win.__antigravityTitleListener = onTitleUpdated;
				win.webContents.on('page-title-updated', onTitleUpdated);
			}
			const winId = win.id;
			applied.set(winId, {id: winId, iconPath, appId});
			if (!win.__antigravityIdentityClosedHook && 'function' === typeof win.once) {
				win.__antigravityIdentityClosedHook = true;
				win.once('closed', () => applied.delete(winId));
			}
		}
	};
	const syncWindows = () => {
		for (const win of allWindows()) {
			apply(win);
		}
	};
	const created = (_event, win) => {
		apply(win);
		win?.once?.('ready-to-show', () => apply(win));
	};
	const onWebContentsCreated = (_event, contents) => {
		setImmediate(syncWindows);
		contents?.once?.('did-finish-load', syncWindows);
	};
	app.on('browser-window-created', created);
	app.on('web-contents-created', onWebContentsCreated);
	const ready = () => {
		const shortcutPath = path.join(app.getPath('desktop'), config.id + '.lnk');
		if (fs.existsSync(shortcutPath)) {
			if (!shell.writeShortcutLink(shortcutPath, 'update', {icon: iconPath, iconIndex: 0, appUserModelId: appId})) {
				throw Error('The account shortcut could not be updated');
			}
		}
		syncWindows();
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
			app.removeListener('web-contents-created', onWebContentsCreated);
			app.removeListener('ready', ready);
		}
	};
	globalThis.__ANTIGRAVITY_WINDOW_IDENTITY__ = r;
	return r;
};
module.exports = {installWindowIdentity};
