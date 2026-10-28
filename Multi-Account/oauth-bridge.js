const callbackCode = (targets, pending) => {
	for (const target of targets) {
		if (target.type !== 'page') continue;
		let url; try {url = new URL(target.url);} catch {continue;}
		if (url.origin !== pending.redirect.origin || url.pathname !== pending.redirect.pathname || url.searchParams.get('state') !== pending.state) continue;
		if (url.searchParams.has('error')) return {error: 'Google sign-in was declined'};
		const code = url.searchParams.get('code');
		if (code && code.length < 4096 && !/[\r\n]/.test(code)) return {code};
	}
	return null;
};
const {CDP} = require('../../tools/Upgrade/code/cdp-client');
const refreshInitialPage = async ({id, userDataDir}) => {
	if (id === 'A0' || !/^A\d+$/.test(id || '')) throw Error('Only a managed secondary profile can refresh its initial page');
	// A first login can outlast Chromium's initial navigation. Reload only an
	// empty A6 document, never a loaded app or a draft.
	await new Promise(resolve => setTimeout(resolve, 1500));
	const fs = require('node:fs'), path = require('node:path');
	const port = Number(fs.readFileSync(path.join(userDataDir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]);
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid A6 browser endpoint');
	const base = `http://127.0.0.1:${port}`;
	const version = await (await fetch(base + '/json/version', {signal: AbortSignal.timeout(2000)})).json();
	if (!/Antigravity\//.test(version['User-Agent'] || '')) throw Error('A6 endpoint is not Antigravity');
	const targets = await (await fetch(base + '/json/list', {signal: AbortSignal.timeout(2000)})).json();
	for (const target of targets) {
		if (target.type !== 'page' || !/^https:\/\/(127\.0\.0\.1|localhost):\d+\//.test(target.url)) continue;
		const cdp = await CDP.open(target.webSocketDebuggerUrl);
		try {
			const empty = await cdp.evaluate("document.readyState==='complete'&&!window.__APP_CONFIG__&&!document.body.innerText.trim()&&![...document.querySelectorAll('[contenteditable=true],textarea,input')].some(x=>(x.innerText||x.value||'').trim())");
			if (empty) await cdp.call('Page.reload');
		} finally {cdp.close();}
	}
};
class OAuthBridge {
	constructor({child, chromePort, open, report = () => {}, request = globalThis.fetch, onAuthenticated = () => {}, expectedEmail}) {
		this.child = child; this.chromePort = chromePort; this.open = open; this.report = report; this.request = request; this.onAuthenticated = onAuthenticated; this.expectedEmail = expectedEmail; this.seen = new Set(); this.buffer = '';
		// The graphical Electron parent normally closes stdin. Terminal auth needs
		// this pipe for the one-time code returned by Google's official callback.
		child.stdin.end = () => child.stdin;
		child.stdin.on?.('error', () => {this.pending = null; clearTimeout(this.timer); this.report('The isolated server closed its authentication input');});
		child.stderr.on('data', chunk => this.consume(chunk.toString()));
		child.stdout?.on('data', chunk => this.consume(chunk.toString()));
		child.on('exit', () => this.dispose());
	}
	consume(chunk) {
		if (this.stopped) return;
		this.buffer = (this.buffer + chunk).replace(/\x1b\[[0-9;]*m/g, '').slice(-32768);
		const authenticated = this.buffer.match(/(?:Headless auth: authenticated as "?|(?:^|\n)Authenticated as )([^"\s]+)/);
		if (authenticated && !this.authenticated) {
			this.authenticated = true;
			if (this.expectedEmail && authenticated[1].toLowerCase() !== this.expectedEmail.toLowerCase()) this.report('The signed-in account differs from the configured A6 email');
			else void Promise.resolve(this.onAuthenticated?.(authenticated[1])).catch(() => this.report('The A6 window could not refresh after sign-in'));
		}
		for (const match of this.buffer.matchAll(/https:\/\/accounts\.google\.com\/o\/oauth2\/(?:v2\/)?auth[^\s]+/g)) {
			// Wait for the line ending, so a split stream chunk cannot truncate state/PKCE.
			if (match.index + match[0].length === this.buffer.length) continue;
			let url; try {url = new URL(match[0]);} catch {continue;}
			const state = url.searchParams.get('state');
			if (!state || this.seen.has(state)) continue;
			this.seen.add(state); void this.start(url).catch(() => this.fail('Could not open the configured Chrome sign-in flow'));
		}
	}
	async start(url) {
		const redirect = new URL(url.searchParams.get('redirect_uri'));
		if (redirect.origin !== 'https://antigravity.google' || redirect.pathname !== '/oauth-callback') throw Error('Unknown Google OAuth callback');
		if (this.pending) throw Error('Another sign-in is still pending');
		this.pending = {redirect, state: url.searchParams.get('state'), deadline: Date.now() + 300000};
		await this.open(url.href);
		this.report('Google sign-in opened in the configured Chrome profile');
		void this.poll();
	}
	async poll() {
		if (!this.pending || this.stopped) return;
		if (Date.now() > this.pending.deadline) {this.fail('Google sign-in timed out; retry in A6'); return;}
		try {
			const response = await this.request(`http://127.0.0.1:${this.chromePort}/json/list`, {signal: AbortSignal.timeout(2000)});
			const targets = await response.json();
			if (!Array.isArray(targets)) throw Error('Invalid Chrome CDP target list');
			let result = callbackCode(targets, this.pending);
			// The official callback clears location.search after displaying the code.
			// Navigation Timing retains the original URL, including the exact OAuth state.
			if (!result) for (const target of targets) {
				let url, socket;
				try {url = new URL(target.url); socket = new URL(target.webSocketDebuggerUrl);} catch {continue;}
				if (target.type !== 'page' || url.origin !== this.pending.redirect.origin || url.pathname !== this.pending.redirect.pathname || socket.protocol !== 'ws:' || !['127.0.0.1','localhost'].includes(socket.hostname) || Number(socket.port) !== this.chromePort) continue;
				const cdp = await CDP.open(socket.href);
				try {const original = await cdp.evaluate("performance.getEntriesByType('navigation')[0]?.name"); result = callbackCode([{type:'page',url:original}], this.pending);}
				finally {cdp.close();}
				if (result) break;
			}
			if (result?.error) {this.fail(result.error); return;}
			if (result?.code) {
				this.child.stdin.write(result.code + '\n');
				this.pending = null; this.report('The matching Google OAuth callback was delivered to the isolated server'); return;
			}
		} catch { /* Chrome can still be starting; keep waiting for this exact OAuth state. */ }
		this.timer = setTimeout(() => this.poll(), 300);
	}
	fail(message) {
		this.report(message);
		if (this.pending && !this.child.stdin.destroyed) this.child.stdin.write('\n');
		this.pending = null; clearTimeout(this.timer);
	}
	dispose() {this.stopped = true; this.pending = null; clearTimeout(this.timer); this.buffer = ''; this.seen.clear();}
}
module.exports = {OAuthBridge, callbackCode, refreshInitialPage};
