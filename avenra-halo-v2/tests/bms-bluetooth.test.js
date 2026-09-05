'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
	AvenraHaloBmsBluetooth,
	AvenraHaloBmsDecoder,
	SERVICE_UUID,
	CHARACTERISTIC_UUID,
	FALLBACK_SERVICE_UUID,
	FALLBACK_NOTIFY_CHARACTERISTIC_UUID,
	FALLBACK_WRITE_CHARACTERISTIC_UUID,
	LEGACY_FRAME_BYTES,
	crc16Modbus,
	generateWakePing,
	generateLegacyProbe,
	parseTelemetryFrame,
	parseLegacyTelemetryFrame
} = require('../assets/js/bms-bluetooth.js');

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

function writeU16(bytes, position, value) {
	const unsigned = Number(value) & 0xffff;
	bytes[position] = unsigned & 0xff;
	bytes[position + 1] = (unsigned >>> 8) & 0xff;
}

function writeU16Be(bytes, position, value) {
	const unsigned = Number(value) & 0xffff;
	bytes[position] = (unsigned >>> 8) & 0xff;
	bytes[position + 1] = unsigned & 0xff;
}

function writeI32Be(bytes, position, value) {
	const unsigned = Number(value) >>> 0;
	bytes[position] = (unsigned >>> 24) & 0xff;
	bytes[position + 1] = (unsigned >>> 16) & 0xff;
	bytes[position + 2] = (unsigned >>> 8) & 0xff;
	bytes[position + 3] = unsigned & 0xff;
}

function makeFrame(options) {
	const settings = Object.assign({
		cells: Array.from({ length: 24 }, () => 3500),
		temperatures: [31, 45],
		packVoltageRaw: 8400,
		currentRaw: -123,
		socRaw: 87
	}, options || {});
	const tail = 34 + (settings.cells.length * 2) + (settings.temperatures.length * 2);
	const frame = new Uint8Array(tail + 82);
	frame.set([0x7e, 0xa1, 0x11], 0);
	frame[5] = frame.length - 10;
	frame[8] = settings.temperatures.length;
	frame[9] = settings.cells.length;
	settings.cells.forEach((cell, index) => writeU16(frame, 34 + (index * 2), cell));
	settings.temperatures.forEach((temperature, index) => writeU16(frame, 34 + (settings.cells.length * 2) + (index * 2), temperature));
	writeU16(frame, tail + 4, settings.packVoltageRaw);
	writeU16(frame, tail + 6, settings.currentRaw);
	writeU16(frame, tail + 8, settings.socRaw);
	const crc = crc16Modbus(frame.subarray(1, frame.length - 4));
	writeU16(frame, frame.length - 4, crc);
	frame.set([0xaa, 0x55], frame.length - 2);
	return frame;
}

