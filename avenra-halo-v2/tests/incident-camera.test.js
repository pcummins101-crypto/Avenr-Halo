'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Blob } = require('node:buffer');
const { AvenraHaloIncidentCamera } = require('../assets/js/incident-camera.js');

class FakeEventTarget {
	constructor() { this.listeners = new Map(); }
	addEventListener(type, listener) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type).add(listener);
	}
	removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
	emit(type, event) { for (const listener of this.listeners.get(type) || []) listener(event || { type }); }
}

class FakeTrack extends FakeEventTarget {
	constructor(role, deviceId) {
		super();
		this.kind = 'video';
		this.id = `${role}-${deviceId}`;
		this.label = `${role} camera`;
		this.enabled = true;
		this.readyState = 'live';
		this.settings = { facingMode: role === 'front' ? 'user' : 'environment', deviceId };
		this.stopCalls = 0;
	}
	getSettings() { return this.settings; }
	stop() {
		if (this.readyState === 'ended') return;
		this.stopCalls += 1;
		this.readyState = 'ended';
		this.emit('ended', { type: 'ended' });
	}
}

class FakeAudioTrack extends FakeTrack {
	constructor() { super('audio', 'microphone'); this.kind = 'audio'; }
}

class FakeStream {
	constructor(tracks, audioTracks) {
		this.videoTracks = tracks || [];
		this.audioTracks = audioTracks || [];
	}
	getVideoTracks() { return this.videoTracks.slice(); }
	getAudioTracks() { return this.audioTracks.slice(); }
	getTracks() { return [...this.videoTracks, ...this.audioTracks]; }
	removeTrack(track) {
		this.videoTracks = this.videoTracks.filter((item) => item !== track);
		this.audioTracks = this.audioTracks.filter((item) => item !== track);
	}
}

class FakeDocument extends FakeEventTarget {
	constructor() { super(); this.hidden = false; }
	listenerCount(type) { return this.listeners.get(type)?.size || 0; }
}

function makeRecorder(options) {
	const settings = Object.assign({ failFront: false, stopDelayMs: 0, runtimeFrontError: false }, options || {});
	return class FakeMediaRecorder extends FakeEventTarget {
		static isTypeSupported(type) { return type.includes('webm'); }
		constructor(stream, recorderOptions) {
			super();
			this.stream = stream;
			this.mimeType = recorderOptions?.mimeType || 'video/webm';
			this.state = 'inactive';
			this.role = stream.getVideoTracks()[0]?.getSettings().facingMode === 'user' ? 'front' : 'rear';
			this.stopCalls = 0;
		}
		start() {
			if (settings.failFront && this.role === 'front') throw new Error('Concurrent front recording unavailable');
			this.state = 'recording';
		}
		stop() {
			if (this.state === 'inactive') return;
			this.stopCalls += 1;
			this.state = 'inactive';
			const finish = () => {
				if (settings.runtimeFrontError && this.role === 'front') this.emit('error', { error: new Error('Front recorder ended') });
				else this.emit('dataavailable', { data: new Blob([`${this.role}-segment`], { type: this.mimeType }) });
				this.emit('stop', { type: 'stop' });
			};
			if (settings.stopDelayMs > 0) setTimeout(finish, settings.stopDelayMs);
			else finish();
		}
	};
}

function makeMediaDevices(options) {
	const settings = Object.assign({ frontFails: false, frontEndsRear: false, unexpectedAudio: false }, options || {});
	const calls = [];
	const tracks = [];
	let latestRear = null;
	return {
		calls,
		tracks,
		async getUserMedia(constraints) {
			calls.push(constraints);
			assert.equal(constraints.audio, false, 'camera requests must always disable audio');
			const facingMode = constraints.video.facingMode?.exact || constraints.video.facingMode?.ideal;
			const role = facingMode === 'user' ? 'front' : 'rear';
			if (role === 'front' && settings.frontFails) throw new Error('Only one camera may be opened');
			if (role === 'front' && settings.frontEndsRear && latestRear) latestRear.stop();
			const track = new FakeTrack(role, `${role}-${tracks.length + 1}`);
			tracks.push(track);
			if (role === 'rear') latestRear = track;
			const audio = settings.unexpectedAudio ? [new FakeAudioTrack()] : [];
			return new FakeStream([track], audio);
		}
	};
}

