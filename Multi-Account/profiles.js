// 2026-10-11 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Prototype multi-account Antigravity instances A1 and A2 with Windows user isolation, composite profile badge icons, and Chrome OAuth routing":
// https://github.com/dmitry-ai/antigravity-addons/issues/1
// 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
// https://github.com/dmitry-ai/antigravity-addons/issues/12
// 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Break Upgrade and Multi-Account circular dependency, replace bootstrap.toString() with require, and split update-guard.js":
// https://github.com/dmitry-ai/antigravity-addons/issues/40
const {readProfiles, resolveConfigFile} = require('../Upgrade/profiles');
const configFile = resolveConfigFile(__dirname && require('node:path').resolve(__dirname, '..'));
module.exports = {configFile, readProfiles};