function makeLegacyFrame(options) {
	const settings = Object.assign({
		cells: Array.from({ length: 24 }, () => 3500),
		temperatures: [31, 45, 28, 29],
		mosfetTemperature: 38,
		balancerTemperature: 36,
		packVoltageRaw: 840,
		currentRaw: -123,
		socRaw: 87
	}, options || {});
	const frame = new Uint8Array(LEGACY_FRAME_BYTES);
	frame.set([0xaa, 0x55, 0xaa], 0);
	writeU16Be(frame, 4, settings.packVoltageRaw);
	for (let index = 0; index < 32; index += 1) {
		writeU16Be(frame, 6 + (index * 2), settings.cells[index] || 0);
	}
	writeI32Be(frame, 70, settings.currentRaw);
	frame[74] = settings.socRaw;
	writeU16Be(frame, 91, settings.mosfetTemperature);
	writeU16Be(frame, 93, settings.balancerTemperature);
	for (let index = 0; index < 4; index += 1) {
		writeU16Be(frame, 95 + (index * 2), settings.temperatures[index] ?? 0x7fff);
	}
	frame[123] = settings.reportedCellCount ?? settings.cells.length;
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
		this.options = Object.assign({ failWithResponse: false, failWrite: false, failWithoutResponse: false }, options || {});
		this.started = 0;
		this.stopped = 0;
		this.writes = [];
	}
	async startNotifications() { this.started += 1; return this; }
	async stopNotifications() { this.stopped += 1; return this; }
	async writeValueWithResponse(value) {
		if (this.options.failWithResponse) throw new Error('with-response unavailable');
		this.writes.push({ method: 'with-response', value: Uint8Array.from(value) });
	}
	async writeValue(value) {
		if (this.options.failWrite) throw new Error('legacy write unavailable');
		this.writes.push({ method: 'write', value: Uint8Array.from(value) });
	}
	async writeValueWithoutResponse(value) {
		if (this.options.failWithoutResponse) throw new Error('without-response unavailable');
		this.writes.push({ method: 'without-response', value: Uint8Array.from(value) });
	}
	notify(bytes) {
		const view = bytes instanceof DataView ? bytes : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		this.emit('characteristicvaluechanged', { type: 'characteristicvaluechanged', target: { value: view } });
	}
}

function makeBluetooth(options) {
	const settings = Object.assign({ transport: 'primary', characteristic: null, notifyCharacteristic: null, writeCharacteristic: null, delayedDevice: null }, options || {});
	const sharedCharacteristic = settings.characteristic || new FakeCharacteristic();
	const notifyCharacteristic = settings.notifyCharacteristic || sharedCharacteristic;
	const writeCharacteristic = settings.writeCharacteristic || sharedCharacteristic;
	const calls = [];
	const device = new FakeEventTarget();
	device.name = 'HyperCore BMS';
	const server = {
		async getPrimaryService(uuid) {
			calls.push(['service', uuid]);
			const expectedService = settings.transport === 'fallback' ? FALLBACK_SERVICE_UUID : SERVICE_UUID;
			if (uuid !== expectedService) {
				const error = new Error('service unavailable');
				error.name = 'NotFoundError';
				throw error;
			}
			return {
				async getCharacteristic(characteristicUuid) {
					calls.push(['characteristic', characteristicUuid]);
					if (settings.transport === 'wrong') {
						const error = new Error('not a BMS characteristic');
						error.name = 'NotFoundError';
						throw error;
					}
					if (settings.transport === 'fallback') {
						if (characteristicUuid === FALLBACK_NOTIFY_CHARACTERISTIC_UUID) return notifyCharacteristic;
						if (characteristicUuid === FALLBACK_WRITE_CHARACTERISTIC_UUID) return writeCharacteristic;
					} else if (characteristicUuid === CHARACTERISTIC_UUID) {
						return sharedCharacteristic;
					}
					const error = new Error('characteristic unavailable');
					error.name = 'NotFoundError';
					throw error;
				}
			};
		}
	};
	device.gatt = {
		connected: false,
		async connect() { calls.push(['connect']); this.connected = true; return server; },
		disconnect() { this.connected = false; device.emit('gattserverdisconnected', { type: 'gattserverdisconnected', target: device }); }
	};
	const bluetooth = {
		async requestDevice(request) {
			calls.push(['request', request]);
			if (settings.delayedDevice) return settings.delayedDevice;
			return device;
		}
	};
	return {
		bluetooth,
		device,
		characteristic: sharedCharacteristic,
		notifyCharacteristic,
		writeCharacteristic,
		calls
	};
}

function makeManager(runtime, overrides) {
	const timers = fakeTimers();
	let now = 1_700_000_000_000;
	const statuses = [];
	const telemetry = [];
	const manager = new AvenraHaloBmsBluetooth(Object.assign({
		bluetooth: runtime.bluetooth,
		secureContext: true,
		sleep: async () => {},
		setInterval: timers.setInterval,
		clearInterval: timers.clearInterval,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
		now: () => now,
		onStatus: (status) => statuses.push(status),
		onTelemetry: (reading) => telemetry.push(reading)
	}, overrides || {}));
	return { manager, timers, statuses, telemetry, setNow(value) { now = value; } };
}

