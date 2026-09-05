(function (global, factory) {
	'use strict';

	const exports = factory(global || {});
	if (typeof module === 'object' && module.exports) module.exports = exports;
	if (global) {
		global.AvenraHaloBmsBluetoothClass = exports.AvenraHaloBmsBluetooth;
		global.AvenraHaloBmsProtocol = exports;
	}
}(typeof globalThis !== 'undefined' ? globalThis : this, function (global) {
	'use strict';

	const SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
	const CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';
	const FALLBACK_SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb';
	const FALLBACK_NOTIFY_CHARACTERISTIC_UUID = '0000ff01-0000-1000-8000-00805f9b34fb';
	const FALLBACK_WRITE_CHARACTERISTIC_UUID = '0000ff02-0000-1000-8000-00805f9b34fb';
	const TELEMETRY_HEADER = [0x7e, 0xa1, 0x11];
	const LEGACY_TELEMETRY_HEADER = [0xaa, 0x55, 0xaa];
	const LEGACY_FRAME_BYTES = 140;
	const MIN_FRAME_BYTES = 80;
	const MAX_FRAME_BYTES = 512;
	const MAX_BUFFER_BYTES = 2048;
	const MAX_CELL_COUNT = 32;
	const MAX_TEMPERATURE_COUNT = 8;

	const errorMessage = (error) => String(error && error.message ? error.message : error || 'Unknown Bluetooth error');
	const nowIso = (now) => new Date(Number(now) || Date.now()).toISOString();

	function crc16Modbus(bytes) {
		let crc = 0xffff;
		for (const byte of bytes) {
			crc ^= Number(byte) & 0xff;
			for (let bit = 0; bit < 8; bit += 1) {
				crc = (crc & 1) ? ((crc >>> 1) ^ 0xa001) : (crc >>> 1);
			}
		}
		return crc & 0xffff;
	}

	function generateWakePing() {
		const ping = new Uint8Array([0x7e, 0xa1, 0x01, 0x00, 0x00, 0xc8, 0x00, 0x00, 0xaa, 0x55]);
		const crc = crc16Modbus(ping.slice(1, 6));
		ping[6] = crc & 0xff;
		ping[7] = (crc >>> 8) & 0xff;
		return ping;
	}

	function generateLegacyProbe() {
		return new Uint8Array([0xdb, 0xdb, 0x00, 0x00, 0x00, 0x00]);
	}

	function bytesFromValue(value) {
		if (value instanceof Uint8Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		if (value instanceof DataView) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		if (value instanceof ArrayBuffer) return new Uint8Array(value);
		if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		if (Array.isArray(value)) return Uint8Array.from(value);
		return new Uint8Array(0);
	}

	function readUnsignedInt16(bytes, position) {
		return (bytes[position] | (bytes[position + 1] << 8)) >>> 0;
	}

	function readSignedInt16(bytes, position) {
		const value = readUnsignedInt16(bytes, position);
		return value >= 0x8000 ? value - 0x10000 : value;
	}

	function readUnsignedInt16Be(bytes, position) {
		return ((bytes[position] << 8) | bytes[position + 1]) >>> 0;
	}

	function readSignedInt16Be(bytes, position) {
		const value = readUnsignedInt16Be(bytes, position);
		return value >= 0x8000 ? value - 0x10000 : value;
	}

	function readSignedInt32Be(bytes, position) {
		const value = ((bytes[position] * 0x1000000)
			+ (bytes[position + 1] << 16)
			+ (bytes[position + 2] << 8)
			+ bytes[position + 3]) >>> 0;
		return value > 0x7fffffff ? value - 0x100000000 : value;
	}

	function expectedFrameLength(bytes, offset) {
		const start = Number(offset) || 0;
		if (bytes.length - start < 6) return null;
		const length = 10 + bytes[start + 5];
		if (length < MIN_FRAME_BYTES || length > MAX_FRAME_BYTES) return -1;
		if (bytes.length - start < 10) return null;
		const temperatures = bytes[start + 8];
		const cells = bytes[start + 9];
		if (cells < 1 || cells > MAX_CELL_COUNT || temperatures > MAX_TEMPERATURE_COUNT) return -1;
		// The length byte and CRC/footer delimit the response. Require the complete
		// core status block, while allowing protocol variants to omit later optional
		// capacity/balance fields or append newer fields.
		const requiredLength = 34 + (cells * 2) + (temperatures * 2) + 44;
		return length >= requiredLength ? length : -1;
	}

	function parseTelemetryFrame(input, timestamp) {
		const frame = bytesFromValue(input);
		if (frame.length < 10 || !TELEMETRY_HEADER.every((byte, index) => frame[index] === byte)) {
			throw new Error('The BMS frame header is invalid.');
		}
		const length = expectedFrameLength(frame, 0);
		if (!length || length < 0 || frame.length < length) throw new Error('The BMS frame is incomplete or malformed.');
		if (frame[length - 2] !== 0xaa || frame[length - 1] !== 0x55) throw new Error('The BMS frame footer is invalid.');
		const expectedCrc = readUnsignedInt16(frame, length - 4);
		const actualCrc = crc16Modbus(frame.subarray(1, length - 4));
		if (expectedCrc !== actualCrc) throw new Error('The BMS frame checksum is invalid.');

		const temperatureCount = frame[8];
		const cellCount = frame[9];
		const cellVoltages = [];
		let cellPosition = 34;
		for (let index = 0; index < cellCount; index += 1) {
			const volts = readUnsignedInt16(frame, cellPosition) * 0.001;
			if (!Number.isFinite(volts) || volts < 0 || volts > 6.5) throw new Error('The BMS cell data is outside its valid bounds.');
			cellVoltages.push(volts);
			cellPosition += 2;
		}
		if (!cellVoltages.some((voltage) => voltage > 0)) throw new Error('The BMS frame contains no usable cell voltage.');

		const temperatures = [];
		let temperaturePosition = 34 + (cellCount * 2);
		for (let index = 0; index < temperatureCount; index += 1) {
			const temperature = readSignedInt16(frame, temperaturePosition);
			if (temperature >= -30 && temperature <= 120) temperatures.push(temperature);
			temperaturePosition += 2;
		}

		const tailPosition = 34 + (cellCount * 2) + (temperatureCount * 2);
		const mosfetTemperatureRaw = readSignedInt16(frame, tailPosition);
		const balancerTemperatureRaw = readSignedInt16(frame, tailPosition + 2);
		const mosfetTemperature = mosfetTemperatureRaw >= -30 && mosfetTemperatureRaw <= 120 ? mosfetTemperatureRaw : null;
		const balancerTemperature = balancerTemperatureRaw >= -30 && balancerTemperatureRaw <= 120 ? balancerTemperatureRaw : null;
		const packVoltage = readUnsignedInt16(frame, tailPosition + 4) * 0.01;
		if (!Number.isFinite(packVoltage) || packVoltage <= 0 || packVoltage > 250) throw new Error('The BMS pack voltage is outside its valid bounds.');
		const currentRaw = readSignedInt16(frame, tailPosition + 6);
		const currentAmps = currentRaw * 0.1;
		if (!Number.isFinite(currentAmps) || Math.abs(currentAmps) > 1500) throw new Error('The BMS current is outside its valid bounds.');

		const stateOfCharge = readUnsignedInt16(frame, tailPosition + 8);
		if (stateOfCharge > 100) throw new Error('The BMS state of charge is outside its valid bounds.');
		const minCellVoltage = Math.min(...cellVoltages);
		const maxCellVoltage = Math.max(...cellVoltages);
		const maxTemperature = temperatures.length ? Math.max(...temperatures) : null;
		const measuredAtMs = Number(timestamp) || Date.now();

		return {
			protocol: 'modern',
			soc: stateOfCharge,
			voltage: Number(packVoltage.toFixed(3)),
			current: Number(currentAmps.toFixed(2)),
			powerKw: Number(((packVoltage * currentAmps) / 1000).toFixed(3)),
			maxTemperature,
			mosfetTemperature,
			balancerTemperature,
			batteryTemperatures: temperatures,
			cellCount,
			temperatureCount,
			cellVoltages,
			minCellVoltage: Number(minCellVoltage.toFixed(3)),
			maxCellVoltage: Number(maxCellVoltage.toFixed(3)),
			cellDeltaMv: minCellVoltage > 0.1 ? Math.round((maxCellVoltage - minCellVoltage) * 1000) : 0,
			measuredAt: nowIso(measuredAtMs),
			measuredAtMs
		};
	}

	function parseLegacyTelemetryFrame(input, timestamp) {
		const frame = bytesFromValue(input);
		if (frame.length < LEGACY_FRAME_BYTES || !LEGACY_TELEMETRY_HEADER.every((byte, index) => frame[index] === byte)) {
			throw new Error('The legacy BMS frame is incomplete or malformed.');
		}

		// The legacy protocol treats zero or an out-of-range count as a 32-cell
		// packet. A valid 1..32 count limits the exposed leading cells.
		const reportedCellCount = frame[123];
		const cellCount = reportedCellCount >= 1 && reportedCellCount <= MAX_CELL_COUNT ? reportedCellCount : MAX_CELL_COUNT;
		const cellVoltages = [];
		for (let index = 0; index < cellCount; index += 1) {
			const volts = readUnsignedInt16Be(frame, 6 + (index * 2)) * 0.001;
			if (!Number.isFinite(volts) || volts < 0 || volts > 6.5) throw new Error('The legacy BMS cell data is outside its valid bounds.');
			cellVoltages.push(volts);
		}
		if (!cellVoltages.some((voltage) => voltage > 0)) throw new Error('The legacy BMS frame contains no usable cell voltage.');

		const temperatures = [];
		for (let index = 0; index < 4; index += 1) {
			const temperature = readSignedInt16Be(frame, 95 + (index * 2));
			if (temperature >= -30 && temperature <= 120) temperatures.push(temperature);
		}
		const mosfetTemperatureRaw = readSignedInt16Be(frame, 91);
		const balancerTemperatureRaw = readSignedInt16Be(frame, 93);
		const mosfetTemperature = mosfetTemperatureRaw >= -30 && mosfetTemperatureRaw <= 120 ? mosfetTemperatureRaw : null;
		const balancerTemperature = balancerTemperatureRaw >= -30 && balancerTemperatureRaw <= 120 ? balancerTemperatureRaw : null;
		const packVoltage = readUnsignedInt16Be(frame, 4) * 0.1;
		if (!Number.isFinite(packVoltage) || packVoltage <= 0 || packVoltage > 250) throw new Error('The legacy BMS pack voltage is outside its valid bounds.');
		const currentAmps = readSignedInt32Be(frame, 70) * 0.1;
		if (!Number.isFinite(currentAmps) || Math.abs(currentAmps) > 1500) throw new Error('The legacy BMS current is outside its valid bounds.');
		const stateOfCharge = frame[74];
		if (stateOfCharge > 100) throw new Error('The legacy BMS state of charge is outside its valid bounds.');

		const minCellVoltage = Math.min(...cellVoltages);
		const maxCellVoltage = Math.max(...cellVoltages);
		const measuredAtMs = Number(timestamp) || Date.now();
		return {
			protocol: 'legacy',
			soc: stateOfCharge,
			voltage: Number(packVoltage.toFixed(3)),
			current: Number(currentAmps.toFixed(2)),
			powerKw: Number(((packVoltage * currentAmps) / 1000).toFixed(3)),
			maxTemperature: temperatures.length ? Math.max(...temperatures) : null,
			mosfetTemperature,
			balancerTemperature,
			batteryTemperatures: temperatures,
			cellCount,
			temperatureCount: 4,
			cellVoltages,
			minCellVoltage: Number(minCellVoltage.toFixed(3)),
			maxCellVoltage: Number(maxCellVoltage.toFixed(3)),
			cellDeltaMv: minCellVoltage > 0.1 ? Math.round((maxCellVoltage - minCellVoltage) * 1000) : 0,
			measuredAt: nowIso(measuredAtMs),
			measuredAtMs
		};
	}

	function headerAt(bytes, position, header) {
		return header.every((byte, index) => bytes[position + index] === byte);
	}

	function findTelemetryHeader(bytes, start) {
		for (let position = Number(start) || 0; position <= bytes.length - 3; position += 1) {
			if (headerAt(bytes, position, TELEMETRY_HEADER)) return { position, protocol: 'modern' };
			if (headerAt(bytes, position, LEGACY_TELEMETRY_HEADER)) return { position, protocol: 'legacy' };
		}
		return null;
	}

	function trailingHeaderPrefixLength(bytes) {
		for (let keep = 2; keep >= 1; keep -= 1) {
			const start = bytes.length - keep;
			if (start < 0) continue;
			if (TELEMETRY_HEADER.slice(0, keep).every((byte, index) => bytes[start + index] === byte)) return keep;
			if (LEGACY_TELEMETRY_HEADER.slice(0, keep).every((byte, index) => bytes[start + index] === byte)) return keep;
		}
		return 0;
	}

	class AvenraHaloBmsDecoder {
		constructor(options) {
			this.options = Object.assign({ maxBufferBytes: MAX_BUFFER_BYTES }, options || {});
			this.buffer = [];
		}

		reset() {
			this.buffer = [];
		}

		push(value, timestamp) {
			const incoming = bytesFromValue(value);
			if (incoming.byteLength) this.buffer.push(...incoming);
			if (this.buffer.length > this.options.maxBufferBytes) {
				this.buffer = this.buffer.slice(-this.options.maxBufferBytes);
			}
			const readings = [];

			while (this.buffer.length) {
				const header = findTelemetryHeader(this.buffer, 0);
				if (!header) {
					const keep = trailingHeaderPrefixLength(this.buffer);
					this.buffer = keep ? this.buffer.slice(-keep) : [];
					break;
				}
				if (header.position > 0) this.buffer.splice(0, header.position);
				if (this.buffer.length < 3) break;

				const frameLength = header.protocol === 'legacy'
					? LEGACY_FRAME_BYTES
					: expectedFrameLength(this.buffer, 0);
				if (frameLength === -1) {
					this.buffer.shift();
					continue;
				}
				if (!frameLength || this.buffer.length < frameLength) break;

				const candidate = Uint8Array.from(this.buffer.slice(0, frameLength));
				try {
					readings.push(header.protocol === 'legacy'
						? parseLegacyTelemetryFrame(candidate, timestamp)
						: parseTelemetryFrame(candidate, timestamp));
					this.buffer.splice(0, frameLength);
				} catch (error) {
					// A false header must not prevent a later genuine frame from being read.
					this.buffer.shift();
				}
			}

			return readings;
		}
	}

	class AvenraHaloBmsBluetooth {
		constructor(options) {
			this.options = Object.assign({
				bluetooth: global.navigator && global.navigator.bluetooth,
				document: global.document || null,
				secureContext: global.isSecureContext !== false,
				serviceUuid: SERVICE_UUID,
				characteristicUuid: CHARACTERISTIC_UUID,
				fallbackServiceUuid: FALLBACK_SERVICE_UUID,
				fallbackNotifyCharacteristicUuid: FALLBACK_NOTIFY_CHARACTERISTIC_UUID,
				fallbackWriteCharacteristicUuid: FALLBACK_WRITE_CHARACTERISTIC_UUID,
				wakeDelayMs: 200,
				legacyProbeDelayMs: 50,
				connectTimeoutMs: 10000,
				discoveryTimeoutMs: 5000,
				notificationTimeoutMs: 5000,
				pingIntervalMs: 2000,
				writeTimeoutMs: 1500,
				staleAfterMs: 7000,
				now: () => Date.now(),
				sleep: (milliseconds) => new Promise((resolve) => (global.setTimeout || setTimeout)(resolve, milliseconds)),
				setInterval: global.setInterval ? global.setInterval.bind(global) : setInterval,
				clearInterval: global.clearInterval ? global.clearInterval.bind(global) : clearInterval,
				setTimeout: global.setTimeout ? global.setTimeout.bind(global) : setTimeout,
				clearTimeout: global.clearTimeout ? global.clearTimeout.bind(global) : clearTimeout,
				onStatus: null,
				onTelemetry: null
			}, options || {});

			this.decoder = new AvenraHaloBmsDecoder();
			this.listeners = new Map();
			this.status = 'idle';
			this.reason = '';
			this.lastError = '';
			this.device = null;
			this.server = null;
			this.characteristic = null;
			this.notifyCharacteristic = null;
			this.writeCharacteristic = null;
			this.activeTransport = null;
			this.protocol = null;
			this.telemetry = null;
			this.lastTelemetryAt = 0;
			this.pingTimer = null;
			this.staleTimer = null;
			this.pingInFlight = false;
			this.generation = 0;
			this.connectPromise = null;
			this.pendingOperations = new Set();
			this.destroyed = false;
			this.boundValueChanged = (event) => this._handleValueChanged(event);
			this.boundDisconnected = () => this._handleGattDisconnected();
		}

		get supported() {
			return Boolean(this.options.secureContext && this.options.bluetooth && typeof this.options.bluetooth.requestDevice === 'function');
		}

		get connected() {
			return Boolean(this.device && this.device.gatt && this.device.gatt.connected
				&& this.notifyCharacteristic && this.writeCharacteristic);
		}

		get live() {
			return this.status === 'live' && this.connected && this.lastTelemetryAt > 0;
		}

		addEventListener(type, listener) {
			if (typeof listener !== 'function') return;
			if (!this.listeners.has(type)) this.listeners.set(type, new Set());
			this.listeners.get(type).add(listener);
		}

		removeEventListener(type, listener) {
			this.listeners.get(type)?.delete(listener);
		}

		on(type, listener) {
			this.addEventListener(type, listener);
			return () => this.removeEventListener(type, listener);
		}

		_emit(type, detail) {
			const event = { type, detail: detail || {}, target: this };
			for (const listener of this.listeners.get(type) || []) {
				try { listener.call(this, event); } catch (error) { /* UI listeners must not interrupt Bluetooth cleanup. */ }
			}
			const callback = type === 'statuschange' ? this.options.onStatus : type === 'telemetry' ? this.options.onTelemetry : null;
			if (typeof callback === 'function') {
				try { callback(event.detail); } catch (error) { /* Rendering is best-effort. */ }
			}
		}

		_setStatus(status, detail) {
			this.status = status;
			this.reason = String(detail && detail.reason ? detail.reason : '');
			if (detail && detail.error) this.lastError = errorMessage(detail.error);
			const snapshot = Object.assign(this.getStatus(), detail || {});
			this._emit('statuschange', snapshot);
			return snapshot;
		}

		getStatus() {
			return {
				status: this.status,
				reason: this.reason,
				supported: this.supported,
				connected: this.connected,
				live: this.live,
				deviceName: String(this.device && this.device.name ? this.device.name : ''),
				protocol: this.protocol,
				transport: this.activeTransport ? this.activeTransport.name : null,
				lastError: this.lastError,
				lastTelemetryAt: this.lastTelemetryAt,
				telemetry: this.telemetry
			};
		}

		async connect() {
			if (this.destroyed) return this._setStatus('unavailable', { reason: 'destroyed' });
			if (!this.supported) {
				return this._setStatus('unavailable', { reason: this.options.secureContext ? 'unsupported' : 'insecure-context' });
			}
			if (this.connectPromise) return this.connectPromise;
			if (this.connected && ['waiting-for-data', 'live', 'stale'].includes(this.status)) return this.getStatus();

			const pending = this._connect();
			const tracked = pending.finally(() => {
				if (this.connectPromise === tracked) this.connectPromise = null;
			});
			this.connectPromise = tracked;
			return tracked;
		}

		async _connect() {
			// Keep requestDevice() in the original button activation. In particular,
			// do not await cleanup before opening the browser's Bluetooth chooser.
			this._clearPingTimer();
			this._clearStaleTimer();
			this.decoder.reset();
			this.lastError = '';
			this.telemetry = null;
			this.lastTelemetryAt = 0;
			this.protocol = null;
			this.activeTransport = null;
			const generation = ++this.generation;
			this._setStatus('scanning', { reason: 'user-request' });
			let device = null;
			try {
				const serviceUuids = [...new Set(this._transportCandidates().map((transport) => transport.serviceUuid))];
				const deviceRequest = Promise.resolve(this.options.bluetooth.requestDevice({
					filters: serviceUuids.map((serviceUuid) => ({ services: [serviceUuid] })),
					optionalServices: serviceUuids
				}));
				deviceRequest.then((selected) => {
					if (!this._isCurrent(generation)) this._disconnectDevice(selected);
				}, () => {});
				device = await this._awaitOperation(deviceRequest, 0, 'Bluetooth selection was cancelled.');
				if (!this._isCurrent(generation)) {
					this._disconnectDevice(device);
					return this.getStatus();
				}
				this.device = device;
				device.addEventListener?.('gattserverdisconnected', this.boundDisconnected);
				this._setStatus('connecting', { reason: 'device-selected' });
				const serverRequest = Promise.resolve(device.gatt.connect());
				serverRequest.then(() => {
					if (!this._isCurrent(generation) || this.device !== device) this._disconnectDevice(device);
				}, () => {});
				const server = await this._awaitOperation(serverRequest, this.options.connectTimeoutMs, 'The Bluetooth connection timed out.');
				if (!this._isCurrent(generation)) {
					this._disconnectDevice(device);
					return this.getStatus();
				}
				this.server = server;
				const discovered = await this._discoverTransport(server, generation);
				if (!this._isCurrent(generation)) return this._lateConnectionCleanup(device);
				this.activeTransport = discovered.transport;
				this.notifyCharacteristic = discovered.notifyCharacteristic;
				this.writeCharacteristic = discovered.writeCharacteristic;
				// Retain the original public field as an alias for callers that only knew
				// the shared FFE1 transport. Notifications always come from this channel.
				this.characteristic = discovered.notifyCharacteristic;
				this.notifyCharacteristic.addEventListener?.('characteristicvaluechanged', this.boundValueChanged);
				await this._awaitOperation(
					Promise.resolve(this.notifyCharacteristic.startNotifications()),
					this.options.notificationTimeoutMs,
					'The BMS notification stream did not start in time.'
				);
				if (!this._isCurrent(generation)) return this._lateConnectionCleanup(device);
				// Some BMS units notify as soon as notifications start. Do not
				// overwrite an already-valid live reading with a waiting state.
				if (!this.lastTelemetryAt) this._setStatus('waiting-for-data', { reason: 'notifications-started' });
				this._armStaleTimer(generation);
				await this.options.sleep(this.options.wakeDelayMs);
				if (!this._isCurrent(generation)) return this._lateConnectionCleanup(device);
				await this._sendProbeCycle(generation);
				if (!this._isCurrent(generation)) return this._lateConnectionCleanup(device);
				this._startPingTimer(generation);
				return this.getStatus();
			} catch (error) {
				if (!this._isCurrent(generation)) {
					this._disconnectDevice(device);
					return this.getStatus();
				}
				const cancelled = error && error.name === 'NotFoundError';
				this.generation += 1;
				this._cancelPendingOperations('connection-ended');
				await this._cleanupConnection(true);
				return this._setStatus(cancelled ? 'idle' : 'error', {
					reason: cancelled ? 'selection-cancelled' : 'connection-failed',
					error: cancelled ? null : error
				});
			}
		}

		_transportCandidates() {
			return [
				{
					name: 'ffe0',
					serviceUuid: this.options.serviceUuid,
					notifyCharacteristicUuid: this.options.characteristicUuid,
					writeCharacteristicUuid: this.options.characteristicUuid
				},
				{
					name: 'ff00',
					serviceUuid: this.options.fallbackServiceUuid,
					notifyCharacteristicUuid: this.options.fallbackNotifyCharacteristicUuid,
					writeCharacteristicUuid: this.options.fallbackWriteCharacteristicUuid
				}
			].filter((transport, index, transports) => transport.serviceUuid
				&& transport.notifyCharacteristicUuid
				&& transport.writeCharacteristicUuid
				&& transports.findIndex((candidate) => candidate.serviceUuid === transport.serviceUuid
					&& candidate.notifyCharacteristicUuid === transport.notifyCharacteristicUuid
					&& candidate.writeCharacteristicUuid === transport.writeCharacteristicUuid) === index);
		}

		async _discoverTransport(server, generation) {
			let lastError = null;
			for (const transport of this._transportCandidates()) {
				try {
					const service = await this._awaitOperation(
						Promise.resolve(server.getPrimaryService(transport.serviceUuid)),
						this.options.discoveryTimeoutMs,
						'The HyperCore BMS service was not found in time.'
					);
					if (!this._isCurrent(generation)) throw new Error('The BMS discovery was cancelled.');
					const notifyCharacteristic = await this._awaitOperation(
						Promise.resolve(service.getCharacteristic(transport.notifyCharacteristicUuid)),
						this.options.discoveryTimeoutMs,
						'The HyperCore BMS notification channel was not found in time.'
					);
					if (!this._isCurrent(generation)) throw new Error('The BMS discovery was cancelled.');
					const writeCharacteristic = transport.writeCharacteristicUuid === transport.notifyCharacteristicUuid
						? notifyCharacteristic
						: await this._awaitOperation(
							Promise.resolve(service.getCharacteristic(transport.writeCharacteristicUuid)),
							this.options.discoveryTimeoutMs,
							'The HyperCore BMS read-request channel was not found in time.'
						);
					return { transport, notifyCharacteristic, writeCharacteristic };
				} catch (error) {
					lastError = error;
					if (!this._isCurrent(generation)) throw error;
				}
			}
			const roleError = new Error('The selected Bluetooth device does not expose a supported HyperCore BMS telemetry transport.');
			roleError.name = 'NotSupportedError';
			roleError.cause = lastError;
			throw roleError;
		}

		async _lateConnectionCleanup(device) {
			await this._cleanupConnection(true);
			this._disconnectDevice(device);
			return this.getStatus();
		}

		_isCurrent(generation) {
			return !this.destroyed && generation === this.generation;
		}

		_awaitOperation(operation, timeoutMs, timeoutMessage) {
			return new Promise((resolve, reject) => {
				let settled = false;
				let timeout = null;
				const finish = (callback, value) => {
					if (settled) return;
					settled = true;
					if (timeout !== null) this.options.clearTimeout(timeout);
					this.pendingOperations.delete(cancel);
					callback(value);
				};
				const cancel = (reason) => {
					const error = new Error(String(reason || 'Bluetooth operation cancelled.'));
					error.name = 'AbortError';
					finish(reject, error);
				};
				this.pendingOperations.add(cancel);
				if (Number(timeoutMs) > 0) {
					timeout = this.options.setTimeout(() => {
						const error = new Error(String(timeoutMessage || 'The Bluetooth operation timed out.'));
						error.name = 'TimeoutError';
						finish(reject, error);
					}, Number(timeoutMs));
				}
				Promise.resolve(operation).then((value) => finish(resolve, value), (error) => finish(reject, error));
			});
		}

		_cancelPendingOperations(reason) {
			for (const cancel of [...this.pendingOperations]) cancel(reason);
			this.pendingOperations.clear();
		}

		_startPingTimer(generation) {
			this._clearPingTimer();
			this.pingTimer = this.options.setInterval(() => {
				this._sendProbeCycle(generation).catch((error) => {
					if (this._isCurrent(generation) && this.connected) {
						this._setStatus('stale', { reason: 'wake-write-failed', error });
					}
				});
			}, this.options.pingIntervalMs);
		}

		async _sendProbeCycle(generation) {
			if (this.protocol === 'legacy') return this._sendLegacyProbe(generation);
			if (this.protocol === 'modern') return this._sendWakePing(generation);
			let modernSent = false;
			let modernError = null;
			try {
				modernSent = await this._sendWakePing(generation);
			} catch (error) {
				modernError = error;
			}
			if (!this._isCurrent(generation) || !this.connected) {
				if (modernError) throw modernError;
				return modernSent;
			}
			if (this.protocol) return modernSent;
			await this.options.sleep(this.options.legacyProbeDelayMs);
			if (!this._isCurrent(generation) || !this.connected || this.protocol) return modernSent;
			try {
				return await this._sendLegacyProbe(generation);
			} catch (legacyError) {
				if (modernSent) return true;
				throw legacyError || modernError;
			}
		}

		_clearPingTimer() {
			if (this.pingTimer !== null) this.options.clearInterval(this.pingTimer);
			this.pingTimer = null;
			this.pingInFlight = false;
		}

		_armStaleTimer(generation) {
			if (this.staleTimer !== null) this.options.clearTimeout(this.staleTimer);
			this.staleTimer = this.options.setTimeout(() => {
				this.staleTimer = null;
				if (!this._isCurrent(generation) || !this.connected) return;
				this._setStatus('stale', { reason: this.lastTelemetryAt ? 'telemetry-stale' : 'no-telemetry' });
			}, this.options.staleAfterMs);
		}

		_clearStaleTimer() {
			if (this.staleTimer !== null) this.options.clearTimeout(this.staleTimer);
			this.staleTimer = null;
		}

		async _sendWakePing(generation) {
			if (!this._isCurrent(generation) || !this.connected || !this.writeCharacteristic || this.pingInFlight) return false;
			this.pingInFlight = true;
			const characteristic = this.writeCharacteristic;
			const payload = generateWakePing();
			let lastError = null;
			try {
				const writers = ['writeValueWithResponse', 'writeValue', 'writeValueWithoutResponse'];
				for (const method of writers) {
					if (typeof characteristic[method] !== 'function') continue;
					try {
						await this._writeWithTimeout(characteristic, method, payload);
						return true;
					} catch (error) {
						lastError = error;
						if (!this._isCurrent(generation) || !this.connected) throw error;
					}
				}
				throw lastError || new Error('The BMS characteristic cannot accept its wake request.');
			} finally {
				this.pingInFlight = false;
			}
		}

		async _sendLegacyProbe(generation) {
			if (!this._isCurrent(generation) || !this.connected || !this.writeCharacteristic || this.pingInFlight) return false;
			this.pingInFlight = true;
			const characteristic = this.writeCharacteristic;
			const payload = generateLegacyProbe();
			let lastError = null;
			try {
				for (const method of ['writeValueWithResponse', 'writeValue', 'writeValueWithoutResponse']) {
					if (typeof characteristic[method] !== 'function') continue;
					try {
						await this._writeWithTimeout(characteristic, method, payload);
						return true;
					} catch (error) {
						lastError = error;
						if (!this._isCurrent(generation) || !this.connected) throw error;
					}
				}
				throw lastError || new Error('The BMS characteristic cannot accept its legacy read probe.');
			} finally {
				this.pingInFlight = false;
			}
		}

		_writeWithTimeout(characteristic, method, payload) {
			return this._awaitOperation(
				Promise.resolve().then(() => characteristic[method](payload)),
				this.options.writeTimeoutMs,
				'The BMS read request timed out.'
			);
		}

		_handleValueChanged(event) {
			if (!this.connected || !event || !event.target) return;
			const generation = this.generation;
			const timestamp = this.options.now();
			const readings = this.decoder.push(event.target.value, timestamp);
			for (const reading of readings) {
				if (!this._isCurrent(generation) || !this.connected) return;
				if (this.protocol && reading.protocol !== this.protocol) continue;
				if (!this.protocol) this.protocol = reading.protocol;
				this.telemetry = reading;
				this.lastTelemetryAt = reading.measuredAtMs;
				this.lastError = '';
				if (this.status !== 'live') this._setStatus('live', { reason: 'telemetry-received' });
				this._emit('telemetry', Object.assign({}, reading));
				this._armStaleTimer(generation);
			}
		}

		_handleGattDisconnected() {
			if (!this.device && !this.notifyCharacteristic && !this.writeCharacteristic) return;
			const generation = ++this.generation;
			this._cancelPendingOperations('gatt-disconnected');
			this._cleanupConnection(false).finally(() => {
				// A quick rider-initiated reconnect may already be using a newer
				// generation by the time the old notification stream finishes stopping.
				if (this._isCurrent(generation)) this._setStatus('disconnected', { reason: 'gatt-disconnected' });
			});
		}

		async _cleanupConnection(disconnectGatt) {
			this._clearPingTimer();
			this._clearStaleTimer();
			this.decoder.reset();
			const characteristic = this.notifyCharacteristic;
			const device = this.device;
			this.characteristic = null;
			this.notifyCharacteristic = null;
			this.writeCharacteristic = null;
			this.activeTransport = null;
			this.protocol = null;
			this.server = null;
			this.device = null;
			device?.removeEventListener?.('gattserverdisconnected', this.boundDisconnected);
			if (characteristic) {
				characteristic.removeEventListener?.('characteristicvaluechanged', this.boundValueChanged);
				// A deliberate privacy shutdown drops GATT immediately. Some WebViews
				// leave stopNotifications() pending forever, so it must never delay radio
				// teardown, sign-out, account change or background cleanup.
				if (disconnectGatt) this._disconnectDevice(device);
				else if (device?.gatt?.connected) {
					try { await characteristic.stopNotifications?.(); } catch (error) { /* A lost link cannot stop notifications. */ }
				}
			}
			else if (disconnectGatt) this._disconnectDevice(device);
		}

		_disconnectDevice(device) {
			try {
				if (device && device.gatt && device.gatt.connected) device.gatt.disconnect();
			} catch (error) { /* The radio may already have ended the GATT session. */ }
		}

		async disconnect(reason, options) {
			const settings = Object.assign({ silent: false }, options || {});
			this.generation += 1;
			this._cancelPendingOperations(reason || 'user-disconnected');
			await this._cleanupConnection(true);
			this.telemetry = null;
			this.lastTelemetryAt = 0;
			this.lastError = '';
			if (settings.silent) {
				this.status = 'idle';
				this.reason = String(reason || 'disconnected');
				return this.getStatus();
			}
			return this._setStatus(reason === 'document-hidden' ? 'disconnected' : 'idle', { reason: reason || 'user-disconnected' });
		}

		async destroy() {
			if (this.destroyed) return;
			await this.disconnect('destroyed', { silent: true });
			this.destroyed = true;
			this.listeners.clear();
		}
	}

	return {
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
		parseLegacyTelemetryFrame,
		bytesFromValue,
		expectedFrameLength
	};
}));
