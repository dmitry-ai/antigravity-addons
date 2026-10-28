const fs = require('node:fs');
const path = require('node:path');
const inspectRuntime = async ({expectedTools = ['css', 'folders']} = {}) => {
	const filename = path.join(process.env.APPDATA || '', 'Antigravity/DevToolsActivePort');
	if (!fs.existsSync(filename)) return {state: 'unavailable', reason: 'CDP endpoint file is absent'};
	const port = Number(fs.readFileSync(filename, 'utf8').split(/\r?\n/)[0]);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) throw Error('Invalid current Antigravity CDP port');
	let version, targets;
	try {
		version = await (await fetch(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(2000)})).json();
		targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(2000)})).json();
	} catch (error) { return {state: 'unavailable', reason: error.message}; }
	if (!/Antigravity\//.test(version['User-Agent'] || '')) throw Error('The current CDP endpoint is not Antigravity');
	const pages = targets.filter(target => target.type === 'page' && /^https:\/\/(127\.0\.0\.1|localhost):\d+\/(?:[?#].*)?$/.test(target.url));
	if (!pages.length) return {state: 'unavailable', reason: 'No Antigravity shell page is open'};
	const windows = [];
	for (const page of pages) {
		const socket = new WebSocket(page.webSocketDebuggerUrl);
		try {
			await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(Error('CDP connection timeout')), 3000); socket.addEventListener('open', () => {clearTimeout(timeout); resolve();}, {once: true}); socket.addEventListener('error', () => {clearTimeout(timeout); reject(Error('CDP connection failed'));}, {once: true}); });
			const status = await new Promise((resolve, reject) => {
				const timeout = setTimeout(() => reject(Error('CDP health check timeout')), 5000);
				socket.addEventListener('message', event => { const result = JSON.parse(event.data); if (result.id !== 1) return; clearTimeout(timeout); if (result.error || result.result?.exceptionDetails) reject(Error('CDP health check failed')); else resolve(result.result?.result?.value); });
				const expression = `(() => {const tools=window.__ANTIGRAVITY_TOOLS_STATUS__,expected=${JSON.stringify(expectedTools)};if(!tools||expected.some(id=>!tools.tools.includes(id)))return {state:'missing',reason:'Tools runtime is not attached',tools};if(tools.pending.length)return {state:'deferred',reason:tools.pending,tools};return expected.includes('folders')?{...(window.__PROJECT_FOLDERS_VIEW__?.inspect()||{state:'missing',reason:'Folders runtime is not attached'}),tools}:{state:'ready',tools};})()`;
				socket.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {expression, returnByValue: true}}));
			});
			windows.push({url: page.url, ...status});
		} finally { socket.close(); }
	}
	const failed = windows.filter(win => win.state !== 'ready');
	if (failed.length) throw Error(`Tools runtime is not healthy: ${failed.map(win => `${win.state}: ${JSON.stringify(win.errors || win.reason || {})}`).join('; ')}`);
	return {state: 'ready', windows};
};
if (require.main === module) inspectRuntime().then(result => { console.log(JSON.stringify(result, null, 2)); if (result.state !== 'ready') process.exitCode = 2; }).catch(error => {console.error(error.message); process.exitCode = 1;});
module.exports = {inspectRuntime};
