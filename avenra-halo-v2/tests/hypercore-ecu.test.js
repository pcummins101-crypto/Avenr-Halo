'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../assets/js/hypercore-ecu.js');
const {
	HyperCoreEcuBluetooth,
	HyperCoreEcuDecoder,
	SERVICE_UUID,
	CHARACTERISTIC_UUID,
	POLL_REGISTERS,
	PAGE_REGISTER_MAP,
	crc16HyperCore,
	faultMessages,
	buildReadPacket,
	frameValidation,
	validateFrame,
	parseFrame
} = protocol;

class FakeEventTarget {
	constructor() { this.listeners = new Map(); }
	addEventListener(type, listener) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type).add(listener);
	}
	removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
	emit(type, event) { for (const listener of this.listeners.get(type) || []) listener(event || { type, target: this }); }
	listenerCount(type) { return this.listeners.get(type)?.size || 0; }
}

function writeU16Le(bytes, position, value) {
	const unsigned = Number(value) & 0xffff;
	bytes[position] = unsigned & 0xff;
	bytes[position + 1] = (unsigned >>> 8) & 0xff;
}

function makeModernFrame(page, configure) {
	const frame = new Uint8Array(16);
	frame[0] = 0xaa;
	frame[1] = 0x80 | (Number(page) & 0x7f);
	if (typeof configure === 'function') configure(frame);
	const crc = crc16HyperCore(frame.subarray(0, 14));
	frame[14] = crc & 0xff;
	frame[15] = (crc >>> 8) & 0xff;
	return frame;
}

function makeLegacyFrame(page, configure) {
	const frame = new Uint8Array(16);
	frame[0] = 0xaa;
	frame[1] = Number(page) & 0x7f;
	if (typeof configure === 'function') configure(frame);
	let checksum = 0;
	for (let index = 0; index < 14; index += 1) checksum = (checksum + frame[index]) & 0xffff;
	frame[14] = (checksum >>> 8) & 0xff;
	frame[15] = checksum & 0xff;
	return frame;
}

function fakeTimers() {
	let nextId = 1;
	const intervals = new Map();
	const timeouts = new Map();
	return {
		intervals,
		timeouts,
		setInterval(fn, milliseconds) { const id = nextId++; intervals.set(id, { fn, milliseconds }); return id; },
		clearInterval(id) { intervals.delete(id); },
		setTimeout(fn, milliseconds) { const id = nextId++; timeouts.set(id, { fn, milliseconds }); return id; },
		clearTimeout(id) { timeouts.delete(id); },
		runIntervals() { for (const entry of [...intervals.values()]) entry.fn(); },
		runTimeouts() { const entries = [...timeouts.values()]; timeouts.clear(); for (const entry of entries) entry.fn(); }
	};
}

class FakeCharacteristic extends FakeEventTarget {
	constructor(options) {
		super();
		this.options = Object.assign({ failWithoutResponse: false, failWrite: false }, options || {});
		this.started = 0;
		this.writes = [];
	}
	async startNotifications() { this.started += 1; return this; }
	async writeValueWithoutResponse(value) {
		if (this.options.failWithoutResponse) throw new Error('without-response unavailable');
		this.writes.push({ method: 'without-response', value: Uint8Array.from(value) });
	}
	async writeValue(value) {
		if (this.options.failWrite) throw new Error('legacy write unavailable');
		this.writes.push({ method: 'write', value: Uint8Array.from(value) });
	}
	async writeValueWithResponse(value) {
		this.writes.push({ method: 'with-response', value: Uint8Array.from(value) });
	}
	notify(value) {
		const bytes = value instanceof Uint8Array ? value : Uint8Array.from(value);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		this.emit('characteristicvaluechanged', { type: 'characteristicvaluechanged', target: { value: view } });
	}
}


