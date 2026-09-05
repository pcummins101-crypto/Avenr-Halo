'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Blob } = require('node:buffer');
const {
	AvenraHaloRideMemories,
	formatRideMemoryFilename,
	extensionForMimeType,
	constants
} = require('../assets/js/ride-memories.js');

function clone(value) {
	return typeof structuredClone === 'function' ? structuredClone(value) : value;
}

class FakeRequest {
	constructor() {
		this.result = undefined;
		this.error = null;
		this.onsuccess = null;
		this.onerror = null;
		this.onupgradeneeded = null;
		this.onblocked = null;
	}
}

class FakeTransaction {
	constructor(database, storeNames, mode) {
		this.database = database;
		this.storeNames = Array.isArray(storeNames) ? storeNames : [storeNames];
		this.mode = mode;
		this.error = null;
		this.oncomplete = null;
		this.onabort = null;
		this.onerror = null;
		this.pending = 0;
		this.aborted = false;
		this.finished = false;
		setImmediate(() => this.maybeComplete());
	}

	objectStore(name) {
		if (!this.storeNames.includes(name) || !this.database.state.stores.has(name)) throw new Error(`Missing store ${name}`);
		return new FakeObjectStore(this, name);
	}

	request(operation) {
		const request = new FakeRequest();
		this.pending += 1;
		setImmediate(() => {
			if (this.aborted || this.finished) {
				this.pending -= 1;
				this.maybeComplete();
				return;
			}
			try {
				request.result = operation();
				request.onsuccess?.({ type: 'success', target: request });
			} catch (operationError) {
				request.error = operationError;
				let prevented = false;
				request.onerror?.({
					type: 'error',
					target: request,
					preventDefault() { prevented = true; }
				});
				if (!prevented && !this.aborted) {
					this.error = operationError;
					this.onerror?.({ type: 'error', target: this });
					this.abort();
				}
			} finally {
				this.pending -= 1;
				this.maybeComplete();
			}
		});
		return request;
	}

	maybeComplete() {
		if (this.finished || this.aborted || this.pending !== 0) return;
		this.finished = true;
		this.oncomplete?.({ type: 'complete', target: this });
	}

	abort() {
		if (this.finished || this.aborted) return;
		this.aborted = true;
		setImmediate(() => {
			if (this.finished) return;
			this.finished = true;
			this.onabort?.({ type: 'abort', target: this });
		});
	}
}

class FakeObjectStore {
	constructor(transaction, name) {
		this.transaction = transaction;
		this.name = name;
		this.keyPath = transaction.database.state.keyPaths.get(name);
	}

	createIndex(name, keyPath) {
		this.transaction.database.state.indexes.get(this.name).set(name, keyPath);
		return this;
	}

	index(name) {
		const keyPath = this.transaction.database.state.indexes.get(this.name)?.get(name);
		if (!keyPath) throw new Error(`Missing index ${name}`);
		return new FakeIndex(this.transaction, this.name, name, keyPath);
	}

	get(key) {
		return this.transaction.request(() => clone(this.map().get(key)));
	}

	getAll() {
		return this.transaction.request(() => {
			const records = Array.from(this.map().entries(), ([key, value]) => [key, clone(value)]);
			this.transaction.database.state.queryLog.push({ store: this.name, index: null, operation: 'getAll', keys: records.map(([key]) => key) });
			return records.map(([, value]) => value);
		});
	}

	add(value) {
		return this.transaction.request(() => {
			const key = value[this.keyPath];
			if (this.map().has(key)) {
				const duplicate = new Error('Key already exists');
				duplicate.name = 'ConstraintError';
				throw duplicate;
			}
			this.map().set(key, clone(value));
			return key;
		});
	}

	put(value) {
		return this.transaction.request(() => {
			const key = value[this.keyPath];
			this.map().set(key, clone(value));
			return key;
		});
	}

	delete(key) {
		return this.transaction.request(() => this.map().delete(key));
	}

	map() { return this.transaction.database.state.stores.get(this.name); }
}

