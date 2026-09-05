(function (global) {
	'use strict';

	const STATUS_EVENT = 'halo:webtonative-ride-status';
	const DEFAULT_TIMEOUT_MS = 5000;
	const DEFAULT_DISTANCE_FILTER_METRES = 5;

	const cleanString = (value, maxLength = 512) => String(value ?? '').trim().slice(0, maxLength);
	const boundedNumber = (value, fallback, minimum, maximum) => {
		const number = Number(value);
		return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
	};
	const isPromiseLike = value => Boolean(value && typeof value.then === 'function');

	/**
	 * WebToNative ride adapter.
	 *
	 * Halo's normal ride engine remains the owner of foreground geolocation,
	 * motion/orientation and camera capture. This adapter adds only two native
	 * conveniences when they really exist: WebToNative Background Location and
	 * native screen-on control. Browser/PWA callers safely fall back to the Screen
	 * Wake Lock API and continue without native background location.
	 *
	 * A background-location writer token must be short-lived and scoped to one
	 * ride. The host app may provide a session directly, or provide createSession
	 * and endSession callbacks so its authenticated Halo API client owns session
	 * creation and revocation.
	 */
	class AvenraHaloWebToNativeRide {
		constructor(options = {}) {
			this.window = options.window || global;
			this.document = options.document || this.window?.document || null;
			this.navigator = options.navigator || this.window?.navigator || {};
			this.options = {
				bridgeWaitMs: boundedNumber(options.bridgeWaitMs, 3000, 0, 15000),
				bridgePollMs: boundedNumber(options.bridgePollMs, 200, 10, 2000),
				timeoutMs: boundedNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 60000),
				distanceFilterMetres: boundedNumber(options.distanceFilterMetres, DEFAULT_DISTANCE_FILTER_METRES, 0, 100),
				backgroundIndicator: options.backgroundIndicator === true,
				pauseAutomatically: options.pauseAutomatically === true,
				requireSameOrigin: options.requireSameOrigin !== false,
				allowedApiOrigins: Array.isArray(options.allowedApiOrigins) ? options.allowedApiOrigins : [],
				createSession: typeof options.createSession === 'function' ? options.createSession : null,
				endSession: typeof options.endSession === 'function' ? options.endSession : null,
				onStatus: typeof options.onStatus === 'function' ? options.onStatus : null,
				onError: typeof options.onError === 'function' ? options.onError : null,
				now: typeof options.now === 'function' ? options.now : () => Date.now(),
				sleep: typeof options.sleep === 'function' ? options.sleep : null
			};
			this.run = null;
			this.generation = 0;
			this.wakeLock = null;
			this.wakeLockPromise = null;
			this.lastOperation = Promise.resolve();
			this.status = Object.freeze({
				active: false,
				phase: 'idle',
				rideId: '',
				environment: this.capabilities().environment,
				backgroundLocation: 'stopped',
				screen: 'normal',
				visibility: this.document?.visibilityState || 'visible',
				backgroundMotion: false,
				backgroundCamera: false,
				reason: '',
				at: this.options.now()
			});

			this.onVisibilityChange = () => this.handleVisibilityChange();
			this.onPageShow = () => {
				if (this.run?.active) this.applyScreenMode(this.run);
			};
			this.document?.addEventListener?.('visibilitychange', this.onVisibilityChange);
			this.window?.addEventListener?.('pageshow', this.onPageShow);
		}

		isPwa() {
			try {
				return this.navigator?.standalone === true
					|| this.window?.matchMedia?.('(display-mode: standalone)')?.matches === true;
			} catch (error) {
				return false;
			}
		}

		nativeTransport() {
			const android = this.window?.WebToNativeInterface;
			if (android && (typeof android === 'object' || typeof android === 'function')) {
				const knownMethod = ['startTrackingLocation', 'stopTrackingLocation', 'keepScreenOn', 'keepScreenNormal']
					.some(method => typeof android[method] === 'function');
				if (knownMethod) return { platform: 'android', bridge: android };
			}

			const handlers = this.window?.webkit?.messageHandlers;
			if (handlers && (typeof handlers === 'object' || typeof handlers === 'function')) {
				// The official iOS SDK uses this exact lower-camel-case key. WKWebView
				// handler collections can also expose it as a non-enumerable property.
				const knownNames = ['webToNativeInterface', 'WebToNativeInterface', 'webToNative', 'WTN', 'backgroundLocation'];
				const knownHandler = knownNames.some(name => handlers[name]?.postMessage);
				let enumerableHandler = false;
				try { enumerableHandler = Object.keys(handlers).some(name => typeof handlers[name]?.postMessage === 'function'); }
				catch (error) { /* Some WKWebView handler collections are proxies. */ }
				if (knownHandler || enumerableHandler) return { platform: 'ios', bridge: handlers };
			}
			return null;
		}

		locationModule() {
			const module = this.window?.WTN?.backgroundLocation;
			return module && typeof module.start === 'function' && typeof module.stop === 'function' ? module : null;
		}

		directLocationBridge() {
			const bridge = this.window?.WebToNativeInterface;
			return bridge
				&& typeof bridge.startTrackingLocation === 'function'
				&& typeof bridge.stopTrackingLocation === 'function'
				? bridge
				: null;
		}

		wtnPlatform() {
			const wrapper = this.window?.WTN;
			if (!wrapper || typeof wrapper !== 'object') return 'unknown';
			const read = (name) => {
				try {
					const value = wrapper[name];
					return typeof value === 'function' ? value.call(wrapper) : value;
				} catch (error) {
					return undefined;
				}
			};
			if (read('isAndroidApp') === true) return 'android';
			if (read('isIosApp') === true || read('isIOSApp') === true) return 'ios';
			const platform = cleanString(read('platform'), 32).toUpperCase();
			if (platform === 'ANDROID_APP') return 'android';
			if (platform === 'IOS_APP') return 'ios';
			if (platform === 'WEBSITE' || read('isNativeApp') === false) return 'web';
			return 'unknown';
		}

		locationController() {
			const transport = this.nativeTransport();
			if (!transport) return null;
			const module = this.locationModule();
			const direct = this.directLocationBridge();
			const wrapperPlatform = this.wtnPlatform();
			// SDK 1.0.63 snapshots its platform at load time. If Android injects
			// WebToNativeInterface later, the stale wrapper remains a WEBSITE no-op;
			// prefer the live raw bridge so Halo never reports a false active state.
			if (transport.platform === 'android' && direct && wrapperPlatform !== 'android') {
				return {
					mode: 'direct',
					start: config => direct.startTrackingLocation.call(direct, JSON.stringify(this.directLocationConfig(config))),
					stop: () => direct.stopTrackingLocation.call(direct)
				};
			}
			if (module && (wrapperPlatform === 'unknown' || wrapperPlatform === transport.platform)) {
				return {
					mode: 'wtn',
					start: config => module.start.call(module, config),
					stop: () => module.stop.call(module)
				};
			}
			if (!direct) return null;
			return {
				mode: 'direct',
				start: config => direct.startTrackingLocation.call(direct, JSON.stringify(this.directLocationConfig(config))),
				stop: () => direct.stopTrackingLocation.call(direct)
			};
		}

		nativeScreenAvailable() {
			if (!this.nativeTransport()) return false;
			const owners = [
				this.window?.WebToNativeInterface,
				this.window?.WTN?.screen,
				this.window?.WTN,
				this.window?.screen
			];
			return owners.some(owner => typeof owner?.keepScreenOn === 'function');
		}

		capabilities() {
			const wrapper = Boolean(this.window?.WTN && typeof this.window.WTN === 'object');
			const transport = this.nativeTransport();
			const location = Boolean(transport && this.locationController());
			return Object.freeze({
				environment: transport ? 'webtonative' : (this.isPwa() ? 'pwa' : 'browser'),
				wtnWrapper: wrapper,
				nativeBridge: Boolean(transport),
				backgroundLocation: location,
				nativeScreen: this.nativeScreenAvailable(),
				screenWakeLock: typeof this.navigator?.wakeLock?.request === 'function',
				backgroundMotion: false,
				backgroundCamera: false
			});
		}

		getStatus() {
			return this.status;
		}

		emitStatus(patch = {}) {
			const capabilities = this.capabilities();
			const next = {
				...this.status,
				...patch,
				environment: capabilities.environment,
				visibility: this.document?.visibilityState || this.status.visibility || 'visible',
				backgroundMotion: false,
				backgroundCamera: false,
				at: this.options.now()
			};
			this.status = Object.freeze(next);
			try { this.options.onStatus?.(next); } catch (error) { /* Status observers cannot affect a ride. */ }
			if (this.document?.dispatchEvent && typeof this.window?.CustomEvent === 'function') {
				try { this.document.dispatchEvent(new this.window.CustomEvent(STATUS_EVENT, { detail: next })); }
				catch (error) { /* Event delivery is optional. */ }
			}
			return next;
		}

		reportError(error, stage) {
			try { this.options.onError?.(error, stage); } catch (observerError) { /* Diagnostics cannot affect a ride. */ }
		}

		isCurrent(run) {
			return Boolean(run?.active && this.run === run && run.generation === this.generation);
		}

		start(context = {}) {
			const rideId = cleanString(context.client_ride_id ?? context.clientRideId ?? context.rideId, 256);
			if (!rideId) {
				return this.emitStatus({
					active: false,
					phase: 'degraded',
					rideId: '',
					backgroundLocation: 'unavailable',
					reason: 'ride_id_required'
				});
			}
			if (this.run?.active && this.run.rideId === rideId) return this.status;
			if (this.run?.active) this.stop('replaced');

			const generation = ++this.generation;
			const run = {
				active: true,
				generation,
				rideId,
				context,
				session: null,
				nativeStartIssued: false,
				nativeStopIssued: false,
				nativeScreenIssued: false,
				sessionCleanupStarted: false,
				abortController: typeof this.window?.AbortController === 'function' ? new this.window.AbortController() : null,
				activation: null
			};
			this.run = run;
			this.emitStatus({
				active: true,
				phase: 'starting',
				rideId,
				backgroundLocation: 'starting',
				screen: 'starting',
				reason: ''
			});

			// These tasks are deliberately detached: a native add-on can never delay or
			// reject Halo's normal foreground ride start.
			run.screenActivation = this.applyScreenMode(run);
			run.activation = this.activate(run).catch(error => {
				this.reportError(error, 'activation');
				if (this.isCurrent(run)) {
					this.emitStatus({ phase: 'degraded', backgroundLocation: 'failed', reason: 'native_location_failed' });
				}
				return this.status;
			});
			this.lastOperation = Promise.allSettled([run.activation, run.screenActivation]).then(() => this.status);
			return this.status;
		}

		startRide(context = {}) {
			return this.start(context);
		}

		async activate(run) {
			let session = null;
			const suppliedSession = run.context.session !== undefined && run.context.session !== null;
			if (suppliedSession) {
				try {
					const rawSession = await this.resolveSession(run);
					session = this.normaliseSession(rawSession, run.rideId);
					run.session = session;
				} catch (error) {
					this.adoptSessionForCleanup(run, await Promise.resolve(run.context.session).catch(() => null));
					await this.cleanupSession(run, 'invalid_session');
					this.reportError(error, 'validate_session');
					if (!this.isCurrent(run)) return this.status;
					return this.emitStatus({
						phase: 'degraded',
						backgroundLocation: 'unavailable',
						reason: 'native_session_invalid'
					});
				}
				if (!this.isCurrent(run)) {
					await this.cleanupSession(run, 'cancelled_before_start');
					return this.status;
				}
			}

			const bridge = await this.waitForLocationBridge(run);
			if (!this.isCurrent(run)) {
				await this.cleanupSession(run, 'cancelled_before_start');
				return this.status;
			}
			if (!bridge) {
				await this.cleanupSession(run, 'bridge_unavailable');
				return this.emitStatus({
					phase: 'degraded',
					backgroundLocation: 'unavailable',
					reason: 'native_location_unavailable'
				});
			}

			if (!session) {
				let rawSession;
				try {
					rawSession = await this.resolveSession(run);
				} catch (error) {
					this.reportError(error, 'create_session');
					if (!this.isCurrent(run)) return this.status;
					return this.emitStatus({
						phase: 'degraded',
						backgroundLocation: 'unavailable',
						reason: 'native_session_unavailable'
					});
				}

				try {
					session = this.normaliseSession(rawSession, run.rideId);
					run.session = session;
				} catch (error) {
					this.adoptSessionForCleanup(run, rawSession);
					await this.cleanupSession(run, 'invalid_session');
					this.reportError(error, 'validate_session');
					if (!this.isCurrent(run)) return this.status;
					return this.emitStatus({
						phase: 'degraded',
						backgroundLocation: 'unavailable',
						reason: 'native_session_invalid'
					});
				}
			}

			if (!this.isCurrent(run)) {
				await this.cleanupSession(run, 'cancelled_before_start');
				return this.status;
			}

			const currentBridge = this.locationController();
			if (!currentBridge) {
				await this.cleanupSession(run, 'bridge_unavailable');
				if (this.isCurrent(run)) {
					return this.emitStatus({ phase: 'degraded', backgroundLocation: 'unavailable', reason: 'native_location_unavailable' });
				}
				return this.status;
			}

			const config = this.locationConfig(run, session);
			try {
				run.nativeStartIssued = true;
				run.locationMode = currentBridge.mode;
				const result = currentBridge.start(config);
				if (isPromiseLike(result)) await result;
			} catch (error) {
				this.reportError(error, 'start_location');
				await this.stopNativeLocation(run);
				await this.cleanupSession(run, 'native_start_failed');
				if (this.isCurrent(run)) {
					return this.emitStatus({ phase: 'degraded', backgroundLocation: 'failed', reason: 'native_location_failed' });
				}
				return this.status;
			}

			if (!this.isCurrent(run)) {
				await this.stopNativeLocation(run);
				await this.cleanupSession(run, 'cancelled_after_start');
				return this.status;
			}
			return this.emitStatus({ phase: 'active', backgroundLocation: 'active', reason: '' });
		}

		adoptSessionForCleanup(run, value) {
			const source = value?.session && typeof value.session === 'object' ? value.session : value;
			if (!source || typeof source !== 'object') return false;
			const sessionId = cleanString(source.session_id ?? source.sessionId, 256);
			const sourceRideId = cleanString(source.client_ride_id ?? source.clientRideId, 256);
			if (!sessionId || sourceRideId && sourceRideId !== run.rideId) return false;
			run.session = { sessionId, clientRideId: run.rideId };
			return true;
		}

		async resolveSession(run) {
			if (run.context.session !== undefined && run.context.session !== null) {
				return Promise.resolve(run.context.session);
			}
			const createSession = typeof run.context.createSession === 'function'
				? run.context.createSession
				: this.options.createSession;
			if (typeof createSession !== 'function') throw new Error('Native ride session is unavailable.');
			return createSession({
				client_ride_id: run.rideId,
				signal: run.abortController?.signal || null
			});
		}

		normaliseSession(value, rideId) {
			const source = value?.session && typeof value.session === 'object' ? value.session : value;
			if (!source || typeof source !== 'object') throw new Error('Native ride session is invalid.');
			const sessionId = cleanString(source.session_id ?? source.sessionId, 256);
			const writerToken = cleanString(source.writer_token ?? source.writerToken, 4096);
			const sourceRideId = cleanString(source.client_ride_id ?? source.clientRideId, 256);
			if (!sessionId || !writerToken || !source.api_url && !source.apiUrl) throw new Error('Native ride session is incomplete.');
			if (sourceRideId && sourceRideId !== rideId) throw new Error('Native ride session belongs to a different ride.');
			const expiresAt = cleanString(source.expires_at ?? source.expiresAt, 128);
			if (expiresAt) {
				const expires = Date.parse(expiresAt);
				if (!Number.isFinite(expires) || expires <= this.options.now() + 5000) throw new Error('Native ride session has expired.');
			}
			return {
				sessionId,
				writerToken,
				clientRideId: rideId,
				apiUrl: this.normaliseApiUrl(source.api_url ?? source.apiUrl),
				expiresAt
			};
		}

		normaliseApiUrl(value) {
			const raw = cleanString(value, 2048);
			if (!raw || typeof this.window?.URL !== 'function') throw new Error('Native ride API URL is invalid.');
			const pageHref = this.window?.location?.href || 'https://invalid.local/';
			const url = new this.window.URL(raw, pageHref);
			if (url.protocol !== 'https:') throw new Error('Native ride API URL must use HTTPS.');
			if (url.username || url.password) throw new Error('Native ride API URL cannot contain credentials.');
			const page = new this.window.URL(pageHref);
			const allowedOrigins = new Set([page.origin, ...this.options.allowedApiOrigins.map(origin => cleanString(origin, 512))]);
			if (this.options.requireSameOrigin && !allowedOrigins.has(url.origin)) {
				throw new Error('Native ride API URL is not an approved origin.');
			}
			url.hash = '';
			return url.href;
		}

		locationConfig(run, session) {
			const hasBackgroundIndicator = Object.prototype.hasOwnProperty.call(run.context, 'backgroundIndicator');
			const hasPauseAutomatically = Object.prototype.hasOwnProperty.call(run.context, 'pauseAutomatically');
			return {
				apiUrl: session.apiUrl,
				timeout: boundedNumber(run.context.timeoutMs, this.options.timeoutMs, 1000, 60000),
				data: {
					session_id: session.sessionId,
					writer_token: session.writerToken,
					client_ride_id: run.rideId
				},
				backgroundIndicator: hasBackgroundIndicator ? run.context.backgroundIndicator === true : this.options.backgroundIndicator,
				pauseAutomatically: hasPauseAutomatically ? run.context.pauseAutomatically === true : this.options.pauseAutomatically,
				distanceFilter: boundedNumber(run.context.distanceFilterMetres, this.options.distanceFilterMetres, 0, 100),
				desiredAccuracy: 'bestForNavigation',
				activityType: 'otherNavigation'
			};
		}

		/**
		 * The Android APK exposes the lower-level WebToNativeInterface directly.
		 * Its current bridge expects interval/displacement/priority and serialised
		 * data, while newer builds also understand the documented option names.
		 * Supplying both forms keeps this fallback compatible without loading any
		 * third-party script at runtime.
		 */
		directLocationConfig(config) {
			return {
				apiUrl: config.apiUrl,
				interval: config.timeout,
				timeout: config.timeout,
				displacement: config.distanceFilter,
				distanceFilter: config.distanceFilter,
				priority: 100,
				data: JSON.stringify(config.data),
				backgroundIndicator: config.backgroundIndicator,
				pauseAutomatically: config.pauseAutomatically,
				desiredAccuracy: config.desiredAccuracy,
				activityType: config.activityType
			};
		}

		async waitForLocationBridge(run) {
			const startedAt = this.options.now();
			while (this.isCurrent(run)) {
				const controller = this.locationController();
				if (controller) return controller;
				const elapsed = this.options.now() - startedAt;
				if (elapsed >= this.options.bridgeWaitMs) return null;
				await this.sleep(Math.min(this.options.bridgePollMs, this.options.bridgeWaitMs - elapsed));
			}
			return null;
		}

		sleep(milliseconds) {
			if (this.options.sleep) return Promise.resolve(this.options.sleep(milliseconds));
			return new Promise(resolve => {
				if (typeof this.window?.setTimeout === 'function') this.window.setTimeout(resolve, milliseconds);
				else resolve();
			});
		}

		async callScreen(method) {
			if (!this.nativeTransport()) return false;
			const owners = [
				this.window?.WebToNativeInterface,
				this.window?.WTN?.screen,
				this.window?.WTN,
				this.window?.screen
			];
			const invoked = new Set();
			for (const owner of owners) {
				const callable = owner?.[method];
				if (typeof callable !== 'function' || invoked.has(callable)) continue;
				invoked.add(callable);
				try {
					const result = callable.call(owner);
					const settled = isPromiseLike(result) ? await result : result;
					if (settled !== false) return true;
				} catch (error) {
					this.reportError(error, method);
				}
			}
			return false;
		}

		async applyScreenMode(run) {
			if (!this.isCurrent(run) || this.document?.visibilityState === 'hidden') return false;
			run.nativeScreenIssued = true;
			const nativeApplied = await this.callScreen('keepScreenOn');
			if (!this.isCurrent(run)) {
				if (nativeApplied) await this.callScreen('keepScreenNormal');
				return false;
			}
			if (nativeApplied) {
				run.screenMode = 'native';
				this.emitStatus({ screen: 'native' });
				return true;
			}

			const wakeLock = await this.requestWakeLock(run);
			if (this.isCurrent(run)) {
				run.screenMode = wakeLock ? 'wake-lock' : 'unavailable';
				this.emitStatus({ screen: run.screenMode });
			}
			return Boolean(wakeLock);
		}

		async requestWakeLock(run) {
			if (!this.isCurrent(run) || this.document?.visibilityState === 'hidden') return null;
			if (this.wakeLock) return this.wakeLock;
			if (this.wakeLockPromise) return this.wakeLockPromise;
			if (typeof this.navigator?.wakeLock?.request !== 'function') return null;
			this.wakeLockPromise = Promise.resolve()
				.then(() => this.navigator.wakeLock.request('screen'))
				.then(lock => {
					if (!this.isCurrent(run)) {
						lock?.release?.().catch?.(() => {});
						return null;
					}
					this.wakeLock = lock || null;
					lock?.addEventListener?.('release', () => {
						if (this.wakeLock === lock) this.wakeLock = null;
						if (this.isCurrent(run)) this.emitStatus({ screen: 'released', reason: 'wake_lock_released' });
					});
					return this.wakeLock;
				})
				.catch(error => {
					this.reportError(error, 'wake_lock');
					return null;
				})
				.finally(() => { this.wakeLockPromise = null; });
			return this.wakeLockPromise;
		}

		async releaseWakeLock() {
			const lock = this.wakeLock;
			this.wakeLock = null;
			if (!lock?.release) return false;
			try {
				const result = lock.release();
				if (isPromiseLike(result)) await result;
				return true;
			} catch (error) {
				this.reportError(error, 'release_wake_lock');
				return false;
			}
		}

		handleVisibilityChange() {
			const run = this.run;
			if (!run?.active) return;
			if (this.document?.visibilityState === 'hidden') {
				if (run.screenMode === 'wake-lock') this.releaseWakeLock();
				this.emitStatus({ visibility: 'hidden' });
				return;
			}
			this.emitStatus({ visibility: 'visible', reason: '' });
			this.applyScreenMode(run);
		}

		async stopNativeLocation(run) {
			if (!run?.nativeStartIssued || run.nativeStopIssued) return false;
			run.nativeStopIssued = true;
			const module = run.locationMode === 'direct' ? null : this.locationModule();
			if (module) {
				try {
					const result = module.stop.call(module);
					if (isPromiseLike(result)) await result;
					return true;
				} catch (error) {
					this.reportError(error, 'stop_location');
				}
			}
			const direct = this.window?.WebToNativeInterface?.stopTrackingLocation;
			if (typeof direct === 'function') {
				try {
					const result = direct.call(this.window.WebToNativeInterface);
					if (isPromiseLike(result)) await result;
					return true;
				} catch (error) { this.reportError(error, 'stop_location_direct'); }
			}
			return false;
		}

		async cleanupSession(run, reason) {
			if (!run?.session || run.sessionCleanupStarted) return false;
			run.sessionCleanupStarted = true;
			const endSession = typeof run.context.endSession === 'function'
				? run.context.endSession
				: typeof run.context.deleteSession === 'function'
					? run.context.deleteSession
					: typeof run.context.stopSession === 'function'
						? run.context.stopSession
						: this.options.endSession;
			if (typeof endSession !== 'function') return false;
			try {
				await endSession({
					session_id: run.session.sessionId,
					client_ride_id: run.rideId,
					reason: cleanString(reason || 'ended', 64)
				});
				return true;
			} catch (error) {
				this.reportError(error, 'end_session');
				return false;
			}
		}

		stop(reason = 'ended') {
			const run = this.run;
			if (!run?.active) return Promise.resolve(this.status);
			run.active = false;
			this.run = null;
			this.generation += 1;
			run.abortController?.abort?.();
			this.emitStatus({
				active: false,
				phase: 'stopping',
				rideId: run.rideId,
				backgroundLocation: run.nativeStartIssued ? 'stopping' : 'stopped',
				reason: cleanString(reason, 64)
			});

			const immediate = Promise.allSettled([
				this.stopNativeLocation(run),
				this.releaseWakeLock(),
				run.nativeScreenIssued ? this.callScreen('keepScreenNormal') : Promise.resolve(false),
				this.cleanupSession(run, reason)
			]).then(() => {
				if (!this.run) {
					this.emitStatus({
						active: false,
						phase: 'idle',
						rideId: '',
						backgroundLocation: 'stopped',
						screen: 'normal',
						reason: cleanString(reason, 64)
					});
				}
				return this.status;
			});
			this.lastOperation = Promise.allSettled([
				immediate,
				run.activation || Promise.resolve(),
				run.screenActivation || Promise.resolve()
			]).then(() => this.status);
			return immediate;
		}

		stopRide(reason = 'ended') {
			return this.stop(reason);
		}

		whenSettled() {
			return Promise.resolve(this.lastOperation).catch(() => this.status);
		}

		destroy() {
			this.document?.removeEventListener?.('visibilitychange', this.onVisibilityChange);
			this.window?.removeEventListener?.('pageshow', this.onPageShow);
			return this.stop('destroy');
		}
	}

	AvenraHaloWebToNativeRide.STATUS_EVENT = STATUS_EVENT;
	global.AvenraHaloWebToNativeRide = AvenraHaloWebToNativeRide;
	if (typeof module === 'object' && module.exports) module.exports = { AvenraHaloWebToNativeRide };
}(typeof window !== 'undefined' ? window : globalThis));
