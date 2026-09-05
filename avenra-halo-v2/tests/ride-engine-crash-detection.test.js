'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
	path.join(__dirname, '..', 'assets', 'js', 'ride-engine.js'),
	'utf8'
);

const G = 9.80665;
const START = Date.parse('2026-09-01T09:00:00.000Z');

function loadRideEngine(clock) {
	class FakeDate extends Date {
		static now() { return clock.now; }
	}
	const document = {
		hidden: false,
		visibilityState: 'visible',
		addEventListener() {},
		removeEventListener() {}
	};
	const window = {
		crypto: { randomUUID: () => 'crash-detection-test' },
		addEventListener() {},
		removeEventListener() {},
		setInterval: () => 1,
		clearInterval() {},
		setTimeout,
		clearTimeout
	};
	const context = {
		window,
		document,
		navigator: { onLine: true },
		EventTarget,
		CustomEvent,
		Date: FakeDate,
		Math,
		Promise,
		setInterval: () => 1,
		clearInterval() {},
		setTimeout,
		clearTimeout
	};
	vm.runInNewContext(source, context, { filename: 'ride-engine.js' });
	return window;
}

function ridingEngine(clock, options = {}) {
	const RideEngine = loadRideEngine(clock).AvenraHaloRideEngineClass;
	const engine = new RideEngine({ persistEveryPoints: 1000, ...options });
	engine.state = 'riding';
	engine.session = {
		id: 'ride-crash-detection',
		startedAt: new Date(START - 60000).toISOString(),
		points: [],
		context: {}
	};
	const events = [];
	['crashcandidate', 'impactdiscarded', 'crashcancelled'].forEach((type) => {
		engine.addEventListener(type, (event) => events.push({ type, detail: event.detail }));
	});
	return { engine, events };
}

function gpsFix(engine, clock, at, speedMetresPerSecond, offset = 0) {
	clock.now = at;
	engine.acceptPosition({
		timestamp: at,
		coords: {
			latitude: 53.7101 + offset,
			longitude: -1.3602,
			accuracy: 6,
			altitude: null,
			heading: 90,
			speed: speedMetresPerSecond
		}
	});
}

function motionSample(engine, clock, at, dynamicG, includingGravityOnly = false) {
	clock.now = at;
	const vector = { x: dynamicG * G, y: 0, z: 0 };
	engine.handleMotion(includingGravityOnly
		? { acceleration: null, accelerationIncludingGravity: { x: 0, y: 0, z: dynamicG * G }, interval: 16 }
		: { acceleration: vector, accelerationIncludingGravity: { x: vector.x, y: 0, z: G }, interval: 16 });
}

function impactBurst(engine, clock, at, dynamicG, samples = 5, stepMs = 20) {
	for (let index = 0; index < samples; index += 1) {
		motionSample(engine, clock, at + index * stepMs, dynamicG);
	}
	return at + (samples - 1) * stepMs;
}

const THIRTY_MPH = 13.4;
const candidates = (events) => events.filter((event) => event.type === 'crashcandidate');

test('a single high-g sample while riding is ignored', () => {
	const clock = { now: START };
	const { engine, events } = ridingEngine(clock);
	gpsFix(engine, clock, START, THIRTY_MPH);
	assert.ok(engine.currentSpeed >= 15);

	motionSample(engine, clock, START + 500, 6);
	assert.equal(engine.pendingImpact, null, 'one spike must not open an impact assessment');
	gpsFix(engine, clock, START + 1500, 0);
	gpsFix(engine, clock, START + 2500, 0);
	assert.equal(candidates(events).length, 0);
	assert.equal(engine.crashPhase, 'idle');
});

