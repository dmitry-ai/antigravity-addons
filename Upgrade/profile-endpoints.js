// 2026-10-12 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Verify native multi-window architecture (Ctrl+Shift+N) for concurrent project workflows under primary account A0":
// https://github.com/dmitry-ai/antigravity-addons/issues/5
// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
const fs = require('node:fs');
const {readProfiles} = require('../Multi-Account/profiles');
const {isCandidateTarget} = require('./antigravity-shell');
const discoverEndpoints = async () => Promise.all(readProfiles().map(async profile => {
	let r = {id: profile.id, email: profile.email, userDataDir: profile.userDataDir, state: 'unavailable', pages: []};
	result: {
		if (!fs.existsSync(profile.portFile)) {
			break result;
		}
		try {
			const port = Number(fs.readFileSync(profile.portFile, 'utf8').split(/\r?\n/)[0]);
			if (!Number.isInteger(port) || 1 > port || 65535 < port) {
				throw Error('Invalid current Antigravity CDP endpoint');
			}
			let version;
			let targets;
			try {
				version = await (await fetch(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(2000)})).json();
				targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(2000)})).json();
			}
			catch {
				break result;
			}
			if (!/Antigravity\//.test(version['User-Agent'] || '')) {
				throw Error('The CDP endpoint is not Antigravity');
			}
			if (!Array.isArray(targets)) {
				throw Error('Invalid CDP target list');
			}
			const localSocket = value => {
				let valid = false;
				try {
					const url = new URL(value);
					valid = 'ws:' === url.protocol && ['127.0.0.1', 'localhost'].includes(url.hostname) && Number(url.port) === port;
				}
				catch {
					valid = false;
				}
				return valid;
			};
			const pages = targets.filter(isCandidateTarget);
			if (pages.some(page => !localSocket(page.webSocketDebuggerUrl))) {
				throw Error('CDP target socket does not belong to this local endpoint');
			}
			r = {
				...r,
				state: 'available',
				endpoint: version.webSocketDebuggerUrl || `port:${port}`,
				appVersion: version['User-Agent'].match(/Antigravity\/([^ ]+)/)?.[1],
				pages
			};
		}
		catch (error) {
			r = {...r, state: 'error', error: error.message};
		}
	}
	return r;
}));
module.exports = {discoverEndpoints};