function makeCamera(overrides) {
	const mediaDevices = overrides?.mediaDevices || makeMediaDevices();
	const document = overrides?.document || new FakeDocument();
	const MediaRecorder = overrides?.MediaRecorder || makeRecorder();
	const camera = new AvenraHaloIncidentCamera(Object.assign({
		mediaDevices,
		document,
		MediaRecorder,
		MediaStream: FakeStream,
		Blob,
		dualProbeDelayMs: 0,
		recorderStopTimeoutMs: 1,
		segmentDurationMs: 60000
	}, overrides || {}, { mediaDevices, document, MediaRecorder }));
	return { camera, mediaDevices, document };
}

test('falls back to rear-only without failing the ride when concurrent cameras are unavailable', async () => {
	const mediaDevices = makeMediaDevices({ frontEndsRear: true, unexpectedAudio: true });
	const { camera } = makeCamera({ mediaDevices });
	const capabilityEvents = [];
	camera.addEventListener('capabilitychange', (event) => capabilityEvents.push(event.detail));

	const status = await camera.startRide({ rideId: 'ride-1', preferDual: true });
	assert.equal(status.status, 'recording');
	assert.equal(status.mode, 'rear');
	assert.equal(status.dualCapability, 'unsupported');
	assert.equal(status.microphoneActive, false);
	assert.ok(mediaDevices.calls.length >= 3, 'rear should be reacquired after a failed dual-camera probe');
	assert.ok(mediaDevices.calls.every((call) => call.audio === false));
	assert.ok(capabilityEvents.some((event) => event.dual === false));

	await camera.stopRide();
	assert.ok(mediaDevices.tracks.every((track) => track.readyState === 'ended'));
});

test('uses dual mode only after both live sources and both recorders start', async () => {
	const { camera, mediaDevices } = makeCamera();
	const status = await camera.startRide({ rideId: 'ride-dual' });
	assert.equal(status.mode, 'dual');
	assert.equal(status.dualCapability, 'supported');
	assert.equal(mediaDevices.calls.length, 2);
	await camera.stopRide();
	assert.ok(mediaDevices.tracks.every((track) => track.readyState === 'ended'));
});

test('keeps rear recording when the WebView opens both cameras but cannot record both', async () => {
	const { camera } = makeCamera({ MediaRecorder: makeRecorder({ failFront: true }) });
	const status = await camera.startRide({ rideId: 'ride-recorder-fallback' });
	assert.equal(status.status, 'recording');
	assert.equal(status.mode, 'rear');
	assert.equal(status.dualCapability, 'unsupported');
	await camera.rotateSegment();
	assert.equal(camera.getSegments()[0].recordings.length, 1);
	assert.equal(camera.getSegments()[0].recordings[0].camera, 'rear');
	await camera.stopRide();
});

test('keeps only the configured rolling segment window and evicts complete segment files', async () => {
	const { camera } = makeCamera({ preferDual: false, maxSegments: 2 });
	const deleted = [];
	camera.addEventListener('segmentdeleted', (event) => deleted.push(event.detail));
	await camera.startRide({ rideId: 'ride-rolling', preferDual: false });

	await camera.rotateSegment();
	await camera.rotateSegment();
	await camera.rotateSegment();
	const segments = camera.getSegments();
	assert.equal(segments.length, 2);
	assert.deepEqual(segments.map((segment) => segment.sequence), [2, 3]);
	assert.ok(segments.every((segment) => segment.recordings.length === 1));
	assert.ok(segments.every((segment) => segment.recordings[0].size > 0));
	assert.ok(segments.every((segment) => !Object.prototype.hasOwnProperty.call(segment.recordings[0], 'blob')), 'public segment metadata must not expose buffered Blob references');
	assert.ok(deleted.some((event) => event.reason === 'rolling-eviction' && event.sequence === 1));

	await camera.stopRide();
});