function makeBluetooth(characteristic, options) {
	const settings = Object.assign({ characteristicError: null }, options || {});
	const calls = [];
	const channel = characteristic || new FakeCharacteristic();
	const device = new FakeEventTarget();
	device.name = 'HyperCore ECU';
	const server = {
		async getPrimaryService(uuid) {
			calls.push(['service', uuid]);
			return {
				async getCharacteristic(characteristicUuid) {
					calls.push(['characteristic', characteristicUuid]);
					if (settings.characteristicError) throw settings.characteristicError;
					return channel;
				}
			};
		}
	};
	device.gatt = {
		connected: false,
		async connect() { calls.push(['connect']); this.connected = true; return server; },
		disconnect() {
			if (!this.connected) return;
			this.connected = false;
			device.emit('gattserverdisconnected', { type: 'gattserverdisconnected', target: device });
		}
	};
	const bluetooth = {
		async requestDevice(request) { calls.push(['request', request]); return device; }
	};
	return { bluetooth, device, characteristic: channel, calls };
}

function makeManager(runtime, overrides) {
	const timers = fakeTimers();
	let now = 1_700_000_000_000;
	const statuses = [];
	const telemetry = [];
	const frames = [];
	const manager = new HyperCoreEcuBluetooth(Object.assign({
		bluetooth: runtime.bluetooth,
		secureContext: true,
		setInterval: timers.setInterval,
		clearInterval: timers.clearInterval,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
		now: () => now,
		onStatus: (status) => statuses.push(status),
		onTelemetry: (reading) => telemetry.push(reading),
		onFrame: (frame) => frames.push(frame)
	}, overrides || {}));
	return { manager, timers, statuses, telemetry, frames, setNow(value) { now = value; } };
}

test('uses the exact HyperCore ECU UUIDs, poll list, CRC seed and read packet', () => {
	assert.equal(SERVICE_UUID, '0000ffe0-0000-1000-8000-00805f9b34fb');
	assert.equal(CHARACTERISTIC_UUID, '0000ffec-0000-1000-8000-00805f9b34fb');
	assert.deepEqual(POLL_REGISTERS, [0xe2, 0xe8, 0xee, 0xf4, 0xfa, 0xd6, 0x24, 0x2a, 0x30, 0x18, 0x69, 0x7c, 0xd0]);
	assert.equal(PAGE_REGISTER_MAP.length, 55);
	assert.equal(crc16HyperCore([0x07, 0x07, 0x80]), 0x6d52);
	assert.equal(Buffer.from(buildReadPacket(0x07)).toString('hex'), '070780526d');
	assert.throws(() => buildReadPacket(256), /unsigned byte/i);
	assert.notEqual(buildReadPacket(7), buildReadPacket(7), 'callers receive an independent payload');
});

test('validates modern CRC frames and legacy additive-checksum frames exactly', () => {
	const modern = makeModernFrame(0, (frame) => writeU16Le(frame, 8, 4321));
	assert.equal(validateFrame(modern), true);
	assert.deepEqual(frameValidation(modern), {
		valid: true,
		protocol: 'modern',
		checksum: modern[14] | (modern[15] << 8)
	});
	const parsedModern = parseFrame(modern);
	assert.equal(parsedModern.page, 0);
	assert.equal(parsedModern.register, 0xe2);
	assert.equal(parsedModern.words[3], 4321);

	const legacy = makeLegacyFrame(1, (frame) => {
		frame[2] = 0x03;
		frame[3] = 0x39;
	});
	assert.equal(validateFrame(legacy), true);
	assert.equal(parseFrame(legacy).protocol, 'legacy');
	assert.equal(parseFrame(legacy).words[0], 825);
	const corrupted = Uint8Array.from(modern);
	corrupted[8] ^= 1;
	assert.equal(validateFrame(corrupted), false);
	assert.equal(frameValidation(corrupted).reason, 'crc');
	assert.throws(() => parseFrame(corrupted), /invalid \(crc\)/i);
});

