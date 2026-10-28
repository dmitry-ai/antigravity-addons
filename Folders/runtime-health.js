const fs = require('node:fs');
const path = require('node:path');
const {CDP} = require('../../Upgrade/code/cdp-client');
const {isCandidateTarget,shellProbe,isShell} = require('../../Upgrade/code/antigravity-shell');
const {discoverEndpoints} = require('../../Upgrade/code/profile-endpoints');
const inspectRuntime = async ({expectedTools = ['css','folders']} = {}) => {
	const profiles = await discoverEndpoints();
	const errors = profiles.filter(profile => profile.error);
	if(errors.length) throw Error(errors.map(profile=>profile.id+': '+profile.error).join('; '));
	const windows=[];
	await Promise.all(profiles.flatMap(profile=>profile.pages.map(page=>({...page,profileId:profile.id}))).map(async page=>{
		const cdp=await CDP.open(page.webSocketDebuggerUrl);
		try {
			if(!isShell(await cdp.evaluate(shellProbe)))return;
			const expression=`(()=>{const tools=window.__ANTIGRAVITY_TOOLS_STATUS__,expected=${JSON.stringify(expectedTools)};if(!tools||expected.some(id=>!tools.tools.includes(id)))return {state:'missing',reason:'Tools runtime is not attached',tools};if(tools.pending.length)return {state:'deferred',reason:tools.pending,tools};return expected.includes('folders')?{...(window.__PROJECT_FOLDERS_VIEW__?.inspect()||{state:'missing',reason:'Folders runtime is not attached'}),tools}:{state:'ready',tools};})()`;
			windows.push({profile:page.profileId,url:page.url,...await cdp.evaluate(expression)});
		}finally{cdp.close();}
	}));
	if(!windows.length)return {state:'unavailable',reason:'No verified Antigravity shell page is open'};
	const failed=windows.filter(window=>window.state!=='ready');
	if(failed.length&&failed.every(window=>window.state==='deferred'&&Array.isArray(window.reason)&&window.reason.every(item=>item.reason==='onboarding'))) return {state:'waiting-for-sign-in',windows};
	if(failed.length)throw Error(`Tools runtime is not healthy: ${failed.map(window=>`${window.url} ${window.state}: ${JSON.stringify(window.errors||window.reason||{})}`).join('; ')}`);
	return {state:'ready',windows};
};
if(require.main===module)inspectRuntime().then(result=>{console.log(JSON.stringify(result,null,2));if(result.state!=='ready')process.exitCode=2;}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={inspectRuntime};