test('emits Blob-bearing segmentdata before eviction while keeping the public segment event redacted', async () => {
	const { camera } = makeCamera({ preferDual: false, maxSegments: 1 });
	const archived = [];
	const publicSegments = [];
	camera.addEventListener('segmentdata', () => { throw new Error('A Ride Memories listener failed.'); });
	camera.addEventListener('segmentdata', (event) => archived.push(event.detail.segment));
	camera.addEventListener('segment', (event) => publicSegments.push(event.detail.segment));
	await camera.startRide({ rideId: 'ride-segmentdata', preferDual: false });

	await camera.rotateSegment();
	await camera.rotateSegment();

	assert.equal(archived.length, 2, 'a throwing listener must not interrupt capture or later listeners');
	assert.equal(publicSegments.length, 2);
	assert.ok(archived.every((segment) => segment.recordings[0].blob instanceof Blob));
	assert.ok(archived.every((segment) => segment.recordings[0].blob.size > 0));
	assert.ok(publicSegments.every((segment) => segment.recordings[0].blob === undefined), 'public segment events must not expose Blob data');
	assert.equal(camera.getSegments().length, 1, 'the incident buffer should still evict its oldest segment');
	assert.equal(camera.getSegments()[0].sequence, 2);
	assert.ok(archived[0].recordings[0].blob instanceof Blob, 'rolling eviction must not null a listener-held Blob');
	assert.ok(archived[0].recordings[0].blob.size > 0);

	await camera.stopRide();
});

test('archive stop emits the final partial segment before discarded incident evidence is cleared', async () => {
	const { camera } = makeCamera({ preferDual: false });
	const archived = [];
	camera.addEventListener('segmentdata', (event) => archived.push(event.detail.segment));
	await camera.startRide({ rideId: 'ride-archive-stop', preferDual: false });

	const status = await camera.stopRide({ discard: true, archive: true, reason: 'ride-ended' });

	assert.equal(archived.length, 1);
	assert.equal(archived[0].reason, 'ride-ended');
	assert.equal(archived[0].recordings.length, 1);
	assert.ok(archived[0].recordings[0].blob instanceof Blob);
	assert.ok(archived[0].recordings[0].blob.size > 0);
	assert.equal(camera.getSegments().length, 0, 'archiving must not retain incident evidence after discard');
	assert.equal(status.bufferedSegments, 0);
	assert.equal(status.status, 'stopped');
});

test('continues rear-only Ride Memories after incident consent is removed without losing the partial clip', async () => {
	const { camera, mediaDevices } = makeCamera();
	const archived = [];
	const statuses = [];
	camera.addEventListener('segmentdata', (event) => archived.push(event.detail.segment));
	camera.addEventListener('statuschange', (event) => statuses.push(event.detail.status));
	await camera.startRide({ rideId: 'ride-memory-consent-change', preferDual: true });
	assert.equal(camera.getStatus().mode, 'dual');

	const continued = await camera.continueForRideMemory({ preferDual: false, reason: 'camera-consent-withdrawn' });

	assert.equal(archived.length, 1, 'the in-progress cycle must be handed to Ride Memories');
	assert.ok(archived[0].recordings.every((recording) => recording.blob instanceof Blob));
	assert.ok(statuses.includes('reconfiguring'), 'the app receives a gap boundary while cameras are reacquired');
	assert.equal(continued.status, 'recording');
	assert.equal(continued.mode, 'rear');
	assert.equal(camera.getSegments().length, 0, 'the withdrawn incident consumer must retain no rolling evidence');
	assert.equal(mediaDevices.calls.at(-1).video.facingMode.exact, 'environment');
	await camera.stopRide({ discard: true });
});

test('a later archive shutdown upgrades an overlapping discard-only recorder flush', async () => {
	const { camera } = makeCamera({
		preferDual: false,
		MediaRecorder: makeRecorder({ stopDelayMs: 35 }),
		recorderStopTimeoutMs: 150
	});
	const archived = [];
	camera.addEventListener('segmentdata', (event) => archived.push(event.detail.segment));
	await camera.startRide({ rideId: 'ride-overlapping-archive', preferDual: false });

	const cancellation = camera.cancelCandidate({ resume: false, reason: 'consumer-stopped' });
	const ending = camera.stopRide({ discard: true, archive: true, reason: 'ride-ended' });
	await Promise.all([cancellation, ending]);

	assert.equal(archived.length, 1, 'archive:true must win while the same recorder is still flushing');
	assert.ok(archived[0].recordings[0].blob instanceof Blob);
	assert.equal(camera.getSegments().length, 0);
});

