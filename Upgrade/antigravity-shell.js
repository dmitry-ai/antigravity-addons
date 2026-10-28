const isCandidateTarget = target => {
	if (target.type !== 'page') return false;
	try {const url = new URL(target.url); return url.protocol === 'https:' && ['localhost','127.0.0.1'].includes(url.hostname) && !!url.port;}
	catch {return false;}
};
const shellProbe = '({product:window.__APP_CONFIG__?.productName,csrf:typeof window.__APP_CONFIG__?.csrfToken,ready:document.readyState,origin:location.origin,appRoot:!!document.querySelector("#root"),nativeStorage:typeof window.nativeStorage?.getItems})';
const isShell = info => /antigravity/i.test(info?.product || '') && info.csrf === 'string' && info.ready !== 'loading' && info.appRoot === true && info.nativeStorage === 'function' && /^https:\/\/(localhost|127\.0\.0\.1):\d+$/.test(info.origin);
module.exports = {isCandidateTarget,shellProbe,isShell};