class FakeIndex {
	constructor(transaction, storeName, name, keyPath) {
		this.transaction = transaction;
		this.storeName = storeName;
		this.name = name;
		this.keyPath = keyPath;
	}

	getAll(query) {
		const expected = query && query.__haloOnly === true ? query.value : query;
		return this.transaction.request(() => {
			const records = [];
			const keys = [];
			for (const [key, value] of this.transaction.database.state.stores.get(this.storeName).entries()) {
				if (value?.[this.keyPath] !== expected) continue;
				keys.push(key);
				records.push(clone(value));
			}
			this.transaction.database.state.queryLog.push({
				store: this.storeName,
				index: this.name,
				operation: 'getAll',
				value: expected,
				keys
			});
			return records;
		});
	}
}

const FakeIDBKeyRange = Object.freeze({
	only(value) { return Object.freeze({ __haloOnly: true, value }); }
});

class FakeDatabase {
	constructor(state) {
		this.state = state;
		this.onversionchange = null;
		this.objectStoreNames = { contains: (name) => this.state.stores.has(name) };
	}

	createObjectStore(name, options = {}) {
		if (!this.state.stores.has(name)) this.state.stores.set(name, new Map());
		this.state.keyPaths.set(name, options.keyPath || 'id');
		if (!this.state.indexes.has(name)) this.state.indexes.set(name, new Map());
		return {
			createIndex: (indexName, keyPath) => {
				this.state.indexes.get(name).set(indexName, keyPath);
			}
		};
	}

	transaction(storeNames, mode) { return new FakeTransaction(this, storeNames, mode); }
	close() {}
}

class FakeIndexedDB {
	constructor() { this.databases = new Map(); }

	open(name, version) {
		const request = new FakeRequest();
		setImmediate(() => {
			let state = this.databases.get(name);
			const isUpgrade = !state || version > state.version;
			if (!state) {
				state = { version: 0, stores: new Map(), keyPaths: new Map(), indexes: new Map(), queryLog: [] };
				this.databases.set(name, state);
			}
			if (version < state.version) {
				request.error = new Error('VersionError');
				request.onerror?.({ type: 'error', target: request });
				return;
			}
			const database = new FakeDatabase(state);
			request.result = database;
			if (isUpgrade) {
				state.version = version;
				request.onupgradeneeded?.({ type: 'upgradeneeded', target: request });
			}
			request.onsuccess?.({ type: 'success', target: request });
		});
		return request;
	}

	seed(databaseName, storeName, key, value) {
		const state = this.databases.get(databaseName);
		assert.ok(state?.stores.has(storeName), `store ${storeName} should exist before seeding`);
		state.stores.get(storeName).set(key, clone(value));
	}

	has(databaseName, storeName, key) {
		return this.databases.get(databaseName)?.stores.get(storeName)?.has(key) === true;
	}

	queryLog(databaseName) {
		return this.databases.get(databaseName)?.queryLog || [];
	}

	clearQueryLog(databaseName) {
		const state = this.databases.get(databaseName);
		if (state) state.queryLog = [];
	}
}

function makeStore(options = {}) {
	const indexedDB = options.indexedDB || new FakeIndexedDB();
	const databaseName = options.databaseName || `halo-memories-test-${Math.random()}`;
	let time = options.time || Date.parse('2026-08-24T20:30:40.123Z');
	const navigator = options.navigator || {
		storage: {
			async estimate() { return { usage: 250, quota: 1000 }; },
			async persisted() { return true; }
		}
	};
	const store = new AvenraHaloRideMemories({
		indexedDB,
		IDBKeyRange: FakeIDBKeyRange,
		databaseName,
		Blob,
		navigator,
		now: () => time,
		leaseOwner: options.leaseOwner,
		leaseDurationMs: options.leaseDurationMs
	});
	return {
		store,
		indexedDB,
		databaseName,
		advance(milliseconds) { time += milliseconds; }
	};
}

