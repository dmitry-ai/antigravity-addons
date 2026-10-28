let migrated = false;
const activate = () => {
	if (!migrated && process.versions.electron) {
		const {BrowserWindow} = require('electron');
		migrated = true;
		const install = () => {
			const windows = BrowserWindow.getAllWindows().filter(win => /^https:\/\/(127\.0\.0\.1|localhost):\d+\//.test(win.webContents.getURL()));
			if (windows.some(win => win.webContents.isLoading())) { setTimeout(install, 250).unref(); return; }
			delete require.cache[require.resolve('./folders-manager')];
			delete require.cache[require.resolve('./folders-bootstrap')];
			const attach = require('./folders-host');
			for (const win of windows) attach(win);
		};
		// Never unregister a protocol callback while its own main.js response is in flight.
		setTimeout(install, 500).unref();
	}
};
// Compatibility entry point for the protocol callback already loaded in an old main process.
// The vendor bundle is returned byte for byte; new processes inject our renderer separately.
const applyFolderPatch = source => { activate(); return source; };
module.exports = {applyFolderPatch};
