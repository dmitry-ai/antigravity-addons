const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const path = require('node:path');

test('late attachment applies CSS immediately; later ready events and closing remain safe', async () => {
  const module = {exports: {}}, win = new EventEmitter(), wc = win.webContents = new EventEmitter();
  const inserted = [], watchers = [];
  wc.isDestroyed = () => false;wc.getURL = () => 'https://127.0.0.1:12345/';wc.isLoading = () => false;
  wc.insertCSS = async css => {inserted.push(css);return 'key';};wc.removeInsertedCSS = async () => {};
  const mockFs = {existsSync: () => true, readFileSync: () => 'body {color: red}', watch: () => {
    const watcher = new EventEmitter();watcher.close = () => {watcher.closed = true;};watchers.push(watcher);return watcher;
  }};
  vm.compileFunction(fs.readFileSync(path.join(__dirname, 'bootstrap.js'), 'utf8'), ['require','module','__dirname','console','setTimeout','clearTimeout'])(
    name => 'fs' === name ? mockFs : './build' === name ? async () => {} : require(name),module,__dirname,console,setTimeout,clearTimeout);
  module.exports(win);await new Promise(resolve => setImmediate(resolve));assert.equal(inserted.length, 1);
  wc.emit('dom-ready');await new Promise(resolve => setImmediate(resolve));assert.equal(inserted.length, 2);
  win.emit('closed');assert.ok(watchers.every(watcher => watcher.closed));
});