test('formats deterministic HALO-owned filenames with an allowlisted extension', () => {
	const first = formatRideMemoryFilename({
		startedAt: '2026-08-24T20:30:40.123Z',
		rideId: 'Ride / Paul:Summer 2026',
		camera: 'rear',
		sequence: 7,
		mimeType: 'video/webm;codecs=vp9'
	});
	const repeated = formatRideMemoryFilename({
		started_at: '2026-08-24T20:30:40.123Z',
		client_ride_id: 'Ride / Paul:Summer 2026',
		role: 'rear',
		sequence: 7,
		mime_type: 'video/webm'
	});
	const collisionCandidate = formatRideMemoryFilename({
		startedAt: '2026-08-24T20:30:40.123Z',
		rideId: 'Ride ? Paul:Summer 2026',
		camera: 'rear',
		sequence: 7,
		mimeType: 'video/webm'
	});

	assert.equal(first, repeated);
	assert.match(first, /^HALO_RIDE_v1_20260824T203040123Z_Ride-Paul-Summer-2026-[0-9a-f]{16}_rear_000007\.webm$/);
	assert.notEqual(first, collisionCandidate, 'the exact ride-id hash must distinguish sanitisation collisions');
	assert.equal(extensionForMimeType('video/mp4; codecs=h264'), 'mp4');
	assert.equal(extensionForMimeType('application/octet-stream'), '');
	assert.throws(() => formatRideMemoryFilename({ startedAt: '2026-08-24T20:30:40Z', rideId: 'ride-x', camera: 'rear', sequence: 1, mimeType: 'video/avi' }), {
		code: 'ride_memories_mime_unsupported'
	});
});

test('stores ride and segment manifests, video Blobs, gaps and final summary without audio', async () => {
	const { store, advance } = makeStore();
	const ride = await store.beginRide({
		customerId: 42,
		rideId: 'ride-memory-0001',
		startedAt: '2026-08-24T20:30:40.123Z',
		cameras: ['rear', 'front']
	});
	assert.equal(ride.haloMagic, constants.OWNERSHIP_MAGIC);
	assert.equal(ride.haloSchemaVersion, 1);
	assert.equal(ride.audio, false);
	assert.equal(ride.status, 'recording');

	const rearBlob = new Blob(['rear-video'], { type: 'video/webm' });
	const frontBlob = new Blob(['front-video'], { type: 'video/mp4' });
	const rear = await store.appendSegment({
		customerId: 42,
		rideId: 'ride-memory-0001',
		camera: 'rear',
		sequence: 1,
		blob: rearBlob,
		startedAt: '2026-08-24T20:30:40.123Z',
		durationMs: 10000
	});
	advance(10000);
	await store.appendSegment({
		customerId: 42,
		rideId: 'ride-memory-0001',
		camera: 'front',
		sequence: 1,
		blob: frontBlob,
		mimeType: 'video/mp4;codecs=h264',
		startedAt: '2026-08-24T20:30:40.123Z',
		durationMs: 10000
	});
	assert.equal(Object.prototype.hasOwnProperty.call(rear, 'blob'), false, 'append should return metadata, not keep a UI Blob reference');

	const gap = await store.markGap({
		customerId: 42,
		rideId: 'ride-memory-0001',
		startedAt: '2026-08-24T20:30:50.123Z',
		endedAt: '2026-08-24T20:30:55.123Z',
		reason: 'document-hidden'
	});
	assert.equal(gap.durationMs, 5000);

	const final = await store.finalizeRide({
		customerId: 42,
		rideId: 'ride-memory-0001',
		endedAt: '2026-08-24T20:31:00.123Z',
		summary: { distance_miles: 3.2, top_speed_mph: 52 }
	});
	assert.equal(final.status, 'completed');
	assert.equal(final.segmentCount, 2);
	assert.deepEqual(final.counts, { rear: 1, front: 1 });
	assert.equal(final.bytes, rearBlob.size + frontBlob.size);
	assert.equal(final.gaps[0].reason, 'document-hidden');
	assert.equal(final.summary.distance_miles, 3.2);

	const manifests = await store.getSegments({ customerId: 42, rideId: 'ride-memory-0001' });
	assert.equal(manifests.length, 2);
	assert.ok(manifests.every((segment) => !Object.prototype.hasOwnProperty.call(segment, 'blob')));
	assert.ok(manifests.every((segment) => segment.audio === false));
	assert.deepEqual(manifests.map((segment) => segment.camera), ['rear', 'front']);

	const storedRear = await store.getSegment({ customerId: 42, rideId: 'ride-memory-0001', camera: 'rear', sequence: 1 });
	assert.ok(storedRear.blob instanceof Blob);
	assert.equal(await storedRear.blob.text(), 'rear-video');
	assert.match(storedRear.filename, /_rear_000001\.webm$/);

	const estimate = await store.estimateStorage({ customerId: 42 });
	assert.deepEqual(estimate, {
		supported: true,
		storage: 'indexeddb',
		haloBytes: rearBlob.size + frontBlob.size,
		rideCount: 1,
		segmentCount: 2,
		usageBytes: 250,
		quotaBytes: 1000,
		availableBytes: 750,
		persisted: true,
		externalMediaScanned: false
	});
});

