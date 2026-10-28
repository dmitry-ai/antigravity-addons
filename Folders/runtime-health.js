const fs = require('node:fs');
const path = require('node:path');
const {CDP} = require('../../Upgrade/code/cdp-client');
const {isCandidateTarget,shellProbe,isShell} = require('../../Upgrade/code/antigravity-shell');
const inspectRuntime = async ({expectedTools = ['css','folders']} = {}) => {
	const filename = path.join(process.env.APPDATA || '', 'Antigravity/DevToolsActivePort');
	if (!fs.existsSync(filename)) return {state:'unavailable',reason:'CDP endpoint file is absent'};
	const port = Number(fs.readFileSync(filename,'utf8').split(/\r?\n/)[0]);
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid current Antigravity CDP port');
	let version,targets;
	try {version=await(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(2000)})).json();targets=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2000)})).json();}
	catch(error){return {state:'unavailable',reason:error.message};}
	if (!/Antigravity\//.test(version['User-Agent']||'')) throw Error('The current CDP endpoint is not Antigravity');
	const windows=[];
	await Promise.all(targets.filter(isCandidateTarget).map(async page=>{
		const cdp=await CDP.open(page.webSocketDebuggerUrl);
		try {
			if(!isShell(await cdp.evaluate(shellProbe)))return;
			const expression=`(()=>{const tools=window.__ANTIGRAVITY_TOOLS_STATUS__,expected=${JSON.stringify(expectedTools)};if(!tools||expected.some(id=>!tools.tools.includes(id)))return {state:'missing',reason:'Tools runtime is not attached',tools};if(tools.pending.length)return {state:'deferred',reason:tools.pending,tools};return expected.includes('folders')?{...(window.__PROJECT_FOLDERS_VIEW__?.inspect()||{state:'missing',reason:'Folders runtime is not attached'}),tools}:{state:'ready',tools};})()`;
			windows.push({url:page.url,...await cdp.evaluate(expression)});
		}finally{cdp.close();}
	}));
	if(!windows.length)return {state:'unavailable',reason:'No verified Antigravity shell page is open'};
	const failed=windows.filter(window=>window.state!=='ready');
	if(failed.length)throw Error(`Tools runtime is not healthy: ${failed.map(window=>`${window.url} ${window.state}: ${JSON.stringify(window.errors||window.reason||{})}`).join('; ')}`);
	return {state:'ready',windows};
};
if(require.main===module)inspectRuntime().then(result=>{console.log(JSON.stringify(result,null,2));if(result.state!=='ready')process.exitCode=2;}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={inspectRuntime};