test('freezes on a candidate, discards on cancel, resumes, and uploads only after confirmation', async () => {
	const uploads = [];
	const { camera } = makeCamera({
		preferDual: false,
		uploadSegment: async (item) => {
			uploads.push(item);
			return { ok: true };
		}
	});
	await camera.startRide({ rideId: 'ride-crash', preferDual: false });
	await camera.rotateSegment();
	await camera.freezeCandidate({ event_id: 'candidate-cancelled' });
	assert.equal(camera.getStatus().status, 'frozen');
	assert.ok(camera.getSegments().length >= 1);
	assert.equal(uploads.length, 0, 'candidate footage must not upload before incident confirmation');

	await camera.cancelCandidate({ resume: true });
	assert.equal(camera.getStatus().status, 'recording');
	assert.equal(camera.getSegments().length, 0, 'cancelled candidate evidence must be deleted');

	await camera.rotateSegment();
	await camera.freezeCandidate({ event_id: 'confirmed-event' });
	const result = await camera.confirmIncident({ event_id: 'confirmed-event', incident_id: 'incident-9' });
	assert.equal(result.ok, true);
	assert.ok(uploads.length >= 1);
	assert.ok(uploads.every((item) => item.camera === 'rear' && item.audio === false));
	assert.ok(uploads.every((item) => item.context.incident_id === 'incident-9'));
	assert.equal(camera.getSegments().length, 0, 'successfully uploaded evidence should be deleted from memory');
	assert.equal(camera.getStatus().cameraActive, false);

	await camera.stopRide();
});

test('stops recorders, camera tracks, visibility listeners and buffered blobs on cleanup', async () => {
	const document = new FakeDocument();
	const { camera, mediaDevices } = makeCamera({ document });
	await camera.startRide({ rideId: 'ride-cleanup' });
	await camera.rotateSegment();
	assert.equal(document.listenerCount('visibilitychange'), 1);
	assert.ok(camera.getSegments().length > 0);

	const status = await camera.stopRide({ discard: true });
	assert.equal(status.status, 'stopped');
	assert.equal(status.cameraActive, false);
	assert.equal(status.recording, false);
	assert.equal(camera.getSegments().length, 0);
	assert.equal(document.listenerCount('visibilitychange'), 0);
	assert.ok(mediaDevices.tracks.every((track) => track.readyState === 'ended'));
});

test('stops camera capture when backgrounded and safely reacquires it on return', async () => {
	const document = new FakeDocument();
	const { camera, mediaDevices } = makeCamera({ document, preferDual: false });
	await camera.startRide({ rideId: 'ride-visibility', preferDual: false });
	assert.equal(camera.getStatus().status, 'recording');

	document.hidden = true;
	document.emit('visibilitychange', { type: 'visibilitychange' });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(camera.getStatus().status, 'paused-background');
	assert.equal(camera.getStatus().cameraActive, false);

	document.hidden = false;
	document.emit('visibilitychange', { type: 'visibilitychange' });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(camera.getStatus().status, 'recording');
	assert.equal(camera.getStatus().mode, 'rear');
	assert.equal(mediaDevices.calls.length, 2, 'rear camera should be reacquired after foreground return');

	await camera.stopRide();
});

test('coalesces a quick background and foreground transition while the recorder is flushing', async () => {
	const document = new FakeDocument();
	const { camera, mediaDevices } = makeCamera({
		document,
		preferDual: false,
		MediaRecorder: makeRecorder({ stopDelayMs: 35 }),
		recorderStopTimeoutMs: 150
	});
	await camera.startRide({ rideId: 'ride-visibility-race', preferDual: false });

	document.hidden = true;
	document.emit('visibilitychange', { type: 'visibilitychange' });
	document.hidden = false;
	document.emit('visibilitychange', { type: 'visibilitychange' });
	await new Promise((resolve) => setTimeout(resolve, 80));

	assert.equal(camera.getStatus().status, 'recording');
	assert.equal(camera.getStatus().pausedForVisibility, false);
	assert.equal(camera.getStatus().cameraActive, true);
	assert.equal(camera.getStatus().mode, 'rear');
	assert.equal(mediaDevices.calls.length, 2, 'the rear camera is reacquired exactly once after the queued pause');
	await camera.stopRide();
});