test('retains both HyperCore BMS transports and the two exact read-only probes', () => {
	assert.equal(SERVICE_UUID, '0000ffe0-0000-1000-8000-00805f9b34fb');
	assert.equal(CHARACTERISTIC_UUID, '0000ffe1-0000-1000-8000-00805f9b34fb');
	assert.equal(FALLBACK_SERVICE_UUID, '0000ff00-0000-1000-8000-00805f9b34fb');
	assert.equal(FALLBACK_NOTIFY_CHARACTERISTIC_UUID, '0000ff01-0000-1000-8000-00805f9b34fb');
	assert.equal(FALLBACK_WRITE_CHARACTERISTIC_UUID, '0000ff02-0000-1000-8000-00805f9b34fb');
	assert.equal(Buffer.from(generateWakePing()).toString('hex'), '7ea1010000c899b3aa55');
	assert.equal(Buffer.from(generateLegacyProbe()).toString('hex'), 'dbdb00000000');
	assert.notEqual(generateWakePing(), generateWakePing(), 'each write receives its own immutable payload');
	assert.notEqual(generateLegacyProbe(), generateLegacyProbe(), 'each legacy probe receives its own immutable payload');
});

test('decodes the proven HyperCore BMS telemetry layout with fixed field scaling', () => {
	const reading = parseTelemetryFrame(makeFrame(), 1_700_000_000_000);
	assert.equal(reading.protocol, 'modern');
	assert.equal(reading.soc, 87);
	assert.equal(reading.voltage, 84);
	assert.equal(reading.current, -12.3);
	assert.equal(reading.powerKw, -1.033);
	assert.equal(reading.maxTemperature, 45);
	assert.equal(reading.cellCount, 24);
	assert.equal(reading.cellDeltaMv, 0);
	assert.equal(reading.measuredAt, '2023-11-14T22:13:20.000Z');

	assert.equal(parseTelemetryFrame(makeFrame({ currentRaw: 1500, socRaw: 87 })).current, 150);
	assert.equal(parseTelemetryFrame(makeFrame({ currentRaw: -1500, socRaw: 100 })).current, -150);
	assert.equal(parseTelemetryFrame(makeFrame({ currentRaw: 8430 })).current, 843, 'high-current telemetry stays at the protocol-defined 0.1 A per bit');
	assert.throws(() => parseTelemetryFrame(makeFrame({ socRaw: 255 })), /state of charge/i);
	assert.equal(parseTelemetryFrame(makeFrame({ packVoltageRaw: 8123 })).voltage, 81.23, 'reported pack voltage is authoritative over the cell sum');
	assert.equal(parseTelemetryFrame(makeFrame({ cells: [0, 3500] })).cellDeltaMv, 0, 'an unpopulated cell does not become a false multi-volt imbalance');
});

test('decodes the fixed big-endian AA55AA telemetry into the same normalized shape', () => {
	const reading = parseLegacyTelemetryFrame(makeLegacyFrame(), 1_700_000_000_000);
	assert.equal(reading.protocol, 'legacy');
	assert.equal(reading.soc, 87);
	assert.equal(reading.voltage, 84);
	assert.equal(reading.current, -12.3);
	assert.equal(reading.powerKw, -1.033);
	assert.equal(reading.maxTemperature, 45);
	assert.equal(reading.mosfetTemperature, 38);
	assert.equal(reading.balancerTemperature, 36);
	assert.equal(reading.cellCount, 24);
	assert.equal(reading.temperatureCount, 4);
	assert.equal(reading.cellVoltages.length, 24);
	assert.equal(reading.cellDeltaMv, 0);
	assert.equal(reading.measuredAt, '2023-11-14T22:13:20.000Z');

	assert.equal(parseLegacyTelemetryFrame(makeLegacyFrame({ currentRaw: 8430 })).current, 843);
	assert.equal(parseLegacyTelemetryFrame(makeLegacyFrame({ cells: Array.from({ length: 32 }, () => 3500), reportedCellCount: 0 })).cellCount, 32);
	assert.throws(() => parseLegacyTelemetryFrame(makeLegacyFrame({ socRaw: 255 })), /state of charge/i);
	assert.throws(() => parseLegacyTelemetryFrame(makeLegacyFrame().slice(0, LEGACY_FRAME_BYTES - 1)), /incomplete|malformed/i);
});

