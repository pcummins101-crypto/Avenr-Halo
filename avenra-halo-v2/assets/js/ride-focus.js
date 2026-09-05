(function (global) {
	'use strict';

	/**
	 * Foreground-only Ride Focus navigation guard.
	 *
	 * Current WebToNative screen-awake and background-location behaviour lives in
	 * webtonative-ride.js. This helper owns the same-document history guard and
	 * retains legacy Median/GoNative bridge controls for existing wrapper builds.
	 * It does not create OS kiosk mode: Home, power and emergency controls remain
	 * owned by iOS and Android.
	 */
	class AvenraHaloRideFocus {
		constructor(options = {}) {
			this.window = options.window || global;
			this.document = options.document || this.window.document;
			this.notify = typeof options.notify === 'function' ? options.notify : () => {};
			this.active = false;
			this.historyArmed = false;
			this.ignoreNextPop = false;
			this.guardUrl = '';
			this.lastBackNoticeAt = 0;
			this.appliedNative = { keepScreen: false, fullScreen: false, swipe: false };
			this.onVisibilityChange = () => {
				if (this.active && this.document?.visibilityState === 'visible') this.applyNativeMode();
			};
			// Legacy wrappers expose lifecycle hooks as assignable globals. Chain any
			// existing handlers so compatibility does not replace host-app behaviour.
			this.previousLibraryReady = typeof this.window?.median_library_ready === 'function'
				? this.window.median_library_ready
				: null;
			this.onLibraryReady = (...args) => {
				if (this.previousLibraryReady) {
					try { this.previousLibraryReady.apply(this.window, args); } catch (error) { /* Keep Ride Focus available. */ }
				}
				if (this.active) this.applyNativeMode();
			};
			this.previousAppResumed = typeof this.window?.median_app_resumed === 'function'
				? this.window.median_app_resumed
				: null;
			this.onAppResumed = (...args) => {
				if (this.previousAppResumed) {
					try { this.previousAppResumed.apply(this.window, args); } catch (error) { /* Keep Ride Focus available. */ }
				}
				this.resume();
			};
			if (this.window) this.window.median_library_ready = this.onLibraryReady;
			if (this.window) this.window.median_app_resumed = this.onAppResumed;
			this.document?.addEventListener?.('visibilitychange', this.onVisibilityChange);
		}

		nativeBridge() {
			return this.window?.median || this.window?.gonative || this.window?.Median || null;
		}

		invoke(path) {
			let owner = this.nativeBridge();
			if (!owner) return false;
			const segments = String(path || '').split('.').filter(Boolean);
			const method = segments.pop();
			for (const segment of segments) {
				owner = owner?.[segment];
				if (!owner) return false;
			}
			if (!method || typeof owner?.[method] !== 'function') return false;
			try {
				const result = owner[method].call(owner);
				if (result && typeof result.catch === 'function') result.catch(() => {});
				return true;
			} catch (error) {
				return false;
			}
		}

		applyNativeMode() {
			this.document?.documentElement?.classList?.add('halo-ride-focus');
			const invoked = {
				keepScreen: this.invoke('screen.keepScreenOn'),
				fullScreen: this.invoke('android.screen.fullScreen'),
				swipe: this.invoke('android.swipeGestures.disable')
			};
			for (const key of Object.keys(invoked)) this.appliedNative[key] = this.appliedNative[key] || invoked[key];
			return Object.values(invoked).some(Boolean);
		}

		restoreNativeMode() {
			this.document?.documentElement?.classList?.remove('halo-ride-focus');
			if (this.appliedNative.swipe) this.invoke('android.swipeGestures.enable');
			if (this.appliedNative.fullScreen) this.invoke('android.screen.normal');
			if (this.appliedNative.keepScreen) this.invoke('screen.keepScreenNormal');
			this.appliedNative = { keepScreen: false, fullScreen: false, swipe: false };
		}

		pushHistoryGuard(baseState) {
			const history = this.window?.history;
			if (!history || typeof history.pushState !== 'function') return false;
			const existing = baseState && typeof baseState === 'object' ? baseState : {};
			const nextState = Object.assign({}, existing, { haloRideFocus: true });
			if (!this.guardUrl) this.guardUrl = this.window?.location?.href || this.document?.URL || '';
			try {
				history.pushState(nextState, '', this.guardUrl || this.window?.location?.href || undefined);
				this.historyArmed = true;
				return true;
			} catch (error) {
				this.historyArmed = false;
				return false;
			}
		}

		enter() {
			const firstEntry = !this.active;
			this.active = true;
			if (firstEntry) this.guardUrl = this.window?.location?.href || this.document?.URL || '';
			if (!this.historyArmed) this.pushHistoryGuard(this.window?.history?.state);
			const nativeBridgeActive = this.applyNativeMode();
			this.dispatch('halo:ride-focus-change', { active: true, nativeBridge: nativeBridgeActive });
			return { active: true, nativeBridge: nativeBridgeActive, historyGuard: this.historyArmed };
		}

		handlePopState(event) {
			if (this.ignoreNextPop) {
				this.ignoreNextPop = false;
				return true;
			}
			if (!this.active) return false;

			this.historyArmed = false;
			this.pushHistoryGuard(event?.state);
			const now = Date.now();
			if (now - this.lastBackNoticeAt > 1500) {
				this.lastBackNoticeAt = now;
				this.notify('Ride Focus is active. Hold to end the ride before leaving Halo.', 'info');
			}
			this.dispatch('halo:ride-focus-back-blocked', { active: true });
			return true;
		}

		releaseHistoryGuard() {
			if (!this.historyArmed) return;
			this.historyArmed = false;
			const history = this.window?.history;
			if (!history?.state?.haloRideFocus || typeof history.back !== 'function') return;
			this.ignoreNextPop = true;
			history.back();
			this.window?.setTimeout?.(() => { this.ignoreNextPop = false; }, 1000);
		}

		leave() {
			const wasActive = this.active || this.historyArmed || Object.values(this.appliedNative).some(Boolean);
			if (!wasActive) return false;
			this.active = false;
			this.restoreNativeMode();
			this.releaseHistoryGuard();
			this.guardUrl = '';
			if (wasActive) this.dispatch('halo:ride-focus-change', { active: false, nativeBridge: Boolean(this.nativeBridge()) });
			return wasActive;
		}

		suspend() {
			if (!this.active) return false;
			this.restoreNativeMode();
			return true;
		}

		resume() {
			if (!this.active) return false;
			this.applyNativeMode();
			return true;
		}

		releaseForUnload() {
			const wasActive = this.active || this.historyArmed || Object.values(this.appliedNative).some(Boolean);
			if (!wasActive) return false;
			this.active = false;
			this.historyArmed = false;
			this.ignoreNextPop = false;
			this.restoreNativeMode();
			this.guardUrl = '';
			return true;
		}

		dispatch(type, detail) {
			if (!this.document?.dispatchEvent || typeof this.window?.CustomEvent !== 'function') return;
			this.document.dispatchEvent(new this.window.CustomEvent(type, { detail }));
		}

		destroy() {
			this.leave();
			this.document?.removeEventListener?.('visibilitychange', this.onVisibilityChange);
			if (this.window?.median_library_ready === this.onLibraryReady) {
				if (this.previousLibraryReady) this.window.median_library_ready = this.previousLibraryReady;
				else delete this.window.median_library_ready;
			}
			if (this.window?.median_app_resumed === this.onAppResumed) {
				if (this.previousAppResumed) this.window.median_app_resumed = this.previousAppResumed;
				else delete this.window.median_app_resumed;
			}
		}
	}

	global.AvenraHaloRideFocus = AvenraHaloRideFocus;
}(typeof window !== 'undefined' ? window : globalThis));