test('confirmation waits for a delayed recorder flush and uploads the final partial segment', async () => {
	const uploads = [];
	const { camera } = makeCamera({
		preferDual: false,
		MediaRecorder: makeRecorder({ stopDelayMs: 35 }),
		recorderStopTimeoutMs: 150,
		uploadSegment: async (item) => { uploads.push(item); return { ok: true }; }
	});
	await camera.startRide({ rideId: 'ride-freeze-race', preferDual: false });
	const freeze = camera.freezeCandidate({ event_id: 'candidate-fast-confirm' });
	const confirmed = camera.confirmIncident({ event_id: 'candidate-fast-confirm', incident_id: 'incident-fast' });
	await freeze;
	const result = await confirmed;
	assert.equal(result.ok, true);
	assert.equal(uploads.length, 1);
	assert.equal(uploads[0].camera, 'rear');
	await camera.stopRide();
});

test('cancelling evidence aborts the active upload and prevents later segment callbacks', async () => {
	const uploads = [];
	let markFirstUploadStarted;
	const firstUploadStarted = new Promise((resolve) => { markFirstUploadStarted = resolve; });
	const { camera } = makeCamera({
		preferDual: false,
		uploadSegment: async (item) => {
			uploads.push(item);
			if (uploads.length > 1) return { ok: true };
			markFirstUploadStarted();
			return new Promise((resolve, reject) => {
				const abort = () => {
					const error = new Error('Upload aborted by evidence cancellation.');
					error.name = 'AbortError';
					reject(error);
				};
				if (item.signal.aborted) abort();
				else item.signal.addEventListener('abort', abort, { once: true });
			});
		}
	});

	await camera.startRide({ rideId: 'ride-cancel-upload', preferDual: false });
	await camera.rotateSegment();
	await camera.rotateSegment();
	await camera.freezeCandidate({ event_id: 'cancel-upload-event' });
	const confirmation = camera.confirmIncident({ event_id: 'cancel-upload-event', incident_id: 'cancel-upload-incident' });
	await firstUploadStarted;
	const cancellation = camera.cancelCandidate({ resume: false, reason: 'camera-consent-withdrawn' });
	const [result] = await Promise.all([confirmation, cancellation]);

	assert.equal(result.ok, false);
	assert.equal(result.aborted, true);
	assert.equal(uploads.length, 1, 'no later segment callback may start after cancellation');
	assert.equal(uploads[0].signal.aborted, true, 'the active upload receives an aborted signal');
	assert.equal(camera.getSegments().length, 0);
	assert.equal(camera.getStatus().status, 'stopped');
	await camera.stopRide({ discard: true });
});

test('cancelling during a delayed freeze prevents a waiting confirmation from starting an upload', async () => {
	const uploads = [];
	const { camera } = makeCamera({
		preferDual: false,
		MediaRecorder: makeRecorder({ stopDelayMs: 35 }),
		recorderStopTimeoutMs: 150,
		uploadSegment: async (item) => { uploads.push(item); return { ok: true }; }
	});
	await camera.startRide({ rideId: 'ride-cancel-during-freeze', preferDual: false });

	const freezing = camera.freezeCandidate({ event_id: 'cancel-during-freeze-event' });
	const confirmation = camera.confirmIncident({ event_id: 'cancel-during-freeze-event', incident_id: 'cancel-during-freeze-incident' });
	const cancellation = camera.cancelCandidate({ resume: false, reason: 'incident-cancelled' });
	const [, result] = await Promise.all([freezing, confirmation, cancellation]);

	assert.equal(result.ok, false);
	assert.equal(result.aborted, true);
	assert.equal(uploads.length, 0, 'confirmation waiting on recorder flush must respect the cancellation fence');
	assert.equal(camera.getSegments().length, 0);
	assert.equal(camera.getStatus().status, 'stopped');
	await camera.stopRide({ discard: true });
});

