// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
const isCandidateTarget = target => {
	let r = false;
	if ('page' === target.type) {
		try {
			const url = new URL(target.url);
			r = 'https:' === url.protocol && ['localhost', '127.0.0.1'].includes(url.hostname) && Boolean(url.port);
		}
		catch {
			r = false;
		}
	}
	return r;
};
// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Diagnose language_server.exe PreToolHook blocks on broad localStorage scans, codify authenticated browser access (EXEC-3/EXEC-6), and isolate security-policy journal entries":
// https://github.com/dmitry-ai/antigravity-addons/issues/11
const shellProbe = '({product:window.__APP_CONFIG__?.productName,csrf:typeof window.__APP_CONFIG__?.csrfToken,ready:document.readyState,origin:location.origin,appRoot:!!document.querySelector("#root"),nativeStorage:typeof window.nativeStorage?.getItems})';
const isShell = info => /antigravity/i.test(info?.product || '') && 'string' === info.csrf && 'loading' !== info.ready && true === info.appRoot && 'function' === info.nativeStorage && /^https:\/\/(localhost|127\.0\.0\.1):\d+$/.test(info.origin);
module.exports = {isCandidateTarget, shellProbe, isShell};