test('buffers fragmented notifications, resynchronises after noise and preserves trailing frames', () => {
	const first = makeModernFrame(0, (frame) => writeU16Le(frame, 8, 4000));
	const second = makeModernFrame(1, (frame) => writeU16Le(frame, 2, 800));
	for (let split = 1; split < first.length; split += 1) {
		const decoder = new HyperCoreEcuDecoder();
		assert.deepEqual(decoder.push(first.slice(0, split), 10), []);
		const updates = decoder.push(first.slice(split), 10);
		assert.equal(updates.length, 1, `split ${split} should retain the whole frame`);
		assert.equal(updates[0].telemetry.rpm, 4000);
	}

	const bad = Uint8Array.from(first);
	bad[14] ^= 0xff;
	const combined = new Uint8Array(3 + bad.length + first.length + second.length + 5);
	combined.set([1, 2, 3]);
	combined.set(bad, 3);
	combined.set(first, 3 + bad.length);
	combined.set(second, 3 + bad.length + first.length);
	combined.set(first.slice(0, 5), 3 + bad.length + first.length + second.length);
	const decoder = new HyperCoreEcuDecoder();
	const updates = decoder.push(combined, 20);
	assert.equal(updates.length, 2);
	assert.equal(decoder.invalidFrames, 1);
	assert.equal(decoder.buffer.length, 5);
	assert.equal(decoder.getRawState().wordsByRegister['226'][3], 4000);
	assert.equal(decoder.getRawState().wordsByRegister['232'][0], 800);
});

test('decodes the verified modern ECU telemetry formulae and keeps ECU speed diagnostic', () => {
	const decoder = new HyperCoreEcuDecoder();
	let update = decoder.push(makeModernFrame(0, (frame) => {
		frame[2] = 2;
		frame[4] = 1;
		frame[5] = 0x82;
		frame[6] = 64;
		writeU16Le(frame, 8, 4800);
	}), 100)[0];
	assert.equal(update.telemetry.rpm, 4800);
	assert.equal(update.telemetry.gear, 2);
	assert.equal(update.telemetry.modulationPercent, 50);
	assert.deepEqual(update.telemetry.faults, [1, 2]);
	assert.deepEqual(update.telemetry.faultMessages, ['Motor position sensor', 'Phase zero']);
	assert.equal(update.telemetry.faultSummary, 'Motor position sensor · Phase zero');
	assert.equal(update.telemetry.faultActive, true);
	assert.equal(update.telemetry.diagnosticSpeedKmh, null, 'ECU speed is unavailable until its diagnostic ratio arrives');

	update = decoder.push(makeModernFrame(1, (frame) => {
		writeU16Le(frame, 2, 825);
		writeU16Le(frame, 6, -400);
		writeU16Le(frame, 12, 192);
	}), 200)[0];
	assert.equal(update.telemetry.voltage, 82.5);
	assert.equal(update.telemetry.current, -100);
	assert.equal(update.telemetry.powerW, -8250);
	assert.equal(update.telemetry.powerKw, -8.25);
	assert.equal(update.telemetry.throttleRaw, 192);
	assert.equal(update.telemetry.throttlePercent, 50);
	assert.equal(update.telemetry.throttleSource, 'raw-fallback');

	update = decoder.push(makeModernFrame(2, (frame) => {
		frame.set([0x00, 0x01, 0x00], 6);
		frame.set([0x00, 0x04, 0x00], 9);
	}), 300)[0];
	assert.equal(update.telemetry.phaseCurrentA, 31.25);
	assert.equal(update.telemetry.phaseCurrentC, 62.5);

	update = decoder.push(makeModernFrame(0x35, (frame) => {
		writeU16Le(frame, 2, -5);
		frame[5] = 99;
	}), 400)[0];
	assert.equal(update.telemetry.motorTemperature, -5);
	assert.equal(update.telemetry.soc, null, 'HyperCore BMS remains the sole battery SOC authority');

	update = decoder.push(makeModernFrame(0x33, (frame) => {
		frame[6] = 0x08;
		writeU16Le(frame, 12, 67);
	}), 500)[0];
	assert.equal(update.telemetry.controllerTemperature, 67);
	assert.equal(update.telemetry.brakeActive, true);

	update = decoder.push(makeModernFrame(0x36, (frame) => { frame[6] = 16; }), 600)[0];
	assert.equal(update.telemetry.polePairs, 16);
	assert.equal(update.telemetry.rpm, 1200);

	update = decoder.push(makeModernFrame(0x2f, (frame) => {
		frame[6] = 190;
		frame[7] = 17;
		frame[9] = 60;
		writeU16Le(frame, 10, 4000);
	}), 700)[0];
	assert.ok(Math.abs(update.telemetry.diagnosticSpeedKmh - 149.243251) < 0.001);
	assert.ok(Math.abs(update.telemetry.diagnosticSpeedMph - 92.735) < 0.01);
	assert.equal(update.telemetry.diagnosticSpeedSource, 'hypercore-ecu-calculated');
	assert.equal('speedKmh' in update.telemetry, false, 'diagnostic ECU speed cannot masquerade as Halo GPS speed');
	assert.equal(update.telemetry.fieldTimestamps.diagnosticSpeedKmh, 700);
	assert.equal(update.telemetry.fieldSources.diagnosticSpeedKmh, 'hypercore-ecu');
});

