const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const encodeHeader = header => {
	const json = Buffer.from(JSON.stringify(header));
	const payloadSize = 4 + Math.ceil(json.length / 4) * 4;
	const size = Buffer.alloc(8);
	const payload = Buffer.alloc(4 + payloadSize);
	size.writeUInt32LE(4, 0);
	size.writeUInt32LE(payload.length, 4);
	payload.writeUInt32LE(payloadSize, 0);
	payload.writeUInt32LE(json.length, 4);
	json.copy(payload, 8);
	return Buffer.concat([size, payload]);
};
const entries = (header, prefix = '') => {
	const r = [];
	for (const [name, record] of Object.entries(header.files)) {
		if (!name || '.' === name || '..' === name || /[\\/\0]/.test(name)) {
			throw new Error(`Недопустимое имя в ASAR: ${name}`);
		}
		const filename = prefix + name;
		const type = record.files ? 'directory' : record.link ? 'link' : 'file';
		r.push({path: filename, type, record});
		if (record.files) {
			r.push(...entries(record, `${filename}/`));
		}
	}
	return r;
};
const pack = async (asar, snapshot, replacements, destination) => {
	const header = structuredClone(snapshot.header);
	const body = fs.readFileSync(snapshot.path).subarray(8 + snapshot.headerSize);
	const chunks = [body];
	let offset = body.length;
	for (const [filename, content] of replacements) {
		let record = header;
		for (const part of filename.split('/')) {
			record = record.files[part];
		}
		if (record.files || record.link || record.unpacked || record.integrity && 'SHA256' !== record.integrity.algorithm) {
			throw new Error(`Неподдерживаемый тип или алгоритм целостности изменяемого файла: ${filename}`);
		}
		const blockSize = record.integrity?.blockSize || 4194304;
		const blocks = [];
		for (let start = 0; start < content.length; start += blockSize) {
			blocks.push(digest(content.subarray(start, start + blockSize)));
		}
		record.offset = String(offset);
		record.size = content.length;
		record.integrity = {algorithm: 'SHA256', hash: digest(content), blockSize, blocks};
		chunks.push(content);
		offset += content.length;
	}
	fs.writeFileSync(destination, Buffer.concat([encodeHeader(header), ...chunks]));
};
const read = (asar, archivePath, unpackedArchivePath = archivePath) => {
	asar.uncache(archivePath);
	const r = {
		path: archivePath,
		hash: digest(fs.readFileSync(archivePath)),
		entries: entries(asar.getRawHeader(archivePath).header)
	};
	Object.assign(r, asar.getRawHeader(archivePath));
	for (const entry of r.entries) {
		if ('file' === entry.type) {
			entry.content = entry.record.unpacked ? fs.readFileSync(path.join(`${unpackedArchivePath}.unpacked`, entry.path)) : asar.extractFile(archivePath, path.normalize(entry.path));
			entry.hash = digest(entry.content);
		}
	}
	r.manifest = JSON.parse(r.entries.find(entry => 'package.json' === entry.path)?.content?.toString('utf8') ?? 'null');
	if ('antigravity' !== r.manifest?.name || !r.manifest.version) {
		throw new Error(`Это не архив Antigravity: ${archivePath}`);
	}
	r.unpackedHash = unpackedHash(r);
	return r;
};
const unpackedHash = snapshot => digest(JSON.stringify(snapshot.entries.filter(entry => entry.record.unpacked).map(entry => [entry.path, entry.type, entry.hash ?? null, entry.record.link ?? null]).sort((a, b) => a[0].localeCompare(b[0]))));
const verify = (before, after, replacements) => {
	const actual = new Map(after.entries.map(entry => [entry.path, entry]));
	if (before.entries.length !== actual.size) {
		throw new Error('После сборки изменился список файлов ASAR');
	}
	for (const entry of before.entries) {
		const next = actual.get(entry.path);
		if (!next || entry.type !== next.type || !!entry.record.unpacked !== !!next.record.unpacked || !!entry.record.executable !== !!next.record.executable || entry.record.link !== next.record.link) {
			throw new Error(`После сборки изменились свойства файла: ${entry.path}`);
		}
		if ('file' === entry.type && digest(replacements.get(entry.path) ?? entry.content) !== next.hash) {
			throw new Error(`После сборки изменилось содержимое файла: ${entry.path}`);
		}
	}
	if (before.unpackedHash !== after.unpackedHash) {
		throw new Error('После сборки изменились распакованные файлы ASAR');
	}
};
module.exports = {digest, encodeHeader, entries, pack, read, unpackedHash, verify};