test('stores bounded, validated telemetry beside a clip without changing the original Blob', async () => {
	const { store } = makeStore();
	const startedAt = '2026-08-24T20:30:40.123Z';
	const startedMs = Date.parse(startedAt);
	await store.beginRide({ customerKey: 'customer-telemetry', rideId: 'ride-telemetry', startedAt });
	const sourceBlob = new Blob(['pristine-camera-bytes'], { type: 'video/webm' });
	await store.appendSegment({
		customerKey: 'customer-telemetry',
		rideId: 'ride-telemetry',
		camera: 'rear',
		sequence: 1,
		blob: sourceBlob,
		startedAt,
		endedAt: '2026-08-24T20:30:50.123Z',
		telemetry: [
			{ at: startedMs + 1000, speedMph: 42.36, lat: 53.12345678, lng: -1.98765432, accuracy: 8.44, heading: 360, roadName: '  A1(M)  ' },
			{ at: startedMs + 2000, speedMph: null, elapsedSeconds: '', lat: 91, lng: -1, roadName: 'x'.repeat(240) },
			{ at: 'not-a-time', speedMph: 30 }
		]
	});

	const descriptors = await store.getSegments({ customerKey: 'customer-telemetry', rideId: 'ride-telemetry' });
	assert.equal(descriptors[0].telemetryPointCount, 2);
	assert.equal(Object.prototype.hasOwnProperty.call(descriptors[0], 'telemetry'), false, 'the growing ride manifest must not duplicate the telemetry sidecar');

	const stored = await store.getSegment({ customerKey: 'customer-telemetry', rideId: 'ride-telemetry', camera: 'rear', sequence: 1 });
	assert.equal(stored.telemetrySchemaVersion, constants.TELEMETRY_SCHEMA_VERSION);
	assert.equal(stored.telemetry.length, 2);
	assert.deepEqual(stored.telemetry[0], {
		at: startedMs + 1000,
		speedMph: 42.4,
		lat: 53.123457,
		lng: -1.987654,
		accuracy: 8.4,
		heading: 0,
		roadName: 'A1(M)'
	});
	assert.equal(Object.prototype.hasOwnProperty.call(stored.telemetry[1], 'speedMph'), false);
	assert.equal(Object.prototype.hasOwnProperty.call(stored.telemetry[1], 'elapsedSeconds'), false);
	assert.equal(Object.prototype.hasOwnProperty.call(stored.telemetry[1], 'lat'), false);
	assert.equal(stored.telemetry[1].roadName.length, 190);
	assert.equal(await stored.blob.text(), 'pristine-camera-bytes');

	const secondStartedAt = '2026-08-24T20:30:50.123Z';
	const secondStartedMs = Date.parse(secondStartedAt);
	await store.appendSegment({
		customerKey: 'customer-telemetry',
		rideId: 'ride-telemetry',
		camera: 'rear',
		sequence: 2,
		blob: new Blob(['second-clip'], { type: 'video/webm' }),
		startedAt: secondStartedAt,
		endedAt: '2026-08-24T20:31:00.123Z',
		telemetry: Array.from({ length: 80 }, (_, index) => ({ at: secondStartedMs + (index * 100), speedMph: index }))
	});
	const bounded = await store.getSegment({ customerKey: 'customer-telemetry', rideId: 'ride-telemetry', camera: 'rear', sequence: 2 });
	assert.equal(bounded.telemetry.length, constants.MAX_TELEMETRY_POINTS_PER_SEGMENT);
	assert.equal(bounded.telemetry[0].at, secondStartedMs + 1600, 'the newest bounded samples should be retained');
});

