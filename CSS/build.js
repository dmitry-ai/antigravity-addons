const fs = require('node:fs');
const path = require('node:path');
const less = require('../Upgrade/node_modules/less');
const input = path.join(__dirname, 'style.less');
const output = path.join(__dirname, 'style.css');
let queue = Promise.resolve();
const build = ({dryRun = false} = {}) => {
	const pending = async () => {
		const compiled = await less.render(fs.readFileSync(input, 'utf8'), {filename: input, javascriptEnabled: false, math: 'parens-division'});
		const css = compiled.css.replace(/^(?: {2})+/gm, indentation => '\t'.repeat(indentation.length / 2)).split('\n').filter(line => line.trim()).join('\n') + '\n';
		const changed = !fs.existsSync(output) || css !== fs.readFileSync(output, 'utf8');
		if (!dryRun && changed) {
			const temporary = `${output}.${process.pid}.tmp`;
			try {
				fs.writeFileSync(temporary, css, 'utf8');
				fs.renameSync(temporary, output);
			}
			finally {
				fs.rmSync(temporary, {force: true});
			}
		}
		return {changed, css, inputs: [input, ...compiled.imports], output};
	};
	queue = queue.catch(() => {}).then(pending);
	return queue;
};
if (require.main === module) {
	build().then(({changed}) => console.log(changed ? 'Less → style.css: обновлено.' : 'Less → style.css: без изменений.')).catch(error => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
module.exports = build;
