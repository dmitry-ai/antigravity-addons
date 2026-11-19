// 2026-11-19 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Fail closed when active Antigravity profiles lack a reachable inspector endpoint":
// https://github.com/dmitry-ai/antigravity-addons/issues/53
// 2026-11-19 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Bridge Upgrade and OAuth renderer attach through main-process WebContents debugger":
// https://github.com/dmitry-ai/antigravity-addons/issues/52
// 2026-10-12 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Verify native multi-window architecture (Ctrl+Shift+N) for concurrent project workflows under primary account A0":
// https://github.com/dmitry-ai/antigravity-addons/issues/5
// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Break Upgrade and Multi-Account circular dependency, replace bootstrap.toString() with require, and split update-guard.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/40
const fs = require('node:fs');
const path = require('node:path');
const {CDP} = require('./cdp-client');
const {isCandidateTarget} = require('./antigravity-shell');
const {BRIDGE_GLOBAL, ensureRemoteBridge} = require('./main-debugger-bridge');
const {isLockfileHeld, isPidAlive, readJsonSafe} = require('./process-io');
const {readProfiles} = require('./profiles');
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
const probeProfileEndpoint = async (profile, {candidateFilter = isCandidateTarget, fetch: request = globalThis.fetch, fs: fileSystem = fs, isLockfileHeld: checkLockfile = isLockfileHeld, isPidAlive: checkPid = isPidAlive, openInspector = url => CDP.open(url)} = {}) => {
	const portFile = profile.portFile || path.join(profile.userDataDir, 'DevToolsActivePort');
	const mainRuntimeFile = path.join(profile.userDataDir, 'main-runtime.json');
	let r = {id: profile.id, email: profile.email, userDataDir: profile.userDataDir, state: 'unavailable', pages: []};
	let mainError = null;
	let runtimePidAlive = false;
	result: {
		const defaultPortFile = path.join(profile.userDataDir, 'DevToolsActivePort');
		const isDefaultPortFile = !profile.portFile || path.resolve(profile.portFile).toLowerCase() === path.resolve(defaultPortFile).toLowerCase();
		const mainRecord = isDefaultPortFile && fileSystem.existsSync(mainRuntimeFile) ? readJsonSafe(mainRuntimeFile, fileSystem) : null;
		runtimePidAlive = Boolean(mainRecord?.pid && checkPid(mainRecord.pid));
		const validMainRecord = Boolean(
			runtimePidAlive
			&& mainRecord.id === profile.id
			&& path.resolve(String(mainRecord.userDataDir || '')).toLowerCase() === path.resolve(profile.userDataDir).toLowerCase()
			&& /^ws:\/\/(127\.0\.0\.1|localhost):\d+\/[\da-f-]+$/i.test(mainRecord.inspector || '')
		);
		if (validMainRecord) {
			let inspector;
			try {
				inspector = await openInspector(mainRecord.inspector);
				await ensureRemoteBridge(inspector);
				const discovered = await inspector.evaluate(`globalThis[${JSON.stringify(BRIDGE_GLOBAL)}].discover()`);
				if (discovered?.pid !== mainRecord.pid || (discovered.accountId && discovered.accountId !== profile.id)) {
					throw Error('Main inspector belongs to another Antigravity instance');
				}
				const rawTargets = Array.isArray(discovered.targets) ? discovered.targets : [];
				const pages = rawTargets.filter(candidateFilter).map(target => ({
					...target,
					mainInspectorUrl: mainRecord.inspector,
					webContentsId: target.id
				}));
				r = {
					...r,
					state: 'available',
					transport: 'main-debugger',
					endpoint: mainRecord.inspector,
					appVersion: discovered.appVersion || undefined,
					pages
				};
				break result;
			}
			catch (error) {
				mainError = error.message;
			}
			finally {
				inspector?.close?.();
			}
		}
		if (!fileSystem.existsSync(portFile)) {
			if (mainError) {
				r = {...r, state: 'error', error: mainError};
			}
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
	if ('unavailable' === r.state && (runtimePidAlive || checkLockfile(profile.userDataDir, fileSystem))) {
		r = {
			...r,
			state: 'error',
			error: mainError || `Active Antigravity profile ${profile.id} has no reachable inspector or CDP endpoint`
		};
	}
	return r;
};
module.exports = {discoverEndpoints, isLocalEndpointSocket, probeProfileEndpoint};