test('an ordinary upload failure retains evidence and retries with a fresh signal', async () => {
	const signals = [];
	let attempts = 0;
	const { camera } = makeCamera({
		preferDual: false,
		uploadSegment: async (item) => {
			attempts += 1;
			signals.push(item.signal);
			if (attempts === 1) throw new Error('Temporary upload failure.');
			return { ok: true };
		}
	});

	await camera.startRide({ rideId: 'ride-upload-retry', preferDual: false });
	await camera.freezeCandidate({ event_id: 'upload-retry-event' });
	const first = await camera.confirmIncident({ event_id: 'upload-retry-event', incident_id: 'upload-retry-incident' });
	assert.equal(first.ok, false);
	assert.equal(first.aborted, undefined);
	assert.equal(camera.getStatus().status, 'upload-failed');
	assert.equal(camera.getSegments().length, 1);

	const retried = await camera.confirmIncident({ event_id: 'upload-retry-event', incident_id: 'upload-retry-incident' });
	assert.equal(retried.ok, true);
	assert.equal(attempts, 2);
	assert.notEqual(signals[0], signals[1], 'a retry must not reuse the failed attempt signal');
	assert.equal(signals[0].aborted, false, 'a network failure is not treated as a privacy cancellation');
	assert.equal(camera.getSegments().length, 0);
	await camera.stopRide({ discard: true });
});

test('resumes capture only after a completed incident outcome and clears residual uploaded evidence', async () => {
	const { camera, mediaDevices } = makeCamera({
		preferDual: false,
		discardAfterUpload: false,
		uploadSegment: async () => ({ ok: true })
	});
	await camera.startRide({ rideId: 'ride-resume-uploaded', preferDual: false });
	await camera.freezeCandidate({ event_id: 'resume-uploaded-event' });
	const confirmed = await camera.confirmIncident({ event_id: 'resume-uploaded-event', incident_id: 'resume-uploaded-incident' });
	assert.equal(confirmed.ok, true);
	assert.equal(camera.getStatus().status, 'uploaded');
	assert.equal(camera.getSegments().length, 1, 'the test keeps uploaded evidence to exercise residual cleanup');

	const resumed = await camera.resumeAfterIncident('incident-handled');
	assert.equal(resumed.status, 'recording');
	assert.equal(resumed.frozen, false);
	assert.equal(resumed.confirmed, false);
	assert.equal(resumed.cameraActive, true);
	assert.equal(camera.getSegments().length, 0);
	assert.equal(mediaDevices.calls.length, 2, 'the rear camera should be reacquired exactly once');
	assert.ok(mediaDevices.calls.every((call) => call.audio === false), 'resumed capture must remain video-only');
	await camera.stopRide({ discard: true });
});

test('starts the queued new ride after an earlier retained incident finishes uploading', async () => {
	const uploads = [];
	const { camera, mediaDevices } = makeCamera({
		preferDual: false,
		uploadSegment: async (item) => { uploads.push(item); return { ok: true }; }
	});
	await camera.startRide({ rideId: 'earlier-ride', preferDual: false });
	await camera.freezeCandidate({ event_id: 'earlier-event' });
	await camera.stopRide({ discard: false, reason: 'earlier-ride-ended' });

	const pending = await camera.startRide({ rideId: 'new-memory-ride', preferDual: false });
	assert.equal(pending.status, 'pending-upload');
	assert.equal(pending.rideActive, false);

	const delivered = await camera.confirmIncident({ event_id: 'earlier-event', incident_id: 'earlier-incident', ride_id: 'earlier-ride' });
	assert.equal(delivered.ok, true);
	const resumed = await camera.resumeAfterIncident('earlier-incident-complete');

	assert.equal(resumed.status, 'recording');
	assert.equal(resumed.rideActive, true);
	assert.equal(resumed.recording, true);
	assert.equal(resumed.mode, 'rear');
	assert.ok(uploads.length >= 1);
	assert.equal(mediaDevices.calls.length, 2, 'the new ride reacquires its rear camera after the old upload');
	await camera.stopRide({ discard: true });
});