test('requires the protocol length, checksum and AA55 footer', () => {
	const valid = makeFrame();
	assert.equal(valid.length, valid[5] + 10);
	assert.doesNotThrow(() => parseTelemetryFrame(valid));

	const badChecksum = Uint8Array.from(valid);
	badChecksum[40] ^= 0x01;
	assert.throws(() => parseTelemetryFrame(badChecksum), /checksum/i);

	const badFooter = Uint8Array.from(valid);
	badFooter[badFooter.length - 1] = 0;
	assert.throws(() => parseTelemetryFrame(badFooter), /footer/i);

	const truncated = valid.slice(0, valid.length - 1);
	assert.throws(() => parseTelemetryFrame(truncated), /incomplete|malformed/i);
});

test('preserves every fragmented frame and every concatenated trailing frame', () => {
	const frame = makeFrame();
	for (let split = 1; split < frame.length; split += 1) {
		const decoder = new AvenraHaloBmsDecoder();
		assert.deepEqual(decoder.push(frame.slice(0, split), 10), []);
		const readings = decoder.push(frame.slice(split), 10);
		assert.equal(readings.length, 1, `split ${split} should produce exactly one reading`);
		assert.equal(readings[0].soc, 87);
	}

	const second = makeFrame({ socRaw: 64, temperatures: [22] });
	const decoder = new AvenraHaloBmsDecoder();
	const combined = new Uint8Array(frame.length + second.length + 7);
	combined.set(frame, 0);
	combined.set(second, frame.length);
	combined.set(frame.slice(0, 7), frame.length + second.length);
	const readings = decoder.push(combined, 20);
	assert.deepEqual(readings.map((reading) => reading.soc), [87, 64]);
	assert.equal(decoder.buffer.length, 7, 'a trailing frame fragment stays buffered');

	const legacy = makeLegacyFrame({ socRaw: 52 });
	for (let split = 1; split < legacy.length; split += 1) {
		const legacyDecoder = new AvenraHaloBmsDecoder();
		assert.deepEqual(legacyDecoder.push(legacy.slice(0, split), 30), []);
		const legacyReadings = legacyDecoder.push(legacy.slice(split), 30);
		assert.equal(legacyReadings.length, 1, `legacy split ${split} should produce exactly one reading`);
		assert.equal(legacyReadings[0].soc, 52);
		assert.equal(legacyReadings[0].protocol, 'legacy');
	}

	const mixedProtocols = new Uint8Array(5 + legacy.length + frame.length);
	mixedProtocols.set([9, 0xaa, 0x01, 0x7e, 0x02]);
	mixedProtocols.set(legacy, 5);
	mixedProtocols.set(frame, 5 + legacy.length);
	assert.deepEqual(
		new AvenraHaloBmsDecoder().push(mixedProtocols, 40).map((reading) => reading.protocol),
		['legacy', 'modern']
	);
});