test('a sustained bump followed by ordinary braking to a stop is not a crash', () => {
	const clock = { now: START };
	const { engine, events } = ridingEngine(clock);
	gpsFix(engine, clock, START, 8.94); // 20 mph raw, 23 mph calibrated
	impactBurst(engine, clock, START + 500, 4.5);
	assert.ok(engine.pendingImpact, 'a sustained 4.5 g bump is assessed');

	gpsFix(engine, clock, START + 1500, 6.7);
	gpsFix(engine, clock, START + 2500, 4.0);
	gpsFix(engine, clock, START + 3500, 1.5);
	gpsFix(engine, clock, START + 4500, 0);
	gpsFix(engine, clock, START + 5500, 0);
	assert.equal(candidates(events).length, 0, 'a gradual stop after a bump must not start the countdown');

	// Let the assessment window lapse without any further evidence.
	clock.now = START + 14000;
	engine.publishTelemetry();
	assert.equal(engine.pendingImpact, null);
	assert.equal(engine.crashPhase, 'idle');
	const discarded = events.filter((event) => event.type === 'impactdiscarded');
	assert.equal(discarded.length, 1);
	assert.equal(discarded[0].detail.reason, 'gradual_stop');
});

test('a sustained impact followed by an abrupt stop starts the 20-second countdown', () => {
	const clock = { now: START };
	const { engine, events } = ridingEngine(clock);
	gpsFix(engine, clock, START, THIRTY_MPH);
	impactBurst(engine, clock, START + 500, 5.2);
	assert.ok(engine.pendingImpact);
	assert.equal(engine.crashPhase, 'idle', 'nothing is shown to the rider before confirmation');

	gpsFix(engine, clock, START + 1500, 0);
	assert.equal(candidates(events).length, 0, 'one stopped fix is not yet a confirmation');
	gpsFix(engine, clock, START + 2500, 0);

	const raised = candidates(events);
	assert.equal(raised.length, 1);
	assert.equal(engine.crashPhase, 'countdown');
	assert.equal(raised[0].detail.seconds, 20);
	assert.equal(raised[0].detail.confirmation, 'abrupt_stop');
	assert.equal(raised[0].detail.impactSamples >= 3, true);
	assert.equal(raised[0].detail.peakG, 5.2);
	assert.ok(raised[0].detail.impactSpeedMph >= 30);
	assert.equal(raised[0].detail.movingAtImpact, true);
	assert.equal(engine.pendingImpact, null);
});

test('an impact is discarded when the rider keeps riding', () => {
	const clock = { now: START };
	const { engine, events } = ridingEngine(clock);
	gpsFix(engine, clock, START, THIRTY_MPH);
	impactBurst(engine, clock, START + 500, 5);
	assert.ok(engine.pendingImpact);

	gpsFix(engine, clock, START + 1500, THIRTY_MPH, 0.0001);
	gpsFix(engine, clock, START + 2500, THIRTY_MPH, 0.0002);
	gpsFix(engine, clock, START + 3500, THIRTY_MPH, 0.0003);
	gpsFix(engine, clock, START + 5000, THIRTY_MPH, 0.0004);
	assert.equal(engine.pendingImpact, null);
	assert.equal(candidates(events).length, 0);
	const discarded = events.filter((event) => event.type === 'impactdiscarded');
	assert.equal(discarded[0].detail.reason, 'rider_kept_moving');

	// A later stop at a junction must not be paired with the earlier bump.
	gpsFix(engine, clock, START + 6000, 0, 0.0004);
	gpsFix(engine, clock, START + 7000, 0, 0.0004);
	assert.equal(candidates(events).length, 0);
});

test('gravity-inclusive readings are not counted as impact force', () => {
	const clock = { now: START };
	const { engine } = ridingEngine(clock);
	gpsFix(engine, clock, START, THIRTY_MPH);
	// 2.5 g including gravity is only 1.5 g of actual movement.
	for (let index = 0; index < 6; index += 1) {
		motionSample(engine, clock, START + 500 + index * 20, 2.5, true);
	}
	assert.equal(engine.pendingImpact, null);
	assert.equal(engine.lastAcceleration.includesGravity, true);
	assert.equal(engine.lastAcceleration.dynamicG, 1.5);
});

test('a stale GPS speed cannot arm crash detection', () => {
	const clock = { now: START };
	const { engine } = ridingEngine(clock);
	gpsFix(engine, clock, START, THIRTY_MPH);
	assert.ok(engine.currentSpeed >= 15);

	// No fix for 30 seconds: the recorded speed no longer describes the bike.
	impactBurst(engine, clock, START + 30000, 6);
	assert.equal(engine.pendingImpact, null);
});

