/* global AvenraHaloV2Config */
(function (global, factory) {
	'use strict';

	const exports = factory(global || {});
	if (typeof module === 'object' && module.exports) module.exports = exports;
	if (global) {
		global.AvenraHaloIncidentCameraClass = exports.AvenraHaloIncidentCamera;
		if (!global.AvenraHaloIncidentCamera) {
			global.AvenraHaloIncidentCamera = new exports.AvenraHaloIncidentCamera();
		}
	}
}(typeof globalThis !== 'undefined' ? globalThis : this, function (global) {
	'use strict';

	const DEFAULT_MIME_TYPES = [
		'video/mp4;codecs=h264',
		'video/webm;codecs=vp9',
		'video/webm;codecs=vp8',
		'video/webm'
	];

	const nowIso = () => new Date().toISOString();
	const makeId = (prefix) => {
		const random = global.crypto && typeof global.crypto.randomUUID === 'function'
			? global.crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(16).slice(2)}`;
		return `${prefix || 'camera'}-${random}`;
	};
	const safeNumber = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
	const errorMessage = (error) => String(error && error.message ? error.message : error || 'Unknown camera error');

	class AvenraHaloIncidentCamera {
		constructor(options) {
			const config = global.AvenraHaloV2Config || {};
			this.options = Object.assign({
				segmentDurationMs: 10000,
				maxSegmentDurationMs: 12000,
				maxSegments: 6,
				preferDual: true,
				dualProbeDelayMs: 120,
				recorderStopTimeoutMs: 1500,
				resumeOnVisible: true,
				stopOnHidden: true,
				discardAfterUpload: true,
				width: { ideal: 1280, max: 1920 },
				height: { ideal: 720, max: 1080 },
				frameRate: { ideal: 24, max: 30 },
				videoBitsPerSecond: 1600000,
				mimeTypes: DEFAULT_MIME_TYPES,
				uploadUrl: config.incidentCameraUploadUrl || '',
				uploadHeaders: null,
				uploadCredentials: 'same-origin',
				uploadEvidence: null,
				uploadSegment: null,
				mediaDevices: global.navigator && global.navigator.mediaDevices,
				MediaRecorder: global.MediaRecorder,
				MediaStream: global.MediaStream,
				Blob: global.Blob,
				FormData: global.FormData,
				AbortController: global.AbortController,
				fetch: typeof global.fetch === 'function' ? global.fetch.bind(global) : null,
				document: global.document || null,
				setTimeout: global.setTimeout ? global.setTimeout.bind(global) : setTimeout,
				clearTimeout: global.clearTimeout ? global.clearTimeout.bind(global) : clearTimeout,
				onStatus: null
			}, options || {});

			this._listeners = new Map();
			this._segments = [];
			this._streams = { rear: null, front: null };
			this._currentCycle = null;
			this._cycleTimer = null;
			this._cycleEndingPromise = null;
			this._cycleEndingOptions = null;
			this._sequence = 0;
			this._generation = 0;
			this._status = 'idle';
			this._rideActive = false;
			this._running = false;
			this._frozen = false;
			this._confirmed = false;
			this._pausedForVisibility = false;
			this._destroyed = false;
			this._rideContext = {};
			this._queuedRideContext = null;
			this._candidateContext = null;
			this._dualCapability = 'unknown';
			this._lastError = '';
			this._visibilityAttached = false;
			this._visibilityPending = false;
			this._visibilityPromise = null;
			this._resumePromise = null;
			this._freezePromise = null;
			this._uploadPromise = null;
			this._uploadController = null;
			this._uploadGeneration = 0;
			this._evidenceCancelled = false;
			this._acquiring = false;
			this._onVisibilityChange = () => {
				this._handleVisibilityChange().catch((error) => {
					this._emit('error', { phase: 'visibility', recoverable: true, error, message: errorMessage(error) });
				});
			};
		}

		get supported() {
			return Boolean(
				this.options.mediaDevices
				&& typeof this.options.mediaDevices.getUserMedia === 'function'
				&& this.options.MediaRecorder
				&& this.options.Blob
			);
		}

		get active() {
			return this._running;
		}

		get frozen() {
			return this._frozen;
		}

		addEventListener(type, listener) {
			if (typeof listener !== 'function') return;
			if (!this._listeners.has(type)) this._listeners.set(type, new Set());
			this._listeners.get(type).add(listener);
		}

		removeEventListener(type, listener) {
			this._listeners.get(type)?.delete(listener);
		}

		on(type, listener) {
			this.addEventListener(type, listener);
			return () => this.removeEventListener(type, listener);
		}

		_emit(type, detail) {
			const event = { type, detail: detail || {}, target: this };
			for (const listener of this._listeners.get(type) || []) {
				try { listener.call(this, event); } catch (error) { /* UI listeners must not interrupt capture. */ }
			}
			if (type === 'statuschange' && typeof this.options.onStatus === 'function') {
				try { this.options.onStatus(event.detail); } catch (error) { /* Status reporting is best-effort. */ }
			}
		}

		_setStatus(status, detail) {
			this._status = status;
			if (detail && detail.error) this._lastError = errorMessage(detail.error);
			const snapshot = Object.assign(this.getStatus(), detail || {});
			this._emit('statuschange', snapshot);
			return snapshot;
		}

		_emitPrivacy(reason) {
			const status = this.getStatus();
			this._emit('privacychange', {
				reason: reason || '',
				cameraActive: status.cameraActive,
				activeCameras: status.activeCameras,
				microphoneActive: false,
				audioCaptured: false,
				storage: 'memory-only',
				bufferedSegments: status.bufferedSegments,
				bufferedSeconds: status.bufferedSeconds,
				frozen: status.frozen,
				confirmed: status.confirmed
			});
		}

		getStatus() {
			const activeCameras = ['rear', 'front'].filter((role) => this._isStreamLive(this._streams[role]));
			const bufferedMs = this._segments.reduce((total, segment) => total + safeNumber(segment.durationMs, 0), 0);
			return {
				status: this._status,
				supported: this.supported,
				rideActive: this._rideActive,
				recording: this._running && Boolean(this._currentCycle),
				cameraActive: activeCameras.length > 0,
				activeCameras,
				mode: activeCameras.includes('front') ? 'dual' : (activeCameras.includes('rear') ? 'rear' : 'off'),
				dualCapability: this._dualCapability,
				microphoneActive: false,
				audioCaptured: false,
				bufferedSegments: this._segments.length,
				bufferedSeconds: Math.round(bufferedMs / 100) / 10,
				frozen: this._frozen,
				confirmed: this._confirmed,
				pausedForVisibility: this._pausedForVisibility,
				lastError: this._lastError
			};
		}

		_snapshotSegments(includeBlobs) {
			return this._segments.map((segment) => Object.assign({}, segment, {
				recordings: segment.recordings.map((recording) => {
					const copy = Object.assign({}, recording);
					if (!includeBlobs) delete copy.blob;
					return copy;
				})
			}));
		}

		getSegments() {
			return this._snapshotSegments(false);
		}

		configure(options) {
			Object.assign(this.options, options || {});
			return this;
		}

		setCapturePreference(options) {
			const settings = options || {};
			if (Object.prototype.hasOwnProperty.call(settings, 'preferDual')) {
				this._rideContext.preferDual = settings.preferDual === true;
				if (this._queuedRideContext) this._queuedRideContext.preferDual = settings.preferDual === true;
			}
			return this.getStatus();
		}

		_createUploadController() {
			const Controller = this.options.AbortController;
			if (typeof Controller === 'function') return new Controller();
			const listeners = new Set();
			const signal = {
				aborted: false,
				reason: undefined,
				addEventListener(type, listener) { if (type === 'abort' && typeof listener === 'function') listeners.add(listener); },
				removeEventListener(type, listener) { if (type === 'abort') listeners.delete(listener); }
			};
			return {
				signal,
				abort(reason) {
					if (signal.aborted) return;
					signal.aborted = true;
					signal.reason = reason;
					for (const listener of listeners) {
						try { listener.call(signal, { type: 'abort', target: signal }); } catch (error) { /* An abort listener must not interrupt privacy cleanup. */ }
					}
					listeners.clear();
				}
			};
		}

		_abortEvidenceUpload(reason) {
			this._uploadGeneration += 1;
			const controller = this._uploadController;
			this._uploadController = null;
			if (controller && !controller.signal?.aborted) {
				try { controller.abort(reason || 'evidence-discarded'); }
				catch (error) { try { controller.abort(); } catch (abortError) { /* Best-effort for older AbortController implementations. */ } }
			}
		}

		_uploadIsCurrent(generation, controller) {
			return generation === this._uploadGeneration
				&& controller === this._uploadController
				&& !controller?.signal?.aborted;
		}

		_uploadAbortError(reason) {
			const error = new Error(String(reason || 'Incident footage upload was cancelled.'));
			error.name = 'AbortError';
			error.code = 'incident_camera_upload_aborted';
			return error;
		}

		_assertUploadCurrent(generation, controller) {
			if (!this._uploadIsCurrent(generation, controller)) {
				throw this._uploadAbortError(controller?.signal?.reason);
			}
		}

		async startRide(context) {
			if (this._destroyed) return this._setStatus('unavailable', { reason: 'destroyed' });
			if (this._segments.length && (this._confirmed || this._frozen)) {
				// A previous ride's confirmed evidence owns the camera until delivery is
				// complete. Remember the newest ride request so Ride Memories can begin
				// immediately after that evidence is safely released.
				this._queuedRideContext = Object.assign({}, context || {});
				return this._setStatus('pending-upload', { reason: 'previous-incident-retained', retained: this._segments.length });
			}
			if (this._rideActive || this._currentCycle || this._streams.rear || this._streams.front) {
				await this.stopRide({ discard: true, reason: 'restart' });
			}

			this._generation += 1;
			const generation = this._generation;
			this._queuedRideContext = null;
			this._rideContext = Object.assign({}, context || {});
			this._rideActive = true;
			this._running = false;
			this._frozen = false;
			this._confirmed = false;
			this._pausedForVisibility = false;
			this._candidateContext = null;
			this._evidenceCancelled = false;
			this._lastError = '';
			this._sequence = 0;
			// Probe once per ride. A temporary camera conflict in an earlier ride
			// must not permanently disable dual capture until the page is reloaded.
			this._dualCapability = 'unknown';
			this.discardEvidence('new-ride');
			this._attachVisibility();

			if (!this.supported) {
				this._setStatus('unavailable', { reason: 'unsupported' });
				this._emitPrivacy('unsupported');
				return this.getStatus();
			}
			if (this.options.stopOnHidden && this.options.document?.hidden) {
				this._pausedForVisibility = true;
				this._setStatus('paused-background', { reason: 'ride-started-hidden' });
				this._emitPrivacy('ride-started-hidden');
				return this.getStatus();
			}

			this._setStatus('requesting-permission', { reason: 'ride-start' });
			try {
				await this._acquireCameras(generation, this._rideContext.preferDual);
				if (generation !== this._generation || !this._rideActive) {
					this._stopAllStreams();
					return this.getStatus();
				}
				if (this.options.stopOnHidden && this.options.document?.hidden) {
					this._pausedForVisibility = true;
					this._stopAllStreams();
					this._setStatus('paused-background', { reason: 'background-during-permission' });
					this._emitPrivacy('background-during-permission');
					return this.getStatus();
				}
				this._running = true;
				await this._startCycle(generation);
				if (this._currentCycle) this._setStatus('recording', { reason: 'ride-start', mode: this.getStatus().mode });
				this._emitPrivacy('ride-start');
			} catch (error) {
				this._running = false;
				this._stopAllStreams();
				this._setStatus('unavailable', { reason: 'camera-unavailable', error });
				this._emit('error', { phase: 'start', recoverable: true, error, message: errorMessage(error) });
				this._emitPrivacy('camera-unavailable');
			}
			return this.getStatus();
		}

		start(context) {
			return this.startRide(context);
		}

		_cameraConstraints(role, exact) {
			return {
				audio: false,
				video: {
					facingMode: { [exact ? 'exact' : 'ideal']: role === 'front' ? 'user' : 'environment' },
					width: this.options.width,
					height: this.options.height,
					frameRate: this.options.frameRate
				}
			};
		}

		async _getCamera(role) {
			let stream = null;
			let exactError = null;
			try {
				stream = this._sanitiseStream(await this.options.mediaDevices.getUserMedia(this._cameraConstraints(role, true)));
			} catch (error) {
				exactError = error;
			}
			if (!stream) {
				stream = this._sanitiseStream(await this.options.mediaDevices.getUserMedia(this._cameraConstraints(role, false)));
			}
			if (this._streamRole(stream) === role) return stream;

			const devices = typeof this.options.mediaDevices.enumerateDevices === 'function'
				? await this.options.mediaDevices.enumerateDevices().catch(() => [])
				: [];
			const match = devices.find((device) => device?.kind === 'videoinput' && this._labelRole(device.label) === role && device.deviceId);
			if (match) {
				this._stopStream(stream);
				stream = this._sanitiseStream(await this.options.mediaDevices.getUserMedia({
					audio: false,
					video: {
						deviceId: { exact: match.deviceId },
						width: this.options.width,
						height: this.options.height,
						frameRate: this.options.frameRate
					}
				}));
				if (this._streamRole(stream) === role) return stream;
			}

			this._stopStream(stream);
			const error = new Error(`Halo could not verify that the selected camera is the ${role === 'front' ? 'front-facing' : 'rear-facing'} camera.`);
			error.cause = exactError || undefined;
			throw error;
		}

		_labelRole(label) {
			const value = String(label || '').toLowerCase();
			if (/\b(front|user|face|selfie)\b/.test(value)) return 'front';
			if (/\b(back|rear|environment|world)\b/.test(value)) return 'rear';
			return 'unknown';
		}

		_streamRole(stream) {
			const track = stream?.getVideoTracks?.()[0];
			if (!track) return 'unknown';
			const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
			if (settings.facingMode === 'user') return 'front';
			if (settings.facingMode === 'environment') return 'rear';
			return this._labelRole(track.label);
		}

		_sanitiseStream(stream) {
			if (!stream) return stream;
			const audioTracks = typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks() : [];
			for (const track of audioTracks) {
				try { track.stop(); } catch (error) { /* Ignore an already-ended unexpected audio track. */ }
				try { stream.removeTrack?.(track); } catch (error) { /* Some WebViews expose immutable streams. */ }
			}
			const videoTracks = typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks() : [];
			if (this.options.MediaStream && videoTracks.length && audioTracks.length) {
				try { return new this.options.MediaStream(videoTracks); } catch (error) { /* The cleaned original is still usable. */ }
			}
			return stream;
		}

		async _acquireCameras(generation, requestedDual) {
			this._acquiring = true;
			try { return await this._acquireCamerasInternal(generation, requestedDual); }
			finally { this._acquiring = false; }
		}

		async _acquireCamerasInternal(generation, requestedDual) {
			let rear = await this._getCamera('rear');
			if (!this._isStreamLive(rear)) throw new Error('The rear camera did not provide a live video track.');
			if (generation !== this._generation) {
				this._stopStream(rear);
				return;
			}
			this._streams.rear = rear;
			this._bindTrackEnd('rear', rear);

			const wantsDual = requestedDual !== false && this.options.preferDual && this._dualCapability !== 'unsupported';
			if (!wantsDual) return;
			let front = null;
			try {
				front = await this._getCamera('front');
				const dualWorks = await this._verifyDualStreams(rear, front);
				if (!dualWorks) throw new Error('This device cannot keep distinct front and rear cameras active together.');
				if (generation !== this._generation) {
					this._stopStream(front);
					return;
				}
				this._streams.front = front;
				this._bindTrackEnd('front', front);
			} catch (error) {
				this._dualCapability = 'unsupported';
				this._stopStream(front);
				this._streams.front = null;
				this._emit('capabilitychange', { dual: false, mode: 'rear', reason: errorMessage(error) });
				if (!this._isStreamLive(rear)) {
					this._stopStream(rear);
					rear = await this._getCamera('rear');
					if (!this._isStreamLive(rear)) throw new Error('The rear camera was interrupted while testing the front camera.');
					this._streams.rear = rear;
					this._bindTrackEnd('rear', rear);
				}
			}
		}

		async _verifyDualStreams(rear, front) {
			if (!this._isStreamLive(rear) || !this._isStreamLive(front)) return false;
			if (this.options.dualProbeDelayMs > 0) await this._delay(this.options.dualProbeDelayMs);
			if (!this._isStreamLive(rear) || !this._isStreamLive(front)) return false;
			if (this._streamRole(rear) !== 'rear' || this._streamRole(front) !== 'front') return false;
			const rearTrack = rear.getVideoTracks()[0];
			const frontTrack = front.getVideoTracks()[0];
			const rearSettings = typeof rearTrack.getSettings === 'function' ? rearTrack.getSettings() : {};
			const frontSettings = typeof frontTrack.getSettings === 'function' ? frontTrack.getSettings() : {};
			const deviceDistinct = Boolean(rearSettings.deviceId && frontSettings.deviceId && rearSettings.deviceId !== frontSettings.deviceId);
			const labelDistinct = Boolean(rearTrack.label && frontTrack.label && rearTrack.label !== frontTrack.label);
			return deviceDistinct || labelDistinct || rearTrack.id !== frontTrack.id;
		}

		_bindTrackEnd(role, stream) {
			const track = stream?.getVideoTracks?.()[0];
			if (!track || typeof track.addEventListener !== 'function') return;
			track.addEventListener('ended', () => this._handleTrackEnded(role, stream), { once: true });
		}

		_handleTrackEnded(role, stream) {
			if (this._streams[role] !== stream) return;
			this._streams[role] = null;
			// Opening a second camera can end the first stream on single-camera
			// WebViews. The acquisition probe owns that fallback and may reacquire
			// the rear camera, so do not race it with the runtime interruption path.
			if (this._acquiring) return;
			if (role === 'front') {
				this._dualCapability = 'unsupported';
				this._emit('capabilitychange', { dual: false, mode: this._isStreamLive(this._streams.rear) ? 'rear' : 'off', reason: 'front-track-ended' });
				if (this._isStreamLive(this._streams.rear) && this._running) this._setStatus('recording', { mode: 'rear', reason: 'front-track-ended' });
				this._emitPrivacy('front-track-ended');
				return;
			}
			if (!this._rideActive || this._frozen) return;
			this._running = false;
			this._finishCycle({ save: true, reason: 'rear-track-ended', continueRecording: false })
				.catch(() => {})
				.finally(() => {
					this._stopAllStreams();
					this._setStatus('unavailable', { reason: 'rear-track-ended' });
					this._emitPrivacy('rear-track-ended');
				});
		}

		_isStreamLive(stream) {
			const tracks = stream && typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks() : [];
			return tracks.some((track) => track && track.readyState !== 'ended' && track.enabled !== false);
		}

		_selectMimeType() {
			const Recorder = this.options.MediaRecorder;
			if (typeof Recorder.isTypeSupported !== 'function') return '';
			for (const mimeType of this.options.mimeTypes || DEFAULT_MIME_TYPES) {
				if (Recorder.isTypeSupported(mimeType)) return mimeType;
			}
			return '';
		}

		_createRecorder(role, stream, cycle) {
			const Recorder = this.options.MediaRecorder;
			const mimeType = this._selectMimeType();
			const recorderOptions = {};
			if (mimeType) recorderOptions.mimeType = mimeType;
			const bitsPerSecond = Math.round(safeNumber(this.options.videoBitsPerSecond, 1600000));
			if (bitsPerSecond > 0) recorderOptions.videoBitsPerSecond = bitsPerSecond;
			const recorder = Object.keys(recorderOptions).length ? new Recorder(stream, recorderOptions) : new Recorder(stream);
			const entry = { role, recorder, chunks: [], error: null, stopped: false, stopPromise: null };
			entry.stopPromise = new Promise((resolve) => {
				entry.resolveStop = resolve;
			});

			const onData = (event) => {
				if (event?.data && safeNumber(event.data.size, 0) > 0) entry.chunks.push(event.data);
			};
			const onStop = () => {
				entry.stopped = true;
				entry.resolveStop();
			};
			const onError = (event) => {
				entry.error = event?.error || new Error(`${role} camera recorder failed.`);
				this._emit('error', { phase: 'recording', camera: role, recoverable: role === 'front', error: entry.error, message: errorMessage(entry.error) });
				if (role === 'front') {
					this._dualCapability = 'unsupported';
					this._stopStream(this._streams.front);
					this._streams.front = null;
					if (this._isStreamLive(this._streams.rear) && this._running) this._setStatus('recording', { mode: 'rear', reason: 'front-recorder-error' });
				}
			};
			if (typeof recorder.addEventListener === 'function') {
				recorder.addEventListener('dataavailable', onData);
				recorder.addEventListener('stop', onStop, { once: true });
				recorder.addEventListener('error', onError);
			} else {
				recorder.ondataavailable = onData;
				recorder.onstop = onStop;
				recorder.onerror = onError;
			}
			cycle.recorders.push(entry);
			recorder.start();
			return entry;
		}

		async _startCycle(generation) {
			if (!this._running || this._frozen || !this._rideActive || generation !== this._generation) return false;
			if (!this._isStreamLive(this._streams.rear)) throw new Error('Rear camera stream is no longer active.');
			const cycle = {
				id: makeId('camera-segment'),
				generation,
				startedAt: nowIso(),
				startedMs: Date.now(),
				recorders: []
			};
			this._currentCycle = cycle;

			try {
				this._createRecorder('rear', this._streams.rear, cycle);
			} catch (error) {
				this._currentCycle = null;
				this._running = false;
				throw error;
			}

			if (this._isStreamLive(this._streams.front)) {
				try {
					this._createRecorder('front', this._streams.front, cycle);
					this._dualCapability = 'supported';
					this._emit('capabilitychange', { dual: true, mode: 'dual', reason: 'simultaneous-recorders-started' });
				} catch (error) {
					this._dualCapability = 'unsupported';
					this._stopStream(this._streams.front);
					this._streams.front = null;
					this._emit('capabilitychange', { dual: false, mode: 'rear', reason: errorMessage(error) });
				}
			}

			this._cycleTimer = this.options.setTimeout(() => {
				this._finishCycle({ save: true, reason: 'duration', continueRecording: true }).catch((error) => {
					this._emit('error', { phase: 'segment-rotation', recoverable: true, error, message: errorMessage(error) });
				});
			}, Math.max(250, safeNumber(this.options.segmentDurationMs, 10000)));
			return true;
		}

		async _finishCycle(settings) {
			if (this._cycleEndingPromise) {
				const requested = settings || {};
				if (requested.save === true && this._cycleEndingOptions) this._cycleEndingOptions.save = true;
				if (requested.continueRecording === false && this._cycleEndingOptions) this._cycleEndingOptions.continueRecording = false;
				return this._cycleEndingPromise;
			}
			const cycle = this._currentCycle;
			if (!cycle) return null;
			this._currentCycle = null;
			if (this._cycleTimer) this.options.clearTimeout(this._cycleTimer);
			this._cycleTimer = null;
			const options = Object.assign({ save: true, reason: 'manual', continueRecording: false }, settings || {});
			this._cycleEndingOptions = options;

			const work = (async () => {
				const stopRequestedMs = Date.now();
				for (const entry of cycle.recorders) {
					try {
						if (entry.recorder.state && entry.recorder.state !== 'inactive') entry.recorder.stop();
						else entry.resolveStop();
					} catch (error) {
						entry.error = entry.error || error;
						entry.resolveStop();
					}
				}
				await Promise.all(cycle.recorders.map((entry) => this._waitForRecorderStop(entry)));

				const endedMs = stopRequestedMs;
				// The REST evidence contract rejects declared segments above twelve
				// seconds. A throttled WebView can run the rotation callback late, so
				// never let scheduling drift create metadata that is guaranteed to be
				// rejected on every retry.
				const maxDurationMs = Math.max(100, safeNumber(this.options.maxSegmentDurationMs, 12000));
				const durationMs = Math.min(maxDurationMs, Math.max(0, stopRequestedMs - cycle.startedMs));
				const recordings = [];
				for (const entry of cycle.recorders) {
					if (entry.error || !entry.chunks.length) continue;
					let blob;
					try {
						blob = new this.options.Blob(entry.chunks, { type: entry.recorder.mimeType || entry.chunks[0]?.type || '' });
					} catch (error) {
						this._emit('error', { phase: 'segment-assembly', camera: entry.role, recoverable: true, error, message: errorMessage(error) });
						continue;
					}
					if (!blob || !safeNumber(blob.size, 0)) continue;
					recordings.push({
						id: `${cycle.id}-${entry.role}`,
						camera: entry.role,
						blob,
						mimeType: blob.type || entry.recorder.mimeType || 'video/webm',
						size: blob.size,
						audio: false
					});
				}

				let segment = null;
					if (options.save && recordings.length) {
					this._sequence += 1;
					segment = {
						id: cycle.id,
						sequence: this._sequence,
						startedAt: cycle.startedAt,
						endedAt: new Date(endedMs).toISOString(),
						durationMs,
						reason: options.reason,
						recordings
					};
					this._appendSegment(segment);
				}

				if (options.continueRecording && this._running && !this._frozen && this._rideActive && cycle.generation === this._generation) {
					await this._startCycle(cycle.generation);
				}
				return segment;
			})();

			this._cycleEndingPromise = work;
			try { return await work; }
			finally {
				if (this._cycleEndingPromise === work) {
					this._cycleEndingPromise = null;
					this._cycleEndingOptions = null;
				}
			}
		}

		_waitForRecorderStop(entry) {
			return new Promise((resolve) => {
				let settled = false;
				let timer = null;
				const finish = () => {
					if (settled) return;
					settled = true;
					if (timer) this.options.clearTimeout(timer);
					resolve();
				};
				timer = this.options.setTimeout(finish, Math.max(0, safeNumber(this.options.recorderStopTimeoutMs, 1500)));
				entry.stopPromise.then(finish, finish);
			});
		}

		_appendSegment(segment) {
			this._segments.push(segment);
			// Ride Memories consumes this synchronous, private data event before the
			// rolling incident buffer can evict the segment. Clone the containers so
			// clearing incident evidence cannot null a listener-held Blob reference.
			this._emit('segmentdata', {
				segment: Object.assign({}, segment, {
					recordings: segment.recordings.map((item) => Object.assign({}, item))
				}),
				bufferedSegments: this._segments.length
			});
			this._emit('segment', {
				segment: Object.assign({}, segment, { recordings: segment.recordings.map((item) => Object.assign({}, item, { blob: undefined })) }),
				bufferedSegments: this._segments.length
			});
			const limit = Math.max(1, Math.floor(safeNumber(this.options.maxSegments, 6)));
			while (this._segments.length > limit) {
				const expired = this._segments.shift();
				this._deleteSegment(expired, 'rolling-eviction');
			}
			this._emitPrivacy('segment-buffered');
		}

		_deleteSegment(segment, reason) {
			if (!segment) return;
			for (const recording of segment.recordings || []) recording.blob = null;
			this._emit('segmentdeleted', { id: segment.id, sequence: segment.sequence, reason: reason || 'discarded' });
			segment.recordings = [];
		}

		discardEvidence(reason) {
			const count = this._segments.length;
			while (this._segments.length) this._deleteSegment(this._segments.shift(), reason || 'discarded');
			if (count) this._emitPrivacy(reason || 'discarded');
			return count;
		}

		async rotateSegment() {
			return this._finishCycle({ save: true, reason: 'manual', continueRecording: true });
		}

		async freezeCandidate(context) {
			if (this._destroyed) return this.getStatus();
			if (this._freezePromise) return this._freezePromise;
			this._evidenceCancelled = false;
			const work = (async () => {
				this._candidateContext = Object.assign({}, context || {});
				this._frozen = true;
				this._confirmed = false;
				this._running = false;
				this._pausedForVisibility = false;
				this._generation += 1;
				this._setStatus('freezing', { reason: 'crash-candidate' });
				await this._finishCycle({ save: true, reason: 'crash-candidate', continueRecording: false });
				this._stopAllStreams();
				this._setStatus('frozen', {
					reason: 'crash-candidate',
					eventId: context?.event_id || context?.id || '',
					bufferedSegments: this._segments.length
				});
				this._emitPrivacy('crash-candidate');
				return this.getStatus();
			})();
			this._freezePromise = work;
			try { return await work; }
			finally { if (this._freezePromise === work) this._freezePromise = null; }
		}

		freeze(context) {
			return this.freezeCandidate(context);
		}

		async cancelCandidate(options) {
			const settings = Object.assign({ resume: true, reason: 'rider-cancelled' }, options || {});
			this._evidenceCancelled = true;
			this._abortEvidenceUpload(settings.reason);
			if (this._freezePromise) await this._freezePromise.catch(() => null);
			this._running = false;
			await this._finishCycle({ save: false, reason: settings.reason, continueRecording: false });
			this._stopAllStreams();
			this.discardEvidence(settings.reason);
			this._frozen = false;
			this._confirmed = false;
			this._candidateContext = null;
			if (settings.resume && this._rideActive) return this._resumeCapture('candidate-cancelled');
			this._setStatus(this._rideActive ? 'stopped' : 'idle', { reason: settings.reason });
			this._emitPrivacy(settings.reason);
			return this.getStatus();
		}

		async continueForRideMemory(options) {
			const settings = Object.assign({ preferDual: false, reason: 'incident-consumer-stopped' }, options || {});
			if (this._destroyed || !this._rideActive || this._confirmed) return this.getStatus();
			this.setCapturePreference({ preferDual: settings.preferDual === true });
			this._evidenceCancelled = true;
			this._abortEvidenceUpload(settings.reason);
			if (this._freezePromise) await this._freezePromise.catch(() => null);
			if (this._confirmed) return this.getStatus();
			this._running = false;
			this._generation += 1;
			this._setStatus('reconfiguring', { reason: settings.reason });
			// Save the partial cycle for Ride Memories before purging the incident
			// consumer's rolling buffer. The private listener receives the Blob first.
			await this._finishCycle({ save: true, reason: settings.reason, continueRecording: false });
			this._stopAllStreams();
			this.discardEvidence(settings.reason);
			this._frozen = false;
			this._confirmed = false;
			this._candidateContext = null;
			this._evidenceCancelled = false;
			return this._resumeCapture(settings.reason);
		}

		cancel(options) {
			return this.cancelCandidate(options);
		}

		async confirmIncident(context) {
			const incidentContext = Object.assign({}, this._candidateContext || {}, context || {});
			if (this._evidenceCancelled) {
				return { ok: false, aborted: true, uploaded: 0, retained: this._segments.length, reason: 'evidence-cancelled' };
			}
			if (this._freezePromise) await this._freezePromise;
			else if (!this._frozen) await this.freezeCandidate(incidentContext);
			if (this._evidenceCancelled) {
				return { ok: false, aborted: true, uploaded: 0, retained: this._segments.length, reason: 'evidence-cancelled' };
			}
			if (this._uploadPromise && this._uploadController && !this._uploadController.signal?.aborted) {
				return this._uploadPromise;
			}
			this._confirmed = true;
			const segments = this._snapshotSegments(true);
			if (!segments.length) {
				this._setStatus('confirmed-no-evidence', { reason: 'empty-buffer' });
				this._emitPrivacy('confirmed-no-evidence');
				return { ok: false, uploaded: 0, retained: 0, reason: 'empty-buffer' };
			}

			if (this._uploadController) this._abortEvidenceUpload('upload-superseded');
			const controller = this._createUploadController();
			const generation = this._uploadGeneration + 1;
			this._uploadGeneration = generation;
			this._uploadController = controller;
			this._setStatus('uploading', { reason: 'incident-confirmed', totalSegments: segments.length });
			this._emit('uploadstart', { context: incidentContext, totalSegments: segments.length, signal: controller.signal });

			const work = (async () => {
				try {
					let result;
					if (typeof this.options.uploadEvidence === 'function') {
						result = await this.options.uploadEvidence({
							context: incidentContext,
							segments,
							signal: controller.signal,
							microphoneActive: false,
							audioCaptured: false
						});
					} else {
						result = await this._uploadRecordings(segments, incidentContext, generation, controller);
					}
					this._assertUploadCurrent(generation, controller);
					if (result && result.ok === false) throw result.error || new Error(result.reason || 'Incident footage upload failed.');
					const uploaded = result?.uploaded ?? segments.reduce((total, segment) => total + segment.recordings.length, 0);
					this._emit('uploadcomplete', { context: incidentContext, uploaded, result: result || null });
					if (this.options.discardAfterUpload) this.discardEvidence('uploaded');
					this._setStatus('uploaded', { reason: 'incident-uploaded', uploaded });
					this._emitPrivacy('incident-uploaded');
					return { ok: true, uploaded, retained: this._segments.length, result: result || null };
				} catch (error) {
					const aborted = controller.signal?.aborted || !this._uploadIsCurrent(generation, controller) || error?.name === 'AbortError' || error?.code === 'incident_camera_upload_aborted';
					if (aborted) {
						return { ok: false, aborted: true, uploaded: 0, retained: this._segments.length, reason: 'aborted', error };
					}
					this._setStatus('upload-failed', { reason: 'upload-failed', error, retained: this._segments.length });
					this._emit('uploaderror', { context: incidentContext, error, message: errorMessage(error), retained: this._segments.length });
					this._emitPrivacy('upload-failed');
					return { ok: false, uploaded: 0, retained: this._segments.length, error };
				}
			})();
			this._uploadPromise = work;
			try { return await work; }
			finally {
				if (this._uploadPromise === work) this._uploadPromise = null;
				if (this._uploadController === controller) this._uploadController = null;
			}
		}

		confirm(context) {
			return this.confirmIncident(context);
		}

		async resumeAfterIncident(reason) {
			const resumableStatuses = new Set(['uploaded', 'confirmed-no-evidence']);
			if (this._destroyed || !resumableStatuses.has(this._status)) return this.getStatus();
			const resumeReason = String(reason || 'incident-complete');
			if (!this._rideActive && this._queuedRideContext) {
				const queuedContext = Object.assign({}, this._queuedRideContext);
				this._queuedRideContext = null;
				return this.startRide(queuedContext);
			}
			if (!this._rideActive) return this.getStatus();
			// Only a completed incident outcome reaches this branch. Remove any
			// residual uploaded evidence before reopening the privacy-sensitive camera.
			this.discardEvidence(resumeReason);
			this._frozen = false;
			this._confirmed = false;
			this._candidateContext = null;
			this._evidenceCancelled = false;
			this._pausedForVisibility = false;
			return this._resumeCapture(resumeReason);
		}

		async _uploadRecordings(segments, context, generation, controller) {
			const recordings = [];
			for (const segment of segments) {
				for (const recording of segment.recordings) recordings.push({ segment, recording });
			}
			if (!recordings.length) return { ok: false, uploaded: 0, reason: 'empty-buffer' };
			if (typeof this.options.uploadSegment !== 'function' && !this.options.uploadUrl) {
				return { ok: false, uploaded: 0, reason: 'upload-not-configured', error: new Error('Incident camera upload is not configured.') };
			}

			let uploaded = 0;
			for (let index = 0; index < recordings.length; index += 1) {
				this._assertUploadCurrent(generation, controller);
				const item = recordings[index];
				let response;
				if (typeof this.options.uploadSegment === 'function') {
					response = await this.options.uploadSegment({
						context,
						segment: item.segment,
						recording: item.recording,
						blob: item.recording.blob,
						camera: item.recording.camera,
						audio: false,
						signal: controller.signal,
						index,
						total: recordings.length
					});
				} else {
					response = await this._uploadRecordingRest(item.segment, item.recording, context, index, recordings.length, generation, controller);
				}
				this._assertUploadCurrent(generation, controller);
				if (response && response.ok === false) throw response.error || new Error('A footage segment was rejected.');
				uploaded += 1;
				this._emit('uploadprogress', { uploaded, total: recordings.length, camera: item.recording.camera, sequence: item.segment.sequence, response: response || null });
			}
			return { ok: true, uploaded };
		}

		async _uploadRecordingRest(segment, recording, context, index, total, generation, controller) {
			this._assertUploadCurrent(generation, controller);
			if (!this.options.fetch || !this.options.FormData) throw new Error('This WebView cannot upload incident footage.');
			const data = new this.options.FormData();
			const extension = recording.mimeType.includes('mp4') ? 'mp4' : 'webm';
			data.append('file', recording.blob, `halo-${segment.sequence}-${recording.camera}.${extension}`);
			data.append('camera', recording.camera);
			data.append('sequence', String(segment.sequence));
			data.append('started_at', segment.startedAt);
			data.append('ended_at', segment.endedAt);
			data.append('duration_ms', String(segment.durationMs));
			data.append('audio', 'false');
			data.append('event_id', String(context.event_id || context.id || ''));
			data.append('incident_id', String(context.incident_id || ''));
			data.append('ride_id', String(context.ride_id || this._rideContext.rideId || this._rideContext.ride_id || ''));
			data.append('part', String(index + 1));
			data.append('parts', String(total));
			const headerSource = typeof this.options.uploadHeaders === 'function'
				? await this.options.uploadHeaders(context)
				: this.options.uploadHeaders;
			this._assertUploadCurrent(generation, controller);
			const response = await this.options.fetch(this.options.uploadUrl, {
				method: 'POST',
				headers: headerSource || {},
				body: data,
				credentials: this.options.uploadCredentials || 'same-origin',
				cache: 'no-store',
				signal: controller.signal
			});
			if (!response?.ok) throw new Error(`Incident footage upload returned HTTP ${response?.status || 0}.`);
			const type = response.headers?.get?.('content-type') || '';
			return type.includes('application/json') ? response.json().catch(() => ({ ok: true })) : { ok: true };
		}

		async _resumeCapture(reason) {
			if (this._resumePromise) return this._resumePromise;
			if (!this._rideActive || this._frozen || this._destroyed) return this.getStatus();
			if (this.options.stopOnHidden && this.options.document?.hidden) {
				this._pausedForVisibility = true;
				this._setStatus('paused-background', { reason: reason || 'background' });
				this._emitPrivacy(reason || 'background');
				return this.getStatus();
			}

			const work = (async () => {
				this._generation += 1;
				const generation = this._generation;
				this._pausedForVisibility = false;
				this._setStatus('requesting-permission', { reason: reason || 'resume' });
				try {
					await this._acquireCameras(generation, this._rideContext.preferDual);
					if (generation !== this._generation || !this._rideActive || this._frozen
						|| (this.options.stopOnHidden && this.options.document?.hidden)) {
						this._stopAllStreams();
						return this.getStatus();
					}
					this._running = true;
					await this._startCycle(generation);
					this._setStatus('recording', { reason: reason || 'resume', mode: this.getStatus().mode });
					this._emitPrivacy(reason || 'resume');
				} catch (error) {
					this._running = false;
					this._stopAllStreams();
					this._setStatus('unavailable', { reason: 'resume-failed', error });
					this._emit('error', { phase: 'resume', recoverable: true, error, message: errorMessage(error) });
					this._emitPrivacy('resume-failed');
				}
				return this.getStatus();
			})();
			this._resumePromise = work;
			try { return await work; }
			finally { if (this._resumePromise === work) this._resumePromise = null; }
		}

		async _handleVisibilityChange() {
			// Visibility events may arrive while recorder.stop() is still flushing.
			// Coalesce them behind one reconciliation loop so an older hidden event
			// cannot overwrite a newer visible state or race camera reacquisition.
			this._visibilityPending = true;
			if (this._visibilityPromise) return this._visibilityPromise;
			const work = (async () => {
				while (this._visibilityPending) {
					this._visibilityPending = false;
					await this._reconcileVisibility();
				}
			})();
			this._visibilityPromise = work;
			try { return await work; }
			finally { if (this._visibilityPromise === work) this._visibilityPromise = null; }
		}

		async _reconcileVisibility() {
			if (!this._rideActive || this._frozen || this._destroyed) return;
			if (this.options.document?.hidden && this.options.stopOnHidden) {
				this._pausedForVisibility = true;
				this._running = false;
				this._generation += 1;
				this._setStatus('pausing-background', { reason: 'document-hidden' });
				await this._finishCycle({ save: true, reason: 'document-hidden', continueRecording: false });
				this._stopAllStreams();
				if (this.options.document?.hidden) {
					this._setStatus('paused-background', { reason: 'document-hidden' });
					this._emitPrivacy('document-hidden');
				}
				return;
			}
			if (!this.options.document?.hidden && this._pausedForVisibility && this.options.resumeOnVisible) {
				await this._resumeCapture('document-visible');
			}
		}

		_attachVisibility() {
			if (this._visibilityAttached || !this.options.document?.addEventListener) return;
			this.options.document.addEventListener('visibilitychange', this._onVisibilityChange);
			this._visibilityAttached = true;
		}

		_detachVisibility() {
			if (!this._visibilityAttached || !this.options.document?.removeEventListener) return;
			this.options.document.removeEventListener('visibilitychange', this._onVisibilityChange);
			this._visibilityAttached = false;
			this._visibilityPending = false;
		}

		_stopStream(stream) {
			if (!stream || typeof stream.getTracks !== 'function') return;
			for (const track of stream.getTracks()) {
				try { track.stop(); } catch (error) { /* Track is already stopped. */ }
			}
		}

		_stopAllStreams() {
			const rear = this._streams.rear;
			const front = this._streams.front;
			this._streams = { rear: null, front: null };
			this._stopStream(rear);
			if (front !== rear) this._stopStream(front);
		}

		async stopRide(options) {
			const settings = Object.assign({ discard: true, archive: false, reason: 'ride-ended' }, options || {});
			// A queued replacement ride is valid only while its owning app ride is
			// still active. Any stop/logout/end action must fence a later upload
			// callback from reopening the camera.
			this._queuedRideContext = null;
			if (settings.discard) {
				this._evidenceCancelled = true;
				this._abortEvidenceUpload(settings.reason);
			}
			// A non-destructive ride stop can race the recorder's final crash-segment
			// flush. Decide retention only after that exact freeze has settled.
			const pendingFreeze = this._freezePromise;
			if (pendingFreeze) await pendingFreeze.catch(() => null);
			const retainConfirmed = !settings.discard && this._segments.length > 0 && (this._confirmed || this._frozen);
			this._rideActive = false;
			this._running = false;
			this._frozen = retainConfirmed;
			this._confirmed = retainConfirmed && this._confirmed;
			this._pausedForVisibility = false;
			this._generation += 1;
			await this._finishCycle({ save: !settings.discard || settings.archive, reason: settings.reason, continueRecording: false });
			this._stopAllStreams();
			if (settings.discard) this.discardEvidence(settings.reason);
			if (!retainConfirmed) this._candidateContext = null;
			this._detachVisibility();
			this._setStatus(retainConfirmed ? 'retained' : 'stopped', { reason: settings.reason, retained: this._segments.length });
			this._emitPrivacy(settings.reason);
			return this.getStatus();
		}

		stop(options) {
			return this.stopRide(options);
		}

		async destroy() {
			await this.stopRide({ discard: true, reason: 'destroyed' });
			this._destroyed = true;
			this._listeners.clear();
		}

		_delay(ms) {
			return new Promise((resolve) => this.options.setTimeout(resolve, Math.max(0, safeNumber(ms, 0))));
		}
	}

	return { AvenraHaloIncidentCamera };
}));
