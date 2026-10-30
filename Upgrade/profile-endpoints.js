const fs = require('node:fs');
const {readProfiles} = require('../Multi-Account/profiles');
const {isCandidateTarget} = require('./antigravity-shell');
const discoverEndpoints = async () => Promise.all(readProfiles().map(async profile => {
	const result = {id: profile.id, email: profile.email, userDataDir: profile.userDataDir, state: 'unavailable', pages: []};
	if (!fs.existsSync(profile.portFile)) return result;
	try {
		const port = Number(fs.readFileSync(profile.portFile, 'utf8').split(/\r?\n/)[0]);
		if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid current Antigravity CDP endpoint');
		let version, targets;
		try {
			version = await (await fetch(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(2000)})).json();
			targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(2000)})).json();
		} catch {return result;}
		if (!/Antigravity\//.test(version['User-Agent'] || '')) throw Error('The CDP endpoint is not Antigravity');
		if (!Array.isArray(targets)) throw Error('Invalid CDP target list');
		const localSocket = value => {try {const url = new URL(value); return url.protocol === 'ws:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && Number(url.port) === port;} catch {return false;}};
		const pages = targets.filter(isCandidateTarget);
		if (pages.some(page => !localSocket(page.webSocketDebuggerUrl))) throw Error('CDP target socket does not belong to this local endpoint');
		return {...result, state: 'available', endpoint: version.webSocketDebuggerUrl || `port:${port}`, appVersion: version['User-Agent'].match(/Antigravity\/([^ ]+)/)?.[1], pages};
	} catch (error) {return {...result, state: 'error', error: error.message};}
}));
module.exports = {discoverEndpoints};
