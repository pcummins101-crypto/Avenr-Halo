(function (global, factory) {
	'use strict';

	const exports = factory(global || {});
	if (typeof module === 'object' && module.exports) module.exports = exports;
	if (global) {
		global.AvenraHaloHyperCoreEcuClass = exports.HyperCoreEcuBluetooth;
		global.AvenraHaloHyperCoreEcuProtocol = exports;
	}
}(typeof globalThis !== 'undefined' ? globalThis : this, function (global) {
	'use strict';

	const SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
	const CHARACTERISTIC_UUID = '0000ffec-0000-1000-8000-00805f9b34fb';
	const FRAME_BYTES = 16;
	const CRC_INITIAL_VALUE = 0x7f3c;
	const MAX_BUFFER_BYTES = 4096;
	const KM_TO_MILES = 0.621371192237334;
	const SPEED_FACTOR = 0.0037699113633689247;

	// Read-only register cycle recovered from the HyperCore powertrain protocol. No
	// configuration, firmware, authentication or remote-drive writes are exposed.
	const POLL_REGISTERS = Object.freeze([
		0xe2, 0xe8, 0xee, 0xf4, 0xfa, 0xd6, 0x24,
		0x2a, 0x30, 0x18, 0x69, 0x7c, 0xd0
	]);

	// Modern notifications identify a page, not the register address directly.
	// Each page contains six little-endian 16-bit words beginning at its base.
	const PAGE_REGISTER_MAP = Object.freeze([
		0xe2, 0xe8, 0xee, 0x00, 0x06, 0x0c, 0x12,
		0xe2, 0xe8, 0xee, 0x18, 0x1e, 0x24, 0x2a,
		0xe2, 0xe8, 0xee, 0x30, 0x5d, 0x63, 0x69,
		0xe2, 0xe8, 0xee, 0x7c, 0x82, 0x88, 0x8e,
		0xe2, 0xe8, 0xee, 0x94, 0x9a, 0xa0, 0xa6,
		0xe2, 0xe8, 0xee, 0xac, 0xb2, 0xb8, 0xbe,
		0xe2, 0xe8, 0xee, 0xc4, 0xca, 0xd0,
		0xe2, 0xe8, 0xee, 0xd6, 0xdc, 0xf4, 0xfa
	]);

	const errorMessage = (error) => String(error && error.message ? error.message : error || 'Unknown Bluetooth error');
	const nowIso = (value) => new Date(Number(value) || Date.now()).toISOString();

	function bytesFromValue(value) {
		if (value instanceof Uint8Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		if (value instanceof DataView) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		if (value instanceof ArrayBuffer) return new Uint8Array(value);
		if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		if (Array.isArray(value)) return Uint8Array.from(value);
		return new Uint8Array(0);
	}

	function readUnsignedInt16Le(bytes, position) {
		return (bytes[position] | (bytes[position + 1] << 8)) >>> 0;
	}

	function readSignedInt16Le(bytes, position) {
		const value = readUnsignedInt16Le(bytes, position);
		return value >= 0x8000 ? value - 0x10000 : value;
	}

	function readUnsignedInt16Be(bytes, position) {
		return ((bytes[position] << 8) | bytes[position + 1]) >>> 0;
	}

	function readSignedInt16Be(bytes, position) {
		const value = readUnsignedInt16Be(bytes, position);
		return value >= 0x8000 ? value - 0x10000 : value;
	}

	function crc16HyperCore(input, initialValue) {
		const bytes = bytesFromValue(input);
		let crc = Number.isInteger(initialValue) ? (initialValue & 0xffff) : CRC_INITIAL_VALUE;
		for (const byte of bytes) {
			crc ^= byte;
			for (let bit = 0; bit < 8; bit += 1) {
				crc = (crc & 1) ? ((crc >>> 1) ^ 0xa001) : (crc >>> 1);
			}
		}
		return crc & 0xffff;
	}

	function buildReadPacket(register) {
		const address = Number(register);
		if (!Number.isInteger(address) || address < 0 || address > 0xff) {
			throw new RangeError('The HyperCore ECU register must be an unsigned byte.');
		}
		const packet = new Uint8Array([address, address, 0x80, 0x00, 0x00]);
		const crc = crc16HyperCore(packet.subarray(0, 3));
		packet[3] = crc & 0xff;
		packet[4] = (crc >>> 8) & 0xff;
		return packet;
	}

	function legacyChecksum(input) {
		const bytes = bytesFromValue(input);
		let checksum = 0;
		for (const byte of bytes) checksum = (checksum + byte) & 0xffff;
		return checksum;
	}

	function frameValidation(input) {
		const frame = bytesFromValue(input);
		if (frame.byteLength !== FRAME_BYTES) return { valid: false, reason: 'length' };
		if (frame[0] !== 0xaa) return { valid: false, reason: 'header' };
		if ((frame[1] & 0x80) !== 0) {
			const expected = crc16HyperCore(frame.subarray(0, 14));
			const received = frame[14] | (frame[15] << 8);
			return expected === received
				? { valid: true, protocol: 'modern', checksum: received }
				: { valid: false, protocol: 'modern', reason: 'crc', expected, received };
		}
		const expected = legacyChecksum(frame.subarray(0, 14));
		const received = (frame[14] << 8) | frame[15];
		return expected === received
			? { valid: true, protocol: 'legacy', checksum: received }
			: { valid: false, protocol: 'legacy', reason: 'checksum', expected, received };
	}

	function validateFrame(input) {
		return frameValidation(input).valid;
	}

	function parseFrame(input) {
		const source = bytesFromValue(input);
		const validation = frameValidation(source);
		if (!validation.valid) throw new Error(`The HyperCore ECU frame is invalid (${validation.reason}).`);
		const frame = Uint8Array.from(source);
		const modern = validation.protocol === 'modern';
		const page = modern ? (frame[1] & 0x7f) : frame[1];
		const register = modern ? (PAGE_REGISTER_MAP[page] ?? null) : page;
		const words = [];
		for (let position = 2; position <= 12; position += 2) {
			words.push(modern ? readUnsignedInt16Le(frame, position) : readUnsignedInt16Be(frame, position));
		}
		return {
			protocol: validation.protocol,
			page,
			register,
			words,
			payload: frame.slice(2, 14),
			checksum: validation.checksum,
			bytes: frame
		};
	}

	function clamp(value, minimum, maximum) {
		return Math.max(minimum, Math.min(maximum, value));
	}

	function finiteOrNull(value) {
		if (value === null || value === undefined || value === '') return null;
		return Number.isFinite(Number(value)) ? Number(value) : null;
	}

	function faultMessages(flags, context) {
		if (!Array.isArray(flags) || flags.length < 2) return null;
		const first = Number(flags[0]) & 0xff;
		const second = Number(flags[1]) & 0x7f;
		const details = context || {};
		const messages = [];
		const add = (condition, message) => { if (condition) messages.push(message); };
		add(first & 0x01, 'Motor position sensor');
		add(first & 0x02, 'Throttle signal');
		add(first & 0x04, 'Current protection');
		add(first & 0x08, 'Phase surge');
		add(first & 0x10, details.voltageDirection === 'over' ? 'Over-voltage' : details.voltageDirection === 'under' ? 'Under-voltage' : 'Voltage protection');
		add(first & 0x20, 'ECU alarm');
		add(first & 0x40, 'Motor over-temperature');
		add(first & 0x80, 'ECU over-temperature');
		add(second & 0x01, 'Phase over-current');
		add(second & 0x02, 'Phase zero');
		add(second & 0x04, details.phaseShort === true ? 'Phase short' : details.phaseShort === false ? 'Phase lost' : 'Phase loss or short');
		add(second & 0x08, 'Line zero');
		add(second & 0x10, 'High-side transistor');
		add(second & 0x20, 'Low-side transistor');
		add(second & 0x40, 'Motor-output protection');
		add(details.brakeAlarm, 'Brake alarm');
		return messages;
	}

	function emptyTelemetry() {
		return {
			source: 'hypercore-ecu',
			label: 'HyperCore ECU',
			protocol: null,
			rpm: null,
			diagnosticSpeedKmh: null,
			diagnosticSpeedMph: null,
			diagnosticSpeedSource: null,
			voltage: null,
			current: null,
			powerW: null,
			powerKw: null,
			phaseCurrentA: null,
			phaseCurrentC: null,
			motorTemperature: null,
			controllerTemperature: null,
			throttlePercent: null,
			throttleSource: null,
			modulationPercent: null,
			gear: null,
			faults: null,
			faultMessages: null,
			faultSummary: null,
			faultActive: false,
			brakeActive: null,
			polePairs: null,
			// State of charge belongs to HyperCore BMS. The ECU byte at F4/5 is
			// intentionally not promoted as battery authority.
			soc: null,
			throttleRaw: null,
			throttleVoltage: null,
			freshFields: [],
			fieldTimestamps: {},
			fieldSources: {},
			measuredAt: null,
			measuredAtMs: 0
		};
	}

	function cloneTelemetry(telemetry) {
		return Object.assign({}, telemetry, {
			faults: Array.isArray(telemetry.faults) ? telemetry.faults.slice() : telemetry.faults,
			faultMessages: Array.isArray(telemetry.faultMessages) ? telemetry.faultMessages.slice() : telemetry.faultMessages,
			freshFields: Array.isArray(telemetry.freshFields) ? telemetry.freshFields.slice() : [],
			fieldTimestamps: Object.assign({}, telemetry.fieldTimestamps || {}),
			fieldSources: Object.assign({}, telemetry.fieldSources || {})
		});
	}

	class HyperCoreEcuDecoder {
		constructor(options) {
			this.options = Object.assign({
				maxBufferBytes: MAX_BUFFER_BYTES,
				polePairs: 4,
				telemetryDecoder: null,
				speedKmhFromRpm: null
			}, options || {});
			this.reset();
		}

		reset() {
			this.buffer = [];
			this.rawWords = Object.create(null);
			this.rawPages = Object.create(null);
			this.telemetry = emptyTelemetry();
			this.validFrames = 0;
			this.invalidFrames = 0;
			this.discardedBytes = 0;
			this.rawRpm = null;
			this.polePairs = Number(this.options.polePairs) || 4;
			this.speedConfiguration = null;
			this.throttleCalibration = null;
			this.faultContext = { voltageDirection: null, phaseShort: null, brakeAlarm: false };
		}

		getTelemetry() {
			return cloneTelemetry(this.telemetry);
		}

		getRawState() {
			const clone = (source) => Object.fromEntries(Object.entries(source).map(([key, value]) => [key, value.slice()]));
			return {
				wordsByRegister: clone(this.rawWords),
				wordsByPage: clone(this.rawPages),
				validFrames: this.validFrames,
				invalidFrames: this.invalidFrames,
				discardedBytes: this.discardedBytes
			};
		}

		push(value, timestamp) {
			const incoming = bytesFromValue(value);
			if (incoming.byteLength) this.buffer.push(...incoming);
			if (this.buffer.length > this.options.maxBufferBytes) {
				const removed = this.buffer.length - this.options.maxBufferBytes;
				this.buffer = this.buffer.slice(-this.options.maxBufferBytes);
				this.discardedBytes += removed;
			}

			const updates = [];
			while (this.buffer.length) {
				const headerPosition = this.buffer.indexOf(0xaa);
				if (headerPosition < 0) {
					this.discardedBytes += this.buffer.length;
					this.buffer = [];
					break;
				}
				if (headerPosition > 0) {
					this.discardedBytes += headerPosition;
					this.buffer.splice(0, headerPosition);
				}
				if (this.buffer.length < FRAME_BYTES) break;

				const candidate = Uint8Array.from(this.buffer.slice(0, FRAME_BYTES));
				let frame;
				try {
					frame = parseFrame(candidate);
				} catch (error) {
					this.invalidFrames += 1;
					this.discardedBytes += 1;
					this.buffer.shift();
					continue;
				}

				this.buffer.splice(0, FRAME_BYTES);
				this.validFrames += 1;
				const measuredAtMs = Number(timestamp) || Date.now();
				const changedFields = this._applyFrame(frame, measuredAtMs);
				updates.push({ frame, telemetry: this.getTelemetry(), changedFields });
			}
			return updates;
		}

		_applyFrame(frame, measuredAtMs) {
			const key = frame.register === null ? `page-${frame.page}` : String(frame.register);
			this.rawWords[key] = frame.words.slice();
			this.rawPages[String(frame.page)] = frame.words.slice();
			const before = this.telemetry;
			let next = cloneTelemetry(before);
			if (frame.protocol === 'modern') next = this._applyModernFrame(next, frame);
			else next = this._applyLegacyFrame(next, frame);

			if (typeof this.options.telemetryDecoder === 'function') {
				const custom = this.options.telemetryDecoder({
					frame,
					telemetry: cloneTelemetry(next),
					raw: this.getRawState()
				});
				if (custom && typeof custom === 'object') next = Object.assign(next, custom);
			}

			const changedFields = Object.keys(next).filter((field) => {
				if (['measuredAt', 'measuredAtMs', 'freshFields', 'fieldTimestamps', 'fieldSources'].includes(field)) return false;
				return JSON.stringify(next[field]) !== JSON.stringify(before[field]);
			});
			const freshFields = [...new Set([...this._fieldsForFrame(frame), ...changedFields])]
				.filter((field) => next[field] !== null && next[field] !== undefined);
			next.protocol = frame.protocol;
			next.measuredAtMs = measuredAtMs;
			next.measuredAt = nowIso(measuredAtMs);
			next.freshFields = freshFields;
			next.fieldTimestamps = Object.assign({}, before.fieldTimestamps || {});
			next.fieldSources = Object.assign({}, before.fieldSources || {});
			for (const field of freshFields) {
				next.fieldTimestamps[field] = measuredAtMs;
				next.fieldSources[field] = 'hypercore-ecu';
			}
			for (const field of Object.keys(next)) {
				if (typeof next[field] === 'number' && !Number.isFinite(next[field])) next[field] = null;
			}
			this.telemetry = next;
			return freshFields;
		}

		_fieldsForFrame(frame) {
			if (frame.protocol === 'modern') {
				switch (frame.register) {
					case 0xe2: return ['rpm', 'diagnosticSpeedKmh', 'diagnosticSpeedMph', 'modulationPercent', 'gear', 'faults', 'faultMessages', 'faultSummary', 'faultActive'];
					case 0xe8: return ['voltage', 'current', 'powerW', 'powerKw', 'throttleRaw', 'throttlePercent', 'throttleSource'];
					case 0xee: return ['phaseCurrentA', 'phaseCurrentC'];
					case 0xf4: return ['motorTemperature'];
					case 0xfa: return ['polePairs', 'rpm', 'diagnosticSpeedKmh', 'diagnosticSpeedMph', 'faultMessages', 'faultSummary', 'faultActive'];
					case 0xd6: return ['controllerTemperature', 'brakeActive', 'faultMessages', 'faultSummary', 'faultActive'];
					case 0x82: return ['throttleVoltage', 'throttlePercent', 'throttleSource'];
					case 0x06: return ['throttlePercent', 'throttleSource'];
					case 0xd0: return ['diagnosticSpeedKmh', 'diagnosticSpeedMph', 'diagnosticSpeedSource'];
					default: return [];
				}
			}
			switch (frame.page) {
				case 0: return ['rpm', 'diagnosticSpeedKmh', 'diagnosticSpeedMph', 'gear', 'faults', 'faultActive'];
				case 1: return ['voltage', 'current', 'powerW', 'powerKw', 'modulationPercent', 'throttleRaw', 'throttlePercent', 'throttleSource'];
				case 2: return ['phaseCurrentA', 'phaseCurrentC'];
				case 4: return ['controllerTemperature'];
				case 13: return ['motorTemperature', 'throttleVoltage', 'throttlePercent', 'throttleSource'];
				default: return [];
			}
		}

		_applyModernFrame(telemetry, frame) {
			const bytes = frame.bytes;
			switch (frame.register) {
				case 0xe2: {
					this.rawRpm = readUnsignedInt16Le(bytes, 8);
					const polePairs = Number(this.polePairs);
					telemetry.rpm = polePairs >= 16 ? (this.rawRpm * 4) / polePairs : this.rawRpm;
					telemetry.modulationPercent = (bytes[6] / 128) * 100;
					telemetry.gear = bytes[2] & 0x03;
					telemetry.faults = [bytes[4], bytes[5] & 0x7f];
					this._applyFaults(telemetry);
					this._applySpeed(telemetry);
					break;
				}
				case 0xe8:
					telemetry.voltage = readUnsignedInt16Le(bytes, 2) / 10;
					telemetry.current = readSignedInt16Le(bytes, 6) / 4;
					telemetry.powerW = telemetry.voltage * telemetry.current;
					telemetry.powerKw = telemetry.powerW / 1000;
					telemetry.throttleRaw = readUnsignedInt16Le(bytes, 12);
					this._applyThrottle(telemetry);
					break;
				case 0xee: {
					const phaseARaw = (bytes[6] << 16) | (bytes[7] << 8) | bytes[8];
					const phaseCRaw = (bytes[9] << 16) | (bytes[10] << 8) | bytes[11];
					telemetry.phaseCurrentA = Math.sqrt(phaseARaw) * 1.953125;
					telemetry.phaseCurrentC = Math.sqrt(phaseCRaw) * 1.953125;
					break;
				}
				case 0xf4:
					telemetry.motorTemperature = readSignedInt16Le(bytes, 2);
					break;
				case 0xfa:
					if (bytes[6]) this.polePairs = bytes[6];
					this.faultContext.brakeAlarm = readSignedInt16Le(bytes, 6) < 0;
					telemetry.polePairs = this.polePairs;
					if (this.rawRpm !== null) telemetry.rpm = this.polePairs >= 16 ? (this.rawRpm * 4) / this.polePairs : this.rawRpm;
					this._applySpeed(telemetry);
					this._applyFaults(telemetry);
					break;
				case 0xd6:
					telemetry.controllerTemperature = readSignedInt16Le(bytes, 12);
					telemetry.brakeActive = Boolean(bytes[6] & 0x08);
					this.faultContext.voltageDirection = readSignedInt16Le(bytes, 6) < 0 ? 'over' : 'under';
					this.faultContext.phaseShort = Boolean(readUnsignedInt16Le(bytes, 4) & 0x0800);
					this._applyFaults(telemetry);
					break;
				case 0x82:
					telemetry.throttleVoltage = readUnsignedInt16Le(bytes, 2) * 0.01;
					this._applyThrottle(telemetry);
					break;
				case 0x06:
					this.throttleCalibration = { low: bytes[6] / 20, high: bytes[7] / 20 };
					this._applyThrottle(telemetry);
					break;
				case 0xd0: {
					const tireWidth = bytes[6];
					const wheelDiameter = bytes[7];
					const aspectRatio = bytes[9];
					const ratioRaw = readUnsignedInt16Le(bytes, 10);
					this.speedConfiguration = tireWidth && wheelDiameter && aspectRatio && ratioRaw
						? { circumferenceFactor: (aspectRatio * tireWidth) + (wheelDiameter * 1270), ratioRaw }
						: null;
					this._applySpeed(telemetry);
					break;
				}
				default:
					break;
			}
			return telemetry;
		}

		_applyLegacyFrame(telemetry, frame) {
			const bytes = frame.bytes;
			switch (frame.page) {
				case 0:
					this.rawRpm = readUnsignedInt16Be(bytes, 6);
					telemetry.rpm = this.rawRpm;
					telemetry.gear = bytes[4] & 0x03;
					telemetry.faults = [bytes[8], bytes[9] & 0x7f];
					this._applyFaults(telemetry);
					this._applySpeed(telemetry);
					break;
				case 1:
					telemetry.voltage = readSignedInt16Be(bytes, 2) / 10;
					telemetry.current = readSignedInt16Be(bytes, 4) / 4;
					telemetry.powerW = telemetry.voltage * telemetry.current;
					telemetry.powerKw = telemetry.powerW / 1000;
					telemetry.modulationPercent = (bytes[6] / 128) * 100;
					telemetry.throttleRaw = readUnsignedInt16Be(bytes, 12);
					this._applyThrottle(telemetry);
					break;
				case 2: {
					const phaseARaw = (bytes[2] << 16) | (bytes[3] << 8) | bytes[4];
					const phaseCRaw = (bytes[9] << 16) | (bytes[10] << 8) | bytes[11];
					telemetry.phaseCurrentA = Math.sqrt(phaseARaw) * 1.953125;
					telemetry.phaseCurrentC = Math.sqrt(phaseCRaw) * 1.953125;
					break;
				}
				case 4:
					telemetry.controllerTemperature = bytes[4] > 200 ? bytes[4] - 256 : bytes[4];
					break;
				case 10:
					break;
				case 13:
					telemetry.motorTemperature = bytes[2] > 127 ? bytes[2] - 256 : bytes[2];
					telemetry.throttleVoltage = readUnsignedInt16Be(bytes, 4) * 0.0012084960762877017;
					this._applyThrottle(telemetry);
					break;
				default:
					break;
			}
			return telemetry;
		}

		_applyFaults(telemetry) {
			if (!Array.isArray(telemetry.faults)) return;
			telemetry.faultMessages = faultMessages(telemetry.faults, this.faultContext) || [];
			telemetry.faultActive = telemetry.faultMessages.length > 0;
			telemetry.faultSummary = telemetry.faultActive
				? telemetry.faultMessages.join(' · ')
				: 'No active faults';
		}

		_applySpeed(telemetry) {
			let speedKmh = null;
			let source = null;
			if (this.rawRpm !== null && this.speedConfiguration) {
				speedKmh = (this.rawRpm * SPEED_FACTOR * this.speedConfiguration.circumferenceFactor)
					/ this.speedConfiguration.ratioRaw;
				source = 'hypercore-ecu-calculated';
			} else if (this.rawRpm !== null && typeof this.options.speedKmhFromRpm === 'function') {
				speedKmh = finiteOrNull(this.options.speedKmhFromRpm(this.rawRpm, cloneTelemetry(telemetry)));
				source = 'hypercore-ecu-custom';
			}
			telemetry.diagnosticSpeedKmh = finiteOrNull(speedKmh);
			telemetry.diagnosticSpeedMph = telemetry.diagnosticSpeedKmh === null ? null : telemetry.diagnosticSpeedKmh * KM_TO_MILES;
			telemetry.diagnosticSpeedSource = source;
		}

		_applyThrottle(telemetry) {
			const calibration = this.throttleCalibration;
			if (telemetry.throttleVoltage !== null && telemetry.throttleVoltage > 0.01
				&& calibration && calibration.high > calibration.low) {
				telemetry.throttlePercent = clamp(
					((telemetry.throttleVoltage - calibration.low) / (calibration.high - calibration.low)) * 100,
					0,
					100
				);
				telemetry.throttleSource = 'voltage-calibrated';
				return;
			}
			if (telemetry.throttleRaw !== null) {
				// The protocol's native fallback is raw * 100 / 384. HALO clamps
				// the presentation to a truthful percentage range for the rider UI.
				telemetry.throttlePercent = clamp((telemetry.throttleRaw * 100) / 384, 0, 100);
				telemetry.throttleSource = 'raw-fallback';
			}
		}
	}

	class HyperCoreEcuBluetooth {
		constructor(options) {
			this.options = Object.assign({
				bluetooth: global.navigator && global.navigator.bluetooth,
				secureContext: global.isSecureContext !== false,
				serviceUuid: SERVICE_UUID,
				characteristicUuid: CHARACTERISTIC_UUID,
				pollRegisters: POLL_REGISTERS,
				pollIntervalMs: 30,
				staleAfterMs: 2500,
				connectTimeoutMs: 10000,
				discoveryTimeoutMs: 5000,
				notificationTimeoutMs: 5000,
				writeTimeoutMs: 1200,
				autoReconnect: false,
				reconnectDelayMs: 1000,
				maxReconnectAttempts: 3,
				now: () => Date.now(),
				setInterval: global.setInterval ? global.setInterval.bind(global) : setInterval,
				clearInterval: global.clearInterval ? global.clearInterval.bind(global) : clearInterval,
				setTimeout: global.setTimeout ? global.setTimeout.bind(global) : setTimeout,
				clearTimeout: global.clearTimeout ? global.clearTimeout.bind(global) : clearTimeout,
				onStatus: null,
				onTelemetry: null,
				onFrame: null,
				decoderOptions: null
			}, options || {});

			this.decoder = new HyperCoreEcuDecoder(this.options.decoderOptions || {});
			this.listeners = new Map();
			this.status = 'idle';
			this.reason = '';
			this.lastError = '';
			this.device = null;
			this.server = null;
			this.characteristic = null;
			this.telemetry = null;
			this.lastTelemetryAt = 0;
			this.pollIndex = 0;
			this.pollTimer = null;
			this.staleTimer = null;
			this.reconnectTimer = null;
			this.pollInFlight = false;
			this.reconnectAttempts = 0;
			this.generation = 0;
			this.connectPromise = null;
			this.pendingOperations = new Set();
			this.manualDisconnect = false;
			this.destroyed = false;
			this.boundValueChanged = (event) => this._handleValueChanged(event);
			this.boundDisconnected = () => this._handleGattDisconnected();
		}

		get supported() {
			return Boolean(this.options.secureContext && this.options.bluetooth && typeof this.options.bluetooth.requestDevice === 'function');
		}

		get connected() {
			return Boolean(this.device && this.device.gatt && this.device.gatt.connected && this.characteristic);
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
				try { listener.call(this, event); } catch (error) { /* UI listeners must not interrupt radio cleanup. */ }
			}
			const callback = type === 'statuschange' ? this.options.onStatus
				: type === 'telemetry' ? this.options.onTelemetry
					: type === 'frame' ? this.options.onFrame : null;
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
				lastError: this.lastError,
				lastTelemetryAt: this.lastTelemetryAt,
				telemetry: this.telemetry ? cloneTelemetry(this.telemetry) : null,
				protocol: this.telemetry ? this.telemetry.protocol : null,
				validFrames: this.decoder.validFrames,
				invalidFrames: this.decoder.invalidFrames
			};
		}

		async connect(settings) {
			const connectSettings = Object.assign({ forceChooser: false }, settings || {});
			if (this.destroyed) return this._setStatus('unavailable', { reason: 'destroyed' });
			if (!this.supported) {
				return this._setStatus('unavailable', { reason: this.options.secureContext ? 'unsupported' : 'insecure-context' });
			}
			if (this.connectPromise) return this.connectPromise;
			if (this.connected && ['waiting-for-data', 'live', 'stale'].includes(this.status)) return this.getStatus();
			this.manualDisconnect = false;
			const pending = this._connect(connectSettings);
			const tracked = pending.finally(() => {
				if (this.connectPromise === tracked) this.connectPromise = null;
			});
			this.connectPromise = tracked;
			return tracked;
		}

		async reconnect() {
			if (!this.device) return this.connect();
			if (this.connected) return this.getStatus();
			return this.connect({ forceChooser: false });
		}

		async _connect(settings) {
			this._clearTimers();
			this._cancelPendingOperations('new-connection');
			this.decoder.reset();
			this.telemetry = null;
			this.lastTelemetryAt = 0;
			this.lastError = '';
			this.pollIndex = 0;
			const generation = ++this.generation;
			let device = !settings.forceChooser ? this.device : null;
			this._setStatus(device ? 'reconnecting' : 'scanning', { reason: device ? 'known-device' : 'user-request' });
			try {
				if (!device) {
					const request = Promise.resolve(this.options.bluetooth.requestDevice({ filters: [{ services: [this.options.serviceUuid] }] }));
					request.then((selected) => {
						if (!this._isCurrent(generation)) this._disconnectDevice(selected);
					}, () => {});
					device = await this._awaitOperation(request, 0, 'Bluetooth selection was cancelled.');
				}
				if (!this._isCurrent(generation)) return this.getStatus();
				this.device = device;
				device.addEventListener?.('gattserverdisconnected', this.boundDisconnected);
				this._setStatus('connecting', { reason: 'device-selected' });
				const server = await this._awaitOperation(
					Promise.resolve(device.gatt.connect()),
					this.options.connectTimeoutMs,
					'The HyperCore ECU Bluetooth connection timed out.'
				);
				if (!this._isCurrent(generation)) return this._lateConnectionCleanup(device);
				this.server = server;
				const service = await this._awaitOperation(
					Promise.resolve(server.getPrimaryService(this.options.serviceUuid)),
					this.options.discoveryTimeoutMs,
					'The HyperCore ECU service was not found in time.'
				);
				const characteristic = await this._awaitOperation(
					Promise.resolve(service.getCharacteristic(this.options.characteristicUuid)),
					this.options.discoveryTimeoutMs,
					'The HyperCore ECU data channel was not found in time.'
				);
				if (!this._isCurrent(generation)) return this._lateConnectionCleanup(device);
				this.characteristic = characteristic;
				characteristic.addEventListener?.('characteristicvaluechanged', this.boundValueChanged);
				await this._awaitOperation(
					Promise.resolve(characteristic.startNotifications()),
					this.options.notificationTimeoutMs,
					'The HyperCore ECU notification stream did not start in time.'
				);
				if (!this._isCurrent(generation)) return this._lateConnectionCleanup(device);
				if (!this.lastTelemetryAt) this._setStatus('waiting-for-data', { reason: 'notifications-started' });
				this.reconnectAttempts = 0;
				this._armStaleTimer(generation);
				await this._pollOnce(generation);
				if (this._isCurrent(generation)) this._startPollLoop(generation);
				return this.getStatus();
			} catch (error) {
				if (!this._isCurrent(generation)) return this.getStatus();
				const cancelled = error && error.name === 'NotFoundError';
				this.generation += 1;
				this._cancelPendingOperations('connection-ended');
				// A failed role/characteristic discovery must not pin the wrong FFE0
				// peripheral and silently reuse it on the next rider attempt.
				await this._cleanupConnection(true, false);
				return this._setStatus(cancelled ? 'idle' : 'error', {
					reason: cancelled ? 'selection-cancelled' : 'connection-failed',
					error: cancelled ? null : error
				});
			}
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

		_startPollLoop(generation) {
			this._clearPollTimer();
			this.pollTimer = this.options.setInterval(() => {
				this._pollOnce(generation).catch((error) => {
					if (this._isCurrent(generation) && this.connected) {
						this._setStatus('stale', { reason: 'poll-write-failed', error });
					}
				});
			}, this.options.pollIntervalMs);
		}

		async _pollOnce(generation) {
			if (!this._isCurrent(generation) || !this.connected || this.pollInFlight) return false;
			const registers = Array.from(this.options.pollRegisters || []).filter((value) => Number.isInteger(value) && value >= 0 && value <= 0xff);
			if (!registers.length) throw new Error('No safe HyperCore ECU polling registers are configured.');
			const register = registers[this.pollIndex % registers.length];
			const payload = buildReadPacket(register);
			this.pollInFlight = true;
			try {
				await this._writeReadRequest(this.characteristic, payload, generation);
				this.pollIndex = (this.pollIndex + 1) % registers.length;
				this._emit('poll', { register, packet: Uint8Array.from(payload) });
				return true;
			} finally {
				this.pollInFlight = false;
			}
		}

		async _writeReadRequest(characteristic, payload, generation) {
			let lastError = null;
			for (const method of ['writeValueWithoutResponse', 'writeValue', 'writeValueWithResponse']) {
				if (typeof characteristic?.[method] !== 'function') continue;
				try {
					await this._awaitOperation(
						Promise.resolve().then(() => characteristic[method](payload)),
						this.options.writeTimeoutMs,
						'The HyperCore ECU read request timed out.'
					);
					return true;
				} catch (error) {
					lastError = error;
					if (!this._isCurrent(generation) || !this.connected) throw error;
				}
			}
			throw lastError || new Error('The HyperCore ECU characteristic cannot accept read requests.');
		}

		_handleValueChanged(event) {
			if (!this.connected || !event || !event.target) return;
			const generation = this.generation;
			const invalidBefore = this.decoder.invalidFrames;
			const updates = this.decoder.push(event.target.value, this.options.now());
			if (this.decoder.invalidFrames > invalidBefore) {
				this._emit('protocolerror', {
					reason: 'invalid-frame',
					invalidFrames: this.decoder.invalidFrames,
					discardedBytes: this.decoder.discardedBytes
				});
			}
			for (const update of updates) {
				if (!this._isCurrent(generation) || !this.connected) return;
				this.telemetry = update.telemetry;
				this.lastTelemetryAt = update.telemetry.measuredAtMs;
				this.lastError = '';
				if (this.status !== 'live') this._setStatus('live', { reason: 'telemetry-received' });
				this._emit('frame', update.frame);
				if (update.changedFields.length) {
					this._emit('telemetry', Object.assign({}, update.telemetry, { updatedFields: update.changedFields.slice() }));
				}
				this._armStaleTimer(generation);
			}
		}

		_armStaleTimer(generation) {
			this._clearStaleTimer();
			this.staleTimer = this.options.setTimeout(() => {
				this.staleTimer = null;
				if (!this._isCurrent(generation) || !this.connected) return;
				this._setStatus('stale', { reason: this.lastTelemetryAt ? 'telemetry-stale' : 'no-telemetry' });
			}, this.options.staleAfterMs);
		}

		_handleGattDisconnected() {
			if (!this.device && !this.characteristic) return;
			const generation = ++this.generation;
			this._cancelPendingOperations('gatt-disconnected');
			this._cleanupConnection(false, true).finally(() => {
				if (!this._isCurrent(generation)) return;
				this._setStatus('disconnected', { reason: 'gatt-disconnected' });
				if (!this.manualDisconnect && this.options.autoReconnect) this._scheduleReconnect();
			});
		}

		_scheduleReconnect() {
			this._clearReconnectTimer();
			if (!this.device || this.reconnectAttempts >= this.options.maxReconnectAttempts) return;
			this.reconnectAttempts += 1;
			const attempt = this.reconnectAttempts;
			this._setStatus('reconnecting', { reason: 'automatic-reconnect', attempt });
			this.reconnectTimer = this.options.setTimeout(() => {
				this.reconnectTimer = null;
				this.reconnect().then((status) => {
					if (status.status === 'error' && this.options.autoReconnect) this._scheduleReconnect();
				}).catch(() => this._scheduleReconnect());
			}, this.options.reconnectDelayMs * attempt);
		}

		async _lateConnectionCleanup(device) {
			await this._cleanupConnection(true, true);
			this._disconnectDevice(device);
			return this.getStatus();
		}

		async _cleanupConnection(disconnectGatt, preserveDevice) {
			this._clearPollTimer();
			this._clearStaleTimer();
			this.pollInFlight = false;
			const characteristic = this.characteristic;
			const device = this.device;
			this.characteristic = null;
			this.server = null;
			characteristic?.removeEventListener?.('characteristicvaluechanged', this.boundValueChanged);
			device?.removeEventListener?.('gattserverdisconnected', this.boundDisconnected);
			if (disconnectGatt) this._disconnectDevice(device);
			if (!preserveDevice) this.device = null;
		}

		_disconnectDevice(device) {
			try {
				if (device && device.gatt && device.gatt.connected) device.gatt.disconnect();
			} catch (error) { /* The radio may already have ended the GATT session. */ }
		}

		_clearPollTimer() {
			if (this.pollTimer !== null) this.options.clearInterval(this.pollTimer);
			this.pollTimer = null;
		}

		_clearStaleTimer() {
			if (this.staleTimer !== null) this.options.clearTimeout(this.staleTimer);
			this.staleTimer = null;
		}

		_clearReconnectTimer() {
			if (this.reconnectTimer !== null) this.options.clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		_clearTimers() {
			this._clearPollTimer();
			this._clearStaleTimer();
			this._clearReconnectTimer();
		}

		async disconnect(reason, settings) {
			const options = Object.assign({ silent: false, forgetDevice: false }, settings || {});
			this.manualDisconnect = true;
			this.generation += 1;
			this._clearTimers();
			this._cancelPendingOperations(reason || 'user-disconnected');
			await this._cleanupConnection(true, !options.forgetDevice);
			this.telemetry = null;
			this.lastTelemetryAt = 0;
			this.lastError = '';
			this.decoder.reset();
			if (options.silent) {
				this.status = 'idle';
				this.reason = String(reason || 'disconnected');
				return this.getStatus();
			}
			return this._setStatus(reason === 'document-hidden' ? 'disconnected' : 'idle', { reason: reason || 'user-disconnected' });
		}

		async forget() {
			return this.disconnect('device-forgotten', { forgetDevice: true });
		}

		async destroy() {
			if (this.destroyed) return;
			await this.disconnect('destroyed', { silent: true, forgetDevice: true });
			this.destroyed = true;
			this.listeners.clear();
		}
	}

	return {
		HyperCoreEcuBluetooth,
		HyperCoreEcuDecoder,
		SERVICE_UUID,
		CHARACTERISTIC_UUID,
		FRAME_BYTES,
		CRC_INITIAL_VALUE,
		POLL_REGISTERS,
		PAGE_REGISTER_MAP,
		crc16HyperCore,
		faultMessages,
		legacyChecksum,
		buildReadPacket,
		frameValidation,
		validateFrame,
		parseFrame,
		bytesFromValue
	};
}));
