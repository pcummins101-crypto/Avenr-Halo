'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(
	path.join(__dirname, '..', 'assets', 'css', 'halo-v2.css'),
	'utf8'
);
const shell = fs.readFileSync(
	path.join(__dirname, '..', 'templates', 'app-shell.php'),
	'utf8'
);
const app = fs.readFileSync(
	path.join(__dirname, '..', 'assets', 'js', 'app.js'),
	'utf8'
);
const plugin = fs.readFileSync(
	path.join(__dirname, '..', 'includes', 'class-halo-v2-plugin.php'),
	'utf8'
);
const entry = fs.readFileSync(
	path.join(__dirname, '..', 'avenra-halo-v2.php'),
	'utf8'
);

test('dark circular controls keep a visible white foreground', () => {
	assert.match(css, /\.halo-app \.halo-avatar,[\s\S]*?\.halo-app \.halo-icon-button,[\s\S]*?\.halo-app \.halo-cart-button\s*\{[\s\S]*?color:\s*#fff;/);
});

test('the persistent profile control uses the configured vehicle-aware mark', () => {
	assert.match(shell, /\$halo_v2_profile_mark_default\s*=\s*esc_url\(/);
	assert.match(shell, /class="halo-avatar-logo"[^\n]*\$halo_v2_profile_mark_default[^\n]*data-profile-mark/);
	assert.match(css, /\.halo-avatar-logo\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?object-fit:\s*cover;/);
});

test('profile artwork maps no bike, EVO and ONE to the supplied URLs', () => {
	const filenames = {
		default: 'file_00000000ea8481f495d8d90ac3ee1292.png',
		evo: 'file_00000000bdfc81f4be439668e0cbc541.png',
		one: 'file_0000000037bc8246a29d947a90e5b159.png'
	};
	for (const [key, filename] of Object.entries(filenames)) {
		const escapedFilename = filename.replace(/\./g, '\\.');
		const constant = `AVENRA_HALO_V2_PROFILE_MARK_${key.toUpperCase()}`;
		assert.match(entry, new RegExp(`${constant}[^\\n]*${escapedFilename}`));
		assert.match(plugin, new RegExp(`'${key}'\\s*=>[\\s\\S]*?${constant}`));
		assert.ok((plugin.match(new RegExp(constant, 'g')) || []).length >= 2, `${key} mark must be configured and cached offline`);
		assert.match(app, new RegExp(`${key}:\\s*'https://rideavenra\\.com/[^']*${escapedFilename}'`));
	}
	assert.match(app, /profileMarkForVehicle\(vehicle\)[\s\S]*?\/\\bEVO\\b\/[\s\S]*?key = 'evo'/);
	assert.match(app, /profileMarkForVehicle\(vehicle\)[\s\S]*?\/\\bONE\\b\/[\s\S]*?key = 'one'/);
	assert.match(app, /renderAll\(\)\s*\{\s*this\.updateProfileMark\(\);/);
});

test('dialog and sheet dismiss buttons contain an explicit close glyph', () => {
	for (const action of ['close-dialog', 'close-sheet']) {
		assert.match(shell, new RegExp(`data-action="${action}"[^>]*>[\\s\\S]*?class="halo-close-glyph"[^>]*>&times;<`));
	}
	assert.match(css, /\.halo-close-glyph\s*\{[\s\S]*?color:\s*#fff;/);
});
