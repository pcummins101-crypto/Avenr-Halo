'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const app = read('assets/js/app.js');
const bms = read('assets/js/bms-bluetooth.js');
const plugin = read('includes/class-halo-v2-plugin.php');
const template = read('templates/app-shell.php');
const css = read('assets/css/halo-v2.css');
const readme = read('readme.txt');
const docs = read('docs/BMS-BLUETOOTH.md');

test('loads the BMS module before Halo, defers it and makes it available offline', () => {
	assert.match(plugin, /wp_enqueue_script\( 'avenra-halo-v2-bms-bluetooth',[\s\S]*assets\/js\/bms-bluetooth\.js/);
	assert.match(plugin, /'avenra-halo-v2-app',[\s\S]*'avenra-halo-v2-bms-bluetooth'/);
	assert.match(plugin, /defer_scripts[\s\S]*'avenra-halo-v2-bms-bluetooth'/);
	assert.match(plugin, /serve_service_worker[\s\S]*assets\/js\/bms-bluetooth\.js\?ver=/);
	assert.ok(plugin.indexOf("wp_enqueue_script( 'avenra-halo-v2-bms-bluetooth'") < plugin.indexOf("wp_enqueue_script( 'avenra-halo-v2-app'"));
});

test('the Halo page explicitly permits same-origin Bluetooth without weakening responder pages', () => {
	assert.match(plugin, /Permissions-Policy:[^\n]+bluetooth=\(self\)/);
	assert.doesNotMatch(read('includes/class-halo-v2-emergency.php'), /bluetooth=\(self\)/);
	assert.doesNotMatch(read('includes/class-halo-v2-operations.php'), /bluetooth=\(self\)/);
});

test('pairing remains an explicit parked-rider action and never runs at bootstrap', () => {
	assert.match(app, /new window\.AvenraHaloBmsBluetoothClass\(\{[\s\S]*onStatus:[\s\S]*onTelemetry:/);
	assert.match(app, /case 'connect-bms': await this\.connectBms\(target\)/);
	assert.match(app, /case 'disconnect-bms': await this\.disconnectBms\(target\)/);
	assert.match(app, /async connectBms\(\)[\s\S]*Pair HyperCore BMS only while safely parked/);
	assert.equal((app.match(/this\.bms\.connect\(\)/g) || []).length, 1, 'only the explicit connection action may open the chooser');
	assert.doesNotMatch(app.slice(app.indexOf('async bootstrap('), app.indexOf('async acceptBootstrap(')), /\.bms\.connect/);
});

test('BMS charge is transient, fresh-only and does not overwrite the server vehicle object', () => {
	assert.match(app, /this\.state\.bms\?\.live[\s\S]*liveBms\.soc \?\? battery\.soc/);
	assert.match(app, /soc: nullableFinite\(liveBms\.soc \?\?/);
	assert.match(app, /status: 'live', connected: true, live: true, telemetry/);
	assert.doesNotMatch(app, /this\.state\.vehicle\.battery\s*=/);
	assert.doesNotMatch(bms, /fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB/);
	assert.match(app, /if \(!this\.state\.activeRide\) this\.syncRideSetup\(\)/);
	assert.match(app, /if \(!this\.state\.activeRide\) this\.syncRideSetup\(\)/);
	assert.match(app, /batterySoc === null \? finite\(socInput\.defaultValue\) \?\? 100 : batterySoc/);
});

test('the rider sees HyperCore BMS pairing, live telemetry and truthful Ride-mode loss states', () => {
	assert.match(template, /data-vehicle-view="battery">HyperCore</);
	assert.match(template, /halo-icon-bluetooth/);
	assert.match(template, /data-bms-ride-status[^>]+aria-live="polite"/);
	assert.match(template, /data-ride-bms-charge/);
	assert.match(app, /renderVehicleBattery\(container\)/);
	assert.match(app, /Charge[\s\S]*Pack voltage[\s\S]*Pack current[\s\S]*Pack power[\s\S]*Highest temperature/);
	assert.match(app, /HyperCore data unavailable · Ride mode continues/);
	assert.match(app, /Bluetooth data unavailable/);
	assert.match(app, /data-bms-metric="soc"/);
	assert.match(app, /data-bms-effective-start-charge/);
	assert.match(app, /updateStartingChargeSurfaces\(\)/);
	assert.match(app, /updateBmsSurfaces\(\{ renderCards: false \}\)/);
	assert.match(app, /hypercorePairing = \[this\.state\.ecu\?\.status, this\.state\.bms\?\.status\]/);
	assert.match(app, /Finish or cancel HyperCore pairing before starting Ride mode/);
	const rideEnd = app.slice(app.indexOf('hideActiveRide() {'), app.indexOf('showRideSummary(ride) {'));
	assert.match(rideEnd, /delete startSoc\.dataset\.userAdjusted[\s\S]*this\.syncRideSetup\(\)/);
	assert.match(css, /\.halo-bms-metrics/);
	assert.match(css, /\.halo-bms-ride-status\.is-live/);
});

test('privacy boundaries stop Bluetooth at background and identity changes but retain it through Ride start', () => {
	assert.match(app, /pagehide[\s\S]{0,420}this\.bms\?\.disconnect\?\.\('page-hidden'/);
	assert.match(app, /visibilitychange[\s\S]{0,520}this\.bms\?\.disconnect\?\.\('document-hidden'/);
	const reset = app.slice(app.indexOf('async resetIdentityBoundState('), app.indexOf('async resetDeviceSession('));
	assert.match(reset, /const bmsShutdown = Promise\.resolve\(this\.bms\?\.disconnect/);
	assert.ok(reset.indexOf('const bmsShutdown') < reset.indexOf('await Promise.all'), 'identity cleanup fences BMS before its first cleanup wait');
	const beginRide = app.slice(app.indexOf('async beginRide('), app.indexOf('bindHoldControl('));
	assert.doesNotMatch(beginRide, /bms\?\.disconnect|bms\.disconnect/);
	const bootstrap = app.slice(app.indexOf('async acceptBootstrap('), app.indexOf('\n\t\tresolveLifecycle(boot) {'));
	assert.match(bootstrap, /nextLifecycle !== 'owner'/);
	assert.match(bootstrap, /disconnect\?\.\('vehicle-changed',[\s\S]*this\.state\.bms = this\.bms\?\.getStatus/);
});

test('the BMS transport is read-only apart from its exact telemetry read probes', () => {
	assert.match(bms, /const payload = generateWakePing\(\)/);
	assert.match(bms, /\['writeValueWithResponse', 'writeValue', 'writeValueWithoutResponse'\]/);
	assert.match(bms, /await this\._writeWithTimeout\(characteristic, method, payload\)/);
	assert.match(bms, /characteristic\[method\]\(payload\)/);
	assert.doesNotMatch(bms, /\b(?:powerOff|setParameter|configurationCommand|arbitraryWrite)\b/i);
	assert.match(app, /reads BMS information and cannot change BMS settings/);
	assert.match(readme, /no new database table or detailed telemetry upload, automatic pairing, BMS setting write or power command/i);
	assert.match(docs, /sends\s+only\s+the\s+(?:two\s+)?established\s+(?:wake|read)\s+requests?\s+and\s+has\s+no\s+configuration[\s\S]{0,100}arbitrary-write capability/i);
});