test('turns verified fault bits and context into HyperCore diagnostic labels', () => {
	assert.deepEqual(
		faultMessages([0x10, 0x04], { voltageDirection: 'over', phaseShort: true, brakeAlarm: true }),
		['Over-voltage', 'Phase short', 'Brake alarm']
	);
	assert.deepEqual(faultMessages([0, 0], {}), []);
});

test('uses learned throttle voltage when available and clamps the UI percentage safely', () => {
	const decoder = new HyperCoreEcuDecoder();
	decoder.push(makeModernFrame(1, (frame) => writeU16Le(frame, 12, 500)), 10);
	let telemetry = decoder.getTelemetry();
	assert.equal(telemetry.throttlePercent, 100, 'raw fallback is presentation-clamped');
	assert.equal(telemetry.throttleSource, 'raw-fallback');

	decoder.push(makeModernFrame(4, (frame) => {
		frame[6] = 20;
		frame[7] = 80;
	}), 20);
	telemetry = decoder.push(makeModernFrame(0x19, (frame) => writeU16Le(frame, 2, 250)), 30)[0].telemetry;
	assert.equal(telemetry.throttleVoltage, 2.5);
	assert.equal(telemetry.throttlePercent, 50);
	assert.equal(telemetry.throttleSource, 'voltage-calibrated');
});

test('connects on request, enables FFEC notifications and runs only the safe read cycle', async () => {
	const runtime = makeBluetooth();
	const { manager, timers, statuses, telemetry, frames } = makeManager(runtime);
	assert.equal(runtime.calls.length, 0, 'construction must never open a device chooser');

	const status = await manager.connect();
	assert.equal(status.status, 'waiting-for-data');
	assert.equal(status.connected, true);
	assert.deepEqual(runtime.calls.slice(0, 4), [
		['request', { filters: [{ services: [SERVICE_UUID] }] }],
		['connect'],
		['service', SERVICE_UUID],
		['characteristic', CHARACTERISTIC_UUID]
	]);
	assert.equal(runtime.characteristic.started, 1);
	assert.equal(runtime.characteristic.listenerCount('characteristicvaluechanged'), 1);
	assert.equal(runtime.characteristic.writes.length, 1);
	assert.equal(Buffer.from(runtime.characteristic.writes[0].value).toString('hex'), Buffer.from(buildReadPacket(0xe2)).toString('hex'));
	assert.equal(timers.intervals.size, 1);

	timers.runIntervals();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(runtime.characteristic.writes.length, 2);
	assert.equal(Buffer.from(runtime.characteristic.writes[1].value).toString('hex'), Buffer.from(buildReadPacket(0xe8)).toString('hex'));

	const e2 = makeModernFrame(0, (frame) => writeU16Le(frame, 8, 3500));
	runtime.characteristic.notify(e2.slice(0, 7));
	assert.equal(manager.getStatus().live, false);
	runtime.characteristic.notify(e2.slice(7));
	assert.equal(manager.getStatus().status, 'live');
	assert.equal(manager.getStatus().telemetry.rpm, 3500);
	assert.equal(telemetry.length, 1);
	assert.equal(frames.length, 1);
	assert.ok(statuses.some((entry) => entry.status === 'scanning'));
	assert.ok(statuses.some((entry) => entry.status === 'live'));
	await manager.disconnect('test-complete');
	assert.equal(runtime.device.gatt.connected, false);
	assert.equal(timers.intervals.size, 0);
});

