// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
const {CDP} = require('./cdp-client');
const {shellProbe, isShell} = require('./antigravity-shell');
const {discoverEndpoints} = require('./profile-endpoints');
const registry = require('./registry');
const buildInspectExpression = (expected, checks) => {
	const checkList = `[${checks.map(item => `{id:${JSON.stringify(item.id)},run:()=>(${item.expr})}`).join(',')}]`;
	return `(()=>{let r;const tools=window.__ANTIGRAVITY_TOOLS_STATUS__,expected=${JSON.stringify(expected)},checks=${checkList};if(!tools||expected.some(id=>!tools.tools.includes(id))){r={state:'missing',reason:'Tools runtime is not attached',tools};}else if(tools.pending.length){r={state:'deferred',reason:tools.pending,tools};}else{r={state:'ready',tools};for(const item of checks){const next=item.run()||{state:'missing',reason:item.id+' runtime is not attached'};r={...next,tools};if('ready'!==next.state){break;}}}return r;})()`;
};
const inspectRuntime = async ({expectedTools, toolsRoot} = {}) => {
	let r;
	result: {
		const tools = registry.discover(toolsRoot);
		const expected = expectedTools || tools.map(tool => tool.id);
		const checks = tools
			.filter(tool => expected.includes(tool.id))
			.map(tool => ({id: tool.id, expr: require(tool.cdp).inspectExpression}))
			.filter(item => 'string' === typeof item.expr && item.expr);
		const expression = buildInspectExpression(expected, checks);
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
if (module === require.main) {
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
module.exports = {buildInspectExpression, inspectRuntime};
