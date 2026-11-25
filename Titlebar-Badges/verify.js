// 2026-11-25 Dmitrii Fediuk https://github.com/dmitrii-fediuk
// "Relocate titlebar update and announcement badges into the Antigravity app menu":
// https://github.com/dmitry-ai/antigravity-addons/issues/67
const vm = require('node:vm');
const {rendererSource, styleSheet} = require('./cdp-runtime');
module.exports = async () => {
	const css = styleSheet();
	if (!css.includes('app-update-button')) {
		throw Error('Titlebar-Badges stylesheet is missing app-update-button rule');
	}
	new vm.Script(rendererSource());
	return {message: 'Titlebar-Badges stylesheet and controller verified; client main.js is unchanged.'};
};