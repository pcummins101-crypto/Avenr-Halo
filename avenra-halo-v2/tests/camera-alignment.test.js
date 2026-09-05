'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AvenraHaloCameraAlignment } = require('../assets/js/camera-alignment.js');

class FakeEventTarget {
	constructor() { this.listeners = new Map(); }
	addEventListener(type, listener) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type).add(listener);
	}
	removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
	emit(type, event) { for (const listener of this.listeners.get(type) || []) listener(event || { type }); }
	listenerCount(type) { return this.listeners.get(type)?.size || 0; }
}

class FakeTrack extends FakeEventTarget {
	constructor(role, deviceId) {
		super();
		this.kind = 'video';
		this.id = `${role}-${deviceId}`;
		this.label = `${role} camera`;
		this.enabled = true;
		this.muted = false;
		this.readyState = 'live';
		this.settings = { facingMode: role === 'front' ? 'user' : 'environment', deviceId };
		this.stopCalls = 0;
	}
	getSettings() { return this.settings; }
	mute() {
		if (this.readyState === 'ended' || this.muted) return;
		this.muted = true;
		this.emit('mute', { type: 'mute' });
	}
	unmute() {
		if (this.readyState === 'ended' || !this.muted) return;
		this.muted = false;
		this.emit('unmute', { type: 'unmute' });
	}
	stop() {
		if (this.readyState === 'ended') return;
		this.stopCalls += 1;
		this.readyState = 'ended';
		this.emit('ended', { type: 'ended' });
	}
}

class FakeAudioTrack extends FakeTrack {
	constructor(index) { super('audio', `microphone-${index}`); this.kind = 'audio'; }
}

