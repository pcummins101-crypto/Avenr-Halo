'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
	KILOWATTS_TO_BHP,
	estimateRange,
	efficiencyWhPerMile,
	bhpFromKilowatts,
	bhpPerTonne,
	powerRecord
} = require('../assets/js/performance.js');

test('scales the published full-charge range by state of charge', () => {
	assert.deepEqual(estimateRange({ soc: 100, fullRangeMiles: 206 }), { miles: 206, basis: 'charge' });
	assert.deepEqual(estimateRange({ soc: 86, fullRangeMiles: 206 }), { miles: 177.2, basis: 'charge' });
	assert.deepEqual(estimateRange({ soc: 50, fullRangeMiles: 206 }), { miles: 103, basis: 'charge' });
	assert.deepEqual(estimateRange({ soc: 100, fullRangeMiles: 103 }), { miles: 103, basis: 'charge' });
	assert.deepEqual(estimateRange({ soc: 25, fullRangeMiles: 103 }), { miles: 25.8, basis: 'charge' });
	assert.deepEqual(estimateRange({ soc: 0, fullRangeMiles: 206 }), { miles: 0, basis: 'charge' });
});

test('prefers the pack’s own remaining energy over its reported charge', () => {
	const estimate = estimateRange({ remainingWh: 2400, fullCapacityWh: 4800, fullRangeMiles: 206, soc: 90 });
	assert.deepEqual(estimate, { miles: 103, basis: 'pack' });
});

test('prefers measured consumption over every published figure', () => {
	const estimate = estimateRange({ remainingWh: 2400, fullCapacityWh: 4800, fullRangeMiles: 206, soc: 90, efficiencyWhPerMile: 30 });
	assert.deepEqual(estimate, { miles: 80, basis: 'measured' });
});

test('falls back to the stored vehicle range, then to nothing at all', () => {
	assert.deepEqual(estimateRange({ vehicleRangeMiles: 44.4 }), { miles: 44.4, basis: 'vehicle' });
	assert.deepEqual(estimateRange({}), { miles: null, basis: 'vehicle' });
	assert.deepEqual(estimateRange({ soc: 80 }), { miles: null, basis: 'vehicle' }, 'charge alone cannot give a range without a model figure');
});

test('never reports more range than a full charge', () => {
	const estimate = estimateRange({ remainingWh: 5200, fullCapacityWh: 4800, fullRangeMiles: 206 });
	assert.equal(estimate.miles, 206);
	assert.equal(estimateRange({ soc: 120, fullRangeMiles: 206 }).miles, 206);
});

test('holds back consumption until the distance makes it meaningful', () => {
	assert.equal(efficiencyWhPerMile(300, 10), 30);
	assert.equal(efficiencyWhPerMile(45, 0.5, 1), null);
	assert.equal(efficiencyWhPerMile(0, 10), null);
	assert.equal(efficiencyWhPerMile(300, 0), null);
	assert.equal(efficiencyWhPerMile(null, 10), null);
});

test('converts kilowatts to bhp and to bhp per tonne at the 170 kg kerb weight', () => {
	assert.equal(KILOWATTS_TO_BHP, 1.34102209);
	assert.equal(bhpFromKilowatts(10), 13.4);
	assert.equal(bhpPerTonne(51.5, 170), 302.9);
	assert.deepEqual(powerRecord(38.4, 170), { kilowatts: 38.4, bhp: 51.5, bhpPerTonne: 302.9 });
	assert.deepEqual(powerRecord(0, 170), { kilowatts: null, bhp: null, bhpPerTonne: null });
	assert.deepEqual(powerRecord(null, 170), { kilowatts: null, bhp: null, bhpPerTonne: null });
	assert.equal(powerRecord(20, 0).bhpPerTonne, null, 'a zero weight can never produce a power-to-weight figure');
});

test('the app routes its derived figures through this module', () => {
	const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'app.js'), 'utf8');
	const plugin = fs.readFileSync(path.join(__dirname, '..', 'includes', 'class-halo-v2-plugin.php'), 'utf8');
	assert.match(app, /haloPerformance\.estimateRange\(/);
	assert.match(app, /haloPerformance\.powerRecord\(/);
	assert.match(app, /haloPerformance\.efficiencyWhPerMile\(/);
	assert.doesNotMatch(app, /const performance =/, 'the helper must never shadow the browser performance global');
	assert.match(plugin, /avenra-halo-v2-performance/);
	assert.match(plugin, /assets\/js\/performance\.js\?ver=/, 'the module is precached with the other Halo scripts');
	assert.match(plugin, /avenra_halo_v2_full_range_miles_evo', 206/);
	assert.match(plugin, /avenra_halo_v2_full_range_miles_one', 103/);
	assert.match(plugin, /avenra_halo_v2_kerb_weight_kg', 170/);
});

test('the app measures ride energy from the pack rather than trusting a sign convention', () => {
	const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'app.js'), 'utf8');
	const between = (start, end) => {
		const from = app.indexOf(start);
		assert.notEqual(from, -1, `missing ${start}`);
		const to = app.indexOf(end, from + start.length);
		assert.notEqual(to, -1, `missing ${end}`);
		return app.slice(from, to);
	};
	const track = between('trackRideEnergy(telemetry) {', 'rideEnergySummary() {');
	assert.match(track, /if \(!this\.state\.activeRide/, 'energy is only accounted for during a ride');
	assert.match(track, /capacityUsedWh \+= -delta/, 'the pack’s own remaining energy is the primary measure');
	assert.match(track, /dischargeSignConfirmed = true/, 'the discharge direction is confirmed against the pack, not assumed');
	assert.match(track, /Math\.min\(30, \(at - energy\.lastAt\) \/ 1000\)/, 'a dropped link cannot invent energy');
	assert.match(track, /speedMph >= 3/, 'peak power is only recorded while the motorcycle is moving');

	const summary = between('rideEnergySummary() {', 'observedEfficiencyWhPerMile() {');
	assert.match(summary, /energy\.capacityUsedWh > 0 \? energy\.capacityUsedWh : energy\.integratedUsedWh/, 'power integration is only a fallback');

	const payload = between('rideEnergyPayload() {', 'isRetryableRideSave(error) {');
	assert.match(payload, /if \(!energy\) return \{\};/, 'a ride without the BMS records no measurements at all');
	assert.match(payload, /peak_power_kw: energy\.peakPowerKw/);

	assert.match(app, /\(battery\.stateOfHealth \?\? 0\) > 0/, 'an unreported zero is never shown as a reading');
	assert.match(app, /hypercoreModuleName\(module\)/);
	assert.match(app, /'Avenrà BMS'/);
});
