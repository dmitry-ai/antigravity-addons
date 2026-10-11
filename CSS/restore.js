const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const asarPath = 'C:/Users/dfedi/AppData/Local/Programs/antigravity/resources/app.asar';
const backupPath = `${asarPath}.original`;
const bootstrapPath = path.join(__dirname, 'bootstrap.js').replace(/\\/g, '/');
const assertPatched = () => {
	const utils = readUtils(asarPath);
	if (false === utils.includes(bootstrapPath) && false === utils.includes('bootstrap.js')) {
		throw new Error('app.asar is not patched (probably replaced by an update): nothing to restore, backup left untouched.');
	}
};
const assertStopped = () => {
	const out = childProcess.execSync('tasklist /FI "IMAGENAME eq Antigravity.exe" /NH').toString();
	if (true === out.includes('Antigravity.exe')) {
		throw new Error('Antigravity is running: quit it completely (tray included, all Windows users) and rerun.');
	}
};
const readUtils = p => {
	const fd = fs.openSync(p, 'r');
	const b = Buffer.alloc(16);
	fs.readSync(fd, b, 0, 16, 0);
	const h = Buffer.alloc(b.readUInt32LE(12));
	fs.readSync(fd, h, 0, h.length, 16);
	const f = JSON.parse(h.toString('utf8')).files.dist.files['utils.js'];
	const c = Buffer.alloc(f.size);
	fs.readSync(fd, c, 0, f.size, 8 + b.readUInt32LE(4) + Number(f.offset));
	fs.closeSync(fd);
	return c.toString('utf8');
};
const restore = () => {
	fs.copyFileSync(backupPath, asarPath);
	fs.rmSync(backupPath);
	console.log('Restored.');
};
const run = () => {
	assertStopped();
	if (false === fs.existsSync(backupPath)) {
		throw new Error(`Backup not found: ${backupPath}`);
	}
	assertPatched();
	restore();
};
run();
