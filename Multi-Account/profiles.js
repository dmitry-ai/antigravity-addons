// 2026-10-11 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// 2026-11-28 "Add ProfileRepository and ProfileProvisioner CLI with duplicate checks": https://github.com/dmitry-ai/antigravity-addons/issues/77
const {readProfiles, resolveConfigFile, validateProfilesConfig} = require('../Upgrade/profiles');
// 2026-10-28
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
// 2026-11-14
// "Break Upgrade and Multi-Account circular dependency, replace bootstrap.toString() with require, and split update-guard.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/40
const configFile = resolveConfigFile(__dirname && require('node:path').resolve(__dirname, '..'));
module.exports = {configFile, readProfiles, validateProfilesConfig};
