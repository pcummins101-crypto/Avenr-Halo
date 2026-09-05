'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const app = read('assets/js/app.js');
const plugin = read('includes/class-halo-v2-plugin.php');
const template = read('templates/app-shell.php');

function between(source, start, end) {
	const startAt = source.indexOf(start);
	const endAt = source.indexOf(end, startAt + start.length);
	assert.notEqual(startAt, -1, `${start} must exist`);
	assert.notEqual(endAt, -1, `${end} must follow ${start}`);
	return source.slice(startAt, endAt);
}

test('delivers the HyperCore ECU transport before Halo and keeps it available offline', () => {
	assert.match(plugin, /wp_enqueue_script\( 'avenra-halo-v2-hypercore-ecu',[\s\S]*assets\/js\/hypercore-ecu\.js/);
	assert.match(plugin, /'avenra-halo-v2-app',[\s\S]*'avenra-halo-v2-hypercore-ecu'/);
	assert.match(plugin, /defer_scripts[\s\S]*'avenra-halo-v2-hypercore-ecu'/);
	assert.match(plugin, /serve_service_worker[\s\S]*assets\/js\/hypercore-ecu\.js\?ver=/);
	assert.ok(
		plugin.indexOf("wp_enqueue_script( 'avenra-halo-v2-hypercore-ecu'")
			< plugin.indexOf("wp_enqueue_script( 'avenra-halo-v2-app'"),
		'the ECU transport must be registered before app.js'
	);
});

test('owns independent HyperCore ECU and BMS managers behind explicit rider actions', () => {
	assert.match(app, /bms:\s*\{\s*status: 'unavailable',[^\n]+telemetry: null \}/);
	assert.match(app, /ecu:\s*\{\s*status: 'unavailable',[^\n]+telemetry: null \}/);
	assert.match(app, /new window\.AvenraHaloBmsBluetoothClass\(\{[\s\S]*?onStatus:[\s\S]*?onTelemetry:/);
	assert.match(app, /new window\.AvenraHaloHyperCoreEcuClass\(\{[\s\S]*?onStatus:[\s\S]*?onTelemetry:/);
	assert.match(app, /case 'connect-bms': await this\.connectBms\(target\)/);
	assert.match(app, /case 'disconnect-bms': await this\.disconnectBms\(target\)/);
	assert.match(app, /case 'connect-ecu': await this\.connectEcu\(target\)/);
	assert.match(app, /case 'disconnect-ecu': await this\.disconnectEcu\(target\)/);
	assert.equal((app.match(/this\.bms\.connect\(\)/g) || []).length, 1, 'only the BMS button action may open its chooser');
	assert.equal((app.match(/this\.ecu\.connect\(/g) || []).length, 1, 'only the ECU button action may open its chooser');

	const bootstrap = between(app, 'async bootstrap(', 'async acceptBootstrap(');
	assert.doesNotMatch(bootstrap, /\.(?:bms|ecu)\.connect\(/);
	const connectBms = between(app, 'async connectBms(', 'async disconnectBms(');
	const connectEcu = between(app, 'async connectEcu(', 'async disconnectEcu(');
	assert.match(connectBms, /safely parked/);
	assert.match(connectEcu, /safely parked/);
	assert.doesNotMatch(connectBms, /this\.ecu\.connect\(/, 'one chooser must not silently open the other');
	assert.doesNotMatch(connectEcu, /this\.bms\.connect\(/, 'each chooser needs its own rider activation');
});

test('disconnects both Bluetooth identities at every privacy and vehicle boundary', () => {
	const bindEvents = between(app, 'bindEvents() {', 'bindDialogBackdrop(dialog) {');
	const pagehide = between(bindEvents, "window.addEventListener('pagehide'", "window.addEventListener('pageshow'");
	assert.match(pagehide, /this\.bms\?\.disconnect\?\.\('page-hidden'/);
	assert.match(pagehide, /this\.ecu\?\.disconnect\?\.\('page-hidden'/);
	const visibility = between(bindEvents, "document.addEventListener('visibilitychange'", 'this.bindDialogBackdrop');
	assert.match(visibility, /this\.bms\?\.disconnect\?\.\('document-hidden'/);
	assert.match(visibility, /this\.ecu\?\.disconnect\?\.\('document-hidden'/);

	const acceptBootstrap = between(app, 'async acceptBootstrap(', 'resolveLifecycle(boot) {');
	assert.match(acceptBootstrap, /this\.bms\?\.disconnect\?\.\('vehicle-changed'/);
	assert.match(acceptBootstrap, /this\.ecu\?\.disconnect\?\.\('vehicle-changed'/);
	assert.match(acceptBootstrap, /this\.state\.bmsVehicleId = null/);
	assert.match(acceptBootstrap, /this\.state\.ecuVehicleId = null/);

	const reset = between(app, 'async resetIdentityBoundState(', 'async resetDeviceSession(');
	const bmsShutdownAt = reset.indexOf('const bmsShutdown');
	const ecuShutdownAt = reset.indexOf('const ecuShutdown');
	const cleanupAwaitAt = reset.indexOf('await Promise.all');
	assert.ok(bmsShutdownAt >= 0 && bmsShutdownAt < cleanupAwaitAt, 'BMS shutdown starts before the first cleanup wait');
	assert.ok(ecuShutdownAt >= 0 && ecuShutdownAt < cleanupAwaitAt, 'ECU shutdown starts before the first cleanup wait');
	assert.match(reset.slice(cleanupAwaitAt, cleanupAwaitAt + 180), /ecuShutdown/);
	assert.match(reset.slice(cleanupAwaitAt, cleanupAwaitAt + 180), /bmsShutdown/);
});

test('presents one customer-facing HyperCore page containing both components', () => {
	assert.match(template, /data-vehicle-view="battery">HyperCore<\/button>/);
	assert.equal((template.match(/data-vehicle-view="battery"/g) || []).length, 1);
	assert.doesNotMatch(template, /data-vehicle-view="(?:controller|ecu|powertrain)"/i, 'there must not be a second controller page');

	const renderHyperCore = between(app, 'renderVehicleBattery(container) {', 'renderVehicleBuild(container) {');
	assert.match(renderHyperCore, /data-hypercore-summary/);
	assert.match(renderHyperCore, /data-ecu-card/);
	assert.match(renderHyperCore, /data-bms-card/);
	assert.match(app, /HyperCore ECU/);
	assert.match(app, /HyperCore BMS/);
	assert.match(app, /data-action="connect-ecu"/);
	assert.match(app, /data-action="connect-bms"/);

	const customerSurface = `${template}\n${app}`;
	assert.doesNotMatch(customerSurface, /\bFar\s*Driver\b|\bFardriver\b|\bANT BMS\b/i);
});

test('keeps ECU readings out of GPS, ride-engine and Emergency Assist ownership', () => {
	const updateEcu = between(app, 'updateEcuTelemetry(telemetry) {', 'updateBmsStatus(status) {');
	assert.match(updateEcu, /this\.state\.ecu\s*=\s*Object\.assign/);
	assert.doesNotMatch(updateEcu, /this\.state\.(?:bms|lastTelemetry|currentLocation|crashPayload|emergencyIncident)\s*=/);
	assert.doesNotMatch(updateEcu, /updateRideTelemetry|updateRidePosition|captureRideMemoryTelemetry|acceptPosition|currentSpeed/);

	const vehicleBattery = between(app, 'vehicleBattery() {', 'syncRideSetup() {');
	assert.match(vehicleBattery, /this\.state\.bms\?\.live/);
	assert.doesNotMatch(vehicleBattery, /this\.state\.ecu/, 'battery truth must remain owned by HyperCore BMS');

	const rideTelemetry = between(app, 'updateRideTelemetry(payload) {', 'updateRidePosition(payload) {');
	assert.doesNotMatch(rideTelemetry, /this\.state\.ecu/, 'GPS ride telemetry must not silently switch to the ECU');
	const crashPayload = between(app, 'async buildCrashAlertPayload(', 'postIncidentCandidate(');
	assert.doesNotMatch(crashPayload, /this\.state\.ecu/, 'Emergency Assist must keep its independently measured ride telemetry');
});

test('guards Ride start while either chooser is active without dropping live links', () => {
	const syncRideSetup = between(app, 'syncRideSetup() {', 'startingChargeLabel() {');
	assert.match(syncRideSetup, /this\.state\.bms\?\.status/);
	assert.match(syncRideSetup, /this\.state\.ecu\?\.status/);
	assert.match(syncRideSetup, /'scanning', 'connecting'/);

	const beginRide = between(app, 'async beginRide(', 'bindHoldControl(');
	assert.match(beginRide, /this\.state\.bms\?\.status/);
	assert.match(beginRide, /this\.state\.ecu\?\.status/);
	assert.match(beginRide, /'scanning', 'connecting'/);
	assert.doesNotMatch(beginRide, /(?:this\.)?(?:bms|ecu)\?*\.disconnect/);
	assert.match(beginRide, /this\.state\.bmsRideWasLive\s*=\s*Boolean\(this\.state\.bms\?\.live\)/);
	assert.match(beginRide, /this\.state\.ecuRideWasLive\s*=\s*Boolean\(this\.state\.ecu\?\.live\)/);

	const hideRide = between(app, 'hideActiveRide() {', 'showRideSummary(ride) {');
	assert.doesNotMatch(hideRide, /(?:this\.)?(?:bms|ecu)\?*\.disconnect/);
	assert.match(hideRide, /this\.state\.bmsRideWasLive = false/);
	assert.match(hideRide, /this\.state\.ecuRideWasLive = false/);
});