class FakeStream {
	constructor(videoTracks, audioTracks) {
		this.videoTracks = videoTracks || [];
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
	constructor() {
		super();
		this.hidden = false;
		this.visibilityState = 'visible';
	}
	hide() {
		this.hidden = true;
		this.visibilityState = 'hidden';
		this.emit('visibilitychange', { type: 'visibilitychange' });
	}
}

function makeMediaDevices(options) {
	const settings = Object.assign({ frontFails: false, frontEndsRear: false, frontMutesRear: false, unexpectedAudio: false }, options || {});
	const calls = [];
	const tracks = [];
	const audioTracks = [];
	let latestRear = null;
	return {
		calls,
		tracks,
		audioTracks,
		async getUserMedia(constraints) {
			calls.push(constraints);
			assert.equal(constraints.audio, false, 'alignment must never request a microphone');
			const facingMode = constraints.video.facingMode?.exact || constraints.video.facingMode?.ideal;
			const role = facingMode === 'user' ? 'front' : 'rear';
			if (role === 'front' && settings.frontFails) {
				const error = new Error('Only one camera is available');
				error.name = 'NotReadableError';
				throw error;
			}
			if (role === 'front' && settings.frontEndsRear && latestRear) latestRear.stop();
			if (role === 'front' && settings.frontMutesRear && latestRear) latestRear.mute();
			const track = new FakeTrack(role, `${role}-${tracks.length + 1}`);
			tracks.push(track);
			if (role === 'rear') latestRear = track;
			const unexpected = settings.unexpectedAudio ? [new FakeAudioTrack(audioTracks.length + 1)] : [];
			audioTracks.push(...unexpected);
			return new FakeStream([track], unexpected);
		}
	};
}

function makeAlignment(overrides) {
	const mediaDevices = overrides?.mediaDevices || makeMediaDevices();
	const document = overrides?.document || new FakeDocument();
	const alignment = new AvenraHaloCameraAlignment(Object.assign({
		mediaDevices,
		document,
		MediaStream: FakeStream,
		dualProbeDelayMs: 0
	}, overrides || {}, { mediaDevices, document }));
	return { alignment, mediaDevices, document };
}

test('opens two verified live previews without recording, saving, uploading or audio', async () => {
	const mediaDevices = makeMediaDevices({ unexpectedAudio: true });
	const { alignment } = makeAlignment({ mediaDevices });
	const status = await alignment.start({ preferDual: true });

	assert.equal(status.status, 'previewing');
	assert.equal(status.mode, 'dual');
	assert.deepEqual(status.activeCameras, ['rear', 'front']);
	assert.equal(status.dualCapability, 'supported');
	assert.equal(status.recording, false);
	assert.equal(status.saving, false);
	assert.equal(status.uploading, false);
	assert.equal(status.stored, false);
	assert.equal(status.microphoneActive, false);
	assert.equal(status.audioCaptured, false);
	assert.equal(mediaDevices.calls.length, 2);
	assert.ok(mediaDevices.calls.every((call) => call.audio === false));
	assert.ok(mediaDevices.audioTracks.every((track) => track.readyState === 'ended'));
	assert.ok(alignment.getStreams().rear);
	assert.ok(alignment.getStreams().front);

	alignment.stop('dialog-closed');
	assert.ok(mediaDevices.tracks.every((track) => track.readyState === 'ended'));
});

test('falls back to a truthful rear preview and lets the rider switch cameras sequentially', async () => {
	const mediaDevices = makeMediaDevices({ frontEndsRear: true });
	const { alignment } = makeAlignment({ mediaDevices });
	const initial = await alignment.start({ preferDual: true });

	assert.equal(initial.status, 'previewing');
	assert.equal(initial.mode, 'rear');
	assert.equal(initial.dualCapability, 'unsupported');
	assert.ok(mediaDevices.calls.length >= 3, 'rear camera should be reacquired after a failed dual preview');

	const front = await alignment.switchTo('front');
	assert.equal(front.status, 'previewing');
	assert.equal(front.mode, 'front');
	assert.deepEqual(front.activeCameras, ['front']);
	assert.equal(alignment.getStreams().rear, null);
	assert.ok(alignment.getStreams().front);

	const rear = await alignment.switchTo('rear');
	assert.equal(rear.mode, 'rear');
	assert.deepEqual(rear.activeCameras, ['rear']);
	alignment.stop();
	assert.ok(mediaDevices.tracks.every((track) => track.readyState === 'ended'));
});

test('a denied front camera does not prevent the rear alignment check', async () => {
	const mediaDevices = makeMediaDevices({ frontFails: true });
	const { alignment } = makeAlignment({ mediaDevices });
	const status = await alignment.start({ preferDual: true });

	assert.equal(status.status, 'previewing');
	assert.equal(status.mode, 'rear');
	assert.equal(status.dualCapability, 'unsupported');
	alignment.stop();
});

test('a muted rear source is rejected as false dual support and reacquired for a truthful rear preview', async () => {
	const mediaDevices = makeMediaDevices({ frontMutesRear: true });
	const { alignment } = makeAlignment({ mediaDevices });
	const status = await alignment.start({ preferDual: true });

	assert.equal(status.status, 'previewing');
	assert.equal(status.mode, 'rear');
	assert.equal(status.dualCapability, 'unsupported');
	assert.ok(mediaDevices.calls.length >= 3, 'rear camera should be reacquired after the first rear track is muted');
	assert.equal(mediaDevices.tracks[0].readyState, 'ended');
	assert.equal(alignment.getStreams().rear?.getVideoTracks()[0].muted, false);
	alignment.stop();
});

test('hiding Halo immediately releases every preview and never resumes without a new gesture', async () => {
	const document = new FakeDocument();
	const { alignment, mediaDevices } = makeAlignment({ document });
	await alignment.start({ preferDual: true });
	assert.equal(document.listenerCount('visibilitychange'), 1);

	document.hide();
	const status = alignment.getStatus();
	assert.equal(status.status, 'paused-background');
	assert.equal(status.active, false);
	assert.deepEqual(status.activeCameras, []);
	assert.equal(document.listenerCount('visibilitychange'), 0);
	assert.ok(mediaDevices.tracks.every((track) => track.readyState === 'ended'));
});

test('a runtime front-track loss degrades to rear and a final track loss closes the preview', async () => {
	const { alignment, mediaDevices } = makeAlignment();
	await alignment.start({ preferDual: true });
	const front = mediaDevices.tracks.find((track) => track.getSettings().facingMode === 'user');
	const rear = mediaDevices.tracks.find((track) => track.getSettings().facingMode === 'environment');

	front.stop();
	let status = alignment.getStatus();
	assert.equal(status.status, 'previewing');
	assert.equal(status.mode, 'rear');
	assert.equal(status.dualCapability, 'unsupported');
	assert.equal(status.active, true);

	rear.stop();
	status = alignment.getStatus();
	assert.equal(status.status, 'unavailable');
	assert.equal(status.mode, 'off');
	assert.equal(status.active, false);
});

test('runtime mute allows a brief recovery, then removes a persistently muted camera after the grace period', async () => {
	const { alignment, mediaDevices } = makeAlignment({ muteGraceMs: 5 });
	await alignment.start({ preferDual: true });
	const front = mediaDevices.tracks.find((track) => track.getSettings().facingMode === 'user');
	const rear = mediaDevices.tracks.find((track) => track.getSettings().facingMode === 'environment');

	front.mute();
	assert.equal(alignment.getStatus().mode, 'rear', 'a muted source must not be described as a live camera during the grace period');
	front.unmute();
	await new Promise((resolve) => setTimeout(resolve, 15));
	assert.equal(alignment.getStatus().mode, 'dual');
	assert.equal(front.readyState, 'live');

	front.mute();
	await new Promise((resolve) => setTimeout(resolve, 15));
	let status = alignment.getStatus();
	assert.equal(status.status, 'previewing');
	assert.equal(status.mode, 'rear');
	assert.equal(status.dualCapability, 'unsupported');
	assert.equal(front.readyState, 'ended');

	rear.mute();
	await new Promise((resolve) => setTimeout(resolve, 15));
	status = alignment.getStatus();
	assert.equal(status.status, 'unavailable');
	assert.equal(status.mode, 'off');
	assert.equal(status.active, false);
});

test('closing during a delayed permission request fences and stops the late stream', async () => {
	let resolvePermission;
	const permission = new Promise((resolve) => { resolvePermission = resolve; });
	const calls = [];
	const mediaDevices = {
		async getUserMedia(constraints) {
			calls.push(constraints);
			assert.equal(constraints.audio, false);
			return permission;
		}
	};
	const { alignment } = makeAlignment({ mediaDevices });
	const start = alignment.start({ preferDual: false });
	assert.equal(alignment.active, true);
	alignment.stop('dialog-closed');

	const track = new FakeTrack('rear', 'late-rear');
	resolvePermission(new FakeStream([track], []));
	const status = await start;
	assert.equal(status.status, 'idle');
	assert.equal(status.active, false);
	assert.equal(track.readyState, 'ended');
	assert.equal(calls.length, 1);
});

test('closing while the front permission request is pending immediately releases the acquired rear stream', async () => {
	let resolveFront;
	const pendingFront = new Promise((resolve) => { resolveFront = resolve; });
	const rearTrack = new FakeTrack('rear', 'rear-ready');
	const frontTrack = new FakeTrack('front', 'front-late');
	const calls = [];
	const mediaDevices = {
		getUserMedia(constraints) {
			calls.push(constraints);
			assert.equal(constraints.audio, false);
			return calls.length === 1 ? Promise.resolve(new FakeStream([rearTrack], [])) : pendingFront;
		}
	};
	const { alignment } = makeAlignment({ mediaDevices });
	const start = alignment.start({ preferDual: true });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(calls.length, 2);
	assert.equal(rearTrack.readyState, 'live');

	alignment.stop('dialog-closed');
	assert.equal(rearTrack.readyState, 'ended', 'the locally held rear stream must be part of synchronous stop ownership');
	resolveFront(new FakeStream([frontTrack], []));
	const status = await start;
	assert.equal(status.status, 'idle');
	assert.equal(frontTrack.readyState, 'ended');
});

test('closing a rejected exact request prevents a late ideal fallback permission request', async () => {
	let rejectExact;
	const exactRequest = new Promise((resolve, reject) => { rejectExact = reject; });
	const calls = [];
	const mediaDevices = {
		getUserMedia(constraints) {
			calls.push(constraints);
			assert.equal(constraints.audio, false);
			return exactRequest;
		}
	};
	const { alignment } = makeAlignment({ mediaDevices });
	const start = alignment.start({ preferDual: false });
	alignment.stop('dialog-closed');
	const error = new Error('Exact facing mode is unavailable');
	error.name = 'OverconstrainedError';
	rejectExact(error);

	const status = await start;
	assert.equal(status.status, 'idle');
	assert.equal(calls.length, 1, 'no relaxed camera request may begin after the window has closed');
});

test('closing during device enumeration stops the provisional wrong-facing stream and fences device fallback', async () => {
	let resolveDevices;
	const devices = new Promise((resolve) => { resolveDevices = resolve; });
	const wrongTrack = new FakeTrack('front', 'wrong-for-rear');
	const calls = [];
	let enumerateCalls = 0;
	const mediaDevices = {
		getUserMedia(constraints) {
			calls.push(constraints);
			assert.equal(constraints.audio, false);
			return Promise.resolve(new FakeStream([wrongTrack], []));
		},
		enumerateDevices() {
			enumerateCalls += 1;
			return devices;
		}
	};
	const { alignment } = makeAlignment({ mediaDevices });
	const start = alignment.start({ preferDual: false });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(enumerateCalls, 1);
	assert.equal(wrongTrack.readyState, 'live');

	alignment.stop('dialog-closed');
	assert.equal(wrongTrack.readyState, 'ended');
	resolveDevices([{ kind: 'videoinput', label: 'rear camera', deviceId: 'rear-device' }]);
	const status = await start;
	assert.equal(status.status, 'idle');
	assert.equal(calls.length, 1, 'a device-specific camera request must not begin after close');
});

test('only a retryable exact-constraint failure is relaxed to an ideal facing-mode request', async () => {
	const calls = [];
	const rearTrack = new FakeTrack('rear', 'ideal-rear');
	const mediaDevices = {
		getUserMedia(constraints) {
			calls.push(constraints);
			assert.equal(constraints.audio, false);
			if (constraints.video.facingMode?.exact) {
				const error = new Error('Exact facing mode is unavailable');
				error.name = 'OverconstrainedError';
				return Promise.reject(error);
			}
			return Promise.resolve(new FakeStream([rearTrack], []));
		}
	};
	const { alignment } = makeAlignment({ mediaDevices });
	const status = await alignment.start({ preferDual: false });

	assert.equal(status.status, 'previewing');
	assert.equal(status.mode, 'rear');
	assert.equal(calls.length, 2);
	assert.equal(calls[0].video.facingMode.exact, 'environment');
	assert.equal(calls[1].video.facingMode.ideal, 'environment');
	alignment.stop();
});

test('reports camera permission failure without leaving any live track', async () => {
	const error = new Error('Permission denied');
	error.name = 'NotAllowedError';
	let calls = 0;
	const mediaDevices = {
		async getUserMedia(constraints) {
			calls += 1;
			assert.equal(constraints.audio, false);
			throw error;
		}
	};
	const { alignment } = makeAlignment({ mediaDevices });
	const status = await alignment.start();

	assert.equal(status.status, 'unavailable');
	assert.equal(status.reason, 'camera-unavailable');
	assert.equal(status.error.name, 'NotAllowedError');
	assert.equal(status.cameraActive, false);
	assert.equal(status.recording, false);
	assert.equal(calls, 1, 'a denied permission must not trigger an ideal retry');
});