test('respects DataView offsets and recovers from noise and malformed frame counts', () => {
	const frame = makeFrame();
	const wrapped = new Uint8Array(frame.length + 6);
	wrapped.set([9, 8, 7], 0);
	wrapped.set(frame, 3);
	wrapped.set([6, 5, 4], frame.length + 3);
	const decoder = new AvenraHaloBmsDecoder();
	const offsetReadings = decoder.push(new DataView(wrapped.buffer, 3, frame.length), 30);
	assert.equal(offsetReadings.length, 1);
	assert.equal(offsetReadings[0].voltage, 84);

	const malformed = new Uint8Array(10);
	malformed.set([0x7e, 0xa1, 0x11]);
	malformed[8] = 255;
	malformed[9] = 255;
	const mixed = new Uint8Array(4 + malformed.length + frame.length);
	mixed.set([1, 2, 0x7e, 3]);
	mixed.set(malformed, 4);
	mixed.set(frame, 4 + malformed.length);
	const recovered = new AvenraHaloBmsDecoder({ maxBufferBytes: 256 }).push(mixed, 40);
	assert.equal(recovered.length, 1);
	assert.equal(recovered[0].soc, 87);
});

test('connects only on request, advertises both services and probes both protocols read-only', async () => {
	const runtime = makeBluetooth();
	const { manager, timers, statuses, telemetry } = makeManager(runtime);
	assert.equal(runtime.calls.length, 0, 'constructing the reader must never open a chooser');

	const status = await manager.connect();
	assert.equal(status.status, 'waiting-for-data');
	assert.equal(status.connected, true);
	assert.equal(status.live, false, 'GATT alone is never reported as live telemetry');
	assert.deepEqual(runtime.calls[0], ['request', {
		filters: [{ services: [SERVICE_UUID] }, { services: [FALLBACK_SERVICE_UUID] }],
		optionalServices: [SERVICE_UUID, FALLBACK_SERVICE_UUID]
	}]);
	assert.deepEqual(runtime.calls.slice(1), [['connect'], ['service', SERVICE_UUID], ['characteristic', CHARACTERISTIC_UUID]]);
	assert.equal(runtime.characteristic.started, 1);
	assert.equal(runtime.characteristic.listenerCount('characteristicvaluechanged'), 1);
	assert.equal(runtime.characteristic.writes.length, 2);
	assert.equal(Buffer.from(runtime.characteristic.writes[0].value).toString('hex'), '7ea1010000c899b3aa55');
	assert.equal(Buffer.from(runtime.characteristic.writes[1].value).toString('hex'), 'dbdb00000000');
	assert.equal(timers.intervals.size, 1);

	runtime.characteristic.notify(makeFrame());
	assert.equal(manager.getStatus().status, 'live');
	assert.equal(manager.getStatus().live, true);
	assert.equal(manager.getStatus().protocol, 'modern');
	assert.equal(manager.getStatus().transport, 'ffe0');
	assert.equal(telemetry.length, 1);
	assert.equal(telemetry[0].soc, 87);
	assert.ok(statuses.some((entry) => entry.status === 'scanning'));
	assert.ok(statuses.some((entry) => entry.status === 'live'));
	runtime.characteristic.notify(makeLegacyFrame({ socRaw: 12 }));
	assert.equal(telemetry.length, 1, 'a validated modern frame locks out later legacy-shaped traffic');

	timers.runIntervals();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(runtime.characteristic.writes.length, 3);
	assert.equal(Buffer.from(runtime.characteristic.writes[2].value).toString('hex'), '7ea1010000c899b3aa55', 'a valid modern frame locks later polling to the modern request');
	await manager.disconnect('test-complete');
});

