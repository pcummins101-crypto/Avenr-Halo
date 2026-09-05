/* global indexedDB */
(function (global, factory) {
	'use strict';

	const exports = factory(global || {});
	if (typeof module === 'object' && module.exports) module.exports = exports;
	if (global) {
		global.AvenraHaloRideMemoriesClass = exports.AvenraHaloRideMemories;
		if (!global.AvenraHaloRideMemories) {
			global.AvenraHaloRideMemories = new exports.AvenraHaloRideMemories();
		}
	}
}(typeof globalThis !== 'undefined' ? globalThis : this, function (global) {
	'use strict';

	const DATABASE_NAME = 'avenra-halo-v2-ride-memories';
	const DATABASE_VERSION = 1;
	const RECORD_SCHEMA_VERSION = 1;
	const TELEMETRY_SCHEMA_VERSION = 1;
	const MAX_TELEMETRY_POINTS_PER_SEGMENT = 64;
	const OWNERSHIP_MAGIC = 'AVENRA_HALO_RIDE_MEMORY';
	const RIDE_STORE = 'halo-rides';
	const SEGMENT_STORE = 'halo-segments';
	const RIDE_CUSTOMER_INDEX = 'by-customer';
	const SEGMENT_RIDE_INDEX = 'by-ride';
	const SEGMENT_CUSTOMER_INDEX = 'by-customer';
	const CAMERA_ROLES = Object.freeze(['rear', 'front']);
	const MIME_EXTENSIONS = Object.freeze({
		'video/mp4': 'mp4',
		'video/webm': 'webm'
	});

	class AvenraHaloRideMemoriesError extends Error {
		constructor(message, code, cause) {
			super(String(message || 'Halo Ride Memories encountered a storage error.'));
			this.name = 'AvenraHaloRideMemoriesError';
			this.code = String(code || 'ride_memories_error');
			if (cause !== undefined) this.cause = cause;
		}
	}

	const error = (message, code, cause) => new AvenraHaloRideMemoriesError(message, code, cause);
	const safeNumber = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
	const nowIso = (clock) => new Date(safeNumber(clock(), Date.now())).toISOString();
	const cleanText = (value, maximum) => String(value ?? '').trim().slice(0, maximum);
	const randomToken = (source, clock) => {
		try {
			if (typeof source?.randomUUID === 'function') return source.randomUUID();
			if (typeof source?.getRandomValues === 'function') {
				const bytes = source.getRandomValues(new Uint32Array(4));
				return Array.from(bytes, (value) => value.toString(16).padStart(8, '0')).join('');
			}
		} catch (tokenError) { /* A timestamp and random suffix remain sufficient for a local lease. */ }
		return `${safeNumber(clock(), Date.now()).toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
	};

	function normaliseMimeType(value) {
		return cleanText(value, 200).split(';')[0].trim().toLowerCase();
	}

	function extensionForMimeType(value) {
		return MIME_EXTENSIONS[normaliseMimeType(value)] || '';
	}

	function normaliseDate(value, fallback, label) {
		const supplied = value === undefined || value === null || value === '' ? fallback : value;
		const date = supplied instanceof Date ? supplied : new Date(supplied);
		if (!Number.isFinite(date.getTime())) {
			throw error(`${label || 'Date'} is invalid.`, 'ride_memories_invalid_date');
		}
		return date.toISOString();
	}

	function compactUtc(value) {
		return normaliseDate(value, undefined, 'Ride start time').replace(/[-:.]/g, '');
	}

	function fnv1a(value, seed) {
		let hash = seed >>> 0;
		for (const character of String(value)) {
			const point = character.codePointAt(0);
			hash ^= point & 0xff;
			hash = Math.imul(hash, 0x01000193) >>> 0;
			hash ^= (point >>> 8) & 0xff;
			hash = Math.imul(hash, 0x01000193) >>> 0;
			hash ^= (point >>> 16) & 0xff;
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
		return hash.toString(16).padStart(8, '0');
	}

	function rideFilenameToken(rideId) {
		const source = String(rideId ?? '').trim();
		if (!source) throw error('A ride identifier is required.', 'ride_memories_ride_id_required');
		if (source.length > 160) throw error('The ride identifier is too long.', 'ride_memories_invalid_ride_id');
		let readable = source;
		try { readable = readable.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); }
		catch (normaliseError) { /* Older WebViews can still use the exact-id hash. */ }
		readable = readable
			.replace(/[^A-Za-z0-9._-]+/g, '-')
			.replace(/[-_.]{2,}/g, '-')
			.replace(/^[-_.]+|[-_.]+$/g, '')
			.slice(0, 42) || 'ride';
		const hash = fnv1a(source, 0x811c9dc5) + fnv1a(source, 0x9e3779b9);
		return `${readable}-${hash}`;
	}

	function normaliseCamera(value) {
		const camera = cleanText(value, 16).toLowerCase();
		if (!CAMERA_ROLES.includes(camera)) {
			throw error('The camera role must be rear or front.', 'ride_memories_invalid_camera');
		}
		return camera;
	}

	function normaliseSequence(value) {
		const sequence = Number(value);
		if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 999999) {
			throw error('The segment sequence is invalid.', 'ride_memories_invalid_sequence');
		}
		return sequence;
	}

	function formatRideMemoryFilename(input) {
		const source = input || {};
		const mimeType = normaliseMimeType(source.mimeType ?? source.mime_type);
		const extension = extensionForMimeType(mimeType);
		if (!extension) {
			throw error('Halo cannot store this video format.', 'ride_memories_mime_unsupported');
		}
		const camera = normaliseCamera(source.camera ?? source.role);
		const sequence = normaliseSequence(source.sequence);
		const rideId = source.rideId ?? source.ride_id ?? source.clientRideId ?? source.client_ride_id;
		return `HALO_RIDE_v${RECORD_SCHEMA_VERSION}_${compactUtc(source.startedAt ?? source.started_at)}_${rideFilenameToken(rideId)}_${camera}_${String(sequence).padStart(6, '0')}.${extension}`;
	}

	function isPlainObject(value) {
		if (!value || typeof value !== 'object') return false;
		const prototype = Object.getPrototypeOf(value);
		return prototype === Object.prototype || prototype === null;
	}

	function safeSummary(value) {
		if (value === undefined || value === null) return {};
		if (!isPlainObject(value)) {
			throw error('The ride summary is invalid.', 'ride_memories_invalid_summary');
		}
		let json;
		try { json = JSON.stringify(value); }
		catch (serialiseError) { throw error('The ride summary could not be saved.', 'ride_memories_invalid_summary', serialiseError); }
		if (json.length > 65536) {
			throw error('The ride summary is too large.', 'ride_memories_invalid_summary');
		}
		try { return JSON.parse(json); }
		catch (parseError) { throw error('The ride summary could not be saved.', 'ride_memories_invalid_summary', parseError); }
	}

	function roundedNumber(value, digits, minimum, maximum) {
		if (value === null || value === undefined || typeof value === 'boolean'
			|| (typeof value === 'string' && !value.trim())) return null;
		const number = Number(value);
		if (!Number.isFinite(number)) return null;
		if (Number.isFinite(minimum) && number < minimum) return null;
		if (Number.isFinite(maximum) && number > maximum) return null;
		const scale = 10 ** Math.max(0, Math.floor(safeNumber(digits, 0)));
		return Math.round(number * scale) / scale;
	}

	function isCanonicalRoundedNumber(value, digits, minimum, maximum) {
		return typeof value === 'number' && roundedNumber(value, digits, minimum, maximum) === value;
	}

	function telemetryTimestamp(value) {
		const numeric = Number(value);
		if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);
		const parsed = Date.parse(String(value || ''));
		return Number.isFinite(parsed) ? parsed : null;
	}

	function normaliseTelemetryPoints(value, segmentStartedAt, segmentEndedAt) {
		if (!Array.isArray(value)) return [];
		const startedMs = Date.parse(segmentStartedAt);
		const endedMs = Date.parse(segmentEndedAt);
		const lowerBound = Number.isFinite(startedMs) ? startedMs - 5000 : -Infinity;
		const upperBound = Number.isFinite(endedMs) ? endedMs + 5000 : Infinity;
		const points = [];
		for (const source of value) {
			if (!isPlainObject(source)) continue;
			const at = telemetryTimestamp(source.at ?? source.timestamp ?? source.recordedAt ?? source.recorded_at);
			if (at === null || at < lowerBound || at > upperBound) continue;
			const point = { at };
			const elapsedSeconds = roundedNumber(source.elapsedSeconds ?? source.elapsed_seconds, 1, 0, 172800);
			const speedMph = roundedNumber(source.speedMph ?? source.speed_mph ?? source.speed, 1, 0, 250);
			const latitude = roundedNumber(source.lat ?? source.latitude, 6, -90, 90);
			const longitude = roundedNumber(source.lng ?? source.longitude, 6, -180, 180);
			const accuracy = roundedNumber(source.accuracy, 1, 0, 10000);
			const heading = roundedNumber(source.heading, 0, 0, 360);
			const roadName = cleanText(source.roadName ?? source.road_name ?? source.road, 190);
			if (elapsedSeconds !== null) point.elapsedSeconds = elapsedSeconds;
			if (speedMph !== null) point.speedMph = speedMph;
			if (latitude !== null && longitude !== null) {
				point.lat = latitude;
				point.lng = longitude;
			}
			if (accuracy !== null) point.accuracy = accuracy;
			if (heading !== null) point.heading = heading === 360 ? 0 : heading;
			if (roadName) point.roadName = roadName;
			points.push(point);
		}
		points.sort((left, right) => left.at - right.at);
		const deduplicated = [];
		for (const point of points) {
			if (deduplicated.length && deduplicated[deduplicated.length - 1].at === point.at) deduplicated[deduplicated.length - 1] = point;
			else deduplicated.push(point);
		}
		return deduplicated.slice(-MAX_TELEMETRY_POINTS_PER_SEGMENT);
	}

	function validStoredTelemetry(record) {
		if (record.telemetry === undefined) return true;
		if (record.telemetrySchemaVersion !== TELEMETRY_SCHEMA_VERSION || !Array.isArray(record.telemetry)
			|| record.telemetry.length > MAX_TELEMETRY_POINTS_PER_SEGMENT) return false;
		const startedAt = Date.parse(String(record.startedAt || ''));
		const endedAt = Date.parse(String(record.endedAt || ''));
		let previousAt = -Infinity;
		for (const point of record.telemetry) {
			if (!isPlainObject(point) || telemetryTimestamp(point.at) !== point.at) return false;
			if (point.at <= previousAt) return false;
			previousAt = point.at;
			if ((Number.isFinite(startedAt) && point.at < startedAt - 5000)
				|| (Number.isFinite(endedAt) && point.at > endedAt + 5000)) return false;
			if (point.elapsedSeconds !== undefined && !isCanonicalRoundedNumber(point.elapsedSeconds, 1, 0, 172800)) return false;
			if (point.speedMph !== undefined && !isCanonicalRoundedNumber(point.speedMph, 1, 0, 250)) return false;
			const hasLatitude = point.lat !== undefined;
			const hasLongitude = point.lng !== undefined;
			if (hasLatitude !== hasLongitude) return false;
			if (hasLatitude && (!isCanonicalRoundedNumber(point.lat, 6, -90, 90) || !isCanonicalRoundedNumber(point.lng, 6, -180, 180))) return false;
			if (point.accuracy !== undefined && !isCanonicalRoundedNumber(point.accuracy, 1, 0, 10000)) return false;
			if (point.heading !== undefined && !isCanonicalRoundedNumber(point.heading, 0, 0, 360)) return false;
			if (point.roadName !== undefined && (typeof point.roadName !== 'string' || point.roadName.length > 190)) return false;
		}
		return true;
	}

	class AvenraHaloRideMemories {
		constructor(options) {
			const settings = options || {};
			this.options = {
				databaseName: cleanText(settings.databaseName, 160) || DATABASE_NAME,
				indexedDB: settings.indexedDB === undefined ? global.indexedDB : settings.indexedDB,
				Blob: settings.Blob || global.Blob,
				navigator: settings.navigator || global.navigator || {},
				IDBKeyRange: settings.IDBKeyRange || global.IDBKeyRange || null,
				now: typeof settings.now === 'function' ? settings.now : () => Date.now(),
				maxSegmentBytes: Math.max(1024, Math.floor(safeNumber(settings.maxSegmentBytes, 64 * 1024 * 1024))),
				maxGaps: Math.max(1, Math.floor(safeNumber(settings.maxGaps, 4096))),
				// Mobile browsers may suspend background timers for hours. The persisted
				// lease therefore uses a seven-day stale window; the 15-second app
				// heartbeat is an additional freshness signal, not the sole safety fence.
				leaseDurationMs: Math.max(1000, Math.floor(safeNumber(settings.leaseDurationMs, 7 * 24 * 60 * 60 * 1000)))
			};
			this._leaseOwner = cleanText(settings.leaseOwner, 160) || randomToken(settings.crypto || global.crypto, this.options.now);
			this._database = null;
			this._databasePromise = null;
			this._openGeneration = 0;
			this._activeRides = new Set();
		}

		get supported() {
			return Boolean(this.options.indexedDB && typeof this.options.indexedDB.open === 'function' && this.options.Blob);
		}

		capabilities() {
			return Object.freeze({
				supported: this.supported,
				storage: this.supported ? 'indexeddb' : 'unavailable',
				deviceFolder: false,
				externalMediaScan: false,
				audio: false,
				schemaVersion: RECORD_SCHEMA_VERSION,
				telemetryOverlay: true,
				telemetrySchemaVersion: TELEMETRY_SCHEMA_VERSION
			});
		}

		_assertSupported() {
			if (!this.supported) {
				throw error('This browser cannot store Halo ride footage locally.', 'ride_memories_unsupported');
			}
		}

		async open() {
			this._assertSupported();
			if (this._database) return this._database;
			if (this._databasePromise) return this._databasePromise;
			const openGeneration = this._openGeneration;

			const work = new Promise((resolve, reject) => {
				let request;
				try { request = this.options.indexedDB.open(this.options.databaseName, DATABASE_VERSION); }
				catch (openError) {
					reject(error('Halo could not open local ride-footage storage.', 'ride_memories_storage_unavailable', openError));
					return;
				}
				request.onupgradeneeded = () => {
					const database = request.result;
					if (!database.objectStoreNames.contains(RIDE_STORE)) {
						const rides = database.createObjectStore(RIDE_STORE, { keyPath: 'storageKey' });
						rides.createIndex?.(RIDE_CUSTOMER_INDEX, 'customerKey', { unique: false });
						rides.createIndex?.('by-status', 'status', { unique: false });
					}
					if (!database.objectStoreNames.contains(SEGMENT_STORE)) {
						const segments = database.createObjectStore(SEGMENT_STORE, { keyPath: 'storageKey' });
						segments.createIndex?.(SEGMENT_RIDE_INDEX, 'rideStorageKey', { unique: false });
						segments.createIndex?.(SEGMENT_CUSTOMER_INDEX, 'customerKey', { unique: false });
					}
				};
				request.onsuccess = () => {
					const database = request.result;
					if (openGeneration !== this._openGeneration) {
						try { database.close(); } catch (closeError) { /* The stale open is already closed. */ }
						reject(error('Halo closed local ride-footage storage before it finished opening.', 'ride_memories_storage_closed'));
						return;
					}
					database.onversionchange = () => {
						try { database.close(); } catch (closeError) { /* A later call may reopen storage. */ }
						if (this._database === database) {
							this._database = null;
							this._databasePromise = null;
						}
					};
					this._database = database;
					resolve(database);
				};
				request.onerror = () => reject(error('Halo could not open local ride-footage storage.', 'ride_memories_storage_unavailable', request.error));
				request.onblocked = () => reject(error('Halo ride-footage storage is busy in another app window.', 'ride_memories_storage_blocked'));
			});

			this._databasePromise = work.catch((openError) => {
				this._databasePromise = null;
				throw openError;
			});
			return this._databasePromise;
		}

		async _transaction(storeNames, mode, action) {
			const database = await this.open();
			return new Promise((resolve, reject) => {
				let transaction;
				let result;
				let failure = null;
				try { transaction = database.transaction(storeNames, mode); }
				catch (transactionError) {
					reject(error('Halo could not access local ride-footage storage.', 'ride_memories_storage_unavailable', transactionError));
					return;
				}

				const fail = (operationError) => {
					if (failure) return;
					failure = operationError instanceof AvenraHaloRideMemoriesError
						? operationError
						: error('Halo could not update local ride-footage storage.', 'ride_memories_storage_write_failed', operationError);
					try { transaction.abort(); } catch (abortError) { reject(failure); }
				};
				const setResult = (value) => { result = value; };
				transaction.oncomplete = () => resolve(result);
				transaction.onabort = () => reject(failure || error('Halo could not update local ride-footage storage.', 'ride_memories_storage_write_failed', transaction.error));
				transaction.onerror = () => {
					if (!failure) failure = error('Halo could not update local ride-footage storage.', 'ride_memories_storage_write_failed', transaction.error);
				};
				try { action(transaction, setResult, fail); }
				catch (actionError) { fail(actionError); }
			});
		}

		_requestFailure(request, fail, message) {
			request.onerror = (event) => {
				if (event && typeof event.preventDefault === 'function') event.preventDefault();
				fail(error(message || 'Halo could not read local ride footage.', 'ride_memories_storage_read_failed', request.error));
			};
			return request;
		}

		async _all(storeName) {
			return this._transaction([storeName], 'readonly', (transaction, setResult, fail) => {
				const request = this._requestFailure(transaction.objectStore(storeName).getAll(), fail);
				request.onsuccess = () => setResult(Array.isArray(request.result) ? request.result : []);
			});
		}

		_only(value) {
			if (this.options.IDBKeyRange && typeof this.options.IDBKeyRange.only === 'function') {
				return this.options.IDBKeyRange.only(value);
			}
			return value;
		}

		async _indexRecords(storeName, indexName, value) {
			return this._transaction([storeName], 'readonly', (transaction, setResult, fail) => {
				const index = transaction.objectStore(storeName).index(indexName);
				const range = this._only(value);
				if (typeof index.getAll === 'function') {
					const request = this._requestFailure(index.getAll(range), fail);
					request.onsuccess = () => setResult(Array.isArray(request.result) ? request.result : []);
					return;
				}
				const records = [];
				const request = this._requestFailure(index.openCursor(range), fail);
				request.onsuccess = () => {
					const cursor = request.result;
					if (!cursor) {
						setResult(records);
						return;
					}
					records.push(cursor.value);
					cursor.continue();
				};
			});
		}

		_customerKey(input) {
			const source = input || {};
			const value = typeof source === 'object'
				? source.customerKey ?? source.customer_key ?? source.customerId ?? source.customer_id
				: source;
			const key = String(value ?? '').trim();
			if (!key) throw error('A customer storage key is required.', 'ride_memories_customer_required');
			if (key.length > 128) throw error('The customer storage key is too long.', 'ride_memories_invalid_customer');
			return key;
		}

		_rideId(input) {
			const source = input || {};
			const value = typeof source === 'object'
				? source.rideId ?? source.ride_id ?? source.clientRideId ?? source.client_ride_id
				: source;
			const rideId = String(value ?? '').trim();
			if (!rideId) throw error('A ride identifier is required.', 'ride_memories_ride_id_required');
			if (rideId.length > 160) throw error('The ride identifier is too long.', 'ride_memories_invalid_ride_id');
			return rideId;
		}

		_rideStorageKey(customerKey, rideId) {
			return `${OWNERSHIP_MAGIC}:ride:${encodeURIComponent(customerKey)}:${encodeURIComponent(rideId)}`;
		}

		_segmentStorageKey(rideStorageKey, camera, sequence) {
			return `${rideStorageKey}:segment:${camera}:${String(sequence).padStart(9, '0')}`;
		}

		_nowMs() {
			return safeNumber(this.options.now(), Date.now());
		}

		_applyLease(ride, timestamp) {
			const at = safeNumber(timestamp, this._nowMs());
			ride.leaseOwner = this._leaseOwner;
			ride.leaseHeartbeatAt = new Date(at).toISOString();
			ride.leaseExpiresAt = new Date(at + this.options.leaseDurationMs).toISOString();
			return ride;
		}

		_clearLease(ride) {
			ride.leaseOwner = null;
			ride.leaseHeartbeatAt = null;
			ride.leaseExpiresAt = null;
			return ride;
		}

		_leaseIsFresh(ride, timestamp) {
			if (!ride || typeof ride.leaseOwner !== 'string' || !ride.leaseOwner) return false;
			const at = safeNumber(timestamp, this._nowMs());
			const expiresAt = Date.parse(String(ride.leaseExpiresAt || ''));
			if (Number.isFinite(expiresAt)) return expiresAt > at;
			const heartbeatAt = Date.parse(String(ride.leaseHeartbeatAt || ''));
			return Number.isFinite(heartbeatAt) && heartbeatAt + this.options.leaseDurationMs > at;
		}

		_assertLeaseAvailable(ride, timestamp) {
			if (ride?.leaseOwner
				&& ride.leaseOwner !== this._leaseOwner
				&& this._leaseIsFresh(ride, timestamp)) {
				throw error('This ride-footage recording is active in another Halo window.', 'ride_memories_lease_conflict');
			}
		}

		_isOwnedRide(record) {
			return Boolean(record
				&& record.haloMagic === OWNERSHIP_MAGIC
				&& record.haloSchemaVersion === RECORD_SCHEMA_VERSION
				&& record.haloRecordType === 'ride'
				&& typeof record.customerKey === 'string'
				&& typeof record.rideId === 'string'
				&& record.storageKey === this._rideStorageKey(record.customerKey, record.rideId));
		}

		_isOwnedSegment(record) {
			if (!record
				|| record.haloMagic !== OWNERSHIP_MAGIC
				|| record.haloSchemaVersion !== RECORD_SCHEMA_VERSION
				|| record.haloRecordType !== 'segment'
				|| typeof record.customerKey !== 'string'
				|| typeof record.rideId !== 'string') return false;
			let camera;
			let sequence;
			let expectedFilename;
			try {
				camera = normaliseCamera(record.camera);
				sequence = normaliseSequence(record.sequence);
				expectedFilename = formatRideMemoryFilename({
					startedAt: record.rideStartedAt,
					rideId: record.rideId,
					camera,
					sequence,
					mimeType: record.mimeType
				});
			} catch (validationError) { return false; }
			const rideStorageKey = this._rideStorageKey(record.customerKey, record.rideId);
			return record.rideStorageKey === rideStorageKey
				&& record.storageKey === this._segmentStorageKey(rideStorageKey, camera, sequence)
				&& record.filename === expectedFilename
				&& record.extension === extensionForMimeType(record.mimeType)
				&& record.audio === false
				&& validStoredTelemetry(record)
				&& safeNumber(record.sizeBytes, -1) > 0
				&& this._isBlob(record.blob)
				&& normaliseMimeType(record.blob.type) === normaliseMimeType(record.mimeType)
				&& Number(record.blob.size) === Number(record.sizeBytes);
		}

		_isOwnedSegmentDescriptor(record, ride) {
			if (!record
				|| !ride
				|| record.haloMagic !== OWNERSHIP_MAGIC
				|| record.haloSchemaVersion !== RECORD_SCHEMA_VERSION
				|| record.haloRecordType !== 'segment'
				|| record.customerKey !== ride.customerKey
				|| record.rideId !== ride.rideId
				|| record.rideStartedAt !== ride.startedAt
				|| record.audio !== false
				|| safeNumber(record.sizeBytes, -1) <= 0) return false;
			if (record.telemetrySchemaVersion !== undefined && record.telemetrySchemaVersion !== TELEMETRY_SCHEMA_VERSION) return false;
			if (record.telemetryPointCount !== undefined
				&& (!Number.isSafeInteger(Number(record.telemetryPointCount))
					|| Number(record.telemetryPointCount) < 0
					|| Number(record.telemetryPointCount) > MAX_TELEMETRY_POINTS_PER_SEGMENT)) return false;
			let camera;
			let sequence;
			let expectedFilename;
			try {
				camera = normaliseCamera(record.camera);
				sequence = normaliseSequence(record.sequence);
				expectedFilename = formatRideMemoryFilename({
					startedAt: ride.startedAt,
					rideId: ride.rideId,
					camera,
					sequence,
					mimeType: record.mimeType
				});
			} catch (validationError) { return false; }
			return record.filename === expectedFilename
				&& record.extension === extensionForMimeType(record.mimeType);
		}

		_manifestSegments(ride) {
			if (!this._isOwnedRide(ride) || !Array.isArray(ride.segmentManifest)) return [];
			return ride.segmentManifest
				.filter((record) => this._isOwnedSegmentDescriptor(record, ride))
				.map((record) => Object.assign({}, record))
				.sort((left, right) => left.sequence - right.sequence || CAMERA_ROLES.indexOf(left.camera) - CAMERA_ROLES.indexOf(right.camera));
		}

		_publicRide(record) {
			if (!this._isOwnedRide(record)) return null;
			const segments = this._manifestSegments(record);
			const copy = Object.assign({}, record, {
				gaps: Array.isArray(record.gaps) ? record.gaps.map((gap) => Object.assign({}, gap)) : [],
				summary: isPlainObject(record.summary) ? safeSummary(record.summary) : {},
				segmentCount: segments.length,
				bytes: segments.reduce((total, segment) => total + Math.max(0, safeNumber(segment.sizeBytes, 0)), 0),
				telemetryPointCount: segments.reduce((total, segment) => total + Math.max(0, safeNumber(segment.telemetryPointCount, 0)), 0),
				counts: segments.reduce((counts, segment) => {
					counts[segment.camera] += 1;
					return counts;
				}, { rear: 0, front: 0 })
			});
			delete copy.storageKey;
			delete copy.segmentManifest;
			delete copy.leaseOwner;
			delete copy.leaseHeartbeatAt;
			delete copy.leaseExpiresAt;
			return copy;
		}

		_publicSegment(record, includeBlob) {
			if (!this._isOwnedSegment(record)) return null;
			const copy = Object.assign({}, record);
			delete copy.storageKey;
			delete copy.rideStorageKey;
			copy.telemetryPointCount = Array.isArray(record.telemetry) ? record.telemetry.length : 0;
			if (!includeBlob) {
				delete copy.blob;
				delete copy.telemetry;
			}
			return copy;
		}

		_isBlob(value) {
			if (!value || typeof value !== 'object') return false;
			if (this.options.Blob && value instanceof this.options.Blob) return true;
			return Object.prototype.toString.call(value) === '[object Blob]'
				&& typeof value.slice === 'function'
				&& Number.isFinite(Number(value.size));
		}

		async beginRide(input) {
			const source = input || {};
			const customerKey = this._customerKey(source);
			const rideId = this._rideId(source);
			if (source.audio === true || source.captureAudio === true || source.capture_audio === true) {
				throw error('Halo Ride Memories does not record audio.', 'ride_memories_audio_forbidden');
			}
			const leaseAt = this._nowMs();
			const startedAt = normaliseDate(source.startedAt ?? source.started_at, new Date(leaseAt).toISOString(), 'Ride start time');
			const createdAt = new Date(leaseAt).toISOString();
			const storageKey = this._rideStorageKey(customerKey, rideId);
			const requestedCameras = Array.from(new Set((Array.isArray(source.cameras) ? source.cameras : ['rear']).map(normaliseCamera)));
			const record = this._applyLease({
				haloMagic: OWNERSHIP_MAGIC,
				haloSchemaVersion: RECORD_SCHEMA_VERSION,
				haloRecordType: 'ride',
				storageKey,
				customerKey,
				rideId,
				status: 'recording',
				startedAt,
				endedAt: null,
				createdAt,
				updatedAt: createdAt,
				lastSegmentEndedAt: null,
				requestedCameras,
				segmentCount: 0,
				counts: { rear: 0, front: 0 },
				bytes: 0,
				segmentManifest: [],
				gaps: [],
				audio: false,
				summary: {}
			}, leaseAt);

			const output = await this._transaction([RIDE_STORE], 'readwrite', (transaction, setResult, fail) => {
				const store = transaction.objectStore(RIDE_STORE);
				const lookup = this._requestFailure(store.get(storageKey), fail);
				lookup.onsuccess = () => {
					if (lookup.result !== undefined) {
						fail(error('Ride footage already exists for this ride.', 'ride_memories_ride_exists'));
						return;
					}
					this._requestFailure(store.add(record), fail, 'Halo could not create the local ride-footage record.');
					setResult(this._publicRide(record));
				};
			});
			this._activeRides.add(storageKey);
			return output;
		}

		async appendSegment(input) {
			const source = input || {};
			const customerKey = this._customerKey(source);
			const rideId = this._rideId(source);
			const camera = normaliseCamera(source.camera ?? source.role);
			const sequence = normaliseSequence(source.sequence);
			const blob = source.blob;
			if (!this._isBlob(blob) || safeNumber(blob.size, 0) <= 0) {
				throw error('The ride-footage segment is empty or invalid.', 'ride_memories_invalid_blob');
			}
			if (blob.size > this.options.maxSegmentBytes) {
				throw error('The ride-footage segment is too large.', 'ride_memories_segment_too_large');
			}
			if (source.audio === true || source.recording?.audio === true) {
				throw error('Halo Ride Memories does not record audio.', 'ride_memories_audio_forbidden');
			}

			const suppliedMime = normaliseMimeType(source.mimeType ?? source.mime_type);
			const blobMime = normaliseMimeType(blob.type);
			if (suppliedMime && blobMime && suppliedMime !== blobMime) {
				throw error('The video type does not match the recorded Blob.', 'ride_memories_mime_mismatch');
			}
			const mimeType = suppliedMime || blobMime;
			const extension = extensionForMimeType(mimeType);
			if (!extension) throw error('Halo cannot store this video format.', 'ride_memories_mime_unsupported');

			const startedAt = normaliseDate(source.startedAt ?? source.started_at, nowIso(this.options.now), 'Segment start time');
			let durationMs = Math.max(0, Math.round(safeNumber(source.durationMs ?? source.duration_ms, 0)));
			const derivedEnd = new Date(new Date(startedAt).getTime() + durationMs).toISOString();
			const endedAt = normaliseDate(source.endedAt ?? source.ended_at, derivedEnd, 'Segment end time');
			if (new Date(endedAt).getTime() < new Date(startedAt).getTime()) {
				throw error('The segment end time precedes its start time.', 'ride_memories_invalid_date');
			}
			if (!durationMs) durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
			const telemetry = normaliseTelemetryPoints(
				source.telemetry ?? source.telemetryPoints ?? source.telemetry_points,
				startedAt,
				endedAt
			);

			const rideStorageKey = this._rideStorageKey(customerKey, rideId);
			const segmentStorageKey = this._segmentStorageKey(rideStorageKey, camera, sequence);
			const leaseAt = this._nowMs();
			const createdAt = new Date(leaseAt).toISOString();
			let publicSegment = null;
			const output = await this._transaction([RIDE_STORE, SEGMENT_STORE], 'readwrite', (transaction, setResult, fail) => {
				const rides = transaction.objectStore(RIDE_STORE);
				const segments = transaction.objectStore(SEGMENT_STORE);
				const rideRequest = this._requestFailure(rides.get(rideStorageKey), fail);
				rideRequest.onsuccess = () => {
					const ride = rideRequest.result;
					if (!this._isOwnedRide(ride) || ride.customerKey !== customerKey || ride.rideId !== rideId) {
						fail(error('The Halo ride-footage record was not found.', 'ride_memories_ride_not_found'));
						return;
					}
					if (ride.status !== 'recording') {
						fail(error('This ride-footage record is no longer accepting segments.', 'ride_memories_ride_closed'));
						return;
					}
					try { this._assertLeaseAvailable(ride, leaseAt); }
					catch (leaseError) { fail(leaseError); return; }
					const duplicateRequest = this._requestFailure(segments.get(segmentStorageKey), fail);
					duplicateRequest.onsuccess = () => {
						if (duplicateRequest.result !== undefined) {
							fail(error('This ride-footage segment already exists.', 'ride_memories_segment_exists'));
							return;
						}
						const filename = formatRideMemoryFilename({ startedAt: ride.startedAt, rideId, camera, sequence, mimeType });
						const segment = {
							haloMagic: OWNERSHIP_MAGIC,
							haloSchemaVersion: RECORD_SCHEMA_VERSION,
							haloRecordType: 'segment',
							storageKey: segmentStorageKey,
							rideStorageKey,
							customerKey,
							rideId,
							rideStartedAt: ride.startedAt,
							camera,
							sequence,
							filename,
							mimeType,
							extension,
							sizeBytes: blob.size,
							startedAt,
							endedAt,
							durationMs,
							telemetrySchemaVersion: TELEMETRY_SCHEMA_VERSION,
							telemetry,
							audio: false,
							createdAt,
							blob
						};
						ride.segmentCount = Math.max(0, Math.floor(safeNumber(ride.segmentCount, 0))) + 1;
						ride.counts = Object.assign({ rear: 0, front: 0 }, ride.counts || {});
						ride.counts[camera] = Math.max(0, Math.floor(safeNumber(ride.counts[camera], 0))) + 1;
						ride.bytes = Math.max(0, safeNumber(ride.bytes, 0)) + blob.size;
						ride.segmentManifest = Array.isArray(ride.segmentManifest) ? ride.segmentManifest.slice() : [];
						ride.segmentManifest.push(this._publicSegment(segment, false));
						ride.lastSegmentEndedAt = endedAt;
						ride.updatedAt = createdAt;
						this._applyLease(ride, leaseAt);
						this._requestFailure(segments.add(segment), fail, 'Halo could not save the local ride-footage segment.');
						this._requestFailure(rides.put(ride), fail, 'Halo could not update the local ride-footage manifest.');
						publicSegment = this._publicSegment(segment, false);
						setResult(publicSegment);
					};
				};
			});
			this._activeRides.add(rideStorageKey);
			return output;
		}

		async refreshLease(input) {
			const source = input || {};
			const customerKey = this._customerKey(source);
			const rideId = this._rideId(source);
			const rideStorageKey = this._rideStorageKey(customerKey, rideId);
			const leaseAt = this._nowMs();
			const output = await this._transaction([RIDE_STORE], 'readwrite', (transaction, setResult, fail) => {
				const store = transaction.objectStore(RIDE_STORE);
				const request = this._requestFailure(store.get(rideStorageKey), fail);
				request.onsuccess = () => {
					const ride = request.result;
					if (!this._isOwnedRide(ride) || ride.customerKey !== customerKey || ride.rideId !== rideId) {
						fail(error('The Halo ride-footage record was not found.', 'ride_memories_ride_not_found'));
						return;
					}
					if (ride.status !== 'recording') {
						fail(error('This ride-footage record is no longer active.', 'ride_memories_ride_closed'));
						return;
					}
					try { this._assertLeaseAvailable(ride, leaseAt); }
					catch (leaseError) { fail(leaseError); return; }
					this._applyLease(ride, leaseAt);
					ride.updatedAt = new Date(leaseAt).toISOString();
					this._requestFailure(store.put(ride), fail);
					setResult(this._publicRide(ride));
				};
			});
			this._activeRides.add(rideStorageKey);
			return output;
		}

		async markGap(input) {
			const source = input || {};
			const customerKey = this._customerKey(source);
			const rideId = this._rideId(source);
			const startedAt = normaliseDate(source.startedAt ?? source.started_at, nowIso(this.options.now), 'Gap start time');
			const endedAt = normaliseDate(source.endedAt ?? source.ended_at, nowIso(this.options.now), 'Gap end time');
			if (new Date(endedAt).getTime() < new Date(startedAt).getTime()) {
				throw error('The recording gap end time precedes its start time.', 'ride_memories_invalid_date');
			}
			const reason = cleanText(source.reason, 128) || 'capture-paused';
			const rideStorageKey = this._rideStorageKey(customerKey, rideId);
			const leaseAt = this._nowMs();
			const output = await this._transaction([RIDE_STORE], 'readwrite', (transaction, setResult, fail) => {
				const store = transaction.objectStore(RIDE_STORE);
				const request = this._requestFailure(store.get(rideStorageKey), fail);
				request.onsuccess = () => {
					const ride = request.result;
					if (!this._isOwnedRide(ride) || ride.customerKey !== customerKey || ride.rideId !== rideId) {
						fail(error('The Halo ride-footage record was not found.', 'ride_memories_ride_not_found'));
						return;
					}
					if (ride.status !== 'recording') {
						fail(error('This ride-footage record is no longer accepting gaps.', 'ride_memories_ride_closed'));
						return;
					}
					try { this._assertLeaseAvailable(ride, leaseAt); }
					catch (leaseError) { fail(leaseError); return; }
					ride.gaps = Array.isArray(ride.gaps) ? ride.gaps.slice() : [];
					if (ride.gaps.length >= this.options.maxGaps) {
						fail(error('This ride has too many recording-gap markers.', 'ride_memories_gap_limit'));
						return;
					}
					const gap = {
						id: `gap-${String(ride.gaps.length + 1).padStart(6, '0')}`,
						startedAt,
						endedAt,
						durationMs: new Date(endedAt).getTime() - new Date(startedAt).getTime(),
						reason
					};
					ride.gaps.push(gap);
					ride.updatedAt = new Date(leaseAt).toISOString();
					this._applyLease(ride, leaseAt);
					this._requestFailure(store.put(ride), fail);
					setResult(Object.assign({}, gap));
				};
			});
			this._activeRides.add(rideStorageKey);
			return output;
		}

		async finalizeRide(input) {
			const source = input || {};
			const customerKey = this._customerKey(source);
			const rideId = this._rideId(source);
			const summary = safeSummary(source.summary || {});
			const rideStorageKey = this._rideStorageKey(customerKey, rideId);
			const operationAt = this._nowMs();
			const output = await this._transaction([RIDE_STORE], 'readwrite', (transaction, setResult, fail) => {
				const store = transaction.objectStore(RIDE_STORE);
				const request = this._requestFailure(store.get(rideStorageKey), fail);
				request.onsuccess = () => {
					const ride = request.result;
					if (!this._isOwnedRide(ride) || ride.customerKey !== customerKey || ride.rideId !== rideId) {
						fail(error('The Halo ride-footage record was not found.', 'ride_memories_ride_not_found'));
						return;
					}
					if (ride.status === 'completed') {
						setResult(this._publicRide(ride));
						return;
					}
					try { this._assertLeaseAvailable(ride, operationAt); }
					catch (leaseError) { fail(leaseError); return; }
					const endedAt = normaliseDate(source.endedAt ?? source.ended_at, new Date(operationAt).toISOString(), 'Ride end time');
					if (new Date(endedAt).getTime() < new Date(ride.startedAt).getTime()) {
						fail(error('The ride end time precedes its start time.', 'ride_memories_invalid_date'));
						return;
					}
					ride.status = 'completed';
					ride.endedAt = endedAt;
					ride.durationMs = new Date(endedAt).getTime() - new Date(ride.startedAt).getTime();
					ride.summary = summary;
					ride.updatedAt = new Date(operationAt).toISOString();
					this._clearLease(ride);
					this._requestFailure(store.put(ride), fail);
					setResult(this._publicRide(ride));
				};
			});
			this._activeRides.delete(rideStorageKey);
			return output;
		}

		async recoverInterrupted(input) {
			const source = input || {};
			const customerKey = this._customerKey(source);
			const recoveredAtMs = this._nowMs();
			const recoveredAt = new Date(recoveredAtMs).toISOString();
			return this._transaction([RIDE_STORE], 'readwrite', (transaction, setResult, fail) => {
				const store = transaction.objectStore(RIDE_STORE);
				const request = this._requestFailure(store.index(RIDE_CUSTOMER_INDEX).getAll(this._only(customerKey)), fail);
				request.onsuccess = () => {
					let count = 0;
					for (const ride of Array.isArray(request.result) ? request.result : []) {
						if (!this._isOwnedRide(ride)
							|| ride.customerKey !== customerKey
							|| ride.status !== 'recording'
							|| this._activeRides.has(ride.storageKey)
							|| this._leaseIsFresh(ride, recoveredAtMs)) continue;
						ride.status = 'interrupted';
						ride.endedAt = ride.lastSegmentEndedAt || ride.updatedAt || recoveredAt;
						ride.durationMs = Math.max(0, new Date(ride.endedAt).getTime() - new Date(ride.startedAt).getTime());
						ride.interruptedAt = recoveredAt;
						ride.updatedAt = recoveredAt;
						this._clearLease(ride);
						this._requestFailure(store.put(ride), fail);
						count += 1;
					}
					setResult({ recovered: count });
				};
			});
		}

		async recoverRide(input) {
			const source = input || {};
			const customerKey = this._customerKey(source);
			const rideId = this._rideId(source);
			const rideStorageKey = this._rideStorageKey(customerKey, rideId);
			const recoveredAtMs = this._nowMs();
			const recoveredAt = new Date(recoveredAtMs).toISOString();
			const confirmedAbandoned = source.confirmAbandoned === true || source.confirm_abandoned === true;
			return this._transaction([RIDE_STORE], 'readwrite', (transaction, setResult, fail) => {
				const store = transaction.objectStore(RIDE_STORE);
				const request = this._requestFailure(store.get(rideStorageKey), fail);
				request.onsuccess = () => {
					const ride = request.result;
					if (!this._isOwnedRide(ride) || ride.customerKey !== customerKey || ride.rideId !== rideId) {
						fail(error('The Halo ride-footage record was not found.', 'ride_memories_ride_not_found'));
						return;
					}
					if (ride.status !== 'recording') {
						setResult(this._publicRide(ride));
						return;
					}
					if (this._activeRides.has(rideStorageKey)) {
						fail(error('This ride-footage recording is active in this Halo window.', 'ride_memories_active_here'));
						return;
					}
					if (this._leaseIsFresh(ride, recoveredAtMs) && !confirmedAbandoned) {
						fail(error('Confirm that the other Halo window or interrupted ride has ended before recovering this footage.', 'ride_memories_recovery_confirmation_required'));
						return;
					}
					ride.status = 'interrupted';
					ride.endedAt = ride.lastSegmentEndedAt || ride.updatedAt || recoveredAt;
					ride.durationMs = Math.max(0, new Date(ride.endedAt).getTime() - new Date(ride.startedAt).getTime());
					ride.interruptedAt = recoveredAt;
					ride.updatedAt = recoveredAt;
					ride.summary = Object.assign({}, isPlainObject(ride.summary) ? safeSummary(ride.summary) : {}, {
						incomplete: true,
						recovered_manually: confirmedAbandoned
					});
					this._clearLease(ride);
					this._requestFailure(store.put(ride), fail);
					setResult(this._publicRide(ride));
				};
			});
		}

		async listRides(input) {
			const source = input || {};
			const customerKey = this._customerKey(source);
			if (source.recoverInterrupted !== false && source.recover_interrupted !== false) {
				await this.recoverInterrupted({ customerKey });
			}
			const records = await this._indexRecords(RIDE_STORE, RIDE_CUSTOMER_INDEX, customerKey);
			return records
				.filter((record) => this._isOwnedRide(record) && record.customerKey === customerKey)
				.map((record) => this._publicRide(record))
				.filter(Boolean)
				.sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
		}

		async getSegments(input) {
			const source = input || {};
			const customerKey = this._customerKey(source);
			const rideId = this._rideId(source);
			const rideStorageKey = this._rideStorageKey(customerKey, rideId);
			return this._transaction([RIDE_STORE], 'readonly', (transaction, setResult, fail) => {
				const request = this._requestFailure(transaction.objectStore(RIDE_STORE).get(rideStorageKey), fail);
				request.onsuccess = () => {
					const ride = request.result;
					if (!this._isOwnedRide(ride) || ride.customerKey !== customerKey || ride.rideId !== rideId) {
						setResult([]);
						return;
					}
					setResult(this._manifestSegments(ride));
				};
			});
		}

		async getSegment(input) {
			const source = input || {};
			const customerKey = this._customerKey(source);
			const rideId = this._rideId(source);
			const camera = normaliseCamera(source.camera ?? source.role);
			const sequence = normaliseSequence(source.sequence);
			const rideStorageKey = this._rideStorageKey(customerKey, rideId);
			const storageKey = this._segmentStorageKey(rideStorageKey, camera, sequence);
			return this._transaction([SEGMENT_STORE], 'readonly', (transaction, setResult, fail) => {
				const request = this._requestFailure(transaction.objectStore(SEGMENT_STORE).get(storageKey), fail);
				request.onsuccess = () => {
					const record = request.result;
					if (!this._isOwnedSegment(record)
						|| record.customerKey !== customerKey
						|| record.rideId !== rideId
						|| record.camera !== camera
						|| record.sequence !== sequence) {
						setResult(null);
						return;
					}
					setResult(this._publicSegment(record, true));
				};
			});
		}

		async deleteRide(input) {
			const source = input || {};
			const customerKey = this._customerKey(source);
			const rideId = this._rideId(source);
			const rideStorageKey = this._rideStorageKey(customerKey, rideId);
			const operationAt = this._nowMs();
			const result = await this._transaction([RIDE_STORE, SEGMENT_STORE], 'readwrite', (transaction, setResult, fail) => {
				const rides = transaction.objectStore(RIDE_STORE);
				const segments = transaction.objectStore(SEGMENT_STORE);
				const rideRequest = this._requestFailure(rides.get(rideStorageKey), fail);
				rideRequest.onsuccess = () => {
					const ride = rideRequest.result;
					if (!this._isOwnedRide(ride) || ride.customerKey !== customerKey || ride.rideId !== rideId) {
						setResult({ deleted: false, segmentsDeleted: 0 });
						return;
					}
					try { this._assertLeaseAvailable(ride, operationAt); }
					catch (leaseError) { fail(leaseError); return; }
					const descriptors = this._manifestSegments(ride);
					for (const descriptor of descriptors) {
						const storageKey = this._segmentStorageKey(rideStorageKey, descriptor.camera, descriptor.sequence);
						this._requestFailure(segments.delete(storageKey), fail);
					}
					this._requestFailure(rides.delete(rideStorageKey), fail);
					setResult({ deleted: true, segmentsDeleted: descriptors.length });
				};
			});
			if (result?.deleted) this._activeRides.delete(rideStorageKey);
			return result;
		}

		async estimateStorage(input) {
			const source = input || {};
			if (!this.supported) {
				return {
					supported: false,
					storage: 'unavailable',
					haloBytes: 0,
					rideCount: 0,
					segmentCount: 0,
					usageBytes: null,
					quotaBytes: null,
					availableBytes: null,
					persisted: false,
					externalMediaScanned: false
				};
			}
			const customerKey = source.customerKey !== undefined || source.customer_key !== undefined || source.customerId !== undefined || source.customer_id !== undefined
				? this._customerKey(source)
				: null;
			const rideRecords = customerKey
				? await this._indexRecords(RIDE_STORE, RIDE_CUSTOMER_INDEX, customerKey)
				: await this._all(RIDE_STORE);
			const rides = rideRecords.filter((record) => this._isOwnedRide(record) && (!customerKey || record.customerKey === customerKey));
			const segmentManifests = rides.flatMap((ride) => this._manifestSegments(ride));
			const haloBytes = segmentManifests.reduce((total, record) => total + Math.max(0, safeNumber(record.sizeBytes, 0)), 0);
			let estimate = {};
			let persisted = false;
			try {
				if (typeof this.options.navigator?.storage?.estimate === 'function') estimate = await this.options.navigator.storage.estimate() || {};
			} catch (estimateError) { estimate = {}; }
			try {
				if (typeof this.options.navigator?.storage?.persisted === 'function') persisted = await this.options.navigator.storage.persisted() === true;
			} catch (persistError) { persisted = false; }
			const usageBytes = Number.isFinite(Number(estimate.usage)) ? Number(estimate.usage) : null;
			const quotaBytes = Number.isFinite(Number(estimate.quota)) ? Number(estimate.quota) : null;
			return {
				supported: true,
				storage: 'indexeddb',
				haloBytes,
				rideCount: rides.length,
				segmentCount: segmentManifests.length,
				usageBytes,
				quotaBytes,
				availableBytes: usageBytes !== null && quotaBytes !== null ? Math.max(0, quotaBytes - usageBytes) : null,
				persisted,
				externalMediaScanned: false
			};
		}

		storageEstimate(input) {
			return this.estimateStorage(input);
		}

		close() {
			this._openGeneration += 1;
			if (this._database) {
				try { this._database.close(); } catch (closeError) { /* Storage is already closed. */ }
			}
			this._database = null;
			this._databasePromise = null;
			this._activeRides.clear();
		}

		destroy() {
			this.close();
		}
	}

	return {
		AvenraHaloRideMemories,
		AvenraHaloRideMemoriesError,
		formatRideMemoryFilename,
		extensionForMimeType,
		constants: Object.freeze({
			DATABASE_NAME,
			DATABASE_VERSION,
			RECORD_SCHEMA_VERSION,
			TELEMETRY_SCHEMA_VERSION,
			MAX_TELEMETRY_POINTS_PER_SEGMENT,
			OWNERSHIP_MAGIC,
			RIDE_STORE,
			SEGMENT_STORE,
			RIDE_CUSTOMER_INDEX,
			SEGMENT_RIDE_INDEX,
			SEGMENT_CUSTOMER_INDEX
		})
	};
}));
