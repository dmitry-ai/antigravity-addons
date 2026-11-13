// 2026-10-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Build unified Upgrade tool (Upg), module registry (tool.json), Less stylesheet build pipeline, and verification runner after Antigravity 2.23.0 update":
// https://github.com/dmitry-ai/antigravity-addons/issues/6
// 2026-11-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Decouple Upgrade host from Folders and Multi-Account internals, extract shared CDP/OS primitives, and unify npm test":
// https://github.com/dmitry-ai/antigravity-addons/issues/25
const fs = require('node:fs');
const path = require('node:path');
const less = require('../Upgrade/node_modules/less');
const {writeFileAtomic} = require('../Upgrade/process-io');
const input = path.join(__dirname, 'style.less');
const output = path.join(__dirname, 'style.css');
let queue = Promise.resolve();
const build = ({dryRun = false} = {}) => {
	const pending = async () => {
		const compiled = await less.render(fs.readFileSync(input, 'utf8'), {filename: input, javascriptEnabled: false, math: 'parens-division'});
		const header = '/* 2026-10-11 Dmitrii Fediuk https://github.com/dmitrii-fediuk\n\t"Create CSS customization tool (CSS/style.css) to compact Antigravity 2.0 sidebar project rows and chat layout":\n\thttps://github.com/dmitry-ai/antigravity-addons/issues/2 */\n';
		const css = header + compiled.css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^(?: {2})+/gm, indentation => '\t'.repeat(indentation.length / 2)).split('\n').filter(line => line.trim()).join('\n') + '\n';
		const changed = !fs.existsSync(output) || css !== fs.readFileSync(output, 'utf8');
		if (!dryRun && changed) {
			writeFileAtomic(output, css);
		}
		return {changed, css, inputs: [input, ...compiled.imports], output};
	};
	queue = queue.catch(() => {}).then(pending);
	return queue;
};
if (module === require.main) {
	build().then(({changed}) => console.log(changed ? 'Less → style.css: updated.' : 'Less → style.css: unchanged.')).catch(error => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
module.exports = build;