test('uses FF00 with independent FF01 notify and FF02 write channels and locks legacy polling', async () => {
	const notifyCharacteristic = new FakeCharacteristic();
	const writeCharacteristic = new FakeCharacteristic();
	const runtime = makeBluetooth({ transport: 'fallback', notifyCharacteristic, writeCharacteristic });
	const { manager, timers, telemetry } = makeManager(runtime);
	const status = await manager.connect();

	assert.equal(status.connected, true);
	assert.equal(status.transport, 'ff00');
	assert.deepEqual(runtime.calls.slice(1), [
		['connect'],
		['service', SERVICE_UUID],
		['service', FALLBACK_SERVICE_UUID],
		['characteristic', FALLBACK_NOTIFY_CHARACTERISTIC_UUID],
		['characteristic', FALLBACK_WRITE_CHARACTERISTIC_UUID]
	]);
	assert.equal(notifyCharacteristic.started, 1);
	assert.equal(notifyCharacteristic.writes.length, 0);
	assert.deepEqual(writeCharacteristic.writes.map((entry) => Buffer.from(entry.value).toString('hex')), [
		'7ea1010000c899b3aa55',
		'dbdb00000000'
	]);

	notifyCharacteristic.notify(makeLegacyFrame({ socRaw: 61 }));
	assert.equal(manager.getStatus().live, true);
	assert.equal(manager.getStatus().protocol, 'legacy');
	assert.equal(telemetry[0].protocol, 'legacy');
	assert.equal(telemetry[0].soc, 61);
	notifyCharacteristic.notify(makeFrame({ socRaw: 12 }));
	assert.equal(telemetry.length, 1, 'a validated legacy frame locks out later modern-shaped traffic');
	timers.runIntervals();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(Buffer.from(writeCharacteristic.writes.at(-1).value).toString('hex'), 'dbdb00000000');

	await manager.disconnect('test-complete');
	assert.equal(notifyCharacteristic.listenerCount('characteristicvaluechanged'), 0);
	assert.equal(writeCharacteristic.listenerCount('characteristicvaluechanged'), 0);
});

test('rejects a wrong-role FFE0 device before any Bluetooth write', async () => {
	const characteristic = new FakeCharacteristic();
	const runtime = makeBluetooth({ transport: 'wrong', characteristic });
	const { manager, timers } = makeManager(runtime);
	const status = await manager.connect();

	assert.equal(status.status, 'error');
	assert.match(status.lastError, /does not expose a supported HyperCore BMS/i);
	assert.equal(characteristic.writes.length, 0);
	assert.equal(runtime.device.gatt.connected, false);
	assert.equal(timers.intervals.size, 0);
	assert.equal(timers.timeouts.size, 0);
});

test('keeps an immediate first notification live after startup completes', async () => {
	const characteristic = new FakeCharacteristic();
	characteristic.startNotifications = async function startNotifications() {
		this.started += 1;
		this.notify(makeFrame({ socRaw: 91 }));
		return this;
	};
	const runtime = makeBluetooth({ characteristic });
	const { manager, telemetry } = makeManager(runtime);
	const status = await manager.connect();
	assert.equal(status.status, 'live');
	assert.equal(status.live, true);
	assert.equal(telemetry.length, 1);
	assert.equal(telemetry[0].soc, 91);
	await manager.disconnect('test-complete');
});

test('uses compatible characteristic write fallbacks without changing the payload', async () => {
	const characteristic = new FakeCharacteristic({ failWithResponse: true });
	const runtime = makeBluetooth({ characteristic });
	const { manager } = makeManager(runtime);
	await manager.connect();
	assert.equal(characteristic.writes[0].method, 'write');
	assert.equal(Buffer.from(characteristic.writes[0].value).toString('hex'), '7ea1010000c899b3aa55');
	await manager.disconnect();

	const fallbackCharacteristic = new FakeCharacteristic({ failWithResponse: true, failWrite: true });
	const fallbackRuntime = makeBluetooth({ characteristic: fallbackCharacteristic });
	const fallback = makeManager(fallbackRuntime).manager;
	await fallback.connect();
	assert.equal(fallbackCharacteristic.writes[0].method, 'without-response');
	await fallback.disconnect();
});

