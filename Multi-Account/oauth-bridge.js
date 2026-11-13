// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
const callbackCode = (targets, pending) => {
	let r = null;
	result: {
		for (const target of targets) {
			if ('page' !== target.type) {
				continue;
			}
			let url;
			try {
				url = new URL(target.url);
			}
			catch {
				continue;
			}
			if (url.origin !== pending.redirect.origin || url.pathname !== pending.redirect.pathname || url.searchParams.get('state') !== pending.state) {
				continue;
			}
			if (url.searchParams.has('error')) {
				r = {error: 'Google sign-in was declined'};
				break result;
			}
			const code = url.searchParams.get('code');
			if (code && 4096 > code.length && !/[\r\n]/.test(code)) {
				r = {code};
				break result;
			}
		}
	}
	return r;
};
const {CDP} = require('../Upgrade/cdp-client');
const {probeProfileEndpoint} = require('../Upgrade/profile-endpoints');
const refreshInitialPage = async ({id, userDataDir}) => {
	if ('A0' === id || !/^A\d+$/.test(id || '')) {
		throw Error('Only a managed secondary profile can refresh its initial page');
	}
	await new Promise(resolve => setTimeout(resolve, 1500));
	const endpoint = await probeProfileEndpoint({id, userDataDir});
	if ('available' !== endpoint.state) {
		throw Error(endpoint.error || 'Invalid A6 browser endpoint');
	}
	for (const target of endpoint.pages) {
		const cdp = await CDP.open(target.webSocketDebuggerUrl);
		try {
			const empty = await cdp.evaluate("document.readyState==='complete'&&!window.__APP_CONFIG__&&!document.body.innerText.trim()&&![...document.querySelectorAll('[contenteditable=true],textarea,input')].some(x=>(x.innerText||x.value||'').trim())");
			if (empty) {
				await cdp.call('Page.reload');
			}
		}
		finally {
			cdp.close();
		}
	}
};
class OAuthBridge {
	constructor({child, chromePort, open, report = () => {}, request = globalThis.fetch, onAuthenticated = () => {}, expectedEmail}) {
		this.child = child;
		this.chromePort = chromePort;
		this.open = open;
		this.report = report;
		this.request = request;
		this.onAuthenticated = onAuthenticated;
		this.expectedEmail = expectedEmail;
		this.seen = new Set();
		this.buffer = '';
		child.stdin.end = () => child.stdin;
		child.stdin.on?.('error', () => {
			this.pending = null;
			clearTimeout(this.timer);
			this.report('The isolated server closed its authentication input');
		});
		child.stderr.on('data', chunk => this.consume(chunk.toString()));
		child.stdout?.on('data', chunk => this.consume(chunk.toString()));
		child.on('exit', () => this.dispose());
	}
	consume(chunk) {
		if (!this.stopped) {
			this.buffer = (this.buffer + chunk).replace(/\x1b\[[0-9;]*m/g, '').slice(-32768);
			const authenticated = this.buffer.match(/(?:Headless auth: authenticated as "?|(?:^|\n)Authenticated as )([^"\s]+)/);
			if (authenticated && !this.authenticated) {
				this.authenticated = true;
				if (this.expectedEmail && authenticated[1].toLowerCase() !== this.expectedEmail.toLowerCase()) {
					this.report('The signed-in account differs from the configured A6 email');
				}
				else {
					void Promise.resolve(this.onAuthenticated?.(authenticated[1])).catch(() => this.report('The A6 window could not refresh after sign-in'));
				}
			}
			for (const match of this.buffer.matchAll(/https:\/\/accounts\.google\.com\/o\/oauth2\/(?:v2\/)?auth[^\s]+/g)) {
				if (match.index + match[0].length === this.buffer.length) {
					continue;
				}
				let url;
				try {
					url = new URL(match[0]);
				}
				catch {
					continue;
				}
				const state = url.searchParams.get('state');
				if (!state || this.seen.has(state)) {
					continue;
				}
				this.seen.add(state);
				void this.start(url).catch(() => this.fail('Could not open the configured Chrome sign-in flow'));
			}
		}
	}
	async start(url) {
		const redirect = new URL(url.searchParams.get('redirect_uri'));
		if ('https://antigravity.google' !== redirect.origin || '/oauth-callback' !== redirect.pathname) {
			throw Error('Unknown Google OAuth callback');
		}
		if (this.pending) {
			throw Error('Another sign-in is still pending');
		}
		this.pending = {redirect, state: url.searchParams.get('state'), deadline: Date.now() + 300000};
		await this.open(url.href);
		this.report('Google sign-in opened in the configured Chrome profile');
		void this.poll();
	}
	async poll() {
		result: {
			if (!this.pending || this.stopped) {
				break result;
			}
			if (Date.now() > this.pending.deadline) {
				this.fail('Google sign-in timed out; retry in A6');
				break result;
			}
			try {
				const response = await this.request(`http://127.0.0.1:${this.chromePort}/json/list`, {signal: AbortSignal.timeout(2000)});
				const targets = await response.json();
				if (!Array.isArray(targets)) {
					throw Error('Invalid Chrome CDP target list');
				}
				let found = callbackCode(targets, this.pending);
				if (!found) {
					for (const target of targets) {
						let url;
						let socket;
						try {
							url = new URL(target.url);
							socket = new URL(target.webSocketDebuggerUrl);
						}
						catch {
							continue;
						}
						if ('page' !== target.type || url.origin !== this.pending.redirect.origin || url.pathname !== this.pending.redirect.pathname || 'ws:' !== socket.protocol || !['127.0.0.1', 'localhost'].includes(socket.hostname) || Number(socket.port) !== this.chromePort) {
							continue;
						}
						const cdp = await CDP.open(socket.href);
						try {
							const original = await cdp.evaluate("performance.getEntriesByType('navigation')[0]?.name");
							found = callbackCode([{type: 'page', url: original}], this.pending);
						}
						finally {
							cdp.close();
						}
						if (found) {
							break;
						}
					}
				}
				if (found?.error) {
					this.fail(found.error);
					break result;
				}
				if (found?.code) {
					this.child.stdin.write(found.code + '\n');
					this.pending = null;
					this.report('The matching Google OAuth callback was delivered to the isolated server');
					break result;
				}
			}
			catch {}
			this.timer = setTimeout(() => this.poll(), 300);
		}
	}
	fail(message) {
		this.report(message);
		if (this.pending && !this.child.stdin.destroyed) {
			this.child.stdin.write('\n');
		}
		this.pending = null;
		clearTimeout(this.timer);
	}
	dispose() {
		this.stopped = true;
		this.pending = null;
		clearTimeout(this.timer);
		this.buffer = '';
		this.seen.clear();
	}
}
module.exports = {OAuthBridge, callbackCode, refreshInitialPage};