test('keeps listings customer-scoped and rejects audio, unknown MIME types and duplicate segments', async () => {
	const { store } = makeStore();
	await store.beginRide({ customerKey: 'customer-a', rideId: 'ride-a', startedAt: '2026-08-24T20:00:00Z' });
	await store.beginRide({ customerKey: 'customer-b', rideId: 'ride-b', startedAt: '2026-08-24T21:00:00Z' });
	await store.appendSegment({ customerKey: 'customer-a', rideId: 'ride-a', camera: 'rear', sequence: 1, blob: new Blob(['a'], { type: 'video/webm' }) });

	assert.deepEqual((await store.listRides({ customerKey: 'customer-a' })).map((ride) => ride.rideId), ['ride-a']);
	assert.deepEqual((await store.listRides({ customerKey: 'customer-b' })).map((ride) => ride.rideId), ['ride-b']);
	assert.equal(await store.getSegment({ customerKey: 'customer-b', rideId: 'ride-a', camera: 'rear', sequence: 1 }), null);

	await assert.rejects(
		store.appendSegment({ customerKey: 'customer-a', rideId: 'ride-a', camera: 'rear', sequence: 2, audio: true, blob: new Blob(['a'], { type: 'video/webm' }) }),
		{ code: 'ride_memories_audio_forbidden' }
	);
	await assert.rejects(
		store.appendSegment({ customerKey: 'customer-a', rideId: 'ride-a', camera: 'rear', sequence: 2, blob: new Blob(['a'], { type: 'video/avi' }) }),
		{ code: 'ride_memories_mime_unsupported' }
	);
	await assert.rejects(
		store.appendSegment({ customerKey: 'customer-a', rideId: 'ride-a', camera: 'rear', sequence: 1, blob: new Blob(['again'], { type: 'video/webm' }) }),
		{ code: 'ride_memories_segment_exists' }
	);
	await assert.rejects(
		store.beginRide({ customerKey: 'customer-a', rideId: 'ride-a' }),
		{ code: 'ride_memories_ride_exists' }
	);
});

test('recovers an interrupted recording in a fresh store instance', async () => {
	const shared = new FakeIndexedDB();
	const databaseName = 'halo-interrupted-recovery';
	const first = makeStore({ indexedDB: shared, databaseName, time: Date.parse('2026-08-24T20:00:00Z'), leaseDurationMs: 45000 });
	await first.store.beginRide({ customerKey: 'customer-a', rideId: 'ride-interrupted', startedAt: '2026-08-24T20:00:00Z' });
	await first.store.appendSegment({
		customerKey: 'customer-a',
		rideId: 'ride-interrupted',
		camera: 'rear',
		sequence: 1,
		blob: new Blob(['partial'], { type: 'video/webm' }),
		startedAt: '2026-08-24T20:00:00Z',
		endedAt: '2026-08-24T20:00:10Z'
	});

	const stillActive = await first.store.listRides({ customerKey: 'customer-a' });
	assert.equal(stillActive[0].status, 'recording', 'the active owner must not recover its own live ride');

	const second = makeStore({ indexedDB: shared, databaseName, time: Date.parse('2026-08-24T20:01:00Z'), leaseDurationMs: 45000 });
	const recovered = await second.store.listRides({ customerKey: 'customer-a' });
	assert.equal(recovered[0].status, 'interrupted');
	assert.equal(recovered[0].endedAt, '2026-08-24T20:00:10.000Z');
	assert.equal(recovered[0].segmentCount, 1);
	assert.equal((await second.store.getSegments({ customerKey: 'customer-a', rideId: 'ride-interrupted' })).length, 1);
});