test('an unknown protocol stays connectable when only one exact read probe is accepted', async () => {
	const legacyOnly = new FakeCharacteristic();
	for (const method of ['writeValueWithResponse', 'writeValue', 'writeValueWithoutResponse']) {
		legacyOnly[method] = async function writeOnlyLegacy(value) {
			const payload = Uint8Array.from(value);
			if (payload.length !== 6) throw new Error('modern probe rejected');
			this.writes.push({ method, value: payload });
		};
	}
	const legacyRuntime = makeBluetooth({ characteristic: legacyOnly });
	const legacyManager = makeManager(legacyRuntime).manager;
	let status = await legacyManager.connect();
	assert.equal(status.connected, true);
	assert.deepEqual(legacyOnly.writes.map((entry) => Buffer.from(entry.value).toString('hex')), ['dbdb00000000']);
	legacyOnly.notify(makeLegacyFrame());
	assert.equal(legacyManager.getStatus().protocol, 'legacy');
	await legacyManager.disconnect();

	const modernOnly = new FakeCharacteristic();
	for (const method of ['writeValueWithResponse', 'writeValue', 'writeValueWithoutResponse']) {
		modernOnly[method] = async function writeOnlyModern(value) {
			const payload = Uint8Array.from(value);
			if (payload.length !== 10) throw new Error('legacy probe rejected');
			this.writes.push({ method, value: payload });
		};
	}
	const modernRuntime = makeBluetooth({ characteristic: modernOnly });
	const modernManager = makeManager(modernRuntime).manager;
	status = await modernManager.connect();
	assert.equal(status.connected, true);
	assert.deepEqual(modernOnly.writes.map((entry) => Buffer.from(entry.value).toString('hex')), ['7ea1010000c899b3aa55']);
	modernOnly.notify(makeFrame());
	assert.equal(modernManager.getStatus().protocol, 'modern');
	await modernManager.disconnect();
});

test('bounds a stalled initial wake write and never leaves pairing pending forever', async () => {
	const characteristic = new FakeCharacteristic();
	const never = () => new Promise(() => {});
	characteristic.writeValueWithResponse = never;
	characteristic.writeValue = never;
	characteristic.writeValueWithoutResponse = never;
	const runtime = makeBluetooth({ characteristic });
	const manager = new AvenraHaloBmsBluetooth({
		bluetooth: runtime.bluetooth,
		secureContext: true,
		sleep: async () => {},
		writeTimeoutMs: 5,
		staleAfterMs: 10000
	});
	const status = await manager.connect();
	assert.equal(status.status, 'error');
	assert.equal(status.connected, false);
	assert.equal(runtime.device.gatt.connected, false);
	assert.match(status.lastError, /timed out/i);
	await manager.destroy();
});

test('bounds a stalled notification startup and releases the failed GATT link', async () => {
	const characteristic = new FakeCharacteristic();
	characteristic.startNotifications = async function startNotifications() {
		this.started += 1;
		return new Promise(() => {});
	};
	const runtime = makeBluetooth({ characteristic });
	const manager = new AvenraHaloBmsBluetooth({
		bluetooth: runtime.bluetooth,
		secureContext: true,
		notificationTimeoutMs: 5
	});
	const status = await manager.connect();
	assert.equal(status.status, 'error');
	assert.equal(status.connected, false);
	assert.equal(runtime.device.gatt.connected, false);
	assert.match(status.lastError, /notification stream did not start/i);
	await manager.destroy();
});

test('identity cleanup cancels a stalled connection stage and permits a later reconnect', async () => {
	const characteristic = new FakeCharacteristic();
	let blockNotifications = true;
	characteristic.startNotifications = async function startNotifications() {
		this.started += 1;
		if (blockNotifications) return new Promise(() => {});
		return this;
	};
	const runtime = makeBluetooth({ characteristic });
	const { manager } = makeManager(runtime);
	const firstConnection = manager.connect();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(characteristic.started, 1);
	await manager.disconnect('identity-changed', { silent: true });
	await firstConnection;
	blockNotifications = false;
	const status = await manager.connect();
	assert.equal(status.status, 'waiting-for-data');
	assert.equal(status.connected, true);
	assert.equal(characteristic.started, 2);
	await manager.disconnect('test-complete');
});

