const {discover} = require('./registry');
const windows = new WeakSet();
module.exports = win => {
	if (win && !win.isDestroyed() && !windows.has(win)) {
		windows.add(win);
		for (const tool of discover()) {
			try {
				const pending = require(tool.entry)(win);
				pending?.catch?.(error => console.error(`[antigravity-tools:${tool.id}]`, error));
			}
			catch (error) {
				console.error(`[antigravity-tools:${tool.id}]`, error);
			}
		}
	}
};
