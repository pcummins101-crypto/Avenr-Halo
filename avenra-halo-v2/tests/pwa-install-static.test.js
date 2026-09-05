'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const app = read('assets/js/app.js');
const css = read('assets/css/halo-v2.css');
const shell = read('templates/app-shell.php');
const plugin = read('includes/class-halo-v2-plugin.php');
const deployment = read('docs/DEPLOYMENT.md');

function method(source, startSignature, endSignature) {
	const start = source.indexOf(startSignature);
	const end = source.indexOf(endSignature, start + startSignature.length);
	assert.notEqual(start, -1, `${startSignature} must exist`);
	assert.notEqual(end, -1, `${endSignature} must follow ${startSignature}`);
	return source.slice(start, end);
}

test('website install intent is exact, secondary to private tracking, and presented after bootstrap', () => {
	const start = method(app, 'async start() {', '\n\t\tbindEvents() {');
	assert.match(start, /const installRequested = query\.get\('install'\) === '1';/);
	const trackingAt = start.indexOf("if (trackingToken &&");
	const trackingReturnAt = start.indexOf('return;', trackingAt);
	const bootstrapAt = start.indexOf('await this.bootstrap();', trackingReturnAt);
	const handoffAt = start.indexOf('if (installRequested) this.openInstallHandoff();', bootstrapAt);
	assert.ok(trackingAt >= 0 && trackingReturnAt > trackingAt, 'private tracking must keep its early return');
	assert.ok(bootstrapAt > trackingReturnAt, 'ordinary Halo bootstrap must follow the tracking return');
	assert.ok(handoffAt > bootstrapAt, 'the install hand-off must wait for Halo bootstrap');
});

test('the native browser prompt remains behind the existing user click action', () => {
	const start = method(app, 'async start() {', '\n\t\tbindEvents() {');
	const configure = method(app, 'configurePWA() {', '\n\t\t\tasync showPublicTracking(');
	const install = method(app, 'async installApp(button) {', '\n\t\t\tconfirmLogout() {');
	assert.doesNotMatch(start, /\.prompt\(/);
	assert.doesNotMatch(configure, /\.prompt\(/);
	assert.equal((app.match(/\.prompt\(/g) || []).length, 1);
	assert.match(install, /await prompt\.prompt\(\)/);
	assert.match(app, /case 'install-app': await this\.installApp\(target\)/);
	assert.match(app, /data-install-handoff[\s\S]*data-action="install-app"[\s\S]*data-install-control/);
});

test('the hand-off consumes only its query flag and handles installed and embedded states', () => {
	const handoff = method(app, 'openInstallHandoff() {', '\n\t\tasync installApp(button) {');
	assert.match(handoff, /cleanUrl\.searchParams\.delete\('install'\)/);
	assert.match(handoff, /replaceState\(window\.history\.state, '', `\$\{cleanUrl\.pathname\}\$\{cleanUrl\.search\}\$\{cleanUrl\.hash\}`\)/);
	assert.match(handoff, /this\.isStandaloneApp\(\)[\s\S]*this\.openInstallInstructions\(true\)/);
	assert.match(app, /window\.WTN\?\.isAndroidApp === true[\s\S]*return 'embedded-android'/);
	assert.match(app, /window\.WTN\?\.isIosApp === true[\s\S]*return 'embedded-ios'/);
	assert.match(app, /const installSheetOpen = Boolean\(\$\('\[data-install-handoff\], \[data-install-retry\]'[\s\S]*if \(installSheetOpen\) this\.openInstallInstructions\(true\)/);
	assert.match(css, /\.halo-install-handoff\s*\{/);
});

test('late Chrome install readiness activates an in-sheet retry without a prompt loop', () => {
	const instructions = method(app, 'openInstallInstructions(installed) {', '\n\t\topenInstallHandoff() {');
	assert.match(instructions, /\['android-chromium', 'desktop'\]\.includes\(this\.installPlatform\(\)\)/);
	assert.match(instructions, /data-install-control data-install-retry disabled/);
	assert.match(app, /control\.hasAttribute\('data-install-retry'\) && !ready && !installing/);
	assert.match(app, /window\.addEventListener\('beforeinstallprompt'[\s\S]*this\.updateInstallControls\(\)/);
	assert.equal((app.match(/await prompt\.prompt\(\)/g) || []).length, 1);
});

test('install controls remain available before sign-in and under More', () => {
	assert.match(shell, /class="halo-auth-install"[\s\S]*data-action="install-app"[\s\S]*data-install-control/);
	assert.match(app, /const install = `<article class="halo-callout halo-install-card"[\s\S]*data-action="install-app"[\s\S]*data-install-control/);
	assert.match(app, /\$\$\('\[data-install-surface\]'[\s\S]*surface\.hidden = installed/);
});

test('manifest keeps the private app start URL and adds a labelled narrow screenshot', () => {
	assert.match(plugin, /'start_url'\s*=>\s*self::page_url\(\)/);
	assert.doesNotMatch(plugin, /'start_url'\s*=>[^\n]*install/);
	assert.match(plugin, /'scope'\s*=>\s*wp_parse_url\( self::page_url\(\), PHP_URL_PATH \)/);
	assert.match(plugin, /'lang'\s*=>\s*'en-GB'/);
	assert.match(plugin, /'categories'\s*=>\s*array\( 'lifestyle', 'navigation' \)/);
	assert.match(plugin, /'screenshots'\s*=>\s*\$screenshots/);
	assert.match(plugin, /'sizes'\s*=>\s*'1080x2372'/);
	assert.match(plugin, /'type'\s*=>\s*'image\/jpeg'/);
	assert.match(plugin, /'form_factor'\s*=>\s*'narrow'/);
	assert.match(plugin, /'label'\s*=>\s*'Halo Safety controls and one-ride monitoring\.'/);
});

test('deployment checklist covers the website hand-off and HyperCore browser acceptance', () => {
	assert.match(deployment, /\/halo-v2\/\?install=1/);
	assert.match(deployment, /never launches the browser prompt automatically/);
	assert.match(deployment, /compatible Android Chrome[\s\S]*HyperCore device choosers through Web Bluetooth/);
});