test('ending a queued ride fences an old upload callback from reopening its camera', async () => {
	const { camera, mediaDevices } = makeCamera({ preferDual: false, uploadSegment: async () => ({ ok: true }) });
	await camera.startRide({ rideId: 'earlier-ride', preferDual: false });
	await camera.freezeCandidate({ event_id: 'earlier-event' });
	await camera.stopRide({ discard: false, reason: 'earlier-ride-ended' });
	await camera.startRide({ rideId: 'ended-before-upload', preferDual: false });
	await camera.stopRide({ discard: false, reason: 'queued-ride-ended' });
	await camera.confirmIncident({ event_id: 'earlier-event', incident_id: 'earlier-incident', ride_id: 'earlier-ride' });
	const result = await camera.resumeAfterIncident('too-late');

	assert.equal(result.rideActive, false);
	assert.equal(result.cameraActive, false);
	assert.equal(mediaDevices.calls.length, 1, 'no camera is reacquired after the queued ride ended');
	await camera.stopRide({ discard: true });
});

test('resuming a no-evidence outcome respects background visibility before reacquiring the camera', async () => {
	const document = new FakeDocument();
	const { camera, mediaDevices } = makeCamera({ document, preferDual: false });
	await camera.startRide({ rideId: 'ride-resume-hidden', preferDual: false });
	await camera.freezeCandidate({ event_id: 'resume-empty-event' });
	camera.discardEvidence('test-empty-outcome');
	const confirmed = await camera.confirmIncident({ event_id: 'resume-empty-event', incident_id: 'resume-empty-incident' });
	assert.equal(confirmed.reason, 'empty-buffer');
	assert.equal(camera.getStatus().status, 'confirmed-no-evidence');

	document.hidden = true;
	const paused = await camera.resumeAfterIncident('incident-no-evidence');
	assert.equal(paused.status, 'paused-background');
	assert.equal(paused.cameraActive, false);
	assert.equal(mediaDevices.calls.length, 1, 'a hidden document must not reacquire the camera');

	document.hidden = false;
	document.emit('visibilitychange', { type: 'visibilitychange' });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(camera.getStatus().status, 'recording');
	assert.equal(camera.getStatus().cameraActive, true);
	assert.equal(mediaDevices.calls.length, 2);
	assert.ok(mediaDevices.calls.every((call) => call.audio === false));
	await camera.stopRide({ discard: true });
});

test('refuses incident resume for failed, retained, pending, destroyed and inactive states', async () => {
	const failedSetup = makeCamera({
		preferDual: false,
		uploadSegment: async () => { throw new Error('Upload remains pending.'); }
	});
	await failedSetup.camera.startRide({ rideId: 'ride-resume-failed', preferDual: false });
	await failedSetup.camera.freezeCandidate({ event_id: 'resume-failed-event' });
	await failedSetup.camera.confirmIncident({ event_id: 'resume-failed-event', incident_id: 'resume-failed-incident' });
	const failedSegments = failedSetup.camera.getSegments().length;
	const failedCalls = failedSetup.mediaDevices.calls.length;
	const failed = await failedSetup.camera.resumeAfterIncident('must-not-resume');
	assert.equal(failed.status, 'upload-failed');
	assert.equal(failed.frozen, true);
	assert.equal(failedSetup.camera.getSegments().length, failedSegments, 'failed evidence must remain retained');
	assert.equal(failedSetup.mediaDevices.calls.length, failedCalls);
	await failedSetup.camera.stopRide({ discard: true });

	const retainedSetup = makeCamera({ preferDual: false });
	await retainedSetup.camera.startRide({ rideId: 'ride-resume-retained', preferDual: false });
	await retainedSetup.camera.freezeCandidate({ event_id: 'resume-retained-event' });
	await retainedSetup.camera.stopRide({ discard: false, reason: 'ride-ended' });
	const retained = await retainedSetup.camera.resumeAfterIncident('must-not-resume');
	assert.equal(retained.status, 'retained');
	assert.equal(retained.rideActive, false);
	assert.ok(retainedSetup.camera.getSegments().length > 0);
	await retainedSetup.camera.stopRide({ discard: true });

	const pendingSetup = makeCamera({ preferDual: false });
	await pendingSetup.camera.startRide({ rideId: 'ride-resume-pending', preferDual: false });
	await pendingSetup.camera.freezeCandidate({ event_id: 'resume-pending-event' });
	const pendingBefore = pendingSetup.camera.getSegments().length;
	const pendingStatus = await pendingSetup.camera.startRide({ rideId: 'replacement-ride', preferDual: false });
	assert.equal(pendingStatus.status, 'pending-upload');
	const pending = await pendingSetup.camera.resumeAfterIncident('must-not-resume');
	assert.equal(pending.status, 'pending-upload');
	assert.equal(pendingSetup.camera.getSegments().length, pendingBefore);
	await pendingSetup.camera.stopRide({ discard: true });

	const destroyedSetup = makeCamera({ preferDual: false });
	await destroyedSetup.camera.startRide({ rideId: 'ride-resume-destroyed', preferDual: false });
	await destroyedSetup.camera.destroy();
	const destroyed = await destroyedSetup.camera.resumeAfterIncident('must-not-resume');
	assert.equal(destroyed.rideActive, false);
	assert.equal(destroyed.cameraActive, false);

	const inactiveSetup = makeCamera({ preferDual: false });
	const inactive = await inactiveSetup.camera.resumeAfterIncident('must-not-resume');
	assert.equal(inactive.status, 'idle');
	assert.equal(inactive.rideActive, false);
	assert.equal(inactiveSetup.mediaDevices.calls.length, 0);
});

