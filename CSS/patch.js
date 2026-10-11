const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const anchor = 'void win.loadURL(url);';
const asar = 'npx --yes @electron/asar@4.3.1';
const asarPath = 'C:/Users/dfedi/AppData/Local/Programs/antigravity/resources/app.asar';
const backupPath = `${asarPath}.original`;
const bootstrapPath = path.join(__dirname, 'bootstrap.js').replace(/\\/g, '/');
const tempDir = path.join(os.tmpdir(), 'antigravity_asar_patch');
const utilsPath = path.join(tempDir, 'dist', 'utils.js');
const assertStopped = () => {
	const out = childProcess.execSync('tasklist /FI "IMAGENAME eq Antigravity.exe" /NH').toString();
	if (true === out.includes('Antigravity.exe')) {
		throw new Error('Antigravity is running: quit it completely (tray included, all Windows users) and rerun.');
	}
};
const cleanup = () => {
	fs.rmSync(tempDir, {force: true, recursive: true});
};
const extract = () => {
	cleanup();
	childProcess.execSync(`${asar} extract "${asarPath}" "${tempDir}"`);
};
const header = p => {
	const fd = fs.openSync(p, 'r');
	const b = Buffer.alloc(16);
	fs.readSync(fd, b, 0, 16, 0);
	const h = Buffer.alloc(b.readUInt32LE(12));
	fs.readSync(fd, h, 0, h.length, 16);
	fs.closeSync(fd);
	return JSON.parse(h.toString('utf8'));
};
const inject = () => {
	const content = fs.readFileSync(utilsPath, 'utf8');
	if (false === content.includes(anchor)) {
		throw new Error(`Anchor not found in dist/utils.js: ${anchor}`);
	}
	fs.writeFileSync(utilsPath, content.replace(anchor, `try { require('${bootstrapPath}')(win); } catch (e) { console.error('[custom-ui]', e); }\n    ${anchor}`), 'utf8');
};
const isPatched = () => fs.readFileSync(utilsPath, 'utf8').includes(bootstrapPath);
const pack = () => {
	const dirs = unpackedDirs(header(asarPath));
	const o = 0 === dirs.length ? '' : `--unpack-dir "${1 === dirs.length ? dirs[0] : `{${dirs.join(',')}}`}"`;
	childProcess.execSync(`${asar} pack "${tempDir}" "${asarPath}" ${o}`);
};
const run = () => {
	assertStopped();
	extract();
	if (true === isPatched()) {
		console.log('Already patched.');
	}
	else {
		fs.copyFileSync(asarPath, backupPath);
		inject();
		pack();
		verify();
	}
	cleanup();
};
const unpackedDirs = h => {
	const r = new Set();
	const walk = (node, prefix) => {
		Object.entries(node.files).forEach(([k, v]) => {
			if (v.files) {
				walk(v, `${prefix}${k}/`);
			}
			else if (true === v.unpacked) {
				const parts = `${prefix}${k}`.split('/');
				r.add(parts.slice(0, 'node_modules' === parts[0] ? 2 : 1).join('/'));
			}
		});
	};
	walk(h, '');
	return [...r];
};
const verify = () => {
	const before = unpackedDirs(header(backupPath)).join(',');
	const after = unpackedDirs(header(asarPath)).join(',');
	if (before !== after) {
		throw new Error(`Unpacked dirs mismatch: ${before} vs ${after}`);
	}
	console.log(`Patched. Unpacked dirs preserved: ${after}`);
};
run();
