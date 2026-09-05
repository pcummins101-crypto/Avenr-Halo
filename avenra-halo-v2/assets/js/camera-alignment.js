(function (global, factory) {
	'use strict';

	const exports = factory(global || {});
	if (typeof module === 'object' && module.exports) module.exports = exports;
	if (global) global.AvenraHaloCameraAlignmentClass = exports.AvenraHaloCameraAlignment;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (global) {
	'use strict';

	const errorMessage = (error) => String(error && error.message ? error.message : error || 'Unknown camera error');

	class AvenraHaloCameraAlignment {
		constructor(options) {
			this.options = Object.assign({
				preferDual: true,
				dualProbeDelayMs: 120,
				muteGraceMs: 600,
				width: { ideal: 1280, max: 1920 },
				height: { ideal: 720, max: 1080 },
				frameRate: { ideal: 24, max: 30 },
				mediaDevices: global.navigator && global.navigator.mediaDevices,
				MediaStream: global.MediaStream,
				document: global.document || null,
				setTimeout: global.setTimeout ? global.setTimeout.bind(global) : setTimeout,
				clearTimeout: global.clearTimeout ? global.clearTimeout.bind(global) : clearTimeout,
				onStatus: null
			}, options || {});

			this._listeners = new Map();
			this._streams = { rear: null, front: null };
			this._pendingStreams = new Set();
			this._trackBindings = new Map();
			this._status = 'idle';
			this._active = false;
			this._destroyed = false;
			this._generation = 0;
			this._dualCapability = 'unknown';
			this._lastError = '';
			this._visibilityAttached = false;
			this._onVisibilityChange = () => {
				if (this._documentHidden() && this._active) this.stop('document-hidden');
			};
		}

		get supported() {
			return Boolean(this.options.mediaDevices && typeof this.options.mediaDevices.getUserMedia === 'function');
		}

		get active() {
			return this._active;
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
				try { listener.call(this, event); } catch (error) { /* A preview listener must not keep a camera active. */ }
			}
			if (type === 'statuschange' && typeof this.options.onStatus === 'function') {
				try { this.options.onStatus(event.detail); } catch (error) { /* Status rendering is best-effort. */ }
			}
		}

		_setStatus(status, detail) {
			this._status = status;
			if (detail && detail.error) this._lastError = errorMessage(detail.error);
			const snapshot = Object.assign(this.getStatus(), detail || {});
			this._emit('statuschange', snapshot);
			return snapshot;
		}

		getStatus() {
			const activeCameras = ['rear', 'front'].filter((role) => this._isStreamLive(this._streams[role]));
			return {
				status: this._status,
				supported: this.supported,
				active: this._active,
				cameraActive: activeCameras.length > 0,
				activeCameras,
				mode: activeCameras.length === 2 ? 'dual' : (activeCameras[0] || 'off'),
				dualCapability: this._dualCapability,
				recording: false,
				saving: false,
				uploading: false,
				microphoneActive: false,
				audioCaptured: false,
				stored: false,
				lastError: this._lastError
			};
		}

		getStreams() {
			return {
				rear: this._isStreamLive(this._streams.rear) ? this._streams.rear : null,
				front: this._isStreamLive(this._streams.front) ? this._streams.front : null
			};
		}

		configure(options) {
			Object.assign(this.options, options || {});
			return this;
		}

		async start(options) {
			const settings = Object.assign({ preferDual: this.options.preferDual !== false }, options || {});
			if (this._destroyed) return this._setStatus('unavailable', { reason: 'destroyed' });
			this.stop('restart', { silent: true });
			this._lastError = '';
			this._dualCapability = 'unknown';
			if (!this.supported) return this._setStatus('unavailable', { reason: 'unsupported' });
			if (this._documentHidden()) return this._setStatus('paused-background', { reason: 'document-hidden' });

			this._generation += 1;
			const generation = this._generation;
			this._active = true;
			this._attachVisibility();
			this._setStatus('requesting-permission', { reason: 'alignment-start' });
			let rear = null;
			let front = null;
			try {
				rear = await this._getCamera('rear', generation);
				if (!this._isCurrent(generation)) {
					this._stopStream(rear);
					return this.getStatus();
				}

				if (settings.preferDual !== false) {
					try {
						front = await this._getCamera('front', generation);
						if (!this._isCurrent(generation)) {
							this._stopStream(rear);
							this._stopStream(front);
							return this.getStatus();
						}
						if (!await this._verifyDualStreams(rear, front)) {
							throw new Error('This phone cannot keep distinct front and rear camera previews active together.');
						}
						this._dualCapability = 'supported';
					} catch (error) {
						this._stopStream(front);
						front = null;
						if (!this._isCurrent(generation)) {
							this._stopStream(rear);
							return this.getStatus();
						}
						this._dualCapability = 'unsupported';
						if (!this._isStreamUsable(rear)) {
							this._stopStream(rear);
							rear = await this._getCamera('rear', generation);
						}
					}
				}

				if (!this._isCurrent(generation) || this._documentHidden()) {
					this._stopStream(rear);
					this._stopStream(front);
					if (this._documentHidden() && this._active) this.stop('document-hidden');
					return this.getStatus();
				}
				if (!this._isStreamUsable(rear)) throw new Error('The rear camera did not provide a live preview.');
				if (front && !this._isStreamUsable(front)) {
					this._stopStream(front);
					front = null;
				}
				this._streams = { rear, front };
				this._commitStream(rear);
				if (front) this._commitStream(front);
				if (settings.preferDual !== false && !this._streams.front) this._dualCapability = 'unsupported';
				this._bindTrackEnd('rear', rear);
				if (this._streams.front) this._bindTrackEnd('front', this._streams.front);
				return this._setStatus('previewing', { reason: 'alignment-ready', mode: this.getStatus().mode });
			} catch (error) {
				this._stopStream(rear);
				this._stopStream(front);
				if (!this._isCurrent(generation)) return this.getStatus();
				this._active = false;
				this._stopAllStreams();
				this._detachVisibility();
				return this._setStatus('unavailable', { reason: 'camera-unavailable', error });
			}
		}

		async switchTo(role) {
			const cameraRole = role === 'front' ? 'front' : 'rear';
			if (this._destroyed) return this._setStatus('unavailable', { reason: 'destroyed' });
			if (!this.supported) return this._setStatus('unavailable', { reason: 'unsupported' });
			if (this._documentHidden()) return this.stop('document-hidden');

			this._generation += 1;
			const generation = this._generation;
			this._active = true;
			this._stopAllStreams();
			this._attachVisibility();
			this._setStatus('requesting-permission', { reason: 'camera-switch', requestedCamera: cameraRole });
			let stream = null;
			try {
				stream = await this._getCamera(cameraRole, generation);
				if (!this._isCurrent(generation) || this._documentHidden()) {
					this._stopStream(stream);
					if (this._documentHidden() && this._active) this.stop('document-hidden');
					return this.getStatus();
				}
				if (!this._isStreamUsable(stream)) throw new Error(`The ${cameraRole} camera did not provide a live preview.`);
				this._streams[cameraRole] = stream;
				this._commitStream(stream);
				this._bindTrackEnd(cameraRole, stream);
				if (this._dualCapability === 'unknown') this._dualCapability = 'unsupported';
				return this._setStatus('previewing', { reason: 'camera-switched', mode: cameraRole });
			} catch (error) {
				this._stopStream(stream);
				if (!this._isCurrent(generation)) return this.getStatus();
				this._active = false;
				this._stopAllStreams();
				this._detachVisibility();
				return this._setStatus('unavailable', { reason: 'camera-unavailable', requestedCamera: cameraRole, error });
			}
		}

		stop(reason, options) {
			const settings = Object.assign({ silent: false }, options || {});
			this._generation += 1;
			this._active = false;
			this._stopAllStreams();
			this._detachVisibility();
			if (settings.silent) {
				this._status = 'idle';
				return this.getStatus();
			}
			return this._setStatus(reason === 'document-hidden' ? 'paused-background' : 'idle', { reason: reason || 'alignment-stopped' });
		}

		destroy() {
			this.stop('destroyed', { silent: true });
			this._destroyed = true;
			this._listeners.clear();
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

		async _getCamera(role, generation) {
			let stream = null;
			let exactError = null;
			let transferred = false;
			try {
				try {
					stream = await this._requestCamera(this._cameraConstraints(role, true), generation);
				} catch (error) {
					exactError = error;
					if (!this._isConstraintFallbackError(error)) throw error;
					this._ensureCurrent(generation);
					stream = await this._requestCamera(this._cameraConstraints(role, false), generation);
				}
				if (this._streamRole(stream) === role) {
					transferred = true;
					return stream;
				}

				this._ensureCurrent(generation);
				const devicesResult = typeof this.options.mediaDevices.enumerateDevices === 'function'
					? await this.options.mediaDevices.enumerateDevices().catch(() => [])
					: [];
				this._ensureCurrent(generation);
				const devices = Array.isArray(devicesResult) ? devicesResult : [];
				const match = devices.find((device) => device?.kind === 'videoinput' && this._labelRole(device.label) === role && device.deviceId);
				if (match) {
					this._stopStream(stream);
					stream = await this._requestCamera({
						audio: false,
						video: {
							deviceId: { exact: match.deviceId },
							width: this.options.width,
							height: this.options.height,
							frameRate: this.options.frameRate
						}
					}, generation);
					if (this._streamRole(stream) === role) {
						transferred = true;
						return stream;
					}
				}

				const error = new Error(`Halo could not verify that the selected camera is the ${role === 'front' ? 'front-facing' : 'rear-facing'} camera.`);
				error.cause = exactError || undefined;
				throw error;
			} finally {
				if (!transferred) this._stopStream(stream);
			}
		}

		async _requestCamera(constraints, generation) {
			this._ensureCurrent(generation);
			let rawStream = null;
			let stream = null;
			try {
				rawStream = await this.options.mediaDevices.getUserMedia(constraints);
				stream = this._sanitiseStream(rawStream);
				if (!stream) throw new Error('The camera did not return a media stream.');
				this._pendingStreams.add(stream);
				this._ensureCurrent(generation);
				return stream;
			} catch (error) {
				if (stream) this._stopStream(stream);
				else if (rawStream) this._stopStream(rawStream);
				throw error;
			}
		}

		_isConstraintFallbackError(error) {
			const name = String(error?.name || '');
			return ['OverconstrainedError', 'ConstraintNotSatisfiedError', 'NotFoundError', 'DevicesNotFoundError'].includes(name);
		}

		_ensureCurrent(generation) {
			if (this._documentHidden() && this._active && generation === this._generation) this.stop('document-hidden');
			if (this._isCurrent(generation)) return;
			const error = new Error('The camera alignment request was cancelled.');
			error.name = 'AbortError';
			error.alignmentCancelled = true;
			throw error;
		}

		_commitStream(stream) {
			if (stream) this._pendingStreams.delete(stream);
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
				try { track.stop(); } catch (error) { /* An unexpected audio track may already be ended. */ }
				try { stream.removeTrack?.(track); } catch (error) { /* Some WebViews expose immutable streams. */ }
			}
			const videoTracks = typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks() : [];
			if (this.options.MediaStream && videoTracks.length && audioTracks.length) {
				try { return new this.options.MediaStream(videoTracks); } catch (error) { /* The cleaned original remains usable. */ }
			}
			return stream;
		}

		async _verifyDualStreams(rear, front) {
			// Some camera sources begin muted for a few frames. Allow the startup probe
			// to settle, but never report dual support while either source stays muted.
			if (!this._isStreamRunning(rear) || !this._isStreamRunning(front)) return false;
			if (this.options.dualProbeDelayMs > 0) await this._delay(this.options.dualProbeDelayMs);
			if (!this._isStreamLive(rear) || !this._isStreamLive(front)) return false;
			if (this._streamRole(rear) !== 'rear' || this._streamRole(front) !== 'front') return false;
			const rearTrack = rear.getVideoTracks()[0];
			const frontTrack = front.getVideoTracks()[0];
			if (rearTrack.muted === true || frontTrack.muted === true) return false;
			const rearSettings = typeof rearTrack.getSettings === 'function' ? rearTrack.getSettings() : {};
			const frontSettings = typeof frontTrack.getSettings === 'function' ? frontTrack.getSettings() : {};
			const deviceDistinct = Boolean(rearSettings.deviceId && frontSettings.deviceId && rearSettings.deviceId !== frontSettings.deviceId);
			const labelDistinct = Boolean(rearTrack.label && frontTrack.label && rearTrack.label !== frontTrack.label);
			return deviceDistinct || labelDistinct || rearTrack.id !== frontTrack.id;
		}

		_bindTrackEnd(role, stream) {
			const track = stream?.getVideoTracks?.()[0];
			if (!track || typeof track.addEventListener !== 'function') return;
			this._unbindTrack(track);
			const binding = { muteTimer: null, onEnded: null, onMute: null, onUnmute: null };
			binding.onEnded = () => this._handleTrackUnavailable(role, stream, 'ended');
			binding.onMute = () => {
				if (this._streams[role] !== stream || !this._active) return;
				this._clearTrackMuteTimer(track);
				this._setStatus('previewing', { reason: `${role}-track-muted`, mode: this.getStatus().mode });
				const generation = this._generation;
				binding.muteTimer = this.options.setTimeout(() => {
					binding.muteTimer = null;
					if (!this._isCurrent(generation) || this._streams[role] !== stream || track.muted !== true) return;
					this._handleTrackUnavailable(role, stream, 'muted');
				}, Math.max(0, Number(this.options.muteGraceMs) || 0));
			};
			binding.onUnmute = () => {
				this._clearTrackMuteTimer(track);
				if (this._streams[role] === stream && this._active) {
					this._setStatus('previewing', { reason: `${role}-track-unmuted`, mode: this.getStatus().mode });
				}
			};
			this._trackBindings.set(track, binding);
			track.addEventListener('ended', binding.onEnded, { once: true });
			track.addEventListener('mute', binding.onMute);
			track.addEventListener('unmute', binding.onUnmute);
		}

		_handleTrackUnavailable(role, stream, reason) {
			if (this._streams[role] !== stream) return;
			this._streams[role] = null;
			this._stopStream(stream);
			if (!this._active) return;
			const status = this.getStatus();
			if (status.activeCameras.length) {
				this._dualCapability = 'unsupported';
				this._setStatus('previewing', { reason: `${role}-track-${reason}`, mode: status.mode });
				return;
			}
			this._active = false;
			this._detachVisibility();
			this._setStatus('unavailable', { reason: `${role}-track-${reason}` });
		}

		_clearTrackMuteTimer(track) {
			const binding = this._trackBindings.get(track);
			if (!binding || binding.muteTimer === null) return;
			this.options.clearTimeout(binding.muteTimer);
			binding.muteTimer = null;
		}

		_unbindTrack(track) {
			const binding = this._trackBindings.get(track);
			if (!binding) return;
			this._clearTrackMuteTimer(track);
			try { track.removeEventListener?.('ended', binding.onEnded); } catch (error) { /* The track may already be detached. */ }
			try { track.removeEventListener?.('mute', binding.onMute); } catch (error) { /* The track may already be detached. */ }
			try { track.removeEventListener?.('unmute', binding.onUnmute); } catch (error) { /* The track may already be detached. */ }
			this._trackBindings.delete(track);
		}

		_isStreamLive(stream) {
			const tracks = stream && typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks() : [];
			return tracks.some((track) => track && track.readyState !== 'ended' && track.enabled !== false && track.muted !== true);
		}

		_isStreamUsable(stream) {
			return this._isStreamLive(stream);
		}

		_isStreamRunning(stream) {
			const tracks = stream && typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks() : [];
			return tracks.some((track) => track && track.readyState !== 'ended' && track.enabled !== false);
		}

		_isCurrent(generation) {
			return this._active && generation === this._generation && !this._destroyed;
		}

		_documentHidden() {
			return Boolean(this.options.document?.hidden || this.options.document?.visibilityState === 'hidden');
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
		}

		_stopStream(stream) {
			if (!stream || typeof stream.getTracks !== 'function') return;
			this._pendingStreams.delete(stream);
			for (const track of stream.getTracks()) {
				this._unbindTrack(track);
				try { track.stop(); } catch (error) { /* The track may already be stopped. */ }
			}
		}

		_stopAllStreams() {
			const rear = this._streams.rear;
			const front = this._streams.front;
			this._streams = { rear: null, front: null };
			this._stopStream(rear);
			if (front !== rear) this._stopStream(front);
			for (const stream of Array.from(this._pendingStreams)) this._stopStream(stream);
		}

		_delay(ms) {
			return new Promise((resolve) => this.options.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
		}
	}

	return { AvenraHaloCameraAlignment };
}));