test('marks missing telemetry stale and a GATT loss clears timers and listeners', async () => {
	const runtime = makeBluetooth();
	const { manager, timers } = makeManager(runtime);
	await manager.connect();
	timers.runTimeouts();
	assert.equal(manager.getStatus().status, 'stale');
	assert.equal(manager.getStatus().live, false);

	runtime.characteristic.notify(makeFrame());
	assert.equal(manager.getStatus().live, true);
	runtime.device.gatt.connected = false;
	runtime.device.emit('gattserverdisconnected', { target: runtime.device });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(manager.getStatus().status, 'disconnected');
	assert.equal(manager.getStatus().connected, false);
	assert.equal(timers.intervals.size, 0);
	assert.equal(timers.timeouts.size, 0);
	assert.equal(runtime.characteristic.listenerCount('characteristicvaluechanged'), 0);
	assert.equal(runtime.device.listenerCount('gattserverdisconnected'), 0);
});

test('a lost GATT link does not wait on a WebView notification-stop promise', async () => {
	const characteristic = new FakeCharacteristic();
	characteristic.stopNotifications = async function stopNotifications() {
		this.stopped += 1;
		return new Promise(() => {});
	};
	const runtime = makeBluetooth({ characteristic });
	const { manager } = makeManager(runtime);
	await manager.connect();
	runtime.device.gatt.connected = false;
	runtime.device.emit('gattserverdisconnected', { target: runtime.device });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(manager.getStatus().status, 'disconnected');
	assert.equal(characteristic.stopped, 0, 'the dead GATT session must not block on stopNotifications');
});

test('a deliberate privacy disconnect drops GATT without waiting on notification shutdown', async () => {
	const characteristic = new FakeCharacteristic();
	characteristic.stopNotifications = async function stopNotifications() {
		this.stopped += 1;
		return new Promise(() => {});
	};
	const runtime = makeBluetooth({ characteristic });
	const { manager, timers } = makeManager(runtime);
	await manager.connect();
	const status = await manager.disconnect('document-hidden');
	assert.equal(status.status, 'disconnected');
	assert.equal(status.connected, false);
	assert.equal(runtime.device.gatt.connected, false);
	assert.equal(characteristic.stopped, 0, 'privacy cleanup must disconnect instead of awaiting a stalled WebView call');
	assert.equal(timers.intervals.size, 0);
});

test('disconnect fences a Bluetooth chooser that resolves after identity cleanup', async () => {
	let resolveDevice;
	const deferred = new Promise((resolve) => { resolveDevice = resolve; });
	const runtime = makeBluetooth({ delayedDevice: deferred });
	const { manager, timers } = makeManager(runtime);
	const connection = manager.connect();
	assert.equal(manager.getStatus().status, 'scanning');
	await manager.disconnect('identity-changed', { silent: true });
	resolveDevice(runtime.device);
	await connection;
	assert.equal(runtime.calls.filter(([kind]) => kind === 'connect').length, 0);
	assert.equal(manager.getStatus().connected, false);
	assert.equal(timers.intervals.size, 0);
	assert.equal(runtime.device.listenerCount('gattserverdisconnected'), 0);
});

test('unsupported and insecure runtimes fail truthfully without opening a chooser', async () => {
	const unsupported = new AvenraHaloBmsBluetooth({ bluetooth: null, secureContext: true });
	let status = await unsupported.connect();
	assert.equal(status.status, 'unavailable');
	assert.equal(status.reason, 'unsupported');

	let calls = 0;
	const insecure = new AvenraHaloBmsBluetooth({ bluetooth: { requestDevice: async () => { calls += 1; } }, secureContext: false });
	status = await insecure.connect();
	assert.equal(status.status, 'unavailable');
	assert.equal(status.reason, 'insecure-context');
	assert.equal(calls, 0);
});
