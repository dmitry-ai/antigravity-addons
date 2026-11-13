// 2026-10-12 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Verify native multi-window architecture (Ctrl+Shift+N) for concurrent project workflows under primary account A0":
// https://github.com/dmitry-ai/antigravity-addons/issues/5
// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
const fs = require('node:fs');
const path = require('node:path');
const {readProfiles} = require('../Multi-Account/profiles');
const {isCandidateTarget} = require('./antigravity-shell');
const discoverEndpoints = async () => Promise.all(readProfiles().map(profile => probeProfileEndpoint(profile)));
const isLocalEndpointSocket = (value, port) => {
	let r = false;
	try {
		const url = new URL(value);
		r = 'ws:' === url.protocol && ['127.0.0.1', 'localhost'].includes(url.hostname) && Number(url.port) === port;
	}
	catch {
		r = false;
	}
	return r;
};
const probeProfileEndpoint = async (profile, {candidateFilter = isCandidateTarget, fetch: request = globalThis.fetch, fs: fileSystem = fs} = {}) => {
	const portFile = profile.portFile || path.join(profile.userDataDir, 'DevToolsActivePort');
	let r = {id: profile.id, email: profile.email, userDataDir: profile.userDataDir, state: 'unavailable', pages: []};
	result: {
		if (!fileSystem.existsSync(portFile)) {
			break result;
		}
		try {
			const port = Number(fileSystem.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
			if (!Number.isInteger(port) || 1 > port || 65535 < port) {
				throw Error('Invalid current Antigravity CDP endpoint');
			}
			let version;
			let targets;
			try {
				version = await (await request(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(2000)})).json();
				targets = await (await request(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(2000)})).json();
			}
			catch {
				break result;
			}
			if (!/Antigravity\//.test(version?.['User-Agent'] || '')) {
				throw Error('The CDP endpoint is not Antigravity');
			}
			if (!Array.isArray(targets)) {
				throw Error('Invalid CDP target list');
			}
			const pages = targets.filter(candidateFilter);
			if (pages.some(page => !isLocalEndpointSocket(page.webSocketDebuggerUrl, port))) {
				throw Error('CDP target socket does not belong to this local endpoint');
			}
			r = {
				...r,
				port,
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
};
module.exports = {discoverEndpoints, isLocalEndpointSocket, probeProfileEndpoint};
