// 2026-11-20 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Discover Ⰿ/≻/♕/⛯ Harness registry and ancestor project overlays in Upgrade/profiles.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/63
// 2026-11-20 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Resolve skillsRoot templates in Multi-Account profiles from Harness paths.json":
// https://github.com/dmitry-ai/antigravity-addons/issues/60
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Break Upgrade and Multi-Account circular dependency, replace bootstrap.toString() with require, and split update-guard.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/40
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const toolsRoot = path.resolve(__dirname, '..');
const ESC_DOLLAR = '\0HARNESS_DOLLAR_LBRACE\0';
const ESC_PCT = '\0HARNESS_PERCENT\0';
const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TOKEN_RE = /\$\$\{|%%|\$\{([^}]*)\}|%([A-Za-z_][A-Za-z0-9_]*)%/g;
const lookupEnv = (name, env) => {
	const upper = name.toUpperCase();
	const hit = Object.entries(env ?? {}).find(([k, v]) => k.toUpperCase() === upper && String(v ?? '').trim());
	if (hit) {
		return String(hit[1]).replaceAll('\\', '/');
	}
	const home = os.homedir().replaceAll('\\', '/').replace(/\/+$/, '');
	if ('USERPROFILE' === upper || 'HOME' === upper) {
		return home;
	}
	if ('APPDATA' === upper) {
		return `${home}/AppData/Roaming`;
	}
	if ('LOCALAPPDATA' === upper) {
		return `${home}/AppData/Local`;
	}
	if ('PROGRAMFILES' === upper) {
		return 'C:/Program Files';
	}
	if ('SYSTEMROOT' === upper || 'WINDIR' === upper) {
		return 'C:/Windows';
	}
	return null;
};
const normalizeExpandedPath = (raw, preserveTrailingSlash = false) => {
	if (!raw) {
		return raw;
	}
	const hadTrailing = raw.endsWith('/') || raw.endsWith('\\');
	const text = raw.replaceAll('\\', '/');
	const isUnc = text.startsWith('//') && !text.startsWith('///');
	const body = isUnc ? text.slice(2) : text;
	let collapsed = (isUnc ? '//' : '') + body.replace(/\/{2,}/g, '/');
	if (!preserveTrailingSlash && 1 < collapsed.length && !/^[A-Za-z]:\/$/.test(collapsed) && '//' !== collapsed) {
		collapsed = collapsed.replace(/\/+$/, '');
	}
	else if (preserveTrailingSlash && hadTrailing && !collapsed.endsWith('/')) {
		collapsed += '/';
	}
	return collapsed;
};
const expandPathTemplate = (raw, vars = {}, {env = process.env, _seen = new Set()} = {}) => {
	if ('string' !== typeof raw || (!raw.includes('$') && !raw.includes('%'))) {
		return 'string' === typeof raw ? (0 === _seen.size ? normalizeExpandedPath(raw, false) : raw) : raw;
	}
	const unclosedCheck = raw.replaceAll('$${', '');
	if (unclosedCheck.includes('${') && !/\$\{[^}]*\}/.test(unclosedCheck)) {
		throw Error('Invalid Multi-Account path template: unclosed variable in ' + raw);
	}
	const expanded = raw.replace(TOKEN_RE, (full, braced, pct) => {
		if ('$${' === full) {
			return ESC_DOLLAR;
		}
		if ('%%' === full) {
			return ESC_PCT;
		}
		if (undefined !== pct) {
			const val = lookupEnv(pct, env);
			if (null === val) {
				throw Error('Invalid Multi-Account path template: unresolved env variable %' + pct + '%');
			}
			return val.replaceAll('${', ESC_DOLLAR).replaceAll('%', ESC_PCT);
		}
		const expr = (braced ?? '').trim();
		if (expr.toUpperCase().startsWith('ENV:')) {
			const envName = expr.slice(4).trim();
			if (!VAR_RE.test(envName)) {
				throw Error('Invalid Multi-Account path template: invalid env variable ${' + braced + '}');
			}
			const val = lookupEnv(envName, env);
			if (null === val) {
				throw Error('Invalid Multi-Account path template: unresolved env variable ${' + braced + '}');
			}
			return val.replaceAll('${', ESC_DOLLAR).replaceAll('%', ESC_PCT);
		}
		if (!VAR_RE.test(expr)) {
			throw Error('Invalid Multi-Account path template: invalid variable ${' + braced + '}');
		}
		if (_seen.has(expr) || 'string' !== typeof vars?.[expr]) {
			throw Error('Invalid Multi-Account path template: unresolved variable ${' + expr + '}');
		}
		const next = new Set(_seen);
		next.add(expr);
		return normalizeExpandedPath(expandPathTemplate(vars[expr], vars, {env, _seen: next}), true);
	});
	if (expanded.replaceAll(ESC_DOLLAR, '').includes('${')) {
		throw Error('Invalid Multi-Account path template: malformed variable in ' + raw);
	}
	if (0 < _seen.size) {
		return expanded;
	}
	return normalizeExpandedPath(expanded.replaceAll(ESC_DOLLAR, '${').replaceAll(ESC_PCT, '%'), false);
};
const readJsonFile = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const resolvePathsVariables = ({filename, pathsRegistry, env = process.env} = {}) => {
	const baseDir = filename ? path.dirname(path.resolve(filename)) : toolsRoot;
	const explicit = pathsRegistry || env?.HARNESS_PATHS_FILE;
	let regFile = explicit ? path.resolve(baseDir, explicit) : '';
	if (!regFile) {
		const anchors = [...new Set([path.resolve(baseDir, '..', '..'), path.resolve(toolsRoot, '..')])];
		const candidates = [];
		for (const anchor of anchors) {
			for (let cur = anchor; ; cur = path.dirname(cur)) {
				const harnessRoot = path.join(cur, 'harness');
				candidates.push(
					path.join(harnessRoot, '\u2c0f', '\u227b', '\u2655', '\u26ef', 'paths.json'),
					path.join(harnessRoot, 'Artifacts', '\u227b', 'Deliverables', '\u26ef', 'paths.json'),
					path.join(harnessRoot, 'code', 'paths.json')
				);
				if (path.dirname(cur) === cur) {
					break;
				}
			}
		}
		regFile = candidates.find(candidate => fs.existsSync(candidate)) || '';
	}
	if (!regFile || !fs.existsSync(regFile)) {
		throw Error('Harness paths.json registry is unavailable');
	}
	const registry = readJsonFile(regFile);
	const r = {...(registry?.variables ?? {})};
	const resolvedReg = path.resolve(regFile);
	overlayLoop: for (let cur = path.resolve(baseDir, '..'), depth = 0; 6 > depth; cur = path.dirname(cur), depth++) {
		for (const rel of ['_/\ua616/paths.json', '\ua616/paths.json', '.agents/paths.json']) {
			const overlay = path.join(cur, rel);
			if (fs.existsSync(overlay) && path.resolve(overlay) !== resolvedReg) {
				Object.assign(r, readJsonFile(overlay)?.variables ?? {});
				break overlayLoop;
			}
		}
		if (path.dirname(cur) === cur) {
			break;
		}
	}
	return r;
};
const readProfiles = ({roaming = process.env.APPDATA, filename = resolveConfigFile(), pathsRegistry, env = process.env} = {}) => {
	if (!roaming) {
		throw Error('APPDATA is required');
	}
	const config = readJsonFile(filename);
	if (1 !== config.schemaVersion || !Array.isArray(config.profiles) || 'string' !== typeof config.skillsRoot || !config.skillsRoot.trim()) {
		throw Error('Invalid Multi-Account configuration');
	}
	const needsTemplate = config.skillsRoot.includes('$') || config.skillsRoot.includes('%');
	const vars = needsTemplate ? resolvePathsVariables({filename, pathsRegistry: pathsRegistry || config.pathsRegistry, env}) : {};
	const skillsRoot = needsTemplate ? expandPathTemplate(config.skillsRoot, vars, {env}) : config.skillsRoot;
	if (!path.isAbsolute(skillsRoot)) {
		throw Error('Invalid Multi-Account configuration');
	}
	const ids = new Set();
	const directories = new Set();
	const r = config.profiles.map(profile => {
		if (!/^A\d+$/.test(profile.id) || ids.has(profile.id) || !/^[a-z0-9-]+$/i.test(profile.userData) || directories.has(profile.userData.toLowerCase())) {
			throw Error('Invalid or duplicate Antigravity profile');
		}
		ids.add(profile.id);
		directories.add(profile.userData.toLowerCase());
		if ('A0' !== profile.id && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email || '') || !/^\d+$/.test(profile.chromeShortcut || ''))) {
			throw Error('Managed profiles require email and Chrome shortcut');
		}
		const userDataDir = path.join(roaming, profile.userData);
		return {
			...profile,
			userDataDir,
			homeDir: path.join(userDataDir, 'home'),
			portFile: path.join(userDataDir, 'DevToolsActivePort'),
			skillsRoot
		};
	});
	if (!ids.has('A0')) {
		throw Error('The existing A0 profile must remain registered');
	}
	return r;
};
const resolveConfigFile = (root = toolsRoot) => {
	const folder = fs.existsSync(root) ? fs.readdirSync(root, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).find(item => item.isDirectory() && fs.existsSync(path.join(root, item.name, 'profiles.json'))) : null;
	return folder ? path.join(root, folder.name, 'profiles.json') : path.join(root, 'profiles.json');
};
module.exports = {expandPathTemplate, readProfiles, resolveConfigFile, resolvePathsVariables};
