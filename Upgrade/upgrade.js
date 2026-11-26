// 2026-10-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
const {run} = require('./upgrade-runtime');
// 2026-10-13
// "Build unified Upgrade tool (Upg), module registry (tool.json), Less stylesheet build pipeline, and verification runner after Antigravity 2.23.0 update":
// https://github.com/dmitry-ai/antigravity-addons/issues/6
// 2026-10-28
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
/**
 * @used-by Upgrade/package.json
 * @used-by Upgrade/run-upgrade.ps1
 * @used-by {@link import('./test-registry.js')}
 * @used-by {@link import('./upgrade.js')}
 */
const parseArguments = args => {
	const r = {mode: 'apply'};
	let selected = false;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (!['--check', '--dry-run', '--restore', '--help'].includes(argument)) {
			throw Error(`Unknown argument ${argument}. Upg operates via CDP.`);
		}
		else {
			if (selected) {
				throw Error('Select one mode: --check, --dry-run, or --restore');
			}
			selected = true;
			r.mode = argument.slice(2);
		}
	}
	return r;
};
// 2026-10-13
// "Build unified Upgrade tool (Upg), module registry (tool.json), Less stylesheet build pipeline, and verification runner after Antigravity 2.23.0 update":
// https://github.com/dmitry-ai/antigravity-addons/issues/6
// 2026-10-28
// "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
// https://github.com/dmitry-ai/antigravity-addons/issues/10
if (module === require.main) {
	Promise.resolve().then(() => {
		const options = parseArguments(process.argv.slice(2));
		return 'help' === options.mode ? console.log('node upgrade.js [--check | --dry-run | --restore]\nUpg installs/starts the CDP runtime. --check verifies the live UI; --restore stops Tools. app.asar is not modified.') : run(options).then(result => {
			if ('check' === options.mode && 'ready' !== result.status) {
				process.exitCode = 2;
			}
		});
	}).catch(error => {
		console.error(`Error: ${error.message}`);
		process.exitCode = 1;
	});
}
module.exports = {run, parseArguments};