test('a rider cancellation suppresses further detections for a cooling-off period', () => {
	const clock = { now: START };
	const { engine, events } = ridingEngine(clock);
	gpsFix(engine, clock, START, THIRTY_MPH);
	impactBurst(engine, clock, START + 500, 5);
	gpsFix(engine, clock, START + 1500, 0);
	gpsFix(engine, clock, START + 2500, 0);
	assert.equal(engine.crashPhase, 'countdown');

	clock.now = START + 4000;
	assert.equal(engine.cancelCrash('rider'), true);
	assert.equal(engine.crashPhase, 'idle');
	assert.ok(engine.crashSuppressedUntil > clock.now);

	gpsFix(engine, clock, START + 10000, THIRTY_MPH, 0.001);
	impactBurst(engine, clock, START + 10500, 5);
	assert.equal(engine.pendingImpact, null, 'the same rough stretch must not ask again straight away');
	gpsFix(engine, clock, START + 11500, 0, 0.001);
	gpsFix(engine, clock, START + 12500, 0, 0.001);
	assert.equal(candidates(events).length, 1);

	// Once the cooling-off period has passed detection is armed again.
	gpsFix(engine, clock, START + 70000, THIRTY_MPH, 0.002);
	impactBurst(engine, clock, START + 70500, 5);
	assert.ok(engine.pendingImpact);
});

test('a severe impact with total GPS loss still reaches the rider after the assessment window', () => {
	const clock = { now: START };
	const { engine, events } = ridingEngine(clock);
	gpsFix(engine, clock, START, THIRTY_MPH);
	impactBurst(engine, clock, START + 500, 9);
	assert.ok(engine.pendingImpact?.severe);

	clock.now = START + 6000;
	engine.publishTelemetry();
	assert.equal(candidates(events).length, 0, 'the window has not lapsed yet');

	clock.now = START + 13000;
	engine.publishTelemetry();
	const raised = candidates(events);
	assert.equal(raised.length, 1);
	assert.equal(raised[0].detail.confirmation, 'severe_impact_gps_lost');
	assert.equal(engine.crashPhase, 'countdown');
});

test('a moderate impact with no GPS confirmation is discarded quietly', () => {
	const clock = { now: START };
	const { engine, events } = ridingEngine(clock);
	gpsFix(engine, clock, START, THIRTY_MPH);
	impactBurst(engine, clock, START + 500, 5);
	clock.now = START + 13000;
	engine.publishTelemetry();
	assert.equal(candidates(events).length, 0);
	assert.equal(engine.pendingImpact, null);
});

test('the crash record keeps the impact speed even though the bike has stopped', () => {
	const clock = { now: START };
	const { engine } = ridingEngine(clock);
	gpsFix(engine, clock, START, THIRTY_MPH);
	impactBurst(engine, clock, START + 500, 5);
	gpsFix(engine, clock, START + 1500, 0);
	gpsFix(engine, clock, START + 2500, 0);
	const snapshot = engine.crashSnapshot(engine.crashImpact);
	assert.equal(engine.currentSpeed, 0);
	assert.ok(snapshot.impactSpeedMph >= 30);
	assert.equal(snapshot.movingAtImpact, true);
	assert.equal(snapshot.confirmation, 'abrupt_stop');
	assert.equal(snapshot.countdown_seconds, 20);
});

test('detection thresholds are no longer a single 2.5 g reading', () => {
	assert.doesNotMatch(source, /crashGThreshold:\s*2\.5/);
	assert.doesNotMatch(source, /gForce >= this\.options\.crashGThreshold \* 1\.8\) this\.raiseCrashCandidate/);
	assert.match(source, /crashImpactMinSamples:\s*3/);
	assert.match(source, /crashStopConfirmFixes:\s*2/);
	assert.match(source, /crashRiderCancelCooldownMs:\s*60000/);
});
