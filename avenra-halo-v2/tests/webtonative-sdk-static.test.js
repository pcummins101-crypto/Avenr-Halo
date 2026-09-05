'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const plugin = path.join(__dirname, '..');
const pluginClass = fs.readFileSync(path.join(plugin, 'includes', 'class-halo-v2-plugin.php'), 'utf8');
const sdk = fs.readFileSync(path.join(plugin, 'assets', 'vendor', 'webtonative', 'webtonative-1.0.63.min.js'), 'utf8');
const license = fs.readFileSync(path.join(plugin, 'assets', 'vendor', 'webtonative', 'LICENSE.txt'), 'utf8');

function runtimeFiles(directory) {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) return entry.name === 'tests' ? [] : runtimeFiles(absolute);
		return ['.php', '.js'].includes(path.extname(entry.name)) ? [absolute] : [];
	});
}

test('the pinned official WebToNative SDK is local and loaded before the Halo adapter', () => {
	assert.ok(sdk.length > 20000, 'the SDK must not be a placeholder loader');
	assert.match(sdk, /window\.WTN=/);
	assert.match(license, /webtonative JavaScript SDK v1\.0\.63/);
	assert.match(pluginClass, /'avenra-halo-v2-webtonative-sdk'.*webtonative-1\.0\.63\.min\.js.*'1\.0\.63'/s);
	assert.match(pluginClass, /'avenra-halo-v2-webtonative-ride'.*array\(\s*'avenra-halo-v2-webtonative-sdk'\s*\)/s);
});

test('the SDK follows defer/service-worker policy without a runtime CDN dependency', () => {
	assert.match(pluginClass, /defer_scripts[\s\S]*'avenra-halo-v2-webtonative-sdk'/);
	assert.match(pluginClass, /assets\/vendor\/webtonative\/webtonative-1\.0\.63\.min\.js\?ver=1\.0\.63/);
	const runtimeSource = runtimeFiles(plugin).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
	assert.doesNotMatch(runtimeSource, /(?:https?:)?\/\/unpkg\.com\//i);
});