test('a fresh cross-tab lease cannot be recovered or stolen, while an expired lease is recoverable', async () => {
	const shared = new FakeIndexedDB();
	const databaseName = 'halo-cross-tab-lease';
	const owner = makeStore({
		indexedDB: shared,
		databaseName,
		time: Date.parse('2026-08-24T20:00:00Z'),
		leaseOwner: 'window-a',
		leaseDurationMs: 45000
	});
	await owner.store.beginRide({ customerKey: 'customer-a', rideId: 'ride-leased', startedAt: '2026-08-24T20:00:00Z' });

	const observer = makeStore({
		indexedDB: shared,
		databaseName,
		time: Date.parse('2026-08-24T20:00:10Z'),
		leaseOwner: 'window-b',
		leaseDurationMs: 45000
	});
	assert.equal((await observer.store.listRides({ customerKey: 'customer-a' }))[0].status, 'recording');
	await assert.rejects(observer.store.refreshLease({ customerKey: 'customer-a', rideId: 'ride-leased' }), {
		code: 'ride_memories_lease_conflict'
	});

	owner.advance(30000);
	await owner.store.refreshLease({ customerKey: 'customer-a', rideId: 'ride-leased' });
	observer.advance(50000);
	assert.equal((await observer.store.listRides({ customerKey: 'customer-a' }))[0].status, 'recording', 'a heartbeat must extend the other window lease');

	observer.advance(20000);
	const recovered = await observer.store.listRides({ customerKey: 'customer-a' });
	assert.equal(recovered[0].status, 'interrupted', 'only the expired lease may be recovered');
});

test('the default lease survives prolonged mobile timer suspension before stale recovery', async () => {
	const shared = new FakeIndexedDB();
	const databaseName = 'halo-suspension-tolerant-lease';
	const owner = makeStore({
		indexedDB: shared,
		databaseName,
		time: Date.parse('2026-08-24T20:00:00Z'),
		leaseOwner: 'suspended-window'
	});
	await owner.store.beginRide({ customerKey: 'customer-a', rideId: 'ride-suspended', startedAt: '2026-08-24T20:00:00Z' });

	const observer = makeStore({
		indexedDB: shared,
		databaseName,
		time: Date.parse('2026-08-27T20:00:00Z'),
		leaseOwner: 'visible-window'
	});
	assert.equal((await observer.store.listRides({ customerKey: 'customer-a' }))[0].status, 'recording', 'several days of timer suspension must not truncate the live manifest');
	await assert.rejects(observer.store.deleteRide({ customerKey: 'customer-a', rideId: 'ride-suspended' }), {
		code: 'ride_memories_lease_conflict'
	});

	observer.advance(5 * 24 * 60 * 60 * 1000);
	assert.equal((await observer.store.listRides({ customerKey: 'customer-a' }))[0].status, 'interrupted', 'an abandoned manifest remains recoverable after the conservative stale window');
});

test('a rider can explicitly recover a killed-tab manifest but not the current window recording', async () => {
	const shared = new FakeIndexedDB();
	const databaseName = 'halo-explicit-abandoned-recovery';
	const owner = makeStore({ indexedDB: shared, databaseName, leaseOwner: 'window-that-will-close' });
	await owner.store.beginRide({ customerKey: 'customer-a', rideId: 'ride-killed-tab', startedAt: '2026-08-24T20:00:00Z' });
	await owner.store.appendSegment({
		customerKey: 'customer-a',
		rideId: 'ride-killed-tab',
		camera: 'rear',
		sequence: 1,
		blob: new Blob(['recoverable'], { type: 'video/webm' }),
		startedAt: '2026-08-24T20:00:00Z',
		endedAt: '2026-08-24T20:00:10Z'
	});
	await assert.rejects(owner.store.recoverRide({ customerKey: 'customer-a', rideId: 'ride-killed-tab', confirmAbandoned: true }), {
		code: 'ride_memories_active_here'
	});
	owner.store.close();

	const relaunched = makeStore({ indexedDB: shared, databaseName, leaseOwner: 'relaunched-window' });
	await assert.rejects(relaunched.store.recoverRide({ customerKey: 'customer-a', rideId: 'ride-killed-tab' }), {
		code: 'ride_memories_recovery_confirmation_required'
	});
	const recovered = await relaunched.store.recoverRide({ customerKey: 'customer-a', rideId: 'ride-killed-tab', confirmAbandoned: true });
	assert.equal(recovered.status, 'interrupted');
	assert.equal(recovered.endedAt, '2026-08-24T20:00:10.000Z');
	assert.equal(recovered.summary.incomplete, true);
	assert.equal(recovered.summary.recovered_manually, true);
	assert.equal((await relaunched.store.getSegments({ customerKey: 'customer-a', rideId: 'ride-killed-tab' })).length, 1);
});

