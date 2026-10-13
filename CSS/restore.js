const {run: upgrade} = require('../../Upgrade/code/upgrade');
const run = () => {
	return upgrade({mode: 'restore'}).catch(error => {
		console.error(error.message);
		process.exitCode = 1;
	});
};
if (require.main === module) {
	run();
}
module.exports = run;
