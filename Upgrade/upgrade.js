const path = require('node:path');
const runtime = require('./upgrade-runtime');
const run = options => options?.archivePath ? require('./legacy-asar').run(options) : runtime.run(options);
const parseArguments = args => {
    const options = {mode: 'apply'}; let selected = false;
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (['--check', '--dry-run', '--restore', '--help'].includes(argument)) {
            if (selected) throw Error('Выберите один режим: --check, --dry-run или --restore');
            selected = true; options.mode = argument.slice(2);
        } else if (argument === '--bundle' && args[index + 1] && !args[index + 1].startsWith('--')) options.bundlePath = path.resolve(args[++index]);
        else throw Error(`Неизвестный аргумент ${argument}. Upg работает через CDP; для старой резервной копии используйте legacy-asar.js --help.`);
    }
    return options;
};
if (require.main === module) {
    Promise.resolve().then(() => {
        const options = parseArguments(process.argv.slice(2));
        if (options.mode === 'help') return console.log('node upgrade.js [--check | --dry-run | --restore] [--bundle PATH]\nUpg installs/starts the CDP runtime. --check verifies the live UI; --restore stops Tools. app.asar is not modified.');
        return run(options).then(result => { if (options.mode === 'check' && result.status !== 'ready') process.exitCode = 2; });
    }).catch(error => {console.error(`Ошибка: ${error.message}`); process.exitCode = 1;});
}
module.exports = {run, parseArguments};
// Compatibility entry points for the isolated legacy recovery tests. Normal
// startup does not load the old archive writer or parser.
for (const name of ['assertCompatibleExecutable', 'assertStopped', 'findArchive', 'isNodeProcess']) module.exports[name] = (...args) => require('./legacy-asar')[name](...args);
