// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
const {CDP} = require('../Upgrade/cdp-client');
const {shellProbe, isShell} = require('../Upgrade/antigravity-shell');
const {discoverEndpoints} = require('../Upgrade/profile-endpoints');
const inspectRuntime = async ({expectedTools = ['css', 'folders']} = {}) => {
	let r;
	result: {
		const profiles = await discoverEndpoints();
		const errors = profiles.filter(profile => profile.error);
		if (errors.length) {
			throw Error(errors.map(profile => profile.id + ': ' + profile.error).join('; '));
		}
		const windows = [];
		await Promise.all(
			profiles
				.flatMap(profile => profile.pages.map(page => ({...page, profileId: profile.id})))
				.map(async page => {
					const cdp = await CDP.open(page.webSocketDebuggerUrl);
					try {
						if (isShell(await cdp.evaluate(shellProbe))) {
							const expression = `(()=>{const tools=window.__ANTIGRAVITY_TOOLS_STATUS__,expected=${JSON.stringify(expectedTools)};return !tools||expected.some(id=>!tools.tools.includes(id))?{state:'missing',reason:'Tools runtime is not attached',tools}:tools.pending.length?{state:'deferred',reason:tools.pending,tools}:expected.includes('folders')?{...(window.__PROJECT_FOLDERS_VIEW__?.inspect()||{state:'missing',reason:'Folders runtime is not attached'}),tools}:{state:'ready',tools};})()`;
							windows.push({profile: page.profileId, url: page.url, ...await cdp.evaluate(expression)});
						}
					}
					finally {
						cdp.close();
					}
				})
		);
		if (!windows.length) {
			r = {state: 'unavailable', reason: 'No verified Antigravity shell page is open'};
			break result;
		}
		const failed = windows.filter(window => 'ready' !== window.state);
		if (failed.length && failed.every(window => 'deferred' === window.state && Array.isArray(window.reason) && window.reason.every(item => 'onboarding' === item.reason))) {
			r = {state: 'waiting-for-sign-in', windows};
			break result;
		}
		if (failed.length) {
			throw Error(`Tools runtime is not healthy: ${failed.map(window => `${window.url} ${window.state}: ${JSON.stringify(window.errors || window.reason || {})}`).join('; ')}`);
		}
		r = {state: 'ready', windows};
	}
	return r;
};
if (require.main === module) {
	inspectRuntime()
		.then(result => {
			console.log(JSON.stringify(result, null, 2));
			if ('ready' !== result.state) {
				process.exitCode = 2;
			}
		})
		.catch(error => {
			console.error(error.message);
			process.exitCode = 1;
		});
}
module.exports = {inspectRuntime};