test('scoped operations query indexes without materialising or deleting another customer\'s Blobs', async () => {
	const { store, indexedDB, databaseName } = makeStore({ leaseOwner: 'single-window' });
	await store.beginRide({ customerKey: 'customer-a', rideId: 'ride-a-scoped', startedAt: '2026-08-24T20:00:00Z' });
	await store.appendSegment({ customerKey: 'customer-a', rideId: 'ride-a-scoped', camera: 'rear', sequence: 1, blob: new Blob(['customer-a-video'], { type: 'video/webm' }) });
	await store.beginRide({ customerKey: 'customer-b', rideId: 'ride-b-private', startedAt: '2026-08-24T20:01:00Z' });
	await store.appendSegment({ customerKey: 'customer-b', rideId: 'ride-b-private', camera: 'rear', sequence: 1, blob: new Blob(['customer-b-private-video'], { type: 'video/webm' }) });

	indexedDB.clearQueryLog(databaseName);
	await store.recoverInterrupted({ customerKey: 'customer-a' });
	await store.listRides({ customerKey: 'customer-a', recoverInterrupted: false });
	await store.getSegments({ customerKey: 'customer-a', rideId: 'ride-a-scoped' });
	await store.estimateStorage({ customerKey: 'customer-a' });
	const removed = await store.deleteRide({ customerKey: 'customer-a', rideId: 'ride-a-scoped' });
	assert.deepEqual(removed, { deleted: true, segmentsDeleted: 1 });

	const queries = indexedDB.queryLog(databaseName);
	assert.ok(queries.length >= 3);
	assert.ok(queries.every((query) => query.index), 'scoped reads must never call an object-store-wide getAll');
	assert.equal(queries.some((query) => query.store === constants.SEGMENT_STORE), false, 'metadata listing, estimates and deletion must not scan Blob-bearing segment records');
	assert.ok(queries.every((query) => query.value !== 'customer-b'));
	assert.ok(queries.every((query) => query.keys.every((key) => !String(key).includes('customer-b') && !String(key).includes('ride-b-private'))), 'another customer\'s records must never be materialised');

	assert.equal((await store.listRides({ customerKey: 'customer-b', recoverInterrupted: false }))[0].rideId, 'ride-b-private');
	assert.equal((await store.getSegments({ customerKey: 'customer-b', rideId: 'ride-b-private' })).length, 1);
});

