// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
const {inspectRuntime} = require('../Upgrade/runtime-health');
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
module.exports = {inspectRuntime};