test('a non-destructive stop during delayed freezing retains the completed final segment', async () => {
	const { camera } = makeCamera({
		preferDual: false,
		MediaRecorder: makeRecorder({ stopDelayMs: 35 }),
		recorderStopTimeoutMs: 150
	});
	await camera.startRide({ rideId: 'ride-stop-during-freeze', preferDual: false });

	const freezing = camera.freezeCandidate({ event_id: 'stop-during-freeze-event' });
	assert.equal(camera.getStatus().status, 'freezing');
	const stopping = camera.stopRide({ discard: false, reason: 'ride-ended' });
	const [, stopped] = await Promise.all([freezing, stopping]);

	assert.equal(stopped.status, 'retained');
	assert.equal(stopped.bufferedSegments, 1);
	assert.equal(stopped.frozen, true);
	assert.equal(camera.getSegments().length, 1, 'the delayed final recorder flush must remain available for upload');
	assert.equal(camera.getSegments()[0].recordings.length, 1);
	await camera.stopRide({ discard: true });
});

test('segment duration excludes asynchronous recorder shutdown latency', async () => {
	const uploads = [];
	const { camera } = makeCamera({
		preferDual: false,
		MediaRecorder: makeRecorder({ stopDelayMs: 70 }),
		recorderStopTimeoutMs: 180,
		uploadSegment: async (item) => { uploads.push(item); return { ok: true }; }
	});
	await camera.startRide({ rideId: 'ride-duration', preferDual: false });
	await camera.freezeCandidate({ event_id: 'duration-event' });
	await camera.confirmIncident({ event_id: 'duration-event', incident_id: 'duration-incident' });
	assert.equal(uploads.length, 1);
	assert.ok(uploads[0].segment.durationMs < 60, `duration ${uploads[0].segment.durationMs}ms included recorder shutdown latency`);
	await camera.stopRide();
});

test('caps declared segment duration at the server evidence contract after timer drift', async () => {
	const { camera } = makeCamera({ preferDual: false, maxSegmentDurationMs: 12000 });
	await camera.startRide({ rideId: 'ride-duration-cap', preferDual: false });
	camera._currentCycle.startedMs = Date.now() - 15000;
	await camera.rotateSegment();
	assert.equal(camera.getSegments()[0].durationMs, 12000);
	await camera.stopRide();
});

test('runtime front recorder failure immediately updates status to truthful rear-only mode', async () => {
	const statuses = [];
	const { camera } = makeCamera({ MediaRecorder: makeRecorder({ runtimeFrontError: true }) });
	camera.addEventListener('statuschange', (event) => statuses.push(event.detail));
	await camera.startRide({ rideId: 'ride-runtime-front-error' });
	await camera.rotateSegment();
	assert.equal(camera.getStatus().mode, 'rear');
	assert.ok(statuses.some((status) => status.status === 'recording' && status.mode === 'rear' && status.reason === 'front-recorder-error'));
	await camera.stopRide();
});
