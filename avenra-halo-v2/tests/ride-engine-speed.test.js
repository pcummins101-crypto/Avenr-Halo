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
const appSource = fs.readFileSync(
	path.join(__dirname, '..', 'assets', 'js', 'app.js'),
	'utf8'
);
const nativeRideSource = fs.readFileSync(
	path.join(__dirname, '..', 'includes', 'class-halo-v2-native-ride.php'),
	'utf8'
);

function loadRideEngine() {
	const document = {
		hidden: false,
		visibilityState: 'visible',
		addEventListener() {},
		removeEventListener() {}
	};
	const window = {
		crypto: { randomUUID: () => 'speed-calibration-test' },
		addEventListener() {},
		removeEventListener() {},
		setInterval,
		clearInterval,
		setTimeout,
		clearTimeout
	};
	const context = {
		window,
		document,
		navigator: { onLine: true },
		EventTarget,
		CustomEvent,
		Date,
		Math,
		Promise,
		setInterval,
		clearInterval,
		setTimeout,
		clearTimeout
	};
	vm.runInNewContext(source, context, { filename: 'ride-engine.js' });
	return window;
}

test('applies the fixed +15% GPS calibration once before every speed consumer', () => {
	const globals = loadRideEngine();
	const RideEngine = globals.AvenraHaloRideEngineClass;
	const engine = new RideEngine({ persistEveryPoints: 100 });
	engine.state = 'riding';
	engine.session = {
		id: 'ride-speed-calibration',
		startedAt: '2026-08-26T08:00:00.000Z',
		points: [],
		context: {}
	};

	engine.acceptPosition({
		timestamp: Date.parse('2026-08-26T08:00:01.000Z'),
		coords: {
			latitude: 53.7101,
			longitude: -1.3602,
			accuracy: 5,
			altitude: null,
			heading: 90,
			speed: 20
		}
	});

	const rawMph = 20 * 2.2369362921;
	const expected = Math.round(rawMph * 1.15);
	assert.equal(expected, 51);
	assert.equal(engine.currentSpeed, expected);
	assert.equal(engine.maxSpeed, expected);
	assert.equal(engine.session.points[0].speedMph, expected);

	let telemetry = null;
	engine.addEventListener('telemetry', (event) => { telemetry = event.detail; });
	engine.publishTelemetry();
	assert.equal(telemetry.speedMph, expected);
	assert.equal(telemetry.topSpeedMph, expected);
	assert.equal(globals.AvenraHaloGpsSpeed.factor, 1.15);
	assert.equal(Math.round(globals.AvenraHaloGpsSpeed.metresPerSecondToMph(20)), expected);
	assert.equal(globals.AvenraHaloGpsSpeed.rawMphToCalibratedMph(40), 46);
	assert.match(source, /GPS_SPEED_CALIBRATION_FACTOR\s*=\s*1\.15/);
	assert.match(source, /currentSpeed\s*=\s*Math\.max\(0, Math\.round\(calibrateGpsMph\(rawMph\)\)\)/);
	assert.match(appSource, /const gpsMetresPerSecondToMph\s*=\s*\(value\)\s*=>/);
	assert.match(appSource, /return metresPerSecond\s*\*\s*2\.2369362921\s*\*\s*1\.15/);
	assert.equal((appSource.match(/speedMph:\s*gpsMetresPerSecondToMph\(/g) || []).length, 3);
	assert.doesNotMatch(appSource, /Number\((?:position\.)?coords\.speed\)\s*\*\s*2\.2369362921/);
	assert.match(nativeRideSource, /GPS_SPEED_CALIBRATION_FACTOR\s*=\s*1\.15/);
	assert.match(nativeRideSource, /\$speed_mps\s*\*\s*self::METRES_PER_SECOND_TO_MPH\s*\*\s*self::GPS_SPEED_CALIBRATION_FACTOR/);
});

test('uses calibrated speed for 0-60 timing while distance stays coordinate-based', () => {
	const RideEngine = loadRideEngine().AvenraHaloRideEngineClass;
	const engine = new RideEngine({ persistEveryPoints: 100 });
	const startedAt = Date.parse('2026-08-26T08:00:00.000Z');
	engine.state = 'riding';
	engine.session = {
		id: 'ride-calibrated-acceleration',
		startedAt: new Date(startedAt).toISOString(),
		points: [],
		context: {}
	};

	engine.acceptPosition({
		timestamp: startedAt,
		coords: { latitude: 51, longitude: -1, accuracy: 5, altitude: null, heading: 90, speed: 0 }
	});
	engine.acceptPosition({
		timestamp: startedAt + 1000,
		coords: { latitude: 51.0001, longitude: -1, accuracy: 5, altitude: null, heading: 90, speed: 10 }
	});
	engine.acceptPosition({
		timestamp: startedAt + 5000,
		coords: { latitude: 51.0002, longitude: -1, accuracy: 5, altitude: null, heading: 90, speed: 24 }
	});

	assert.equal(engine.currentSpeed, 62);
	assert.equal(engine.maxSpeed, 62);
	assert.equal(engine.bestZeroToSixty, 4);
	assert.ok(engine.distanceMiles > 0 && engine.distanceMiles < 0.02);
});

test('calibrates an implied GPS speed without inflating route distance', () => {
	const RideEngine = loadRideEngine().AvenraHaloRideEngineClass;
	const engine = new RideEngine({ persistEveryPoints: 100 });
	engine.state = 'riding';
	engine.session = {
		id: 'ride-implied-speed-calibration',
		startedAt: '2026-08-26T08:00:00.000Z',
		points: [],
		context: {}
	};

	engine.acceptPosition({
		timestamp: Date.parse('2026-08-26T08:00:00.000Z'),
		coords: { latitude: 0, longitude: 0, accuracy: 5, altitude: null, heading: 90, speed: null }
	});
	engine.acceptPosition({
		timestamp: Date.parse('2026-08-26T08:01:00.000Z'),
		coords: { latitude: 0, longitude: 0.0072, accuracy: 5, altitude: null, heading: 90, speed: null }
	});

	const earthMiles = 3958.7613;
	const deltaRadians = 0.0072 * Math.PI / 180;
	const rawDistanceMiles = earthMiles * deltaRadians;
	const rawImpliedMph = rawDistanceMiles * 60;
	assert.ok(Math.abs(engine.distanceMiles - rawDistanceMiles) < 1e-9);
	assert.equal(engine.currentSpeed, Math.round(rawImpliedMph * 1.15));
	assert.notEqual(engine.distanceMiles, rawDistanceMiles * 1.15);
});

test('keeps GPS plausibility rejection on the uncalibrated sensor speed', () => {
	const RideEngine = loadRideEngine().AvenraHaloRideEngineClass;
	const engine = new RideEngine({ persistEveryPoints: 100 });
	engine.state = 'riding';
	engine.session = {
		id: 'ride-raw-outlier-check',
		startedAt: '2026-08-26T08:00:00.000Z',
		points: [],
		context: {}
	};

	engine.acceptPosition({
		timestamp: Date.parse('2026-08-26T08:00:00.000Z'),
		coords: { latitude: 0, longitude: 0, accuracy: 5, altitude: null, heading: 90, speed: 0 }
	});
	engine.acceptPosition({
		timestamp: Date.parse('2026-08-26T08:00:01.000Z'),
		coords: { latitude: 0, longitude: 0.02, accuracy: 5, altitude: null, heading: 90, speed: 56 }
	});

	assert.equal(engine.session.points.length, 1);
	assert.equal(engine.distanceMiles, 0);
});