test('filters foreign records and deletes only records carrying the exact HALO ownership contract', async () => {
	const { store, indexedDB, databaseName } = makeStore();
	await store.open();
	indexedDB.seed(databaseName, constants.RIDE_STORE, 'foreign-ride', {
		storageKey: 'foreign-ride',
		customerKey: 'customer-a',
		rideId: 'external-media',
		status: 'completed'
	});
	indexedDB.seed(databaseName, constants.SEGMENT_STORE, 'foreign-segment', {
		storageKey: 'foreign-segment',
		customerKey: 'customer-a',
		rideId: 'external-media',
		blob: new Blob(['external'], { type: 'video/webm' })
	});

	await store.beginRide({ customerKey: 'customer-a', rideId: 'halo-owned-ride', startedAt: '2026-08-24T20:00:00Z' });
	await store.appendSegment({ customerKey: 'customer-a', rideId: 'halo-owned-ride', camera: 'rear', sequence: 1, blob: new Blob(['owned'], { type: 'video/webm' }) });
	const rideStorageKey = `${constants.OWNERSHIP_MAGIC}:ride:customer-a:malformed-halo-ride`;
	const malformedStorageKey = `${rideStorageKey}:segment:rear:000000001`;
	indexedDB.seed(databaseName, constants.SEGMENT_STORE, malformedStorageKey, {
		haloMagic: constants.OWNERSHIP_MAGIC,
		haloSchemaVersion: constants.RECORD_SCHEMA_VERSION,
		haloRecordType: 'segment',
		storageKey: malformedStorageKey,
		rideStorageKey,
		customerKey: 'customer-a',
		rideId: 'malformed-halo-ride',
		rideStartedAt: '2026-08-24T20:00:00.000Z',
		camera: 'rear',
		sequence: 1,
		filename: 'not-a-recognised-halo-video.webm',
		mimeType: 'video/webm',
		extension: 'webm',
		sizeBytes: 9,
		audio: false,
		blob: new Blob(['malformed'], { type: 'video/webm' })
	});
	assert.deepEqual((await store.listRides({ customerKey: 'customer-a' })).map((ride) => ride.rideId), ['halo-owned-ride']);
	assert.equal((await store.estimateStorage({ customerKey: 'customer-a' })).segmentCount, 1, 'a malformed filename must not be counted as HALO-owned footage');

	const removed = await store.deleteRide({ customerKey: 'customer-a', rideId: 'halo-owned-ride' });
	assert.deepEqual(removed, { deleted: true, segmentsDeleted: 1 });
	assert.equal((await store.listRides({ customerKey: 'customer-a' })).length, 0);
	assert.equal(indexedDB.has(databaseName, constants.RIDE_STORE, 'foreign-ride'), true);
	assert.equal(indexedDB.has(databaseName, constants.SEGMENT_STORE, 'foreign-segment'), true);
	assert.equal(indexedDB.has(databaseName, constants.SEGMENT_STORE, malformedStorageKey), true, 'deletion must leave malformed records untouched');
});

test('fails gracefully when IndexedDB is unavailable without inspecting device media', async () => {
	const store = new AvenraHaloRideMemories({ indexedDB: null, Blob, navigator: {} });
	assert.equal(store.supported, false);
	assert.deepEqual(store.capabilities(), {
		supported: false,
		storage: 'unavailable',
		deviceFolder: false,
		externalMediaScan: false,
		audio: false,
		schemaVersion: 1,
		telemetryOverlay: true,
		telemetrySchemaVersion: 1
	});
	await assert.rejects(store.beginRide({ customerKey: 'customer-a', rideId: 'ride-a' }), {
		code: 'ride_memories_unsupported'
	});
	const estimate = await store.estimateStorage({ customerKey: 'customer-a' });
	assert.equal(estimate.supported, false);
	assert.equal(estimate.externalMediaScanned, false);
});

test('a version change clears both cached database references', async () => {
	const { store } = makeStore();
	const database = await store.open();
	assert.ok(store._databasePromise);
	database.onversionchange();
	assert.equal(store._database, null);
	assert.equal(store._databasePromise, null);
});

test('closing during a pending open rejects and closes the stale database handle', async () => {
	let request;
	let closeCount = 0;
	const indexedDB = {
		open() {
			request = new FakeRequest();
			return request;
		}
	};
	const store = new AvenraHaloRideMemories({ indexedDB, Blob, navigator: {} });
	const opening = store.open();
	store.close();
	request.result = {
		objectStoreNames: { contains() { return true; } },
		close() { closeCount += 1; }
	};
	request.onsuccess();
	await assert.rejects(opening, { code: 'ride_memories_storage_closed' });
	assert.equal(closeCount, 1);
	assert.equal(store._database, null);
	assert.equal(store._databasePromise, null);
});