test('falls back between Web Bluetooth writers without changing a read packet', async () => {
	const characteristic = new FakeCharacteristic({ failWithoutResponse: true });
	const runtime = makeBluetooth(characteristic);
	const { manager } = makeManager(runtime);
	await manager.connect();
	assert.equal(characteristic.writes[0].method, 'write');
	assert.equal(Buffer.from(characteristic.writes[0].value).toString('hex'), Buffer.from(buildReadPacket(0xe2)).toString('hex'));
	await manager.disconnect();

	const finalFallback = new FakeCharacteristic({ failWithoutResponse: true, failWrite: true });
	const fallbackRuntime = makeBluetooth(finalFallback);
	const fallback = makeManager(fallbackRuntime).manager;
	await fallback.connect();
	assert.equal(finalFallback.writes[0].method, 'with-response');
	await fallback.disconnect();
});

test('rejects a wrong-role FFE0 device before writing and reopens the chooser', async () => {
	const runtime = makeBluetooth(new FakeCharacteristic(), { characteristicError: new Error('FFEC unavailable') });
	const { manager } = makeManager(runtime);
	let status = await manager.connect({ forceChooser: true });
	assert.equal(status.status, 'error');
	assert.equal(runtime.characteristic.writes.length, 0, 'role discovery must finish before any request is written');
	assert.equal(manager.device, null, 'the wrong peripheral must not remain pinned');
	status = await manager.connect({ forceChooser: true });
	assert.equal(status.status, 'error');
	assert.equal(runtime.calls.filter(([kind]) => kind === 'request').length, 2);
});

test('reconnect reuses the selected device and never reopens the chooser', async () => {
	const runtime = makeBluetooth();
	const { manager, timers } = makeManager(runtime);
	await manager.connect();
	assert.equal(runtime.calls.filter(([kind]) => kind === 'request').length, 1);

	runtime.device.gatt.connected = false;
	runtime.device.emit('gattserverdisconnected', { target: runtime.device });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(manager.getStatus().status, 'disconnected');
	assert.equal(timers.intervals.size, 0);

	const status = await manager.reconnect();
	assert.equal(status.connected, true);
	assert.equal(runtime.calls.filter(([kind]) => kind === 'request').length, 1);
	assert.equal(runtime.calls.filter(([kind]) => kind === 'connect').length, 2);
	await manager.forget();
	assert.equal(manager.device, null);
});

test('the module deliberately exposes no control, firmware, DRM or remote-drive packet surface', () => {
	for (const forbidden of ['buildWritePacket', 'writeConfig', 'remoteDrive', 'firmware', 'drm']) {
		assert.equal(protocol[forbidden], undefined);
	}
	const publicMethods = Object.getOwnPropertyNames(HyperCoreEcuBluetooth.prototype).filter((name) => !name.startsWith('_'));
	assert.deepEqual(publicMethods.sort(), [
		'addEventListener', 'connect', 'connected', 'constructor', 'destroy', 'disconnect',
		'forget', 'getStatus', 'live', 'on', 'reconnect', 'removeEventListener', 'supported'
	].sort());
});

test('unsupported and insecure runtimes fail truthfully without opening a chooser', async () => {
	let status = await new HyperCoreEcuBluetooth({ bluetooth: null, secureContext: true }).connect();
	assert.equal(status.status, 'unavailable');
	assert.equal(status.reason, 'unsupported');

	let calls = 0;
	const insecure = new HyperCoreEcuBluetooth({
		bluetooth: { requestDevice: async () => { calls += 1; } },
		secureContext: false
	});
	status = await insecure.connect();
	assert.equal(status.status, 'unavailable');
	assert.equal(status.reason, 'insecure-context');
	assert.equal(calls, 0);
});
