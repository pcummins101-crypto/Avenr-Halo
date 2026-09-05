/* global AvenraHaloV2Config, AvenraHaloMap, AvenraHaloRideEngine, AvenraHaloRideFocus, AvenraHaloRideMemories, AvenraHaloGpsSpeed, AvenraHaloBmsBluetoothClass, AvenraHaloHyperCoreEcuClass, AvenraHaloVehicleSpecification */
(function () {
	'use strict';

	const root = document.getElementById('avenra-halo-v2');
	if (!root) return;
	const scriptAssetBase = (() => {
		try { return document.currentScript?.src ? new URL('../images/', document.currentScript.src).href : ''; }
		catch (error) { return ''; }
	})();

	const CONFIG = Object.assign({
		restBase: '/wp-json/avenra-halo/v2',
		restNonce: '',
		timeout: 20000,
		serviceWorkerUrl: '',
		passkeysEnabled: false,
		brandLogoWhite: scriptAssetBase ? `${scriptAssetBase}avenra-halo-lockup.png` : 'https://rideavenra.com/wp-content/uploads/2026/08/avenra-halo-solid-black-transparent.png',
		brandLogoBlack: scriptAssetBase ? `${scriptAssetBase}avenra-halo-lockup.png` : 'https://rideavenra.com/wp-content/uploads/2026/08/avenra-halo-solid-black-transparent.png',
		profileMarks: {
			default: 'https://rideavenra.com/wp-content/uploads/2026/08/file_00000000ea8481f495d8d90ac3ee1292.png',
			evo: 'https://rideavenra.com/wp-content/uploads/2026/08/file_00000000bdfc81f4be439668e0cbc541.png',
			one: 'https://rideavenra.com/wp-content/uploads/2026/08/file_0000000037bc8246a29d947a90e5b159.png'
		},
		canonicalRangeImage: 'https://rideavenra.com/wp-content/uploads/2026/03/file_00000000e00071fdb0583761e854a132.png',
		links: { test_ride: 'https://rideavenra.com/Test-Ride', configurator: '/configurator/' },
		debug: false
	}, window.AvenraHaloV2Config || {});

	const $ = (selector, scope) => (scope || document).querySelector(selector);
	const $$ = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));
	const asArray = (value) => Array.isArray(value) ? value : [];
	const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
	const text = (value, fallback) => {
		if (value === null || value === undefined || value === '') return fallback || '';
		return String(value);
	};
	const escapeHTML = (value) => text(value).replace(/[&<>'"]/g, (char) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
	}[char]));
	const escapeAttr = escapeHTML;
	const customerSpecificationRows = (vehicle) => window.AvenraHaloVehicleSpecification?.customerSpecificationRows?.(vehicle) || [];
	const icon = (name, className) => `<svg class="halo-icon${className ? ` ${className}` : ''}" aria-hidden="true"><use href="#halo-icon-${escapeAttr(name)}"></use></svg>`;
	const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
	const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
	const debounce = (fn, wait) => {
		let timeout;
		return function debounced() {
			const args = arguments;
			window.clearTimeout(timeout);
			timeout = window.setTimeout(() => fn.apply(this, args), wait);
		};
	};
	const unwrap = (payload) => {
		if (isObject(payload) && Object.prototype.hasOwnProperty.call(payload, 'data') && Object.keys(payload).length <= 5) return payload.data;
		return payload || {};
	};
	const readCookie = (name) => {
		const prefix = `${encodeURIComponent(String(name || ''))}=`;
		const entry = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
		if (!entry) return '';
		try { return decodeURIComponent(entry.slice(prefix.length)); }
		catch (error) { return entry.slice(prefix.length); }
	};
	const safeUrl = (value, protocols) => {
		if (!value) return '';
		try {
			const url = new URL(String(value), window.location.origin);
			const allowed = protocols || ['https:'];
			return allowed.includes(url.protocol) ? url.href : '';
		} catch (error) {
			return '';
		}
	};
	const safeHexColour = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '').trim()) ? String(value).trim() : (fallback || '#5f656b');
	const safePaint = (value) => {
		const paint = String(value || '').trim();
		if (/^#[0-9a-f]{6}$/i.test(paint)) return paint;
		if (/^conic-gradient\(from 180deg(?:,\s*#[0-9a-f]{6}){2,12}\)$/i.test(paint)) return paint;
		return '#5f656b';
	};
	const brandLogo = (tone, modifier) => {
		const light = tone === 'light';
		const url = safeUrl(light ? CONFIG.brandLogoWhite : CONFIG.brandLogoBlack, ['https:']);
		const classes = ['halo-brand-logo', light ? 'halo-brand-logo--light' : 'halo-brand-logo--dark', modifier ? `halo-brand-logo--${modifier}` : ''].filter(Boolean).join(' ');
		return url
			? `<img class="${classes}" src="${escapeAttr(url)}" alt="Avenrà Halo" width="815" height="303" decoding="async">`
			: '<span class="halo-brand-fallback">Avenrà Halo</span>';
	};
	const firstName = (name) => text(name, 'Rider').trim().split(/\s+/)[0] || 'Rider';
	const initials = (name) => text(name, 'A').trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || 'A';
	const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
	const nullableFinite = (value) => value === null || value === undefined || value === '' ? null : finite(value);
	const gpsMetresPerSecondToMph = (value) => {
		const metresPerSecond = nullableFinite(value);
		if (metresPerSecond === null || metresPerSecond < 0) return null;
		if (typeof window.AvenraHaloGpsSpeed?.metresPerSecondToMph === 'function') {
			return window.AvenraHaloGpsSpeed.metresPerSecondToMph(metresPerSecond);
		}
		// Defensive fallback for a stale service-worker dependency during an update.
		return metresPerSecond * 2.2369362921 * 1.15;
	};
	const formatNumber = (value, options) => {
		const number = finite(value);
		return number === null ? '—' : new Intl.NumberFormat('en-GB', options || { maximumFractionDigits: 0 }).format(number);
	};
	const formatBytes = (value) => {
		const bytes = finite(value);
		if (bytes === null || bytes < 0) return '—';
		if (bytes < 1024) return `${Math.round(bytes)} B`;
		const units = ['KB', 'MB', 'GB', 'TB'];
		let amount = bytes / 1024;
		let index = 0;
		while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
		return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: amount >= 100 ? 0 : amount >= 10 ? 1 : 2 }).format(amount)} ${units[index]}`;
	};
	const formatMiles = (value, compact) => {
		const number = finite(value);
		if (number === null) return '—';
		return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: compact ? 0 : 1 }).format(number)} mi`;
	};
	const formatDate = (value, options) => {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return text(value, '—');
		return new Intl.DateTimeFormat('en-GB', options || { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
	};
	const formatDuration = (seconds) => {
		const total = finite(seconds);
		if (total === null) return '—';
		const minutes = Math.max(0, Math.round(total / 60));
		if (minutes < 60) return `${minutes} min`;
		const hours = Math.floor(minutes / 60);
		const remainder = minutes % 60;
		return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
	};
	const formatRideClock = (seconds) => {
		const total = Math.max(0, Math.floor(finite(seconds) || 0));
		const hours = Math.floor(total / 3600);
		const minutes = Math.floor((total % 3600) / 60);
		const remainder = total % 60;
		return hours
			? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
			: `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
	};
	const geometryCoordinates = (geometry) => {
		let source = geometry;
		if (typeof source === 'string') {
			try { source = JSON.parse(source); } catch (error) { return []; }
		}
		for (let depth = 0; depth < 4 && isObject(source); depth += 1) {
			if (source.type === 'Feature') source = source.geometry;
			else if (source.type === 'FeatureCollection') source = source.features?.[0]?.geometry;
			else source = source.coordinates || source.geometry || source.points || source.route;
		}
		if (!Array.isArray(source)) return [];
		/* GeoJSON MultiLineString: retain its ordered line segments as one track. */
		if (Array.isArray(source[0]) && Array.isArray(source[0][0])) source = source.flat();
		return source.filter((point) => Array.isArray(point)
			? finite(point[0]) !== null && finite(point[1]) !== null
			: finite(point?.lat ?? point?.latitude) !== null && finite(point?.lng ?? point?.lon ?? point?.longitude) !== null);
	};
	const routeRoot = (route) => text(route, 'home').split('/')[0];
	const isSixDigitPin = (value) => /^\d{6}$/.test(String(value || ''));
	const freshAccountActions = new Set([
		'register-passkey', 'start-guidance', 'start-free-ride', 'submit-hazard',
		'send-nok-now', 'test-nok', 'simulate-crash', 'checkout', 'upload-document',
			'upload-vehicle-photo', 'confirm-delete-document', 'add-approved-used',
			'security-command', 'share-diagnostics', 'share-ride', 'share-live-location',
			'reshare-live-location', 'stop-live-location', 'replace-live-location',
			'create-another-live-location', 'end-all-live-location', 'guardian-resume',
		'withdraw-assist-consent', 'withdraw-medical-consent', 'withdraw-camera-consent',
		'retry-incident-camera',
		'community-block-member', 'community-unblock-member', 'community-report',
		'community-leave', 'community-confirm-leave'
	]);
	const freshAccountForms = new Set([
		'halo-route-form', 'halo-safety-form', 'halo-profile-form', 'halo-pin-form',
		'halo-ride-profile-form', 'halo-approved-used-form', 'halo-community-profile-form',
		'halo-community-thread-form', 'halo-community-reply-form', 'halo-community-new-dm-form',
			'halo-community-message-form', 'halo-community-report-form', 'halo-live-share-form'
	]);

	class HaloAPIError extends Error {
		constructor(message, status, code, details) {
			super(message || 'Halo could not complete that request.');
			this.name = 'HaloAPIError';
			this.status = status || 0;
			this.code = code || '';
			this.details = details || null;
		}
	}

	class HaloSessionExpiredError extends HaloAPIError {
		constructor(message) {
			super(message || 'Your secure session has expired.', 401, 'session_expired');
			this.name = 'HaloSessionExpiredError';
		}
	}

	class HaloAPI {
		constructor(config) {
			this.base = String(config.restBase || '').replace(/\/$/, '');
			// Halo uses its own customer session and CSRF contract. A WordPress-user
			// nonce is intentionally ignored so an expired admin session cannot block
			// customer authentication on this namespace.
			this.nonce = '';
			this.csrf = config.csrf || '';
			this.timeout = Number(config.timeout) || 20000;
			this.identityEpoch = 0;
			this.identitySignal = null;
			this.expectedCustomerId = null;
		}

		setNonce() {
			this.nonce = '';
		}

		setCSRF(token) {
			this.csrf = token || '';
		}

		setIdentityScope(epoch, signal) {
			this.identityEpoch = Number(epoch) || 0;
			this.identitySignal = signal || null;
		}

		setExpectedCustomer(customerId) {
			this.expectedCustomerId = customerId === null || customerId === undefined || customerId === '' ? null : String(customerId);
		}

		async request(path, options) {
			const settings = Object.assign({ method: 'GET', body: undefined, signal: null, timeout: this.timeout, csrfRetry: true, keepalive: false, identityBound: true }, options || {});
			const requestEpoch = this.identityEpoch;
			const identitySignal = settings.identityBound === false ? null : this.identitySignal;
			const requestCustomerId = this.expectedCustomerId;
			const controller = new AbortController();
			const timeout = window.setTimeout(() => controller.abort(), settings.timeout);
			const externalAbort = () => controller.abort();
			if (settings.signal) settings.signal.addEventListener('abort', externalAbort, { once: true });
			if (identitySignal) identitySignal.addEventListener('abort', externalAbort, { once: true });
			if (settings.signal?.aborted || identitySignal?.aborted) controller.abort();
			const identityChanged = () => settings.identityBound !== false && (requestEpoch !== this.identityEpoch || Boolean(identitySignal?.aborted));
			const headers = new Headers(settings.headers || {});
			headers.set('Accept', 'application/json');
			if (this.nonce) headers.set('X-WP-Nonce', this.nonce);
			if (this.csrf && settings.method !== 'GET' && settings.method !== 'HEAD') headers.set('X-Halo-CSRF', this.csrf);
			if (requestCustomerId) headers.set('X-Halo-Customer', requestCustomerId);
			if (CONFIG.version) headers.set('X-Halo-Client', String(CONFIG.version));
			let body = settings.body;
			if (body !== undefined && body !== null && !(body instanceof FormData) && typeof body !== 'string') {
				headers.set('Content-Type', 'application/json');
				body = JSON.stringify(body);
			}

			try {
				const response = await window.fetch(`${this.base}${path.startsWith('/') ? path : `/${path}`}`, {
					method: settings.method,
					headers,
					body,
					credentials: 'same-origin',
					cache: settings.cache || 'no-store',
					keepalive: Boolean(settings.keepalive),
					signal: controller.signal
				});
				const contentType = response.headers.get('content-type') || '';
				const responseRequestId = response.headers.get('X-Halo-Request-ID') || '';
				let payload;
				if (contentType.includes('application/json')) {
					payload = await response.json().catch(() => null);
				} else {
					// Consume, but never render, upstream HTML. WordPress fatal pages can
					// contain markup and server details that do not belong in the app UI.
					await response.text().catch(() => '');
					payload = {
						ok: false,
						error: {
							code: 'unexpected_server_response',
							message: response.status >= 500
								? 'Halo encountered a server error while completing that request. Please try again or contact Avenrà support if it continues.'
								: 'Halo received an unexpected response from the service. Please try again.',
							details: responseRequestId ? { request_id: responseRequestId } : {}
						}
					};
				}
				if (!isObject(payload)) payload = {};
				const errorPayload = payload.error || {};
				const errorCode = errorPayload.code || payload.code || '';
				const errorMessage = errorPayload.message || payload.message || payload.data?.message || '';
				const errorDetails = Object.assign(
					{},
					isObject(errorPayload.details) ? errorPayload.details : (isObject(payload.data) ? payload.data : {}),
					responseRequestId ? { request_id: responseRequestId } : {}
				);
				if (identityChanged()) throw new HaloAPIError('This response belongs to an earlier Halo session.', 0, 'stale_identity');
				const sessionCodes = ['authentication_required', 'session_expired', 'not_authenticated'];
				const identityCodes = ['identity_mismatch', 'identity_context_required'];
				const csrfCodes = ['csrf_failed', 'invalid_csrf', 'rest_cookie_invalid_nonce'];
				if (identityCodes.includes(errorCode)) {
					throw new HaloAPIError(errorMessage || 'Another Halo identity is active in this browser.', response.status, errorCode, errorDetails);
				}
				if (response.status === 403 && csrfCodes.includes(errorCode) && settings.csrfRetry && path !== '/bootstrap') {
					await this.request('/bootstrap', { method: 'GET', timeout: settings.timeout, csrfRetry: false });
					throw new HaloAPIError('Halo refreshed its secure request token. Review the change and submit it once more.', 409, 'csrf_refreshed');
				}
				if ((response.status === 401 && sessionCodes.includes(errorCode)) || (response.status === 403 && csrfCodes.includes(errorCode))) {
					throw new HaloSessionExpiredError(errorMessage);
				}
				if (!response.ok || payload.ok === false) {
					throw new HaloAPIError(errorMessage || 'Halo could not complete that request.', response.status, errorCode, errorDetails);
				}
				if (payload.ok !== true) {
					throw new HaloAPIError(
						'Halo received an incomplete response from a compatibility service. Please try again.',
						502,
						'legacy_response_received',
						errorDetails
					);
				}
				const result = unwrap(payload);
				if (settings.identityBound !== false && path.split('?')[0] === '/bootstrap' && requestCustomerId) {
					const responseCustomerId = result?.customer?.id ?? result?.user?.id ?? result?.profile?.id ?? null;
					if (result?.authenticated === false) throw new HaloSessionExpiredError('Your secure Halo session has ended.');
					if (responseCustomerId === null || String(responseCustomerId) !== String(requestCustomerId)) {
						throw new HaloAPIError('Another Halo identity is active in this browser.', 409, 'identity_mismatch');
					}
				}
				const nextNonce = response.headers.get('X-WP-Nonce') || payload.rest_nonce || payload.nonce || payload.meta?.rest_nonce;
				if (settings.identityBound !== false && nextNonce) this.setNonce(nextNonce);
				const nextCSRF = response.headers.get('X-Halo-CSRF') || payload.csrf || payload.data?.csrf || payload.meta?.csrf;
				if (settings.identityBound !== false && nextCSRF) this.setCSRF(nextCSRF);
				return result;
			} catch (error) {
				if (error.name === 'AbortError') {
					if (identityChanged()) throw new HaloAPIError('This response belongs to an earlier Halo session.', 0, 'stale_identity');
					throw new HaloAPIError('The request took too long. Check your connection and try again.', 0, 'timeout');
				}
				if (error instanceof HaloAPIError) throw error;
				if (!navigator.onLine || error instanceof TypeError) throw new HaloAPIError('Halo cannot reach the service right now. Your connection may be offline.', 0, 'offline');
				throw error;
			} finally {
				window.clearTimeout(timeout);
				if (settings.signal) settings.signal.removeEventListener('abort', externalAbort);
				if (identitySignal) identitySignal.removeEventListener('abort', externalAbort);
			}
		}

		async download(path, options) {
			const settings = Object.assign({ signal: null, timeout: this.timeout }, options || {});
			const requestEpoch = this.identityEpoch;
			const identitySignal = this.identitySignal;
			const requestCustomerId = this.expectedCustomerId;
			if (!requestCustomerId) throw new HaloAPIError('Halo needs to refresh this tab before opening a private file.', 409, 'identity_context_required');
			const controller = new AbortController();
			const timeout = window.setTimeout(() => controller.abort(), settings.timeout);
			const externalAbort = () => controller.abort();
			if (settings.signal) settings.signal.addEventListener('abort', externalAbort, { once: true });
			if (identitySignal) identitySignal.addEventListener('abort', externalAbort, { once: true });
			if (settings.signal?.aborted || identitySignal?.aborted) controller.abort();
			const identityChanged = () => requestEpoch !== this.identityEpoch || Boolean(identitySignal?.aborted);
			const headers = new Headers({ Accept: 'application/pdf,image/*,application/octet-stream' });
			if (this.nonce) headers.set('X-WP-Nonce', this.nonce);
			headers.set('X-Halo-Customer', requestCustomerId);
			if (CONFIG.version) headers.set('X-Halo-Client', String(CONFIG.version));

			try {
				const response = await window.fetch(`${this.base}${path.startsWith('/') ? path : `/${path}`}`, {
					method: 'GET', headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal
				});
				if (identityChanged()) throw new HaloAPIError('This file belongs to an earlier Halo session.', 0, 'stale_identity');
				if (!response.ok) {
					const payload = await response.clone().json().catch(() => ({}));
					const errorPayload = payload.error || {};
					const code = errorPayload.code || payload.code || '';
					const message = errorPayload.message || payload.message || payload.data?.message || 'Halo could not open that private file.';
					if (['identity_mismatch', 'identity_context_required'].includes(code)) throw new HaloAPIError(message, response.status, code);
					if (response.status === 401) throw new HaloSessionExpiredError(message);
					throw new HaloAPIError(message, response.status, code, errorPayload.details || payload.data);
				}
				const blob = await response.blob();
				if (identityChanged()) throw new HaloAPIError('This file belongs to an earlier Halo session.', 0, 'stale_identity');
				const disposition = response.headers.get('Content-Disposition') || '';
				const filenameMatch = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
				let filename = filenameMatch ? (filenameMatch[1] || filenameMatch[2] || '') : '';
				try { filename = decodeURIComponent(filename); } catch (error) { /* Use the header value as supplied. */ }
				return { blob, filename: filename || 'halo-document', contentType: response.headers.get('Content-Type') || blob.type };
			} catch (error) {
				if (error.name === 'AbortError') {
					if (identityChanged()) throw new HaloAPIError('This file belongs to an earlier Halo session.', 0, 'stale_identity');
					throw new HaloAPIError('The private file took too long to open. Check your connection and try again.', 0, 'timeout');
				}
				if (error instanceof HaloAPIError) throw error;
				if (!navigator.onLine || error instanceof TypeError) throw new HaloAPIError('Halo cannot reach the private file right now.', 0, 'offline');
				throw error;
			} finally {
				window.clearTimeout(timeout);
				if (settings.signal) settings.signal.removeEventListener('abort', externalAbort);
				if (identitySignal) identitySignal.removeEventListener('abort', externalAbort);
			}
		}

		get(path, options) { return this.request(path, Object.assign({}, options, { method: 'GET' })); }
		post(path, body, options) { return this.request(path, Object.assign({}, options, { method: 'POST', body })); }
		put(path, body, options) { return this.request(path, Object.assign({}, options, { method: 'PUT', body })); }
		delete(path, body, options) { return this.request(path, Object.assign({}, options, { method: 'DELETE', body })); }
	}

	class HaloOfflineQueue {
		constructor() {
			this.databaseName = 'avenra-halo-v2-sync';
			this.storeName = 'pending-ride-sync';
			this.memory = [];
			this.database = null;
		}

		async open() {
			if (!('indexedDB' in window)) return null;
			if (this.database) return this.database;
			return new Promise((resolve) => {
				const request = window.indexedDB.open(this.databaseName, 1);
				request.onupgradeneeded = () => {
					const db = request.result;
					if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName, { keyPath: 'queue_id' });
				};
				request.onsuccess = () => { this.database = request.result; resolve(this.database); };
				request.onerror = () => resolve(null);
			});
		}

		async add(item) {
			const entry = Object.assign({ queue_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, queued_at: new Date().toISOString() }, item);
			const db = await this.open();
			if (!db) { this.memory.push(entry); return entry; }
			return new Promise((resolve) => {
				const request = db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).put(entry);
				request.onsuccess = () => resolve(entry);
				request.onerror = () => { this.memory.push(entry); resolve(entry); };
			});
		}

		async all() {
			const db = await this.open();
			if (!db) return this.memory.slice();
			return new Promise((resolve) => {
				const request = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).getAll();
				request.onsuccess = () => resolve(request.result.concat(this.memory));
				request.onerror = () => resolve(this.memory.slice());
			});
		}

		async remove(queueId) {
			this.memory = this.memory.filter((entry) => entry.queue_id !== queueId);
			const db = await this.open();
			if (!db) return;
			return new Promise((resolve) => {
				const request = db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).delete(queueId);
				request.onsuccess = request.onerror = () => resolve();
			});
		}

		clearMemory() {
			this.memory = [];
		}
	}

	class HaloMapBridge {
		constructor(app) {
			this.app = app;
			this.instances = new Map();
			this.pendingCreates = new Map();
			this.interactionControllers = new Map();
			this.interactionElements = new Map();
		}

		get api() { return window.AvenraHaloMap || null; }
		get available() { return Boolean(this.api && (typeof this.api.create === 'function' || typeof this.api.mount === 'function')); }

		async create(key, element, options) {
			if (!element) return null;
			const requestedEpoch = this.app.identityEpoch;
			const pending = this.pendingCreates.get(key);
			if (pending) await pending.catch(() => null);
			if (!this.app.isIdentityEpochCurrent(requestedEpoch)) return null;
			if (this.instances.has(key)) return this.instances.get(key);
			if (!this.available) {
				this.showDegraded(element, 'Map unavailable', 'Route details remain available as a list.');
				return null;
			}
			let operation;
			operation = (async () => {
			try {
				const factory = typeof this.api.create === 'function' ? this.api.create : this.api.mount;
				const instance = await factory.call(this.api, element, Object.assign({ style: 'avenra', controls: true }, options || {}));
				const mapInstance = instance || this.api;
				if (!this.app.isIdentityEpochCurrent(requestedEpoch)) {
					if (mapInstance && typeof mapInstance.destroy === 'function') await mapInstance.destroy();
					return null;
				}
				this.instances.set(key, mapInstance);
				element.classList.add('is-initialized');
				this.setupInteraction(key, element, mapInstance);
				const state = $('[data-map-state]', element);
				if (state) state.hidden = true;
				return mapInstance;
			} catch (error) {
				if (!this.app.isIdentityEpochCurrent(requestedEpoch)) return null;
				this.showDegraded(element, 'Map could not load', error && error.message ? error.message : 'Route details remain available as a list.');
				return null;
			}
			})();
			this.pendingCreates.set(key, operation);
			try {
				return await operation;
			} finally {
				if (this.pendingCreates.get(key) === operation) this.pendingCreates.delete(key);
			}
		}

		setupInteraction(key, element, instance) {
			if (element.dataset.haloMapInteraction === 'true') return;
			element.dataset.haloMapInteraction = 'true';
			this.interactionControllers.get(key)?.abort();
			const interactionController = new AbortController();
			this.interactionControllers.set(key, interactionController);
			this.interactionElements.set(key, element);
			const interactionSignal = interactionController.signal;
			const interactive = instance?.options?.interactive !== false;
			const controlsEnabled = instance?.options?.controls !== false;
			element.setAttribute('role', interactive ? 'application' : 'group');
			if (interactive) {
				if (!element.hasAttribute('tabindex')) element.tabIndex = 0;
				if (!element.getAttribute('aria-label')) element.setAttribute('aria-label', 'Map. Use arrow keys to pan and plus or minus to zoom.');
			} else {
				element.removeAttribute('tabindex');
				element.removeAttribute('aria-keyshortcuts');
			}
			if (key === 'active' && typeof instance.addEventListener === 'function') {
				const syncFollowControl = (event) => {
					const button = $('[data-action="ride-recenter"]', root);
					if (!button) return;
					const following = Boolean(event?.detail?.follow ?? instance.getState?.()?.follow);
					button.setAttribute('aria-pressed', String(following));
					button.setAttribute('aria-label', following ? 'Following my location' : 'Follow my location');
					button.classList.toggle('is-active', following);
				};
				instance.addEventListener('followchange', syncFollowControl, { signal: interactionSignal });
				syncFollowControl();
			}

			const adjustZoom = (delta) => {
				if (delta > 0 && typeof instance.zoomIn === 'function') return instance.zoomIn();
				if (delta < 0 && typeof instance.zoomOut === 'function') return instance.zoomOut();
				const current = typeof instance.getState === 'function' ? finite(instance.getState()?.zoom) : finite(instance.zoom);
				if (current !== null && typeof instance.setZoom === 'function') return instance.setZoom(current + delta);
				return null;
			};
			const pan = (xDirection, yDirection) => {
				if (typeof instance.setFollow === 'function') instance.setFollow(false);
				if (typeof instance.panBy === 'function') return instance.panBy(xDirection * 72, yDirection * 72);
				if (typeof instance.getState !== 'function' || typeof instance.getBounds !== 'function' || typeof instance.setCenter !== 'function') return null;
				const state = instance.getState();
				const bounds = instance.getBounds();
				const north = finite(bounds?.north); const south = finite(bounds?.south);
				const east = finite(bounds?.east); const west = finite(bounds?.west);
				if ([north, south, east, west].some((value) => value === null)) return null;
				const latSpan = Math.abs(north - south);
				const lngSpan = Math.abs(east - west);
				if (!state?.center || !Number.isFinite(latSpan) || !Number.isFinite(lngSpan)) return null;
				return instance.setCenter({ lat: state.center.lat - yDirection * latSpan * .16, lng: state.center.lng + xDirection * lngSpan * .16 }, state.zoom);
			};

			if (interactive) element.addEventListener('keydown', (event) => {
				if (event.target.closest('button, a, input, select, textarea')) return;
				const actions = {
					ArrowLeft: () => pan(-1, 0), ArrowRight: () => pan(1, 0),
					ArrowUp: () => pan(0, -1), ArrowDown: () => pan(0, 1),
					'+': () => adjustZoom(1), '=': () => adjustZoom(1), '-': () => adjustZoom(-1), _: () => adjustZoom(-1)
				};
				if (!actions[event.key]) return;
				event.preventDefault();
				actions[event.key]();
			}, { signal: interactionSignal });

			if (controlsEnabled) {
				const controls = document.createElement('div');
				controls.className = 'halo-map-zoom-controls';
				controls.setAttribute('role', 'group');
				controls.setAttribute('aria-label', 'Map zoom');
				controls.innerHTML = '<button type="button" aria-label="Zoom in">+</button><button type="button" aria-label="Zoom out">−</button>';
				const buttons = $$('button', controls);
				buttons[0].addEventListener('click', () => adjustZoom(1), { signal: interactionSignal });
				buttons[1].addEventListener('click', () => adjustZoom(-1), { signal: interactionSignal });
				element.appendChild(controls);
			}

			/* Add pinch zoom above the dependency-free renderer's one-finger drag. */
			if (!interactive) return;
			const pointers = new Map();
			let pinchDistance = 0;
			let pinchZoom = null;
			const distance = () => {
				const points = Array.from(pointers.values());
				return points.length < 2 ? 0 : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
			};
			element.addEventListener('pointerdown', (event) => {
				if (event.pointerType === 'mouse' || event.target.closest('button')) return;
				pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
				if (pointers.size === 2) {
					pinchDistance = distance();
					pinchZoom = typeof instance.getState === 'function' ? finite(instance.getState()?.zoom) : finite(instance.zoom);
					event.preventDefault();
					event.stopPropagation();
				}
			}, { capture: true, signal: interactionSignal });
			element.addEventListener('pointermove', (event) => {
				if (!pointers.has(event.pointerId)) return;
				pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
				if (pointers.size < 2 || !pinchDistance || pinchZoom === null) return;
				event.preventDefault();
				event.stopPropagation();
				const ratio = distance() / pinchDistance;
				if (typeof instance.setZoom === 'function') instance.setZoom(pinchZoom + Math.log2(Math.max(.25, ratio)));
			}, { capture: true, signal: interactionSignal });
			const finishPointer = (event) => {
				const wasPinching = pointers.size > 1;
				pointers.delete(event.pointerId);
				if (wasPinching) { event.preventDefault(); event.stopPropagation(); }
				if (pointers.size < 2) { pinchDistance = 0; pinchZoom = null; }
			};
			element.addEventListener('pointerup', finishPointer, { capture: true, signal: interactionSignal });
			element.addEventListener('pointercancel', finishPointer, { capture: true, signal: interactionSignal });
		}

		showDegraded(element, title, message) {
			element.classList.add('is-degraded');
			let state = $('[data-map-state]', element);
			if (!state) {
				state = document.createElement('div');
				state.className = 'halo-map-state';
				state.setAttribute('data-map-state', '');
				element.appendChild(state);
			}
			state.hidden = false;
			state.classList.add('is-error');
			state.innerHTML = `${icon('warning')}<p><strong>${escapeHTML(title)}</strong><br>${escapeHTML(message)}</p>`;
		}

		async call(key, method, args) {
			const instance = this.instances.get(key);
			if (!instance) return null;
			const candidates = Array.isArray(method) ? method : [method];
			const name = candidates.find((candidate) => typeof instance[candidate] === 'function');
			if (!name) return null;
			return instance[name].apply(instance, args || []);
		}

		async destroy(key) {
			const pending = this.pendingCreates.get(key);
			if (pending) await pending.catch(() => null);
			const instance = this.instances.get(key);
			this.instances.delete(key);
			this.interactionControllers.get(key)?.abort();
			this.interactionControllers.delete(key);
			const element = this.interactionElements.get(key) || instance?.container;
			if (element) element.removeAttribute('data-halo-map-interaction');
			this.interactionElements.delete(key);
			if (instance && typeof instance.destroy === 'function') await instance.destroy();
		}

		async destroyAll() {
			await Promise.allSettled(Array.from(this.pendingCreates.values()));
			await Promise.allSettled(Array.from(this.instances.keys(), (key) => this.destroy(key)));
		}
	}

	class HaloRideBridge {
		constructor(app) {
			this.app = app;
			this.bound = false;
		}

		get engine() { return window.AvenraHaloRideEngine || null; }
		get available() { return Boolean(this.engine && typeof this.engine.start === 'function' && typeof this.engine.end === 'function'); }

		bind() {
			if (!this.engine || this.bound) return;
			const handlers = {
				guidance: (payload) => this.app.updateGuidance(payload),
				telemetry: (payload) => this.app.updateRideTelemetry(payload),
				position: (payload) => this.app.updateRidePosition(payload),
				gps: (payload) => this.app.updateRideGps(payload),
				permission: (payload) => this.app.updateRidePermission(payload),
				crashcandidate: (payload) => this.app.showCrashState(Object.assign({}, payload, { engine_managed: true })),
				crashcountdown: (payload) => this.app.updateCrashCountdown(payload),
				crashcancelled: (payload) => this.app.handleEngineCrashCancelled(payload),
				crash: (payload) => this.app.confirmCrash(payload),
				impact: (payload) => this.app.showCrashState(Object.assign({}, payload, { engine_managed: true })),
				error: (payload) => this.app.handleRideError(payload),
				ended: (payload) => this.app.onRideEngineEnded(payload)
			};
			if (typeof this.engine.setHandlers === 'function') this.engine.setHandlers(handlers);
			else if (typeof this.engine.on === 'function') Object.entries(handlers).forEach(([event, handler]) => this.engine.on(event, handler));
			else if (typeof this.engine.addEventListener === 'function') Object.entries(handlers).forEach(([event, handler]) => this.engine.addEventListener(event, (detail) => handler(detail.detail || detail)));
			this.bound = true;
		}

		start(payload) {
			if (!this.available) throw new HaloAPIError('Live ride guidance is not available on this device yet.', 0, 'ride_engine_unavailable');
			this.bind();
			return this.engine.start(payload);
		}

		requestMotionPermission() {
			if (typeof this.engine?.requestMotionPermission !== 'function') return Promise.resolve(null);
			this.bind();
			return this.engine.requestMotionPermission();
		}

		end(payload) {
			if (!this.available) return Promise.resolve(payload || {});
			return this.engine.end(payload);
		}

		reportHazard(type, payload) {
			if (!this.engine || typeof this.engine.reportHazard !== 'function') return null;
			return this.engine.reportHazard(type, payload || {});
		}

		cancelCrash(reason) {
			if (this.engine && typeof this.engine.cancelCrash === 'function') return this.engine.cancelCrash(reason);
			return null;
		}

		completeCrash(status) {
			if (this.engine && typeof this.engine.completeCrash === 'function') return this.engine.completeCrash(status);
			return null;
		}

			recenter() {
				if (this.engine && typeof this.engine.recenter === 'function') return this.engine.recenter();
				return null;
			}

			restartGps() {
				if (this.engine && typeof this.engine.restartGps === 'function') return this.engine.restartGps();
				return false;
			}
		}

	class AvenraHaloApp {
		constructor() {
			this.api = new HaloAPI(CONFIG);
			this.identityEpoch = 0;
			this.identityController = new AbortController();
			this.api.setIdentityScope(this.identityEpoch, this.identityController.signal);
			this.queue = new HaloOfflineQueue();
			this.maps = new HaloMapBridge(this);
			this.rideEngine = new HaloRideBridge(this);
			this.state = {
				boot: null,
				customer: {},
				vehicle: null,
				lifecycle: 'prospect',
				route: 'home',
				vehicleView: 'overview',
				routes: [],
				selectedRoute: null,
				routePreferences: { profile: 'balanced', avoid_motorways: false, focus_zones: true, voice_guidance: false },
				currentLocation: null,
				currentRoadName: '',
				lastTelemetry: null,
				activeRide: null,
				ecu: { status: 'unavailable', supported: false, connected: false, live: false, telemetry: null },
				ecuVehicleId: null,
				ecuRideWasLive: false,
				bms: { status: 'unavailable', supported: false, connected: false, live: false, telemetry: null },
				bmsVehicleId: null,
				bmsRideWasLive: false,
				testRideTracking: null,
				rideReturnFocus: null,
				community: {
					status: 'idle', enrolled: false, profile: null, tab: 'members',
					members: [], threads: [], conversations: [], blocks: [], activeThread: null, activeConversation: null,
					loadingSection: '', error: '', sectionError: '', memberSearch: '', counts: {}, termsVersion: '1',
					loaded: { members: false, forum: false, inbox: false, blocks: false }
				},
				cart: { items: [], count: 0, total: null },
					installPrompt: null,
					installState: 'checking',
					installInFlight: false,
					publicTrackingMode: false,
					publicTracking: null,
					publicRecovery: { status: 'idle', requestedAt: '', requestId: '', retryAfter: 0 },
					guardianRecoveryTimer: null,
					guardianRecoveryInFlight: false,
					guardianResumeSessionId: '',
					guardianResumePrompted: false,
					guardianResumeSession: null,
					guardianResumeWatchId: null,
					manualQuery: '',
				crashTimer: null,
				crashPhase: 'idle',
				crashDeadline: 0,
				crashPayload: null,
				crashCandidateEventId: null,
				crashCandidatePromise: null,
				crashCandidateOutcome: 'idle',
				crashCancelPromise: null,
				crashCancellationStatus: '',
				crashSendPromise: null,
					emergencyIncident: null,
					incidentCameraStatus: null,
					incidentCameraConfirmedId: '',
					cameraAlignmentStatus: null,
					cameraAlignmentViewed: { rear: false, front: false },
					cameraAlignmentViewedAt: 0,
					rideMemoryPreferences: { enabled: false, dual: false },
					rideMemoryStatus: null,
					nativeRideStatus: null,
				incidentPositionLastSentAt: 0,
				incidentPositionInFlight: false,
				incidentPositionTimer: null,
				presenceTimer: null,
				presenceEndTimer: null,
				presenceInFlight: false,
				presenceLastAttemptAt: 0,
				isSessionExpired: false,
				sessionExpiryDeferred: false
			};
			this.dom = {
				boot: $('#halo-boot', root),
				auth: $('#halo-auth', root),
				product: $('#halo-product', root),
				main: $('#halo-main', root),
				connectivity: $('#halo-connectivity', root),
				dialog: $('#halo-dialog', root),
				sheet: $('#halo-sheet', root),
				toasts: $('#halo-toast-region', root),
				activeRide: $('#halo-active-ride', root),
				crash: $('#halo-crash-state', root)
			};
			this.bootstrapController = null;
			this.rehydratePromise = null;
			this.privateVehicleObjectUrls = new Set();
			this.identityCustomerId = null;
			this.identityRefreshPromise = null;
			this.identityRefreshGeneration = 0;
			this.identityResetGeneration = 0;
			this.identityResetting = false;
			this.identityTabId = window.crypto?.randomUUID?.() || `halo-tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
			this.identityChannel = null;
			if ('BroadcastChannel' in window) {
				try {
					this.identityChannel = new BroadcastChannel('avenra-halo-v2-identity');
					this.identityChannel.addEventListener('message', (event) => this.handleIdentityBroadcast(event.data));
				} catch (error) { this.identityChannel = null; }
			}
			this.endingRide = false;
			this.rideStarting = false;
			this.hypercorePairingTokens = new Set();
			this.hypercoreHiddenDuringPairing = false;
			this.ecuSurfaceTimer = null;
			this.incidentMediaUploads = new Map();
			this.incidentCameraPendingContext = null;
			this.incidentCameraRetryTimer = null;
				this.incidentCameraRetryAttempt = 0;
				this.incidentCameraLocallyDisabled = false;
				this.rideMemorySession = null;
				this.rideMemoryStartPromise = Promise.resolve(null);
				this.rideMemoryWriteQueue = Promise.resolve();
				this.rideMemoryLeaseTimer = null;
				this.rideMemoryPlayer = null;
				this.rideMemoryObjectUrl = '';
				this.rideMemorySecondaryObjectUrl = '';
				this.rideMemoryExport = null;
				this.rideMemoryRenderGeneration = 0;
				this.rideMemoryGapStartedAt = '';
				this.cameraAlignmentDialogGeneration = 0;
				this.cameraAlignmentOperations = new Set();
				this.cameraAlignmentPlaybackError = '';
				this.cameraAlignmentClosing = false;
				this.emergencyReconcileTimer = null;
			this.emergencyReconcileAttempt = 0;
			this.emergencyReconcileEventId = '';
			this.rideFocus = typeof window.AvenraHaloRideFocus === 'function'
				? new window.AvenraHaloRideFocus({ notify: (message, type) => this.toast(message, type) })
				: null;
			this.nativeRide = typeof window.AvenraHaloWebToNativeRide === 'function'
				? new window.AvenraHaloWebToNativeRide({
					createSession: ({ client_ride_id: clientRideId, signal }) => this.api.post('/native-ride/session', { client_ride_id: clientRideId }, { signal }),
					endSession: ({ session_id: sessionId, reason }) => this.api.delete(
						`/native-ride/session/${encodeURIComponent(sessionId)}`,
						{ reason },
						{
							keepalive: true,
							timeout: 5000,
							// Identity reset aborts every ordinary account request, but this
							// narrowly scoped writer-token revocation must still reach the server.
							identityBound: reason !== 'identity_changed',
							csrfRetry: reason !== 'identity_changed'
						}
					),
					onStatus: (status) => this.updateNativeRideStatus(status)
				})
				: null;
				this.bms = typeof window.AvenraHaloBmsBluetoothClass === 'function'
					? new window.AvenraHaloBmsBluetoothClass({
						onStatus: (status) => this.updateBmsStatus(status),
						onTelemetry: (telemetry) => this.updateBmsTelemetry(telemetry)
					})
					: null;
				this.state.bms = this.bms?.getStatus?.() || this.state.bms;
				this.ecu = typeof window.AvenraHaloHyperCoreEcuClass === 'function'
					? new window.AvenraHaloHyperCoreEcuClass({
						onStatus: (status) => this.updateEcuStatus(status),
						onTelemetry: (telemetry) => this.updateEcuTelemetry(telemetry)
					})
					: null;
				this.state.ecu = this.ecu?.getStatus?.() || this.state.ecu;
				this.cameraAlignment = typeof window.AvenraHaloCameraAlignmentClass === 'function'
					? new window.AvenraHaloCameraAlignmentClass({ onStatus: (status) => this.updateCameraAlignmentStatus(status) })
					: null;
				this.incidentCamera = window.AvenraHaloIncidentCamera || null;
				this.rideMemories = window.AvenraHaloRideMemories || null;
				if (this.incidentCamera?.configure) {
				this.incidentCamera.configure({
					uploadSegment: (item) => this.uploadIncidentCameraSegment(item),
					onStatus: (status) => this.updateIncidentCameraStatus(status)
					});
				}
				this.incidentCamera?.on?.('segmentdata', (event) => {
					this.archiveRideMemorySegment(event?.detail?.segment).catch(() => null);
				});
			}

		isIdentityEpochCurrent(epoch) {
			return Number(epoch) === this.identityEpoch && !this.identityController.signal.aborted;
		}

		captureIdentityScope() {
			return { epoch: this.identityEpoch, customerId: this.identityCustomerId };
		}

		identityScopeIsCurrent(scope) {
			return !this.identityResetting && Boolean(scope) && this.isIdentityEpochCurrent(scope.epoch)
				&& (scope.customerId === null || scope.customerId === this.identityCustomerId);
		}

		assertIdentityScope(scope) {
			if (!this.identityScopeIsCurrent(scope)) throw new HaloAPIError('This response belongs to an earlier Halo session.', 0, 'stale_identity');
		}

		advanceIdentityScope() {
			this.identityEpoch += 1;
			this.identityController.abort();
			this.identityController = new AbortController();
			this.api.setIdentityScope(this.identityEpoch, this.identityController.signal);
			return this.identityEpoch;
		}

		beginHypercorePairingAllowance() {
			const token = { timer: null };
			token.timer = window.setTimeout(() => {
				if (!this.hypercorePairingTokens.delete(token)) return;
				if (!this.hypercorePairingTokens.size && document.visibilityState !== 'visible') {
					this.hypercoreHiddenDuringPairing = false;
					this.disconnectHypercoreForHidden('pairing-timeout');
				}
			}, 120000);
			this.hypercorePairingTokens.add(token);
			return token;
		}

		endHypercorePairingAllowance(token) {
			if (!token || !this.hypercorePairingTokens.delete(token)) return;
			window.clearTimeout(token.timer);
			if (this.hypercorePairingTokens.size || !this.hypercoreHiddenDuringPairing) return;
			window.setTimeout(() => {
				if (this.hypercorePairingTokens.size || document.visibilityState === 'visible') return;
				this.hypercoreHiddenDuringPairing = false;
				this.disconnectHypercoreForHidden('document-hidden');
			}, 500);
		}

		clearHypercorePairingAllowances() {
			for (const token of this.hypercorePairingTokens) window.clearTimeout(token.timer);
			this.hypercorePairingTokens.clear();
			this.hypercoreHiddenDuringPairing = false;
			if (this.ecuSurfaceTimer !== null) window.clearTimeout(this.ecuSurfaceTimer);
			this.ecuSurfaceTimer = null;
		}

		disconnectHypercoreForHidden(reason) {
			this.ecu?.disconnect?.(reason || 'document-hidden').catch(() => null);
			this.bms?.disconnect?.(reason || 'document-hidden').catch(() => null);
		}

		broadcastIdentityChange(type) {
			if (!this.identityChannel || this.state.publicTrackingMode) return;
			try {
				this.identityChannel.postMessage({
					type,
					customerId: this.identityCustomerId,
					source: this.identityTabId,
					at: Date.now()
				});
			} catch (error) { /* Server-side request binding remains authoritative. */ }
		}

		handleIdentityBroadcast(message) {
			if (!message || message.source === this.identityTabId || this.state.publicTrackingMode) return;
			if (!['authenticated', 'logout'].includes(message.type)) return;
			this.refreshSharedIdentity().catch((error) => this.handleError(error));
		}

		async refreshSharedIdentity() {
			this.identityRefreshGeneration += 1;
			if (this.identityRefreshPromise) {
				// Never allow a second tab event to be absorbed by an earlier refresh.
				// Abort the in-flight bootstrap immediately and keep account UI hidden;
				// the generation loop below will then resolve the newest shared cookie.
				this.advanceIdentityScope();
				this.bootstrapController?.abort();
				this.dom.product.hidden = true;
				root.dataset.appState = 'booting';
				return this.identityRefreshPromise;
			}
			this.identityRefreshPromise = (async () => {
				let completedGeneration = 0;
				while (completedGeneration !== this.identityRefreshGeneration) {
					const requestedGeneration = this.identityRefreshGeneration;
					await this.resetIdentityBoundState({ clearHash: false, preserveSnapshot: false });
					await this.bootstrap();
					completedGeneration = requestedGeneration;
				}
			})().finally(() => { this.identityRefreshPromise = null; });
			return this.identityRefreshPromise;
		}

			async start() {
				this.bindEvents();
				const query = new URLSearchParams(window.location.search);
				const installRequested = query.get('install') === '1';
				this.configurePWA();
				this.updateConnectivity();
				this.preparePasskeys();
				this.setupRidePlannerUI();
				const trackingToken = query.get('track');
				const guardianToken = query.get('guardian');
				const resumeSessionId = query.get('guardian_resume');
				if (resumeSessionId && /^[A-Za-z0-9._:-]{8,80}$/.test(resumeSessionId)) this.state.guardianResumeSessionId = resumeSessionId;
				if (trackingToken && /^[A-Za-z0-9_-]{40,90}$/.test(trackingToken)) {
					this.state.publicTrackingMode = true;
					await this.showPublicTracking(trackingToken, guardianToken && /^[A-Za-z0-9_-]{32,120}$/.test(guardianToken) ? guardianToken : '');
					return;
				}
				await this.bootstrap();
				if (installRequested) this.openInstallHandoff();
		}

		bindEvents() {
			root.addEventListener('click', (event) => this.handleClick(event));
			root.addEventListener('submit', (event) => this.handleSubmit(event), true);
			root.addEventListener('input', (event) => this.handleInput(event));
			root.addEventListener('change', (event) => this.handleChange(event));
			root.addEventListener('error', (event) => this.handleImageError(event), true);
			window.addEventListener('online', () => {
				this.handleOnline().catch((error) => this.handleError(error));
				this.retryIncidentCameraUpload();
			});
			window.addEventListener('offline', () => {
				this.updateConnectivity();
				const tracking = this.state.testRideTracking;
				if (!tracking?.active || tracking.stopping) return;
				tracking.status = 'degraded';
				this.state.rideDegradedMessages = Object.assign({}, this.state.rideDegradedMessages, {
					testRideMonitoringSignal: 'Avenrà test ride monitoring signal is delayed. Halo will retry while Ride mode remains active.'
				});
				this.renderRideDegradedState();
				this.renderTestRideMonitoringStatus();
			});
			window.addEventListener('popstate', (event) => {
				if (this.rideFocus?.handlePopState(event)) return;
				if (event.state && event.state.haloRoute) this.navigate(event.state.haloRoute, { history: false });
			});
			window.addEventListener('pagehide', (event) => {
				this.cancelRideMemoryExport('backgrounded');
				this.clearHypercorePairingAllowances();
				this.ecu?.disconnect?.('page-hidden').catch(() => null);
				this.bms?.disconnect?.('page-hidden').catch(() => null);
				const alignmentDialogOpen = this.cameraAlignmentDialogOpen();
				this.closeCameraAlignment('page-hidden');
				if (alignmentDialogOpen && this.dom.dialog?.open) this.dom.dialog.close();
				if (event.persisted) this.rideFocus?.suspend();
						else {
							this.nativeRide?.stop?.('page_unload').catch(() => null);
							this.rideFocus?.releaseForUnload();
							this.releaseRideMemoryObjectUrl();
						}
					});
			window.addEventListener('pageshow', (event) => {
				if (event.persisted) this.rideFocus?.resume();
			});
				window.addEventListener('beforeinstallprompt', (event) => {
					event.preventDefault();
					this.state.installPrompt = event;
					this.state.installState = 'prompt-ready';
					if (this.state.boot) this.renderMore();
					this.updateInstallControls();
				});
				window.addEventListener('appinstalled', () => {
					const installSheetOpen = Boolean($('[data-install-handoff], [data-install-retry]', this.dom.sheet));
					this.state.installPrompt = null;
					this.state.installState = 'installed';
					if (this.state.boot) this.renderMore();
					this.updateInstallControls();
					if (installSheetOpen) this.openInstallInstructions(true);
					this.toast('Halo App installed. You can now open it from your Home Screen.', 'success');
				});
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState !== 'visible') {
					this.cancelRideMemoryExport('backgrounded');
					if (this.hypercorePairingTokens.size) this.hypercoreHiddenDuringPairing = true;
					else {
						this.ecu?.disconnect?.('document-hidden').catch(() => null);
						this.bms?.disconnect?.('document-hidden').catch(() => null);
					}
					this.resetCameraAlignmentViewed();
					return;
				}
				this.hypercoreHiddenDuringPairing = false;
				if (!this.state.boot) return;
						if (this.rideMemorySession) this.refreshRideMemoryLease().catch(() => null);
						if (!this.state.activeRide) this.refreshVehicleStatus();
						if (!this.state.boot?.offline_snapshot) this.reconcileStoredEmergency().catch(() => null);
						if (!this.state.boot?.offline_snapshot) this.sendPresence(true).catch(() => null);
						if (this.state.liveTracking?.guardian_enabled) this.pollGuardianRecoveryStatus().catch(() => null);
						if (this.state.guardianResumeSession) this.captureGuardianPosition().then((position) => this.updateGuardianResumePosition(position, true)).catch(() => null);
					});
				this.bindDialogBackdrop(this.dom.dialog);
				this.bindDialogBackdrop(this.dom.sheet);
				this.dom.dialog?.addEventListener('cancel', () => {
					if (this.cameraAlignmentDialogOpen()) this.closeCameraAlignment('dialog-cancelled');
				});
				this.dom.dialog?.addEventListener('close', () => {
					// openDialog can replace one modal immediately; ignore the queued close
					// event from the old modal when a new dialog is already open.
					if (this.dom.dialog.open) return;
					this.closeRideMemoryPlayer();
					this.closeCameraAlignment('dialog-closed');
				});
				window.addEventListener('orientationchange', () => this.resetCameraAlignmentViewed());
			}

		bindDialogBackdrop(dialog) {
			if (!dialog) return;
			dialog.addEventListener('click', (event) => {
				if (event.target !== dialog) return;
				if (dialog === this.dom.dialog && this.cameraAlignmentDialogOpen()) this.closeCameraAlignment('dialog-backdrop');
				dialog.close();
			});
		}

			configurePWA() {
				const displayMode = window.matchMedia?.('(display-mode: standalone)');
				this.state.installState = this.isStandaloneApp() ? 'installed' : 'manual';
				if (displayMode) {
					const onDisplayModeChange = () => {
						this.state.installState = this.isStandaloneApp() ? 'installed' : (this.state.installPrompt ? 'prompt-ready' : 'manual');
						if (this.state.boot) this.renderMore();
						this.updateInstallControls();
					};
					if (typeof displayMode.addEventListener === 'function') displayMode.addEventListener('change', onDisplayModeChange);
					else if (typeof displayMode.addListener === 'function') displayMode.addListener(onDisplayModeChange);
				}
				if (CONFIG.serviceWorkerUrl && 'serviceWorker' in navigator && window.isSecureContext) {
					window.addEventListener('load', () => navigator.serviceWorker.register(CONFIG.serviceWorkerUrl, { scope: CONFIG.serviceWorkerScope || undefined }).catch(() => {
						if (CONFIG.debug) console.warn('Halo service worker could not be registered.');
					}));
				}
				if (navigator.storage && typeof navigator.storage.persist === 'function') navigator.storage.persist().catch(() => {});
				this.updateInstallControls();
			}

			async showPublicTracking(token, guardianToken) {
				this.state.publicTracking = { viewerToken: token, guardianToken: guardianToken || '', latest: null };
				this.dom.auth.hidden = true;
				this.dom.product.hidden = true;
				this.dom.boot.hidden = false;
				this.dom.boot.className = 'halo-public-tracking';
				this.dom.boot.innerHTML = `<header>${brandLogo('dark', 'public')}<p class="halo-eyebrow">LIVE RIDE</p></header><main>
					<section class="halo-card halo-live-status"><div><span class="halo-status-dot is-waiting" aria-hidden="true"></span><p class="halo-card-kicker" data-public-track-state role="status" aria-live="polite">CONNECTING</p><h1 data-public-track-title>Waiting for location</h1><p class="halo-card-copy" data-public-track-copy>This private link shows the latest position and ride telemetry shared by Halo.</p></div><div class="halo-guardian-recovery" data-public-recovery hidden><div class="halo-guardian-recovery__heading">${icon('shield')}<div><strong data-public-recovery-title>Ask for a fresh location</strong><p id="halo-public-recovery-copy" data-public-recovery-copy>The rider has allowed this trusted link to request a new GPS update.</p></div></div><button type="button" class="halo-button halo-button--primary halo-full-width" data-action="request-guardian-location" aria-describedby="halo-public-recovery-copy">Request fresh location</button><p class="halo-guardian-recovery__status" data-public-recovery-status role="status" aria-live="polite" aria-atomic="true"></p><small>This requests an update from Halo. It is not an emergency alert and cannot guarantee the rider's phone has signal.</small></div></section>
					<section class="halo-public-telemetry" data-public-track-metrics aria-label="Latest shared ride telemetry"><dl>
					<div class="halo-public-telemetry__metric halo-public-telemetry__metric--speed"><dt data-public-track-speed-label>Latest speed</dt><dd><strong data-public-track-speed>—</strong><span>mph</span></dd></div>
					<div class="halo-public-telemetry__metric"><dt>Ride peak</dt><dd><strong data-public-track-top-speed>—</strong><span>mph</span></dd></div>
					<div class="halo-public-telemetry__metric halo-public-telemetry__metric--road"><dt data-public-track-road-label>Current road</dt><dd data-public-track-road>Waiting for location</dd></div>
				</dl><p>Speed and road are the latest phone/GPS estimates received from the rider.</p></section>
				<div id="halo-public-track-map" class="halo-map halo-public-track-map" role="img" aria-label="Map showing the rider's latest shared location"><div class="halo-map-state" data-map-state>${icon('route')}<p>Waiting for the first location update.</p></div></div>
				<p class="halo-public-privacy">Anyone with this private link can view these details until sharing ends or the link expires. Halo may show stale information if the rider's phone loses signal or Ride mode closes.</p>
			</main>`;
				root.dataset.appState = 'public-tracking';
				root.setAttribute('aria-busy', 'false');
				const refresh = async () => {
					try {
						const tracking = await this.api.get(`/live-tracking/${encodeURIComponent(token)}`, {
							cache: 'no-store',
							timeout: 12000,
							headers: guardianToken ? { 'X-Halo-Guardian': guardianToken } : {}
						});
						this.state.publicTracking.latest = tracking;
						await this.renderPublicTracking(tracking);
						if (tracking.status === 'ended') { this.state.publicTrackingDone = true; window.clearInterval(this.state.publicTrackingTimer); }
					} catch (error) {
					const state = $('[data-public-track-state]', root);
					const title = $('[data-public-track-title]', root);
					const copy = $('[data-public-track-copy]', root);
					const metrics = $('[data-public-track-metrics]', root);
					const speedLabel = $('[data-public-track-speed-label]', root);
					const roadLabel = $('[data-public-track-road-label]', root);
					const statusDot = $('.halo-live-status .halo-status-dot', root);
					if (state) state.textContent = error.status === 404 ? 'LINK ENDED' : 'UNAVAILABLE';
					if (title) title.textContent = error.status === 404 ? 'This live link has expired' : 'Location unavailable';
					if (copy) copy.textContent = error.status === 404 ? 'Ask the rider to create a new link if they are still travelling.' : 'Halo will try again when the connection returns.';
					if (metrics) metrics.classList.add('is-stale');
					if (speedLabel) speedLabel.textContent = 'Last reported speed';
						if (roadLabel) roadLabel.textContent = 'Last reported road';
						if (statusDot) { statusDot.classList.remove('is-waiting'); statusDot.classList.add('is-stale'); }
						const recovery = $('[data-public-recovery]', root);
						if (recovery && error.status === 404) recovery.hidden = true;
						if (error.status === 404) { this.state.publicTrackingDone = true; window.clearInterval(this.state.publicTrackingTimer); }
					}
			};
			await refresh();
			if (!this.state.publicTrackingDone) this.state.publicTrackingTimer = window.setInterval(refresh, 15000);
		}

		async renderPublicTracking(tracking) {
			const status = text(tracking.status, 'active').toLowerCase();
			const hasPing = Boolean(tracking.last_ping_at);
			const state = $('[data-public-track-state]', root);
			const title = $('[data-public-track-title]', root);
			const copy = $('[data-public-track-copy]', root);
			const metrics = $('[data-public-track-metrics]', root);
			const speed = $('[data-public-track-speed]', root);
			const topSpeed = $('[data-public-track-top-speed]', root);
			const road = $('[data-public-track-road]', root);
			const speedLabel = $('[data-public-track-speed-label]', root);
			const roadLabel = $('[data-public-track-road-label]', root);
			const statusDot = $('.halo-live-status .halo-status-dot', root);
			const currentSpeed = hasPing ? nullableFinite(tracking.speed_mph) : null;
			const ridePeak = hasPing ? nullableFinite(tracking.top_speed_mph) : null;
			const roadName = hasPing ? text(tracking.road_name).trim() : '';
				const stateLabel = status === 'ended' ? 'SHARING ENDED' : status === 'stale' ? 'SIGNAL DELAYED' : status === 'waiting' ? 'CONNECTING' : 'LIVE';
				if (state && state.textContent !== stateLabel) state.textContent = stateLabel;
			if (title) title.textContent = status === 'ended' ? 'The rider has stopped sharing' : status === 'stale' ? 'Waiting for a recent update' : status === 'waiting' ? 'Waiting for the first update' : 'Ride in progress';
			if (copy) {
				copy.textContent = hasPing
					? `${status === 'stale' ? 'Last update' : 'Updated'} ${formatDate(tracking.last_ping_at, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}. Link expires ${formatDate(tracking.expires_at, { hour: '2-digit', minute: '2-digit' })}.`
					: 'The rider has started a private link. Waiting for their first shared GPS update.';
			}
			if (speed) speed.textContent = currentSpeed === null ? '—' : formatNumber(Math.max(0, currentSpeed));
			if (topSpeed) topSpeed.textContent = ridePeak === null ? '—' : formatNumber(Math.max(0, ridePeak));
			if (road) road.textContent = !hasPing ? 'Waiting for location' : roadName || 'Road unavailable';
			if (speedLabel) speedLabel.textContent = status === 'stale' ? 'Last reported speed' : 'Latest speed';
			if (roadLabel) roadLabel.textContent = status === 'stale' ? 'Last reported road' : 'Current road';
			if (metrics) metrics.classList.toggle('is-stale', status === 'stale');
				if (statusDot) {
					statusDot.classList.toggle('is-stale', status === 'stale');
					statusDot.classList.toggle('is-waiting', status === 'waiting');
				}
				this.renderPublicRecovery(tracking, status);
				if (finite(tracking.latitude) === null || finite(tracking.longitude) === null) return;
			const position = {
				lat: Number(tracking.latitude),
				lng: Number(tracking.longitude),
				accuracy: nullableFinite(tracking.accuracy_m),
				heading: nullableFinite(tracking.heading),
				speedMph: status === 'active' ? currentSpeed : 0,
				at: tracking.last_ping_at ? new Date(tracking.last_ping_at).getTime() : Date.now()
			};
			await this.maps.create('public-tracking', $('#halo-public-track-map', root), { mode: 'tracking', zoom: 15, controls: false, interactive: false, ariaLabel: 'Map showing the rider’s latest shared location' });
			await this.maps.call('public-tracking', ['setUserLocation', 'updatePosition'], [position, false]);
				await this.maps.call('public-tracking', ['setCenter', 'flyTo'], [position, 15]);
			}

			renderPublicRecovery(tracking, trackingStatus) {
				const region = $('[data-public-recovery]', root);
				const button = $('[data-action="request-guardian-location"]', region || root);
				const title = $('[data-public-recovery-title]', region || root);
				const copy = $('[data-public-recovery-copy]', region || root);
					const result = $('[data-public-recovery-status]', region || root);
					const publicState = this.state.publicTracking || {};
					if (!region || !button) return;
					const guardianEnabled = tracking.guardian_enabled !== false && Boolean(publicState.guardianToken);
					const recovery = isObject(tracking.recovery) ? tracking.recovery : {};
					const serverStatus = text(recovery.status || tracking.recovery_status?.status || tracking.recovery_status || tracking.guardian_recovery_status).toLowerCase();
					const requestedAt = recovery.requested_at || tracking.recovery_requested_at || tracking.requested_at || this.state.publicRecovery.requestedAt;
					const fulfilledAt = recovery.resumed_at || recovery.fulfilled_at || tracking.recovery_resumed_at || tracking.recovery_fulfilled_at || tracking.resumed_at || tracking.fulfilled_at;
					const pending = ['requested', 'queued', 'acknowledged', 'received', 'pending'].includes(serverStatus)
						|| ['sending', 'requested'].includes(this.state.publicRecovery.status);
					const fulfilled = Boolean(fulfilledAt) || ['resumed', 'fulfilled', 'refreshed', 'complete', 'completed'].includes(serverStatus)
						|| (requestedAt && tracking.last_ping_at && new Date(tracking.last_ping_at).getTime() > new Date(requestedAt).getTime());
				region.hidden = !guardianEnabled || (!pending && !fulfilled && trackingStatus !== 'stale');
				if (region.hidden) return;
				button.hidden = trackingStatus !== 'stale' || pending || fulfilled;
				button.disabled = pending || this.state.publicRecovery.status === 'sending';
					if (fulfilled) {
					if (title) title.textContent = 'Fresh location received';
					if (copy) copy.textContent = 'Halo has received a newer GPS update from the rider’s phone.';
					if (result && result.textContent !== 'Location refreshed.') result.textContent = 'Location refreshed.';
					this.state.publicRecovery.status = 'fulfilled';
					return;
				}
				if (pending) {
					if (title) title.textContent = 'Request sent';
					if (copy) copy.textContent = 'Waiting for the rider’s phone to acknowledge the request and send a new GPS update.';
					const label = requestedAt ? `Requested ${formatDate(requestedAt, { hour: '2-digit', minute: '2-digit' })}.` : 'Request accepted.';
					if (result && result.textContent !== label) result.textContent = label;
					return;
				}
				if (title) title.textContent = 'Ask for a fresh location';
				if (copy) copy.textContent = 'The signal is delayed. The rider has allowed this trusted link to request a new GPS update.';
				if (result && this.state.publicRecovery.status === 'throttled') {
					result.textContent = this.state.publicRecovery.retryAfter
						? `Please wait ${Math.ceil(this.state.publicRecovery.retryAfter / 60)} minutes before asking again.`
						: 'Please wait before asking again.';
				} else if (result) result.textContent = '';
			}

			async requestGuardianRecovery(button) {
				const tracking = this.state.publicTracking;
				if (!tracking?.viewerToken || !tracking.guardianToken) throw new HaloAPIError('This tracking link cannot request a fresh location.');
				if (!navigator.onLine) throw new HaloAPIError('You are offline. Reconnect before requesting a fresh location.', 0, 'offline');
				this.setLoading(button, true);
				this.state.publicRecovery.status = 'sending';
				const requestId = window.crypto?.randomUUID?.() || `guardian-${Date.now()}-${Math.random().toString(16).slice(2)}`;
				try {
					const response = await this.api.post(
						`/live-tracking/${encodeURIComponent(tracking.viewerToken)}/recovery-request`,
						{ guardian_token: tracking.guardianToken, request_id: requestId },
						{ headers: { 'X-Halo-Guardian': tracking.guardianToken } }
					);
					this.state.publicRecovery = {
						status: text(response.status, 'requested').toLowerCase(),
						requestedAt: response.requested_at || new Date().toISOString(),
						requestId: response.request_id || requestId,
						retryAfter: 0
					};
					this.renderPublicRecovery(Object.assign({}, tracking.latest || {}, response, { recovery_status: 'requested' }), 'stale');
					} catch (error) {
						if (error.status === 409 && error.code === 'guardian_feed_current') {
							this.state.publicRecovery = { status: 'fulfilled', requestedAt: '', requestId, retryAfter: 0 };
							this.renderPublicRecovery(Object.assign({}, tracking.latest || {}, { recovery: { status: 'resumed', resumed_at: new Date().toISOString() } }), 'active');
							this.toast('A current location has already been received.', 'success');
							return;
						}
						this.state.publicRecovery.status = error.status === 429 ? 'throttled' : 'idle';
					this.state.publicRecovery.retryAfter = Number(error.details?.retry_after || 0);
					this.renderPublicRecovery(tracking.latest || {}, text(tracking.latest?.status, 'stale'));
					throw error;
				} finally {
					this.setLoading(button, false);
				}
			}

		preparePasskeys() {
			const endpoints = CONFIG.passkeyEndpoints || {};
			const supported = Boolean(CONFIG.passkeysEnabled && endpoints.loginOptions && endpoints.loginVerify && window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
			$$('.halo-passkey-button', root).forEach((button) => { button.hidden = !supported; });
		}

		isAuthenticatedBootstrap(payload) {
			const boot = unwrap(payload);
			const customer = boot.customer || boot.user || boot.profile;
			const customerId = customer?.id;
			return boot.authenticated === true && isObject(customer) && /^[1-9]\d*$/.test(String(customerId || ''));
		}

		async bootstrap(options) {
			const settings = Object.assign({ silent: false, requireAuthenticated: false, expectedCustomerId: null }, options || {});
			if (this.bootstrapController) this.bootstrapController.abort();
			this.bootstrapController = new AbortController();
			const scope = this.captureIdentityScope();
			if (!settings.silent) this.showBoot();
			try {
				const payload = await this.api.get('/bootstrap', { signal: this.bootstrapController.signal });
				this.assertIdentityScope(scope);
				if (!this.isAuthenticatedBootstrap(payload)) {
					if (settings.requireAuthenticated) {
						throw new HaloAPIError('Your details were accepted, but this browser did not retain the secure Halo session. Reset this device session and try again.', 409, 'session_not_retained');
					}
					await this.showAuth('login');
					return;
				}
				const confirmedCustomerId = unwrap(payload)?.customer?.id ?? unwrap(payload)?.user?.id ?? unwrap(payload)?.profile?.id ?? null;
				if (settings.expectedCustomerId !== null && String(confirmedCustomerId || '') !== String(settings.expectedCustomerId)) {
					throw new HaloAPIError('Another Halo account became active before this sign-in completed. Review the other open Halo tab or try again.', 409, 'login_identity_changed');
				}
				const confirmed = unwrap(payload);
				if (confirmed.csrf && CONFIG.csrfCookie && readCookie(CONFIG.csrfCookie) !== String(confirmed.csrf)) {
					throw new HaloAPIError('Halo could not retain its secure browser cookie. Reset this device session and try again.', 409, 'csrf_cookie_not_retained', { reset_required: true });
				}
				await this.acceptBootstrap(payload);
				this.showProduct();
				this.flushRideQueue();
			} catch (error) {
				if (settings.requireAuthenticated) throw error;
				if (error.code === 'stale_identity') return;
				if (error?.code === 'csrf_cookie_failed' || error?.details?.reset_required === true) {
					await this.showAuth('login');
					const resetDeviceButton = $('[data-reset-device-session]', root);
					if (resetDeviceButton) resetDeviceButton.hidden = false;
					this.setAuthAlert(error.message || 'Halo could not retain its secure browser cookie. Reset this device session and try again.');
					return;
				}
				if (error instanceof HaloSessionExpiredError || error.status === 401) {
					await this.showAuth('login');
					return;
				}
				if (error.code === 'offline') {
					const cached = this.readSessionSnapshot();
					if (cached) {
						await this.acceptBootstrap(Object.assign({}, cached, { offline_snapshot: true }));
						this.showProduct();
						this.showConnectivity('You are offline. Live vehicle, routes and account changes are unavailable.');
						return;
					}
				}
				this.showBootError(error);
			}
		}

		async acceptBootstrap(payload) {
			const boot = unwrap(payload);
			if (!this.isAuthenticatedBootstrap(boot)) {
				throw new HaloSessionExpiredError('Sign in to open your Halo account.');
			}
			const nextCustomer = boot.customer || boot.user || boot.profile || {};
			const previousCustomerId = this.identityCustomerId || (this.state.customer?.id ? String(this.state.customer.id) : null);
			const nextCustomerId = nextCustomer?.id ? String(nextCustomer.id) : null;
			if (nextCustomerId && previousCustomerId !== nextCustomerId) {
				const resetEpoch = await this.resetIdentityBoundState({ clearHash: true, preserveSnapshot: false });
				if (!this.isIdentityEpochCurrent(resetEpoch)) throw new HaloAPIError('This response belongs to an earlier Halo session.', 0, 'stale_identity');
			}
			this.state.isSessionExpired = false;
			this.state.sessionExpiryDeferred = false;
			this.state.boot = boot;
			this.state.customer = nextCustomer;
			this.identityCustomerId = nextCustomerId || (boot.offline_snapshot ? previousCustomerId : null);
			this.api.setExpectedCustomer(this.identityCustomerId);
			this.revokePrivateVehicleObjectUrls();
			const nextVehicle = boot.vehicle || boot.motorcycle || boot.bike || asArray(boot.vehicles)[0] || null;
			const nextLifecycle = this.resolveLifecycle(boot);
			if ((this.state.ecuVehicleId !== null || this.state.ecu?.connected) && (String(nextVehicle?.id || '') !== String(this.state.ecuVehicleId || '') || nextLifecycle !== 'owner')) {
				this.clearHypercorePairingAllowances();
				await this.ecu?.disconnect?.('vehicle-changed', { silent: true, forgetDevice: true }).catch(() => null);
				this.state.ecu = this.ecu?.getStatus?.() || { status: 'unavailable', supported: false, connected: false, live: false, telemetry: null };
				this.state.ecuVehicleId = null;
				this.state.ecuRideWasLive = false;
			}
			if ((this.state.bmsVehicleId !== null || this.state.bms?.connected) && (String(nextVehicle?.id || '') !== String(this.state.bmsVehicleId || '') || nextLifecycle !== 'owner')) {
				this.clearHypercorePairingAllowances();
				await this.bms?.disconnect?.('vehicle-changed', { silent: true }).catch(() => null);
				this.state.bms = this.bms?.getStatus?.() || { status: 'unavailable', supported: false, connected: false, live: false, telemetry: null };
				this.state.bmsVehicleId = null;
				this.state.bmsRideWasLive = false;
			}
			this.state.vehicle = nextVehicle;
			this.state.lifecycle = nextLifecycle;
				let localRoutePreferences = {};
				try { localRoutePreferences = JSON.parse(window.localStorage.getItem('avenra-halo-v2-route-preferences') || '{}'); } catch (error) { localRoutePreferences = {}; }
				this.state.routePreferences = Object.assign({}, this.state.routePreferences, boot.route_preferences || boot.preferences?.route || {}, localRoutePreferences);
				this.state.rideMemoryPreferences = this.loadRideMemoryPreferences();
				this.state.cart = this.loadLocalCart();
			if (boot.rest_nonce || boot.nonce) this.api.setNonce(boot.rest_nonce || boot.nonce);
			if (boot.csrf) this.api.setCSRF(boot.csrf);
				this.writeSessionSnapshot();
				if (boot.offline_snapshot) this.stopPresenceHeartbeat();
				else this.startPresenceHeartbeat();
				root.dataset.appState = boot.offline_snapshot ? 'offline' : 'ready';
			root.setAttribute('aria-busy', 'false');
			if (!boot.offline_snapshot && this.state.vehicle?.private_photo_endpoint) {
				this.hydratePrivateVehiclePhoto(this.state.vehicle).catch((error) => {
					if (error.code !== 'stale_identity') console.warn('Halo could not render the private vehicle photo.', error);
				});
			}
		}

		resolveLifecycle(boot) {
			const supplied = text(boot.lifecycle || boot.customer?.lifecycle || boot.user?.lifecycle).toLowerCase().replace(/[_\s]+/g, '-');
			if (['owner', 'delivered', 'active-owner'].includes(supplied)) return 'owner';
			if (['pre-delivery', 'awaiting-delivery', 'in-build', 'ordered'].includes(supplied)) return 'pre-delivery';
			if (['prospect', 'member', 'lead'].includes(supplied)) return 'prospect';
			const vehicle = boot.vehicle || boot.motorcycle || boot.bike || asArray(boot.vehicles)[0];
			if (!vehicle) return 'prospect';
			if (vehicle.is_owned || vehicle.delivered_at || vehicle.delivery_date || ['delivered', 'owned', 'complete'].includes(text(vehicle.status).toLowerCase()) || vehicle.connection) return 'owner';
			return 'pre-delivery';
		}

		writeSessionSnapshot() {
			try {
				const boot = this.state.boot || {};
				const vehicle = this.state.vehicle || null;
				const snapshot = {
					authenticated: true,
					lifecycle: this.state.lifecycle,
					customer: { id: this.state.customer.id || null, full_name: this.state.customer.full_name || this.state.customer.name || '' },
					vehicle: vehicle ? {
						id: vehicle.id, model: vehicle.model, color: vehicle.color, colour: vehicle.colour,
						colour_key: vehicle.colour_key, colour_label: vehicle.colour_label,
						colour_option_id: vehicle.colour_option_id, colour_swatch: vehicle.colour_swatch,
						colour_image_url: vehicle.colour_image_url, fallback_image_url: vehicle.fallback_image_url,
						image_url: String(vehicle.image_url || '').startsWith('blob:') ? (vehicle.fallback_image_url || null) : vehicle.image_url,
						registration: vehicle.registration, vin_masked: vehicle.vin_masked,
						battery: vehicle.battery, range_miles: vehicle.range_miles, connection: vehicle.connection,
						security: vehicle.security, build: vehicle.build, service: vehicle.service
					} : null,
					activity: { summary: boot.activity?.summary || {}, rides: asArray(boot.activity?.rides || boot.rides).slice(0, 8) },
					links: boot.links || {},
					features: boot.features || {},
					offline_snapshot: true
				};
				window.sessionStorage.setItem('avenra-halo-v2-snapshot', JSON.stringify(snapshot));
			} catch (error) { /* Storage can be unavailable in private modes. */ }
		}

		readSessionSnapshot() {
			try {
				const snapshot = JSON.parse(window.sessionStorage.getItem('avenra-halo-v2-snapshot') || 'null');
				if (this.isAuthenticatedBootstrap(snapshot)) return snapshot;
				window.sessionStorage.removeItem('avenra-halo-v2-snapshot');
				return null;
			} catch (error) {
				try { window.sessionStorage.removeItem('avenra-halo-v2-snapshot'); } catch (storageError) { /* Best effort. */ }
				return null;
			}
		}

		showBoot() {
			this.dom.boot.hidden = false;
			this.dom.auth.hidden = true;
			this.dom.product.hidden = true;
			this.dom.product.removeAttribute('inert');
			this.state.rideReturnFocus = null;
			root.dataset.appState = 'booting';
			root.setAttribute('aria-busy', 'true');
		}

		showBootError(error) {
			this.dom.boot.innerHTML = `${brandLogo('light', 'boot')}<div class="halo-error-state"><h2>Halo could not start</h2><p>${escapeHTML(error.message || 'Please try again.')}</p><button type="button" class="halo-button halo-button--primary" data-action="retry-bootstrap">Try again</button></div>`;
		}

		async showAuth(view) {
			await this.resetIdentityBoundState({ clearHash: true, preserveSnapshot: false });
			this.dom.boot.hidden = true;
			this.dom.product.hidden = true;
			this.dom.auth.hidden = false;
				root.dataset.appState = 'authentication';
				root.setAttribute('aria-busy', 'false');
				this.selectAuthView(view || 'login');
				this.updateInstallControls();
			}

		showProduct() {
			this.dom.boot.hidden = true;
			this.dom.auth.hidden = true;
			this.dom.product.hidden = false;
			root.dataset.appState = this.state.boot?.offline_snapshot ? 'offline' : 'ready';
			const name = this.state.customer.full_name || this.state.customer.name || this.state.customer.display_name;
			const avatar = $('[data-avatar-initials]', root);
			if (avatar) avatar.textContent = initials(name);
				this.renderAll();
				const hashRoute = window.location.hash.startsWith('#halo/') ? decodeURIComponent(window.location.hash.slice(6)) : 'home';
				this.navigate($(`[data-route="${CSS.escape(hashRoute)}"]`, root) ? hashRoute : 'home', { history: false, focus: false });
				if (!this.state.boot?.offline_snapshot) this.reconcileStoredEmergency().catch(() => null);
				this.updateInstallControls();
				this.maybePromptGuardianResume();
			}

		selectAuthView(view) {
			const target = ['login', 'signup', 'recovery'].includes(view) ? view : 'login';
			$$('[data-auth-form]', root).forEach((form) => { form.hidden = form.dataset.authForm !== target; });
			$$('[data-auth-view]', $('.halo-segmented', root)).forEach((button) => {
				const active = button.dataset.authView === target;
				button.classList.toggle('is-active', active);
				button.setAttribute('aria-pressed', String(active));
			});
			const title = $('#halo-auth-title', root);
			const description = $('#halo-auth-description', root);
			if (target === 'login') { title.textContent = 'Welcome back'; description.textContent = 'Sign in to your motorcycle and journeys.'; }
			else if (target === 'signup') { title.textContent = 'Join Halo'; description.textContent = 'Create your Avenrà rider profile.'; }
			else { title.textContent = 'Account recovery'; description.textContent = 'Restore secure access to Halo.'; }
			this.setAuthAlert('');
			window.setTimeout(() => $('[data-auth-form]:not([hidden]) input', root)?.focus(), 30);
		}

						async resetIdentityBoundState(options) {
							const settings = Object.assign({ clearHash: false, preserveSnapshot: false }, options || {});
							const resetGeneration = ++this.identityResetGeneration;
							this.identityResetting = true;
							const memorySession = this.rideMemorySession;
							const memoryStart = this.rideMemoryStartPromise;
							const testRideTracking = this.state.testRideTracking;
							if (testRideTracking) {
								testRideTracking.active = false;
								testRideTracking.stopping = true;
							}
							if (memorySession) memorySession.finalizing = true;
							// Fence every old-identity surface synchronously. Private storage cleanup
							// may continue, but no old account view or Blob URL remains interactive.
							this.closeCameraAlignment('identity-changed');
							this.closeRideMemoryPlayer();
							this.revokePrivateVehicleObjectUrls();
							this.dom.product.hidden = true;
							this.dom.product.setAttribute('inert', '');
							this.dom.auth.hidden = true;
							this.dom.activeRide.hidden = true;
							if (this.dom.crash) this.dom.crash.hidden = true;
							if (this.dom.dialog?.open) this.dom.dialog.close();
							if (this.dom.sheet?.open) this.dom.sheet.close();
							$('[data-dialog-content]', this.dom.dialog)?.replaceChildren();
							$('[data-sheet-content]', this.dom.sheet)?.replaceChildren();
							document.documentElement.classList.remove('halo-ride-active');
							if ('speechSynthesis' in window) window.speechSynthesis.cancel();
							if (this.state.wakeLock) this.state.wakeLock.release().catch(() => {});
							this.state.wakeLock = null;
							this.clearHypercorePairingAllowances();
							root.dataset.appState = 'identity-resetting';
							root.setAttribute('aria-busy', 'true');
							this.rideFocus?.leave();
							// Invoke camera shutdown before any await. Native cleanup may include a
							// bounded network request and must never extend capture under the old identity.
							const cameraShutdown = Promise.resolve(this.incidentCamera?.stopRide?.({
								discard: true,
								archive: Boolean(memorySession),
								reason: 'identity-changed'
							})).catch(() => null);
							const ecuShutdown = Promise.resolve(this.ecu?.disconnect?.('identity-changed', { silent: true, forgetDevice: true })).catch(() => null);
							const bmsShutdown = Promise.resolve(this.bms?.disconnect?.('identity-changed', { silent: true })).catch(() => null);
							const nativeShutdown = Promise.resolve(this.nativeRide?.stop?.('identity_changed')).catch(() => null);
							const testRideShutdown = testRideTracking?.session_id
								? Promise.resolve(this.api.delete(
									`/test-ride-monitoring/${encodeURIComponent(testRideTracking.session_id)}`,
									{},
									{ keepalive: true, timeout: 5000, identityBound: false, csrfRetry: false }
								)).catch(() => null)
								: Promise.resolve(null);
							this.bootstrapController?.abort();
							this.bootstrapController = null;
							this.identityController.abort();
							await Promise.all([cameraShutdown, nativeShutdown, ecuShutdown, bmsShutdown]);
							await testRideShutdown;
							await Promise.resolve(memoryStart).catch(() => null);
							await this.rideMemoryWriteQueue.catch(() => null);
							if (memorySession) {
								if (memorySession.segmentCount > 0) {
									await this.rideMemories?.finalizeRide?.({
										customerKey: memorySession.customerKey,
										rideId: memorySession.rideId,
										endedAt: new Date().toISOString(),
										summary: { title: 'Interrupted ride', incomplete: true, reason: 'identity-changed' }
									}).catch(() => null);
								} else {
									await this.rideMemories?.deleteRide?.({ customerKey: memorySession.customerKey, rideId: memorySession.rideId }).catch(() => null);
								}
							}
							this.stopRideMemoryLeaseHeartbeat();
							this.rideMemorySession = null;
						this.rideMemoryStartPromise = Promise.resolve(null);
							this.rideMemoryWriteQueue = Promise.resolve();
							this.rideMemories?.close?.();
							this.closeRideMemoryPlayer();
							if (resetGeneration !== this.identityResetGeneration) return this.identityEpoch;
					this.clearIncidentCameraRetry();
					this.incidentCameraPendingContext = null;
					this.incidentCameraRetryAttempt = 0;
					this.clearEmergencyReconciliation();
					this.stopPresenceHeartbeat();
				this.stopGuardianRecoveryPolling();
				this.clearGuardianResumeTrackingLocal();
				const resetEpoch = this.advanceIdentityScope();
			this.dom.product.hidden = true;
			this.revokePrivateVehicleObjectUrls();
			if (this.state.activeRide) {
				const engine = this.rideEngine.engine;
				try {
					if (engine?.state === 'riding' && typeof engine.stop === 'function') await engine.stop({ syncRide: false });
				} catch (error) {
					/* The pending local record is best-effort; identity data must still leave memory. */
				} finally {
					if (typeof engine?.clearIdentityState === 'function') engine.clearIdentityState();
					else if (typeof engine?.abandon === 'function') engine.abandon();
				}
			} else if (typeof this.rideEngine.engine?.clearIdentityState === 'function') {
				this.rideEngine.engine.clearIdentityState();
			}
			this.queue.clearMemory();
			if (this.state.wakeLock) this.state.wakeLock.release().catch(() => {});
			this.state.wakeLock = null;
			document.documentElement.classList.remove('halo-ride-active');
			this.dom.activeRide.hidden = true;
			this.dom.product.removeAttribute('inert');
			this.state.rideReturnFocus = null;
			this.state.crashReturnFocus = null;
			this.clearCrashState();
			if ('speechSynthesis' in window) window.speechSynthesis.cancel();
			await this.maps.destroyAll().catch(() => null);

			this.state.boot = null;
			this.state.customer = {};
			this.state.vehicle = null;
			this.state.lifecycle = 'prospect';
			this.state.route = 'home';
			this.state.vehicleView = 'overview';
			this.state.routes = [];
			this.state.selectedRoute = null;
			this.state.currentLocation = null;
			this.state.currentRoadName = '';
			this.state.lastTelemetry = null;
			this.state.activeRide = null;
			this.state.ecu = this.ecu?.getStatus?.() || { status: 'unavailable', supported: false, connected: false, live: false, telemetry: null };
			this.state.ecuVehicleId = null;
			this.state.ecuRideWasLive = false;
			this.state.bms = this.bms?.getStatus?.() || { status: 'unavailable', supported: false, connected: false, live: false, telemetry: null };
			this.state.bmsVehicleId = null;
			this.state.bmsRideWasLive = false;
			this.resetCameraAlignmentViewed();
			this.state.testRideTracking = null;
			this.state.community = {
				status: 'idle', enrolled: false, profile: null, tab: 'members',
				members: [], threads: [], conversations: [], blocks: [], activeThread: null, activeConversation: null,
				loadingSection: '', error: '', sectionError: '', memberSearch: '', counts: {}, termsVersion: '1',
				loaded: { members: false, forum: false, inbox: false, blocks: false }
			};
			this.state.liveTracking = null;
			this.state.cart = { items: [], count: 0, total: null };
			this.state.manualQuery = '';
			this.state.lastSpokenInstruction = '';
			this.state.offRouteSamples = 0;
			this.state.lastRerouteAt = 0;
			this.state.rerouteInFlight = false;
			this.state.gpsDeniedDialogShown = false;
			this.state.rideDegradedMessages = {};
			this.state.crashAlertSending = false;
			this.state.crashSendPromise = null;
			this.state.crashCandidateEventId = null;
			this.state.crashCandidatePromise = null;
			this.state.crashCandidateOutcome = 'idle';
			this.state.crashCancelPromise = null;
				this.state.crashCancellationStatus = '';
				this.state.emergencyIncident = null;
						this.state.incidentCameraStatus = null;
						this.state.incidentCameraConfirmedId = '';
						this.state.cameraAlignmentStatus = null;
						this.state.cameraAlignmentViewed = { rear: false, front: false };
						this.state.cameraAlignmentViewedAt = 0;
						this.rideStarting = false;
						this.incidentCameraLocallyDisabled = false;
					this.state.rideMemoryPreferences = { enabled: false, dual: false };
					this.state.rideMemoryStatus = null;
					this.state.nativeRideStatus = null;
				this.incidentMediaUploads.clear();
			this.state.incidentPositionLastSentAt = 0;
			this.state.incidentPositionInFlight = false;
			this.identityCustomerId = null;
			this.api.setExpectedCustomer(null);
			this.api.setCSRF('');
			root.classList.remove('is-offline-snapshot');
			$$('[data-offline-disabled="true"]', root).forEach((control) => {
				control.disabled = false;
				delete control.dataset.offlineDisabled;
				const uploadLabel = control.closest('.halo-upload-zone, .halo-file-button');
				if (uploadLabel) {
					uploadLabel.classList.remove('is-offline-disabled');
					uploadLabel.removeAttribute('aria-disabled');
				}
			});

			$('#halo-route-form', root)?.reset();
			const startSoc = $('#halo-route-form [name="start_soc"]', root);
			if (startSoc) delete startSoc.dataset.userAdjusted;
			$('#halo-manual-search', root)?.reset();
			$$('[data-auth-form]', root).forEach((form) => form.reset());
			const signupForm = $('#halo-signup-form', root);
			const verification = signupForm ? $('[data-registration-verification]', signupForm) : null;
			if (verification) verification.hidden = true;
			const verificationCode = signupForm?.querySelector('[name="verification_code"]');
			if (verificationCode) verificationCode.required = false;
			const signupSubmit = signupForm ? $('button[type="submit"]', signupForm) : null;
			if (signupSubmit) signupSubmit.textContent = 'Create account';
			const resetDeviceButton = $('[data-reset-device-session]', root);
			if (resetDeviceButton) resetDeviceButton.hidden = true;
			[
				'#halo-home-content', '#halo-vehicle-content', '#halo-activity-content',
				'#halo-more-content', '#halo-community-content', '#halo-safety-content', '#halo-documents-content',
				'#halo-manual-content', '#halo-boutique-content', '#halo-profile-content',
				'#halo-route-results'
			].forEach((selector) => $(selector, root)?.replaceChildren());
			this.dom.toasts.replaceChildren();
			if (this.dom.dialog?.open) this.dom.dialog.close();
			if (this.dom.sheet?.open) this.dom.sheet.close();
			$('[data-dialog-content]', this.dom.dialog)?.replaceChildren();
			$('[data-sheet-content]', this.dom.sheet)?.replaceChildren();
			const dialogTitle = $('[data-dialog-title]', this.dom.dialog);
			if (dialogTitle) dialogTitle.textContent = 'Details';
			const dialogEyebrow = $('[data-dialog-eyebrow]', this.dom.dialog);
			if (dialogEyebrow) { dialogEyebrow.textContent = ''; dialogEyebrow.hidden = true; }
			const sheetTitle = $('[data-sheet-title]', this.dom.sheet);
			if (sheetTitle) sheetTitle.textContent = 'Details';
			if (!settings.preserveSnapshot) {
				try { window.sessionStorage.removeItem('avenra-halo-v2-snapshot'); } catch (error) { /* Best effort in private modes. */ }
			}
			if (settings.clearHash && window.location.hash) {
				window.history.replaceState({ haloRoute: 'home' }, '', window.location.href.split('#')[0]);
			}
			if (resetGeneration === this.identityResetGeneration) this.identityResetting = false;
			return resetEpoch;
		}

		setAuthAlert(message, success) {
			const alert = $('#halo-auth-alert', root);
			alert.hidden = !message;
			alert.textContent = message || '';
			alert.classList.toggle('is-success', Boolean(success));
		}

		updateConnectivity() {
			if (navigator.onLine) {
				this.dom.connectivity.hidden = true;
				if (this.state.rideDegradedMessages) delete this.state.rideDegradedMessages.connectivity;
				this.renderRideDegradedState();
				return;
			}
			this.showConnectivity('You are offline. Saved information remains available.');
		}

		showConnectivity(message) {
			if (this.state.activeRide) {
				this.dom.connectivity.hidden = true;
				this.state.rideDegradedMessages = Object.assign({}, this.state.rideDegradedMessages, { connectivity: message });
				this.renderRideDegradedState();
				return;
			}
			this.dom.connectivity.hidden = false;
			$('[data-connectivity-message]', this.dom.connectivity).textContent = message;
		}

		startPresenceHeartbeat() {
			window.clearInterval(this.state.presenceTimer);
			window.clearTimeout(this.state.presenceEndTimer);
			this.state.presenceTimer = window.setInterval(() => {
				this.sendPresence(false).catch(() => null);
			}, 15000);
			this.sendPresence(true).catch(() => null);
		}

		stopPresenceHeartbeat() {
			window.clearInterval(this.state.presenceTimer);
			window.clearTimeout(this.state.presenceEndTimer);
			this.state.presenceTimer = null;
			this.state.presenceEndTimer = null;
			this.state.presenceLastAttemptAt = 0;
		}

		async sendPresence(force, ridingOverride) {
			const boot = this.state.boot;
			if (!boot || boot.offline_snapshot || !this.state.customer?.id || !navigator.onLine || this.state.publicTrackingMode) return false;
			if (this.state.presenceInFlight) {
				if (typeof ridingOverride === 'boolean') {
					window.clearTimeout(this.state.presenceEndTimer);
					this.state.presenceEndTimer = window.setTimeout(() => this.sendPresence(true, ridingOverride).catch(() => null), 1000);
				}
				return false;
			}

			const active = this.state.activeRide;
			const riding = Boolean(active && ridingOverride !== false && this.emergencyAssistEnabled());
			const minimumInterval = riding ? 13000 : 55000;
			if (!force && Date.now() - this.state.presenceLastAttemptAt < minimumInterval) return false;
			this.state.presenceLastAttemptAt = Date.now();
			this.state.presenceInFlight = true;
			const scope = this.captureIdentityScope();
			const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
			const telemetry = this.state.lastTelemetry || {};
			const position = telemetry.position || this.state.currentLocation || this.rideEngine.engine?.lastPosition || {};
			const payload = {
				riding,
				device_state: {
					online: navigator.onLine,
					visibility: document.visibilityState || (document.hidden ? 'hidden' : 'visible'),
					network: connection?.effectiveType || ''
				}
			};
			if (riding) {
				Object.assign(payload, {
					client_ride_id: active.id || active.session?.ride_id || null,
					vehicle_id: this.state.vehicle?.id || null,
					started_at: active.started_at || active.session?.started_at || null,
					speed_mph: nullableFinite(telemetry.speedMph ?? telemetry.speed_mph ?? telemetry.speed ?? position.speedMph ?? position.speed_mph),
					top_speed_mph: nullableFinite(telemetry.topSpeedMph ?? telemetry.top_speed_mph),
					lat: nullableFinite(position.lat ?? position.latitude),
					lng: nullableFinite(position.lng ?? position.lon ?? position.longitude),
					accuracy_m: nullableFinite(position.accuracy),
					heading: nullableFinite(position.heading)
				});
			}

			try {
				await this.api.post('/presence', payload);
				this.assertIdentityScope(scope);
				return true;
			} catch (error) {
				if (error instanceof HaloSessionExpiredError) this.handleSessionExpired();
				return false;
			} finally {
				this.state.presenceInFlight = false;
			}
		}

		async handleOnline() {
			this.updateConnectivity();
			if (this.state.boot?.offline_snapshot) {
				const ready = await this.rehydrateFromSnapshot();
				if (!ready) this.showConnectivity('Halo is online but could not securely refresh your account yet. Saved information remains read-only.');
				return;
			}
			await this.flushRideQueue();
			await this.reconcileStoredEmergency();
			await this.sendPresence(true).catch(() => null);
			if (this.state.testRideTracking?.active && this.state.currentLocation) await this.updateTestRideMonitoringPosition(this.state.currentLocation, true);
			if (this.state.liveTracking?.guardian_enabled) await this.pollGuardianRecoveryStatus().catch(() => null);
			if (this.state.guardianResumeSession) await this.captureGuardianPosition().then((position) => this.updateGuardianResumePosition(position, true)).catch(() => null);
		}

		async rehydrateFromSnapshot() {
			if (!this.state.boot?.offline_snapshot) return true;
			if (!navigator.onLine) return false;
			if (!this.rehydratePromise) {
				this.rehydratePromise = this.bootstrap({ silent: true })
					.then(() => !this.state.boot?.offline_snapshot && Boolean(this.state.customer?.id))
					.finally(() => { this.rehydratePromise = null; });
			}
			return this.rehydratePromise;
		}

		async requireFreshAccount() {
			if (!this.state.boot?.offline_snapshot) return;
			if (!navigator.onLine) throw new HaloAPIError('This saved offline view is read-only. Reconnect before changing account or ride data.', 0, 'offline_snapshot');
			if (!await this.rehydrateFromSnapshot()) throw new HaloAPIError('Halo could not securely refresh your account yet. Try again in a moment.', 0, 'rehydration_required');
		}

		setupRidePlannerUI() {
			const form = $('#halo-route-form', root);
			if (!form || $('[data-route-preferences]', form)) return;
			form.addEventListener('keydown', (event) => {
				if (event.key !== 'Enter' || event.isComposing || !event.target.matches('input[name="origin"], input[name="destination"]')) return;
				event.preventDefault();
				event.stopPropagation();
				this.submitRouteForm(form).catch((error) => this.handleError(error));
			});
			const bar = document.createElement('div');
			bar.className = 'halo-route-options-bar';
			bar.setAttribute('data-route-preferences', '');
			bar.innerHTML = `<button type="button" class="halo-filter-chip is-active" data-action="open-route-preferences">${icon('settings')} <span data-route-preference-label>Balanced</span></button><button type="button" class="halo-filter-chip" data-action="use-current-location">${icon('pin')} My location</button>`;
			form.insertBefore(bar, form.querySelector('.halo-route-submit'));
		}

		normaliseCart(cart) {
			const items = asArray(cart.items || cart.lines);
			const calculatedTotal = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 1), 0);
			return {
				items,
				count: finite(cart.count) !== null ? Number(cart.count) : items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0),
				total: finite(cart.total) ?? calculatedTotal,
				currency: cart.currency || 'GBP'
			};
		}

		loadLocalCart() {
			try {
				const customerId = this.state.customer?.id || 'guest';
				return this.normaliseCart(JSON.parse(window.localStorage.getItem(`avenra-halo-v2-cart-${customerId}`) || '{"items":[]}'));
			} catch (error) { return this.normaliseCart({ items: [] }); }
		}

			saveLocalCart() {
				try {
					const customerId = this.state.customer?.id || 'guest';
					window.localStorage.setItem(`avenra-halo-v2-cart-${customerId}`, JSON.stringify({ items: this.state.cart.items, currency: this.state.cart.currency }));
				} catch (error) { /* Basket still remains in memory. */ }
			}

			loadRideMemoryPreferences() {
				// Recording is a per-ride choice. A previous ride must never silently
				// reactivate either camera on the next one.
				return { enabled: false, dual: false };
			}

			saveRideMemoryPreferences(preferences) {
				const next = {
					enabled: preferences?.enabled === true,
					dual: preferences?.enabled === true && preferences?.dual === true
				};
				this.state.rideMemoryPreferences = next;
				return next;
			}

			rideMemoryPreferences() {
				const form = $('#halo-route-form', root);
				const enabled = $('[name="ride_memories_enabled"]', form);
				const dual = $('[name="ride_memories_dual_enabled"]', form);
				const supported = Boolean(this.rideMemories?.supported && this.incidentCamera?.supported);
				return {
					enabled: supported && Boolean(enabled ? enabled.checked : this.state.rideMemoryPreferences?.enabled),
					dual: supported && Boolean(enabled ? enabled.checked : this.state.rideMemoryPreferences?.enabled)
						&& Boolean(dual ? dual.checked : this.state.rideMemoryPreferences?.dual)
				};
			}

			syncRideMemorySetup() {
				const form = $('#halo-route-form', root);
				if (!form) return;
				const enabled = $('[name="ride_memories_enabled"]', form);
				const dual = $('[name="ride_memories_dual_enabled"]', form);
				const dualSetting = $('[data-ride-memory-dual-setting]', form);
				const supported = Boolean(this.rideMemories?.supported && this.incidentCamera?.supported);
				if (enabled) {
					enabled.checked = supported && this.state.rideMemoryPreferences?.enabled === true;
					enabled.disabled = !supported;
				}
				if (dual) {
					dual.checked = supported && Boolean(enabled?.checked) && this.state.rideMemoryPreferences?.dual === true;
					dual.disabled = !supported || !enabled?.checked;
				}
				if (dualSetting) dualSetting.hidden = !enabled?.checked;
				this.refreshRideMemoryStorageStatus().catch(() => null);
			}

			async refreshRideMemoryStorageStatus() {
				const output = $('[data-ride-memory-storage]', root);
				if (!output) return;
				if (!this.rideMemories?.supported || !this.incidentCamera?.supported) {
					output.textContent = 'Ride Memories is unavailable in this browser or WebView.';
					return;
				}
				const customerKey = String(this.state.customer?.id || this.identityCustomerId || '');
				if (!customerKey) return;
				let estimate;
				try { estimate = await this.rideMemories.estimateStorage({ customerKey }); }
				catch (error) {
					output.textContent = 'Halo could not open private Ride Memories storage on this device.';
					return;
				}
				if (customerKey !== String(this.state.customer?.id || this.identityCustomerId || '')) return;
				const parts = [`HALO footage uses ${formatBytes(estimate.haloBytes || 0)}`];
				if (finite(estimate.availableBytes) !== null) parts.push(`${formatBytes(estimate.availableBytes)} currently available`);
				parts.push(estimate.persisted ? 'persistent storage granted' : 'browser may remove it or app data can be cleared');
				output.textContent = parts.join(' · ');
			}

			cameraAlignmentSupported() {
				if (!this.cameraAlignment?.supported) return false;
				const video = document.createElement('video');
				return 'srcObject' in video && typeof video.play === 'function';
			}

			syncCameraAlignmentSetup() {
				const button = $('[data-action="check-camera-alignment"]', root);
				const output = $('[data-camera-alignment-setup-status]', root);
				const supported = this.cameraAlignmentSupported();
				const current = Number(this.state.cameraAlignmentViewedAt || 0) > 0
					&& Date.now() - Number(this.state.cameraAlignmentViewedAt) <= 10 * 60 * 1000;
				if (!current && (this.state.cameraAlignmentViewed?.rear || this.state.cameraAlignmentViewed?.front)) {
					this.state.cameraAlignmentViewed = { rear: false, front: false };
					this.state.cameraAlignmentViewedAt = 0;
				}
				if (button) button.disabled = !supported || this.rideStarting || Boolean(this.state.activeRide);
				if (!output) return;
				if (!supported) {
					output.textContent = 'Camera alignment preview is unavailable in this browser or WebView.';
					return;
				}
				if (this.rideStarting || this.state.activeRide) {
					output.textContent = 'Camera alignment can be checked before the next ride.';
					return;
				}
				const viewed = this.state.cameraAlignmentViewed || {};
				if (viewed.rear && viewed.front) {
					output.textContent = 'Rear and front previews viewed · live view only · nothing was saved.';
				} else if (viewed.rear || viewed.front) {
					output.textContent = `${viewed.rear ? 'Rear' : 'Front'} preview viewed · view the ${viewed.rear ? 'front' : 'rear'} camera before setting off.`;
				} else {
					output.textContent = 'Live preview only · audio off · nothing is recorded, saved or uploaded.';
				}
			}

			resetCameraAlignmentViewed() {
				this.state.cameraAlignmentViewed = { rear: false, front: false };
				this.state.cameraAlignmentViewedAt = 0;
				this.syncCameraAlignmentSetup();
			}

			trackCameraAlignmentOperation(operation) {
				const promise = Promise.resolve(operation);
				this.cameraAlignmentOperations.add(promise);
				promise.then(
					() => this.cameraAlignmentOperations.delete(promise),
					() => this.cameraAlignmentOperations.delete(promise)
				);
				return promise;
			}

			cameraAlignmentSettlement() {
				const pending = Array.from(this.cameraAlignmentOperations);
				return pending.length ? Promise.allSettled(pending) : null;
			}

			cameraAlignmentDialogOpen() {
				return Boolean(this.dom.dialog?.open && $('[data-camera-alignment]', this.dom.dialog));
			}

			cameraAlignmentErrorCopy(status) {
				const name = String(status?.error?.name || '');
				if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access is off. Allow camera access for Halo in the phone settings, then try again.';
				if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Halo could not find the requested front and rear cameras on this phone.';
				if (name === 'NotReadableError' || name === 'AbortError') return 'The phone camera is busy or unavailable. Close other camera apps, then try again.';
				return 'Halo could not start the camera preview. Check camera permission and try again.';
			}

			cameraAlignmentDialogContent() {
				return `<div class="halo-camera-alignment" data-camera-alignment>
					<p class="halo-camera-alignment__intro"><strong>Park the bike and secure the phone before adjusting the mount.</strong> Use the guides to centre the road ahead and confirm the rider-facing view while stationary.</p>
					<div class="halo-camera-alignment__stage" data-camera-alignment-stage>
						<div class="halo-camera-alignment__placeholder" data-camera-alignment-placeholder>${icon('camera')}<span>Opening camera previews…</span></div>
						<figure class="halo-camera-alignment__view halo-camera-alignment__view--rear" data-camera-alignment-view="rear" hidden>
							<div class="halo-camera-alignment__frame"><video muted autoplay playsinline disablepictureinpicture data-camera-alignment-video="rear" aria-label="Rear road-facing camera alignment preview"></video><span class="halo-camera-alignment__guide" aria-hidden="true"><i></i></span><span class="halo-camera-alignment__label">Rear · road</span></div>
							<figcaption>Keep the road ahead and the bike's direction centred inside the full recorded frame.</figcaption>
						</figure>
						<figure class="halo-camera-alignment__view halo-camera-alignment__view--front" data-camera-alignment-view="front" hidden>
							<div class="halo-camera-alignment__frame"><video muted autoplay playsinline disablepictureinpicture data-camera-alignment-video="front" aria-label="Front rider-facing camera alignment preview"></video><span class="halo-camera-alignment__guide" aria-hidden="true"><i></i></span><span class="halo-camera-alignment__label">Front · rider</span></div>
							<figcaption>Confirm the rider remains visible without moving or loosening the mounted phone.</figcaption>
						</figure>
					</div>
					<div class="halo-camera-alignment__switch" data-camera-alignment-switch role="group" aria-label="Camera preview" hidden>
						<button type="button" class="halo-button halo-button--secondary" data-action="camera-alignment-switch" data-camera-role="rear">Rear · road</button>
						<button type="button" class="halo-button halo-button--secondary" data-action="camera-alignment-switch" data-camera-role="front">Front · rider</button>
					</div>
					<p class="halo-camera-alignment__status" data-camera-alignment-status role="status" aria-live="polite">Opening camera previews…</p>
					<button type="button" class="halo-button halo-button--secondary halo-full-width" data-action="camera-alignment-retry" hidden>Try camera preview again</button>
					<p class="halo-helper">This is an unmirrored live preview of the complete camera frame. Halo requests no microphone access, starts no recorder, stores nothing and stops every camera when this window closes or the app leaves the foreground.</p>
					<button type="button" class="halo-button halo-button--primary halo-full-width" data-action="close-dialog">Close preview</button>
				</div>`;
			}

			async openCameraAlignment() {
				if (this.rideStarting || this.state.activeRide) throw new HaloAPIError('Camera alignment can only be checked before a ride starts.');
				if (!this.cameraAlignmentSupported()) throw new HaloAPIError('Camera alignment preview is unavailable in this browser or WebView.');
				this.resetCameraAlignmentViewed();
				this.cameraAlignmentPlaybackError = '';
				this.openDialog('Check camera alignment', this.cameraAlignmentDialogContent(), 'BEFORE YOU RIDE');
				this.dom.dialog.classList.add('is-camera-alignment');
				this.cameraAlignmentDialogGeneration += 1;
				const generation = this.cameraAlignmentDialogGeneration;
				this.state.cameraAlignmentStatus = { status: 'requesting-permission', activeCameras: [], mode: 'off' };
				this.renderCameraAlignmentStatus(this.state.cameraAlignmentStatus);
				// Start inside the original button gesture so iOS may show its camera prompt.
				const operation = this.trackCameraAlignmentOperation(this.cameraAlignment.start({ preferDual: true }));
				const status = await operation;
				if (generation === this.cameraAlignmentDialogGeneration && this.cameraAlignmentDialogOpen()) this.updateCameraAlignmentStatus(status);
			}

			async retryCameraAlignment() {
				if (this.rideStarting || this.state.activeRide || !this.cameraAlignmentDialogOpen() || !this.cameraAlignmentSupported()) return;
				this.resetCameraAlignmentViewed();
				this.cameraAlignmentPlaybackError = '';
				const generation = this.cameraAlignmentDialogGeneration;
				const operation = this.trackCameraAlignmentOperation(this.cameraAlignment.start({ preferDual: true }));
				const status = await operation;
				if (generation === this.cameraAlignmentDialogGeneration && this.cameraAlignmentDialogOpen()) this.updateCameraAlignmentStatus(status);
			}

			async switchCameraAlignment(role) {
				if (this.rideStarting || this.state.activeRide || !this.cameraAlignmentDialogOpen() || !['rear', 'front'].includes(role)) return;
				this.cameraAlignmentPlaybackError = '';
				const generation = this.cameraAlignmentDialogGeneration;
				const status = await this.trackCameraAlignmentOperation(this.cameraAlignment.switchTo(role));
				if (generation === this.cameraAlignmentDialogGeneration && this.cameraAlignmentDialogOpen()) this.updateCameraAlignmentStatus(status);
			}

			updateCameraAlignmentStatus(status) {
				if (this.cameraAlignmentClosing) return;
				this.state.cameraAlignmentStatus = status || this.cameraAlignment?.getStatus?.() || null;
				this.syncCameraAlignmentSetup();
				if (this.cameraAlignmentDialogOpen()) this.renderCameraAlignmentStatus(this.state.cameraAlignmentStatus);
			}

			markCameraAlignmentFrameRendered(role, video) {
				const generation = Number(video?.dataset?.cameraAlignmentGeneration || 0);
				if (!['rear', 'front'].includes(role) || generation !== this.cameraAlignmentDialogGeneration || !this.cameraAlignmentDialogOpen()) return;
				if (!video.srcObject || Number(video.videoWidth || 0) <= 0 || Number(video.videoHeight || 0) <= 0) return;
				const playbackRecovered = this.cameraAlignmentPlaybackError === role;
				if (playbackRecovered) this.cameraAlignmentPlaybackError = '';
				if (this.state.cameraAlignmentViewed[role]) {
					if (playbackRecovered) this.renderCameraAlignmentStatus(this.state.cameraAlignmentStatus);
					return;
				}
				this.state.cameraAlignmentViewed[role] = true;
				this.state.cameraAlignmentViewedAt = Date.now();
				this.syncCameraAlignmentSetup();
				this.renderCameraAlignmentStatus(this.state.cameraAlignmentStatus);
			}

			handleCameraAlignmentPlaybackFailure(role, video, error) {
				const generation = Number(video?.dataset?.cameraAlignmentGeneration || 0);
				if (generation !== this.cameraAlignmentDialogGeneration || !this.cameraAlignmentDialogOpen() || !video?.srcObject) return;
				this.cameraAlignmentPlaybackError = role;
				this.renderCameraAlignmentStatus(this.state.cameraAlignmentStatus);
			}

			renderCameraAlignmentStatus(status) {
				const container = $('[data-camera-alignment]', this.dom.dialog);
				if (!container) return;
				const snapshot = status || this.cameraAlignment?.getStatus?.() || { status: 'idle', activeCameras: [], mode: 'off' };
				const streams = this.cameraAlignment?.getStreams?.() || { rear: null, front: null };
				const active = ['rear', 'front'].filter((role) => streams[role]);
				const visible = active.filter((role) => Boolean(this.state.cameraAlignmentViewed?.[role]));
				for (const role of ['rear', 'front']) {
					const view = $(`[data-camera-alignment-view="${role}"]`, container);
					const video = $(`[data-camera-alignment-video="${role}"]`, container);
					const stream = streams[role];
					if (view) view.hidden = !stream;
					if (!video) continue;
					const frame = video.closest('.halo-camera-alignment__frame');
					const trackSettings = stream?.getVideoTracks?.()[0]?.getSettings?.() || {};
					const frameWidth = finite(trackSettings.width);
					const frameHeight = finite(trackSettings.height);
					if (frame && frameWidth > 0 && frameHeight > 0) frame.style.aspectRatio = `${frameWidth} / ${frameHeight}`;
					else frame?.style.removeProperty('aspect-ratio');
					video.dataset.cameraAlignmentGeneration = String(this.cameraAlignmentDialogGeneration);
					if (video.dataset.cameraAlignmentPlaybackBound !== 'true') {
						video.dataset.cameraAlignmentPlaybackBound = 'true';
						const rendered = () => this.markCameraAlignmentFrameRendered(role, video);
						video.addEventListener('loadeddata', rendered);
						video.addEventListener('playing', rendered);
					}
					if (stream && video.srcObject !== stream) {
						try {
							video.muted = true;
							video.srcObject = stream;
							const playback = video.play();
							if (playback?.catch) playback.catch((error) => this.handleCameraAlignmentPlaybackFailure(role, video, error));
						} catch (error) { this.handleCameraAlignmentPlaybackFailure(role, video, error); }
					} else if (!stream && video.srcObject) {
						try { video.pause(); video.srcObject = null; } catch (error) { /* The preview is already detached. */ }
					}
				}

				const stage = $('[data-camera-alignment-stage]', container);
				stage?.classList.toggle('is-dual', active.length === 2);
				stage?.classList.toggle('is-single', active.length === 1);
				const placeholder = $('[data-camera-alignment-placeholder]', container);
				if (placeholder) {
					placeholder.hidden = active.length > 0;
					const label = $('span', placeholder);
					if (label) label.textContent = snapshot.status === 'requesting-permission' ? 'Opening camera previews…' : 'Camera preview is off';
				}

				const switcher = $('[data-camera-alignment-switch]', container);
				if (switcher) switcher.hidden = snapshot.status !== 'previewing' || active.length !== 1;
				$$('[data-action="camera-alignment-switch"]', container).forEach((button) => {
					const selected = active.length === 1 && active[0] === button.dataset.cameraRole;
					button.classList.toggle('is-active', selected);
					button.setAttribute('aria-pressed', String(selected));
					button.disabled = this.rideStarting || snapshot.status === 'requesting-permission';
				});

				const output = $('[data-camera-alignment-status]', container);
				if (output) {
					output.classList.toggle('is-warning', Boolean(this.cameraAlignmentPlaybackError) || snapshot.status === 'unavailable' || snapshot.status === 'paused-background');
					output.textContent = this.cameraAlignmentPlaybackError
						? `${this.cameraAlignmentPlaybackError === 'front' ? 'Front rider-facing' : 'Rear road-facing'} camera connected, but Halo could not display its image. Try the preview again before riding.`
						: snapshot.status === 'previewing' && active.length === 2 && visible.length === 2
							? 'Both camera previews are visible. Check each complete frame against the centre guides.'
						: snapshot.status === 'previewing' && active.length > visible.length
							? 'Camera connected. Waiting for the live image before marking this preview as viewed…'
						: snapshot.status === 'previewing' && active[0] === 'front'
							? 'Front rider-facing preview is visible. This phone previews one camera at a time; use the buttons to return to the rear view.'
							: snapshot.status === 'previewing' && active[0] === 'rear'
								? 'Rear road-facing preview is visible. This phone previews one camera at a time; use the buttons to view the front camera too.'
								: snapshot.status === 'requesting-permission' ? 'Waiting for the phone to allow camera access…'
									: snapshot.status === 'paused-background' ? 'Camera preview stopped when Halo left the foreground. Return here and try again while stationary.'
										: snapshot.status === 'unavailable' ? this.cameraAlignmentErrorCopy(snapshot)
											: 'Camera preview is off.';
				}
				const retry = $('[data-action="camera-alignment-retry"]', container);
				if (retry) retry.hidden = !this.cameraAlignmentPlaybackError && !['unavailable', 'paused-background'].includes(snapshot.status);
			}

			closeCameraAlignment(reason) {
				const hasPreview = Boolean(this.cameraAlignment?.active || this.cameraAlignmentOperations.size || this.state.cameraAlignmentStatus || this.cameraAlignmentDialogOpen());
				this.dom.dialog?.classList.remove('is-camera-alignment');
				if (!hasPreview) return;
				this.cameraAlignmentClosing = true;
				this.cameraAlignmentDialogGeneration += 1;
				for (const video of $$('[data-camera-alignment-video]', this.dom.dialog)) {
					try { video.pause(); video.srcObject = null; } catch (error) { /* The preview is already detached. */ }
				}
				this.cameraAlignment?.stop?.(reason || 'alignment-closed');
				this.cameraAlignmentPlaybackError = '';
				this.state.cameraAlignmentStatus = null;
				this.cameraAlignmentClosing = false;
				this.syncCameraAlignmentSetup();
			}

			renderAll() {
			this.updateProfileMark();
			this.renderHome();
			this.renderVehicle();
			this.renderActivity();
			this.renderMore();
			this.renderCommunity();
			this.renderSafety();
			this.renderDocuments();
			this.renderManual();
			this.renderBoutique();
			this.renderProfile();
			this.updateVehicleConnection();
			this.updateCartCount();
				this.updateRoutePreferenceLabel();
				this.syncRideSetup();
				this.syncRideMemorySetup();
				this.syncCameraAlignmentSetup();
				this.applyOfflineSnapshotMode();
		}

		applyOfflineSnapshotMode() {
			const offlineSnapshot = Boolean(this.state.boot?.offline_snapshot);
			root.classList.toggle('is-offline-snapshot', offlineSnapshot);
			const formSelectors = [
				...Array.from(freshAccountForms, (id) => `#${id} input, #${id} select, #${id} textarea, #${id} button`),
				'#halo-document-file', '#halo-vehicle-photo-file'
			].join(',');
			$$(`${formSelectors}, [data-action]`, root)
				.filter((control) => !control.dataset.action || freshAccountActions.has(control.dataset.action))
				.forEach((control) => {
					const uploadLabel = control.closest('.halo-upload-zone, .halo-file-button');
					if (offlineSnapshot && !control.disabled) {
						control.disabled = true;
						control.dataset.offlineDisabled = 'true';
						if (uploadLabel) {
							uploadLabel.classList.add('is-offline-disabled');
							uploadLabel.setAttribute('aria-disabled', 'true');
						}
					} else if (!offlineSnapshot && control.dataset.offlineDisabled === 'true') {
						control.disabled = false;
						delete control.dataset.offlineDisabled;
						if (uploadLabel) {
							uploadLabel.classList.remove('is-offline-disabled');
							uploadLabel.removeAttribute('aria-disabled');
						}
					}
				});
		}

		navigate(route, options) {
			const settings = Object.assign({ history: true, focus: true }, options || {});
			const view = $(`[data-route="${CSS.escape(route)}"]`, root);
			if (!view) return;
			if (route !== 'ride' && this.cameraAlignmentDialogOpen()) {
				this.closeCameraAlignment('route-changed');
				this.dom.dialog.close();
			}
			this.state.route = route;
			$$('.halo-view[data-route]', root).forEach((section) => {
				const active = section === view;
				section.hidden = !active;
				section.classList.toggle('is-active', active);
			});
			const primary = routeRoot(route);
			$$('.halo-bottom-nav [data-route-target]', root).forEach((button) => {
				const active = button.dataset.routeTarget === primary;
				button.classList.toggle('is-active', active);
				if (active) button.setAttribute('aria-current', 'page');
				else button.removeAttribute('aria-current');
			});
			if (settings.history) {
				const nextUrl = `${window.location.href.split('#')[0]}#halo/${encodeURIComponent(route)}`;
				window.history.pushState({ haloRoute: route }, '', nextUrl);
			}
			if (settings.focus) {
				if (!view.hasAttribute('tabindex')) view.tabIndex = -1;
				window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
				window.setTimeout(() => view.focus({ preventScroll: true }), 30);
			}
			if (route === 'ride') this.initialisePlannerMap();
			if (route === 'activity' && !this.state.ridesLoaded) this.loadRides();
			if (route === 'more/documents' && !this.state.documentsLoaded) this.loadDocuments();
			if (route === 'more/manual' && !this.getManualSections().length) this.loadManual();
			if (route === 'more/boutique' && !this.state.productsLoaded) this.loadProducts();
			if (route === 'more/community') this.ensureCommunity().catch((error) => this.handleCommunityLoadError(error));
		}

		async handleClick(event) {
			const target = event.target.closest('button, a[data-action]');
			if (!target || !root.contains(target) || target.disabled) return;

			if (target.dataset.routeTarget) {
				event.preventDefault();
				if (target.dataset.vehicleView) { this.state.vehicleView = target.dataset.vehicleView; this.renderVehicle(); }
				if (target.dataset.action === 'close-dialog' && this.dom.dialog.open) this.dom.dialog.close();
				this.navigate(target.dataset.routeTarget);
				return;
			}
			if (target.dataset.authView) {
				event.preventDefault();
				this.selectAuthView(target.dataset.authView);
				return;
			}
			if (target.dataset.vehicleView) {
				event.preventDefault();
				this.state.vehicleView = target.dataset.vehicleView;
				$$('[data-vehicle-view]', root).forEach((button) => button.classList.toggle('is-active', button === target));
				this.renderVehicle();
				return;
			}
			if (target.matches('.halo-accordion-button')) {
				event.preventDefault();
				const panel = document.getElementById(target.getAttribute('aria-controls'));
				const expanded = target.getAttribute('aria-expanded') === 'true';
				target.setAttribute('aria-expanded', String(!expanded));
				if (panel) panel.hidden = expanded;
				return;
			}
			if (target.dataset.routeIndex !== undefined) {
				this.selectRoute(Number(target.dataset.routeIndex));
				return;
			}
			if (target.dataset.rideId) {
				event.preventDefault();
				try { await this.openRideDetail(target.dataset.rideId); }
				catch (error) { this.handleError(error); }
				return;
			}

			const action = target.dataset.action;
			if (!action) return;
			event.preventDefault();
			try {
				if (freshAccountActions.has(action)) await this.requireFreshAccount();
					switch (action) {
					case 'retry-bootstrap': await this.bootstrap(); break;
					case 'reset-device-session': await this.resetDeviceSession(target); break;
					case 'passkey-login': await this.loginWithPasskey(target); break;
					case 'register-passkey': await this.registerPasskey(target); break;
					case 'connection-detail': this.openConnectionDetail(); break;
					case 'connect-ecu': await this.connectEcu(target); break;
					case 'disconnect-ecu': await this.disconnectEcu(target); break;
					case 'connect-bms': await this.connectBms(target); break;
					case 'disconnect-bms': await this.disconnectBms(target); break;
					case 'close-dialog':
						if (this.cameraAlignmentDialogOpen()) this.closeCameraAlignment('dialog-closed');
						this.dom.dialog.close();
						break;
					case 'close-sheet': this.dom.sheet.close(); break;
					case 'recenter-map': await this.useCurrentLocation(true); break;
					case 'plan-route': await this.submitRouteForm(target.closest('#halo-route-form')); break;
					case 'check-camera-alignment': await this.openCameraAlignment(); break;
					case 'camera-alignment-retry': await this.retryCameraAlignment(); break;
					case 'camera-alignment-switch': await this.switchCameraAlignment(target.dataset.cameraRole); break;
					case 'ride-recenter': await this.recenterRideMap(); break;
					case 'ride-overview': await this.overviewRideMap(); break;
					case 'share-live-location': await this.shareLiveLocation(target); break;
					case 'reshare-live-location': await this.reshareLiveLocation(target); break;
					case 'stop-live-location': await this.stopLiveTracking(true, target); break;
						case 'replace-live-location': await this.replaceLiveTracking(target); break;
						case 'create-another-live-location': this.dom.sheet.close(); await this.shareLiveLocation(target, true); break;
						case 'end-all-live-location': await this.endAllLiveTracking(true, target); break;
						case 'request-guardian-location': await this.requestGuardianRecovery(target); break;
						case 'guardian-resume': await this.resumeGuardianLocation(target); break;
						case 'dismiss-guardian-resume': this.dismissGuardianResumePrompt(); break;
						case 'stop-guardian-resume': await this.stopGuardianResumeTracking(true, target); break;
					case 'end-ride-now': this.dom.dialog.close(); await this.endRide(); break;
					case 'use-current-location': await this.useCurrentLocation(false); break;
					case 'open-route-preferences': this.openRoutePreferences(); break;
					case 'start-guidance': await this.startGuidance(target); break;
					case 'start-free-ride': await this.startFreeRide(target); break;
					case 'report-hazard': this.openHazardSheet(); break;
					case 'submit-hazard': await this.submitHazard(target.dataset.hazardType, target); break;
					case 'cancel-crash': await this.cancelCrashAlert(); break;
					case 'send-nok-now': await this.activateCrashAlert('manual', target); break;
					case 'close-emergency-assist': this.clearCrashState({ preserveIncident: true, keepPhase: true }); break;
					case 'test-nok': await this.sendNokAlert(true, target); break;
					case 'simulate-crash': this.showCrashState({ simulation: true, countdown_seconds: 20 }); break;
					case 'withdraw-assist-consent': await this.withdrawSafetyConsent('assist', target); break;
					case 'withdraw-medical-consent': await this.withdrawSafetyConsent('medical', target); break;
					case 'withdraw-camera-consent': await this.withdrawSafetyConsent('camera', target); break;
					case 'retry-incident-camera': this.retryIncidentCameraUpload(); break;
					case 'open-cart': await this.openCart(); break;
					case 'add-to-cart': await this.addToCart(target.dataset.productId, target); break;
					case 'remove-cart-item': await this.removeCartItem(target.dataset.lineId, target); break;
					case 'checkout': await this.checkout(target); break;
					case 'upload-document': $('#halo-document-file', root)?.click(); break;
					case 'upload-vehicle-photo': $('#halo-vehicle-photo-file', root)?.click(); break;
					case 'open-document': await this.openDocument(target.dataset.documentId); break;
					case 'delete-document': this.confirmDeleteDocument(target.dataset.documentId); break;
					case 'confirm-delete-document': await this.deleteDocument(target.dataset.documentId, target); break;
					case 'open-link': this.openConfiguredLink(target.dataset.linkKey); break;
					case 'add-approved-used': this.openApprovedUsedForm(); break;
					case 'vehicle-security': this.openVehicleSecurity(); break;
					case 'security-command': await this.sendSecurityCommand(target.dataset.command, target); break;
						case 'share-diagnostics': await this.shareDiagnostics(target); break;
						case 'contact-support': this.contactSupport(); break;
						case 'share-ride': await this.shareRide(target.dataset.shareRideId, target); break;
						case 'open-ride-memory': await this.openRideMemory(target.dataset.memoryRideId); break;
						case 'recover-ride-memory': this.confirmRecoverRideMemory(target.dataset.memoryRideId); break;
						case 'confirm-recover-ride-memory': await this.recoverRideMemory(target.dataset.memoryRideId, target); break;
						case 'delete-ride-memory': this.confirmDeleteRideMemory(target.dataset.memoryRideId); break;
						case 'confirm-delete-ride-memory': await this.deleteRideMemory(target.dataset.memoryRideId, target); break;
						case 'ride-memory-camera': await this.switchRideMemoryCamera(target.dataset.memoryCamera); break;
						case 'ride-memory-previous': await this.stepRideMemory(-1); break;
						case 'ride-memory-next': await this.stepRideMemory(1); break;
						case 'ride-memory-telemetry-toggle': this.toggleRideMemoryTelemetry(); break;
						case 'ride-memory-export': await this.exportRideMemoryClip(target); break;
						case 'install-app': await this.installApp(target); break;
					case 'welcome-pack': await this.openWelcomePack(target); break;
					case 'retry-manual': await this.loadManual(); break;
					case 'retry-products': await this.loadProducts(); break;
					case 'community-tab': await this.openCommunityTab(target.dataset.communityTab); break;
					case 'community-clear-search': this.state.community.memberSearch = ''; await this.loadCommunityMembers(); break;
					case 'community-retry': await this.ensureCommunity(true); break;
					case 'community-refresh': await this.refreshCommunitySection(); break;
					case 'community-create-thread': this.openCommunityThreadComposer(); break;
					case 'community-open-thread': await this.openCommunityThread(target.dataset.threadId); break;
					case 'community-back-threads': this.state.community.activeThread = null; this.renderCommunity(); break;
					case 'community-open-member': await this.openCommunityMember(target.dataset.memberId); break;
					case 'community-new-dm': this.openCommunityNewDm(target.dataset.memberId); break;
					case 'community-open-conversation': await this.openCommunityConversation(target.dataset.conversationId); break;
					case 'community-back-conversations': this.state.community.activeConversation = null; this.renderCommunity(); break;
					case 'community-block-member': await this.setCommunityBlock(target.dataset.memberId, true, target); break;
					case 'community-unblock-member': await this.setCommunityBlock(target.dataset.memberId, false, target); break;
					case 'community-report': this.openCommunityReport(target.dataset.reportType, target.dataset.reportId); break;
					case 'community-leave': this.confirmLeaveCommunity(); break;
					case 'community-confirm-leave': await this.leaveCommunity(target); break;
					case 'logout': this.confirmLogout(); break;
					case 'confirm-logout': await this.logout(target); break;
					case 'session-sign-in': this.dom.dialog.close(); this.state.isSessionExpired = false; this.state.sessionExpiryDeferred = false; this.api.setCSRF(''); await this.showAuth('login'); break;
					case 'refresh-vehicle': await this.refreshVehicleStatus(true); break;
					default: break;
				}
			} catch (error) {
				this.handleError(error);
			}
		}

		async handleSubmit(event) {
			const form = event.target;
			if (!(form instanceof HTMLFormElement) || !root.contains(form)) return;
				const handled = ['halo-login-form', 'halo-signup-form', 'halo-recovery-form', 'halo-route-form', 'halo-manual-search', 'halo-safety-form', 'halo-profile-form', 'halo-pin-form', 'halo-ride-profile-form', 'halo-approved-used-form', 'halo-route-preferences-form', 'halo-community-profile-form', 'halo-community-member-search', 'halo-community-thread-form', 'halo-community-reply-form', 'halo-community-new-dm-form', 'halo-community-message-form', 'halo-community-report-form', 'halo-live-share-form'];
			if (!handled.includes(form.id)) return;
			event.preventDefault();
			event.stopPropagation();
			if (!form.reportValidity()) return;
			try {
				if (freshAccountForms.has(form.id)) await this.requireFreshAccount();
				if (form.id === 'halo-login-form') await this.submitAuth(form, 'login');
				else if (form.id === 'halo-signup-form') await this.submitAuth(form, 'signup');
				else if (form.id === 'halo-recovery-form') await this.submitRecovery(form);
				else if (form.id === 'halo-route-form') await this.planRoute(form);
				else if (form.id === 'halo-manual-search') this.renderManual();
				else if (form.id === 'halo-safety-form') await this.saveSafety(form);
				else if (form.id === 'halo-profile-form') await this.saveProfile(form);
				else if (form.id === 'halo-pin-form') await this.changePin(form);
				else if (form.id === 'halo-ride-profile-form') await this.saveRideProfile(form);
				else if (form.id === 'halo-approved-used-form') await this.submitApprovedUsed(form);
				else if (form.id === 'halo-route-preferences-form') await this.saveRoutePreferences(form);
				else if (form.id === 'halo-community-profile-form') await this.saveCommunityProfile(form);
				else if (form.id === 'halo-community-member-search') await this.searchCommunityMembers(form);
				else if (form.id === 'halo-community-thread-form') await this.createCommunityThread(form);
				else if (form.id === 'halo-community-reply-form') await this.replyToCommunityThread(form);
					else if (form.id === 'halo-community-new-dm-form') await this.createCommunityConversation(form);
					else if (form.id === 'halo-community-message-form') await this.sendCommunityMessage(form);
					else if (form.id === 'halo-community-report-form') await this.submitCommunityReport(form);
					else if (form.id === 'halo-live-share-form') await this.createLiveTracking(form);
			} catch (error) {
				this.handleError(error, form.closest('.halo-auth') ? 'auth' : 'toast');
			}
		}

		handleInput(event) {
			const input = event.target;
			if (input.matches('[data-pin-input]')) {
				const clean = input.value.replace(/\D/g, '').slice(0, 6);
				if (input.value !== clean) input.value = clean;
				input.setAttribute('aria-invalid', String(Boolean(clean && clean.length !== 6)));
			}
			if (input.id === 'halo-manual-query') {
				this.state.manualQuery = input.value;
				this.renderManual();
			}
			if (input.matches('#halo-route-form [name="start_soc"]')) {
				input.dataset.userAdjusted = 'true';
				const output = $('[data-start-soc-output]', root);
				if (output) output.textContent = `${Math.round(clamp(input.value, 5, 100))}%`;
				this.updateStartingChargeSurfaces();
				if (this.state.routes.length) this.renderRouteResults();
			}
		}

		async handleChange(event) {
			const input = event.target;
			if (input.id === 'halo-document-file' && input.files && input.files[0]) {
				try { await this.requireFreshAccount(); await this.uploadDocument(input.files[0], input); }
				catch (error) { this.handleError(error); }
			}
				if (input.id === 'halo-vehicle-photo-file' && input.files && input.files[0]) {
					try { await this.requireFreshAccount(); await this.uploadVehiclePhoto(input.files[0], input); }
					catch (error) { this.handleError(error); }
				}
				if (input.matches('#halo-live-share-form [name="guardian_recovery_enabled"]')) {
					const form = input.closest('#halo-live-share-form');
					const details = $('[data-guardian-setup-details]', form);
					const label = form?.elements.guardian_label;
					if (details) details.hidden = !input.checked;
					if (label) {
						label.disabled = !input.checked;
						label.required = input.checked;
						if (input.checked) window.setTimeout(() => label.focus(), 30);
					}
				}
					if (input.matches('#halo-safety-form [name="incident_camera_enabled"]')) {
						const dual = input.form?.elements.incident_camera_dual_enabled;
						if (dual) {
							dual.disabled = !input.checked;
							if (!input.checked) dual.checked = false;
						}
					}
					if (input.matches('#halo-route-form [name="ride_memories_enabled"], #halo-route-form [name="ride_memories_dual_enabled"]')) {
						const form = input.closest('#halo-route-form');
						const enabled = form?.elements.ride_memories_enabled;
						const dual = form?.elements.ride_memories_dual_enabled;
						const dualSetting = $('[data-ride-memory-dual-setting]', form);
						if (dual) {
							dual.disabled = !enabled?.checked;
							if (!enabled?.checked) dual.checked = false;
						}
						if (dualSetting) dualSetting.hidden = !enabled?.checked;
						this.saveRideMemoryPreferences({ enabled: Boolean(enabled?.checked), dual: Boolean(enabled?.checked && dual?.checked) });
						this.refreshRideMemoryStorageStatus().catch(() => null);
					}
				}

		handleImageError(event) {
			const image = event.target;
			if (!(image instanceof HTMLImageElement) || !image.matches('.halo-bike-visual img')) return;
			const fallback = safeUrl(image.dataset.fallbackSrc, ['https:']);
			if (fallback && image.dataset.fallbackUsed !== 'true' && fallback !== image.src) {
				image.dataset.fallbackUsed = 'true';
				image.src = fallback;
				return;
			}
			const canonical = safeUrl(image.dataset.canonicalSrc, ['https:']);
			if (canonical && image.dataset.canonicalUsed !== 'true' && canonical !== image.src) {
				image.dataset.canonicalUsed = 'true';
				image.src = canonical;
				return;
			}
			const silhouette = document.createElement('div');
			silhouette.className = 'halo-bike-silhouette';
			silhouette.setAttribute('aria-hidden', 'true');
			image.replaceWith(silhouette);
		}

		formObject(form) {
			const result = {};
			new FormData(form).forEach((value, key) => {
				if (Object.prototype.hasOwnProperty.call(result, key)) result[key] = [].concat(result[key], value);
				else result[key] = value;
			});
			$$('input[type="checkbox"]', form).forEach((input) => { result[input.name] = input.checked; });
			return result;
		}

		setLoading(element, loading) {
			const button = element && (element.matches('button') ? element : $('button[type="submit"]', element));
			if (!button) return;
			button.classList.toggle('is-loading', loading);
			button.disabled = loading;
			if (loading) button.setAttribute('aria-busy', 'true');
			else button.removeAttribute('aria-busy');
		}

		async submitAuth(form, action) {
			const scope = this.captureIdentityScope();
			const values = this.formObject(form);
			if (!isSixDigitPin(values.pin)) {
				this.setAuthAlert('Enter a six-digit PIN.');
				form.querySelector('[name="pin"]')?.focus();
				return;
			}
			if (action === 'signup' && values.pin !== values.confirm_pin) {
				this.setAuthAlert('The two six-digit PINs do not match.');
				form.querySelector('[name="confirm_pin"]')?.focus();
				return;
			}
			if (action === 'signup') {
				const verification = $('[data-registration-verification]', form);
				if (verification && !verification.hidden && !/^\d{6}$/.test(text(values.verification_code))) {
					this.setAuthAlert('Enter the six-digit code sent to your email address.');
					form.querySelector('[name="verification_code"]')?.focus();
					return;
				}
				values.terms_accepted = Boolean(values.terms);
				values.privacy_acknowledged = Boolean(values.terms);
			}
			this.setLoading(form, true);
			this.setAuthAlert('');
			try {
				const endpoint = action === 'signup' ? '/auth/register' : '/auth/login';
				const response = await this.api.post(endpoint, values);
				this.assertIdentityScope(scope);
				if (action === 'signup' && (response.verification_required || response.requires_verification)) {
					const verification = $('[data-registration-verification]', form);
					const codeInput = form.querySelector('[name="verification_code"]');
					if (verification) verification.hidden = false;
					if (codeInput) codeInput.required = true;
					const copy = $('[data-registration-verification-copy]', form);
					if (copy && response.message) copy.textContent = response.message;
					const submit = $('button[type="submit"]', form);
					if (submit) submit.textContent = 'Verify and create account';
					this.setAuthAlert(response.message || 'Enter the verification code sent to your email address.', true);
					window.setTimeout(() => codeInput?.focus(), 30);
					return;
				}
				const expectedCustomerId = response.customer?.id ?? response.user?.id ?? response.profile?.id ?? null;
				if (!/^[1-9]\d*$/.test(String(expectedCustomerId || ''))) {
					throw new HaloAPIError('Halo accepted the sign-in but could not confirm which customer it belongs to. Please try again.', 409, 'login_identity_unconfirmed');
				}
				if (response.csrf) this.api.setCSRF(response.csrf);
				await this.bootstrap({ silent: true, requireAuthenticated: true, expectedCustomerId });
				form.reset();
				if (action === 'signup') {
					const verification = $('[data-registration-verification]', form);
					const codeInput = form.querySelector('[name="verification_code"]');
					if (verification) verification.hidden = true;
					if (codeInput) codeInput.required = false;
					const submit = $('button[type="submit"]', form);
					if (submit) submit.textContent = 'Create account';
				}
				const resetDeviceButton = $('[data-reset-device-session]', root);
				if (resetDeviceButton) resetDeviceButton.hidden = true;
				if (this.identityCustomerId) this.broadcastIdentityChange('authenticated');
			} finally {
				this.setLoading(form, false);
			}
		}

		async resetDeviceSession(button) {
			this.setLoading(button, true);
			try {
				await this.api.post('/auth/reset-device', {});
				this.clearPendingEmergency();
				this.broadcastIdentityChange('logout');
				await this.showAuth('login');
				button.hidden = true;
				this.setAuthAlert('This device session is reset. You can sign in safely now.', true);
			} finally {
				this.setLoading(button, false);
			}
		}

		async submitRecovery(form) {
			const scope = this.captureIdentityScope();
			this.setLoading(form, true);
			this.setAuthAlert('');
			try {
				await this.api.post('/auth/recover', this.formObject(form));
				this.assertIdentityScope(scope);
				form.reset();
				this.setAuthAlert('If that email matches a Halo account, reset instructions are on their way.', true);
			} finally { this.setLoading(form, false); }
		}

		base64UrlToBytes(value) {
			const base64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
			const binary = window.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
			return Uint8Array.from(binary, (char) => char.charCodeAt(0));
		}

		bytesToBase64Url(value) {
			const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer || value);
			let binary = '';
			bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
			return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
		}

		prepareCredentialOptions(options) {
			const prepared = Object.assign({}, options);
			if (prepared.challenge && typeof prepared.challenge === 'string') prepared.challenge = this.base64UrlToBytes(prepared.challenge);
			if (prepared.user?.id && typeof prepared.user.id === 'string') prepared.user = Object.assign({}, prepared.user, { id: this.base64UrlToBytes(prepared.user.id) });
			if (Array.isArray(prepared.allowCredentials)) prepared.allowCredentials = prepared.allowCredentials.map((item) => Object.assign({}, item, { id: typeof item.id === 'string' ? this.base64UrlToBytes(item.id) : item.id }));
			if (Array.isArray(prepared.excludeCredentials)) prepared.excludeCredentials = prepared.excludeCredentials.map((item) => Object.assign({}, item, { id: typeof item.id === 'string' ? this.base64UrlToBytes(item.id) : item.id }));
			return prepared;
		}

		credentialJSON(credential) {
			const result = { id: credential.id, type: credential.type, rawId: this.bytesToBase64Url(credential.rawId), response: {}, clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {} };
			['clientDataJSON', 'attestationObject', 'authenticatorData', 'signature', 'userHandle'].forEach((key) => {
				if (credential.response && credential.response[key]) result.response[key] = this.bytesToBase64Url(credential.response[key]);
			});
			if (credential.response && typeof credential.response.getTransports === 'function') result.response.transports = credential.response.getTransports();
			return result;
		}

		async loginWithPasskey(button) {
			const scope = this.captureIdentityScope();
			if (!window.PublicKeyCredential || !navigator.credentials) throw new HaloAPIError('Passkeys are not supported on this device.');
			const endpoints = CONFIG.passkeyEndpoints || {};
			if (!endpoints.loginOptions || !endpoints.loginVerify) throw new HaloAPIError('Passkey sign-in is not configured for Halo.');
			this.setLoading(button, true);
			try {
				const email = $('#halo-login-form [name="email"]', root)?.value || '';
				const options = await this.api.post(endpoints.loginOptions, { email });
				this.assertIdentityScope(scope);
				const credential = await navigator.credentials.get({ publicKey: this.prepareCredentialOptions(options.publicKey || options) });
				this.assertIdentityScope(scope);
				if (!credential) throw new HaloAPIError('Passkey sign-in was cancelled.', 0, 'cancelled');
				const response = await this.api.post(endpoints.loginVerify, { credential: this.credentialJSON(credential) });
				this.assertIdentityScope(scope);
				if (response.bootstrap) { await this.acceptBootstrap(response.bootstrap); this.showProduct(); }
				else await this.bootstrap();
				if (this.identityCustomerId) this.broadcastIdentityChange('authenticated');
			} catch (error) {
				if (error.name === 'NotAllowedError') throw new HaloAPIError('Passkey sign-in was cancelled or timed out.');
				throw error;
			} finally { this.setLoading(button, false); }
		}

		async registerPasskey(button) {
			const scope = this.captureIdentityScope();
			if (!window.PublicKeyCredential || !navigator.credentials) throw new HaloAPIError('Passkeys are not supported on this device.');
			const endpoints = CONFIG.passkeyEndpoints || {};
			if (!endpoints.registerOptions || !endpoints.registerVerify) throw new HaloAPIError('Passkey setup is not configured for Halo.');
			this.setLoading(button, true);
			try {
				const options = await this.api.post(endpoints.registerOptions, {});
				this.assertIdentityScope(scope);
				const credential = await navigator.credentials.create({ publicKey: this.prepareCredentialOptions(options.publicKey || options) });
				this.assertIdentityScope(scope);
				if (!credential) throw new HaloAPIError('Passkey setup was cancelled.');
				await this.api.post(endpoints.registerVerify, { credential: this.credentialJSON(credential) });
				this.assertIdentityScope(scope);
				this.toast('Passkey added to your Halo account.', 'success');
			} catch (error) {
				if (error.name === 'NotAllowedError') throw new HaloAPIError('Passkey setup was cancelled or timed out.');
				throw error;
			} finally { this.setLoading(button, false); }
		}

		vehicleName() {
			const vehicle = this.state.vehicle || {};
			return text(vehicle.display_name || vehicle.name || vehicle.model, 'Your Avenrà');
		}

		profileMarkForVehicle(vehicle) {
			const marks = isObject(CONFIG.profileMarks) ? CONFIG.profileMarks : {};
			const fallback = safeUrl(marks.default, ['https:']);
			const source = vehicle || {};
			const model = text(source.model || source.model_name || source.bike_model || source.display_name || source.name || source.product_name).toUpperCase();
			let key = 'default';
			if (/\bEVO\b/.test(model)) key = 'evo';
			else if (/\bONE\b/.test(model)) key = 'one';
			return {
				key,
				url: safeUrl(marks[key], ['https:']) || fallback,
				fallback
			};
		}

		updateProfileMark() {
			const image = $('[data-profile-mark]', root);
			if (!image) return;
			const mark = this.profileMarkForVehicle(this.state.vehicle);
			image.dataset.profileMark = mark.key;
			image.onerror = () => {
				image.onerror = null;
				if (mark.fallback && image.src !== mark.fallback) {
					image.dataset.profileMark = 'default';
					image.src = mark.fallback;
				}
			};
			if (!mark.url) {
				image.removeAttribute('src');
				return;
			}
			if (image.src !== mark.url) image.src = mark.url;
		}

		vehicleBattery() {
			const vehicle = this.state.vehicle || {};
			const battery = isObject(vehicle.battery) ? vehicle.battery : {};
			const liveBms = this.state.bms?.live && isObject(this.state.bms?.telemetry) ? this.state.bms.telemetry : {};
			return {
				soc: nullableFinite(liveBms.soc ?? battery.soc ?? battery.percentage ?? vehicle.battery_percentage ?? (typeof vehicle.battery === 'number' ? vehicle.battery : null)),
				range: finite(battery.range_miles ?? vehicle.range_miles ?? vehicle.estimated_range_miles),
				health: battery.health_label || battery.health || vehicle.battery_health || '',
				status: liveBms.soc !== undefined ? 'HyperCore BMS live' : (battery.status || vehicle.charge_status || ''),
				timeToFull: battery.time_to_full || vehicle.time_to_full || '',
				voltage: nullableFinite(liveBms.voltage),
				current: nullableFinite(liveBms.current),
				powerKw: nullableFinite(liveBms.powerKw),
				maxTemperature: nullableFinite(liveBms.maxTemperature)
			};
		}

		syncRideSetup() {
			const form = $('#halo-route-form', root);
			const socInput = $('[name="start_soc"]', form);
			if (socInput) {
				const batterySoc = this.vehicleBattery().soc;
				if (socInput.dataset.userAdjusted !== 'true') {
					const startingSoc = batterySoc === null ? finite(socInput.defaultValue) ?? 100 : batterySoc;
					socInput.value = String(Math.round(clamp(startingSoc, 5, 100)));
				}
				const output = $('[data-start-soc-output]', form);
				if (output) output.textContent = `${Math.round(clamp(socInput.value, 5, 100))}%`;
			}
			this.updateStartingChargeSurfaces();
			const hypercorePairing = [this.state.ecu?.status, this.state.bms?.status]
				.some((status) => ['scanning', 'connecting'].includes(status));
			$$('[data-action="start-guidance"], [data-action="start-free-ride"]', root).forEach((button) => {
				button.disabled = this.rideStarting || hypercorePairing || !this.rideEngine.available;
			});
		}

		startingChargeLabel() {
			const input = $('#halo-route-form [name="start_soc"]', root);
			const batterySoc = this.vehicleBattery().soc;
			if (input?.dataset.userAdjusted !== 'true' && batterySoc === null) return 'Set manually';
			const value = nullableFinite(input?.value) ?? batterySoc;
			return value === null ? 'Set manually' : `${Math.round(clamp(value, 5, 100))}%`;
		}

		updateStartingChargeSurfaces() {
			const label = this.startingChargeLabel();
			$$('[data-bms-effective-start-charge]', root).forEach((element) => { element.textContent = label; });
		}

		rideSetup() {
			const form = $('#halo-route-form', root);
			const batterySoc = this.vehicleBattery().soc;
			return {
				mode: clamp($('[name="ride_mode"]', form)?.value || 2, 1, 3),
				soc: clamp($('[name="start_soc"]', form)?.value || batterySoc || 100, 5, 100)
			};
		}

		estimatedArrivalSoc(route) {
			if (!route) return null;
			const setup = this.rideSetup();
			const consumption = finite(route.consumption_percent ?? route.estimated_consumption_percent ?? route.soc_used);
			if (consumption !== null) return clamp(setup.soc - consumption, 0, 100);
			const battery = this.vehicleBattery();
			const distance = finite(route.distance_miles);
			if (distance !== null && battery.range !== null && battery.range > 0 && battery.soc !== null && battery.soc > 0) {
				const fullRange = battery.range / (battery.soc / 100);
				return clamp(setup.soc - ((distance / fullRange) * 100), 0, 100);
			}
			return finite(route.arrival_soc ?? route.estimated_arrival_soc);
		}

		connectionState() {
			const vehicle = this.state.vehicle || {};
			const connection = isObject(vehicle.connection) ? vehicle.connection : {};
			const status = text(connection.status || vehicle.connection_status || vehicle.connection, '').toLowerCase();
			const hypercore = this.hypercoreConnectionState();
			if (hypercore.liveCount > 0) {
				return {
					connected: true,
					status: hypercore.status,
					lastSeen: hypercore.lastSeen,
					source: 'HyperCore',
					ecu: Boolean(this.state.ecu?.connected),
					ecuStatus: text(this.state.ecu?.status),
					bms: Boolean(this.state.bms?.connected),
					bmsStatus: text(this.state.bms?.status)
				};
			}
			return {
				connected: ['connected', 'online', 'live'].includes(status) || connection.connected === true,
				status,
				lastSeen: connection.last_seen || vehicle.last_seen || hypercore.lastSeen || '',
				source: connection.source || '',
				ecu: Boolean(this.state.ecu?.connected),
				ecuStatus: text(this.state.ecu?.status),
				bms: Boolean(this.state.bms?.connected),
				bmsStatus: text(this.state.bms?.status)
			};
		}

		hypercoreConnectionState() {
			const ecu = this.state.ecu || {};
			const bms = this.state.bms || {};
			const components = [ecu, bms];
			const liveCount = components.filter((component) => component.live).length;
			const connectedCount = components.filter((component) => component.connected).length;
			const statuses = components.map((component) => text(component.status, component.supported ? 'idle' : 'unavailable'));
			const busy = statuses.some((status) => ['scanning', 'connecting', 'reconnecting', 'waiting-for-data'].includes(status));
			const attention = statuses.some((status) => ['stale', 'error'].includes(status));
			const unsupportedCount = components.filter((component) => component.supported === false).length;
			const lastSeenCandidates = [ecu.telemetry?.measuredAt, bms.telemetry?.measuredAt].filter(Boolean).sort();
			let summary = { status: 'offline', label: 'HyperCore offline', badge: 'Offline', badgeClass: '', connected: false };
			if (liveCount === 2) summary = { status: 'live', label: 'HyperCore live', badge: 'Live', badgeClass: 'halo-badge--good', connected: true };
			else if (busy) summary = { status: 'connecting', label: 'HyperCore connecting', badge: 'Connecting', badgeClass: '', connected: connectedCount > 0 };
			else if (liveCount === 1) summary = { status: 'partial', label: 'HyperCore partial', badge: 'Partial', badgeClass: 'halo-badge--attention', connected: true };
			else if (attention || connectedCount > 0) summary = { status: 'attention', label: 'HyperCore check', badge: 'Check', badgeClass: 'halo-badge--attention', connected: connectedCount > 0 };
			else if (unsupportedCount === 2) summary = { status: 'unavailable', label: 'HyperCore unavailable', badge: 'Unavailable', badgeClass: 'halo-badge--attention', connected: false };
			return Object.assign(summary, {
				liveCount,
				connectedCount,
				lastSeen: lastSeenCandidates[lastSeenCandidates.length - 1] || '',
				ecuLive: Boolean(ecu.live),
				bmsLive: Boolean(bms.live)
			});
		}

		updateVehicleConnection() {
			const button = $('.halo-status-pill', root);
			const label = $('[data-vehicle-connection]', root);
			if (!button || !label) return;
			button.classList.remove('is-connected', 'is-attention', 'is-connecting');
			if (this.state.lifecycle !== 'owner' || !this.state.vehicle) {
				const stateLabel = this.state.lifecycle === 'pre-delivery' ? 'In build' : 'Halo ready';
				label.textContent = stateLabel;
				button.setAttribute('aria-label', `Vehicle connection: ${stateLabel}`);
				return;
			}
			const hypercore = this.hypercoreConnectionState();
			if (hypercore.status === 'live') {
				button.classList.add('is-connected');
				label.textContent = hypercore.label;
				button.setAttribute('aria-label', 'HyperCore connection: ECU and BMS live');
			} else if (hypercore.status === 'connecting') {
				button.classList.add('is-connecting');
				label.textContent = hypercore.label;
				button.setAttribute('aria-label', 'HyperCore connection in progress');
			} else if (['partial', 'attention'].includes(hypercore.status)) {
				button.classList.add('is-attention');
				label.textContent = hypercore.label;
				button.setAttribute('aria-label', hypercore.status === 'partial' ? 'HyperCore connection: one module live' : 'HyperCore connection needs attention');
			} else {
				label.textContent = hypercore.label;
				button.setAttribute('aria-label', `HyperCore connection: ${hypercore.status}`);
			}
		}

		hypercorePresentation() {
			const summary = this.hypercoreConnectionState();
			if (summary.status === 'live') return { title: 'Powertrain data live', copy: 'HyperCore ECU and HyperCore BMS are both feeding this unified view.', badge: summary.badge, badgeClass: summary.badgeClass };
			if (summary.status === 'connecting') return { title: 'Connecting HyperCore', copy: 'Complete the Bluetooth chooser for the module you selected. Each module pairs separately.', badge: summary.badge, badgeClass: summary.badgeClass };
			if (summary.status === 'partial') {
				const liveModule = summary.ecuLive ? 'HyperCore ECU' : 'HyperCore BMS';
				return { title: 'Powertrain partially live', copy: `${liveModule} is live. Connect the other HyperCore module for the complete powertrain view.`, badge: summary.badge, badgeClass: summary.badgeClass };
			}
			if (summary.status === 'attention') return { title: 'Powertrain needs attention', copy: 'One or both HyperCore data links are delayed or disconnected. Your latest readings remain labelled as such.', badge: summary.badge, badgeClass: summary.badgeClass };
			if (summary.status === 'unavailable') return { title: 'Bluetooth data unavailable', copy: 'This phone or app build does not expose the Bluetooth access required for live HyperCore data.', badge: summary.badge, badgeClass: summary.badgeClass };
			return { title: 'Connect your HyperCore powertrain', copy: 'Connect HyperCore ECU and HyperCore BMS here to see powertrain and energy data together.', badge: summary.badge, badgeClass: summary.badgeClass };
		}

		hypercoreSummaryHTML() {
			const presentation = this.hypercorePresentation();
			return `<div class="halo-card-header"><div><p class="halo-card-kicker">HYPERCORE POWERTRAIN</p><h2>${escapeHTML(presentation.title)}</h2></div><span class="halo-badge ${presentation.badgeClass}">${escapeHTML(presentation.badge)}</span></div>
				<p class="halo-card-copy">${escapeHTML(presentation.copy)}</p>
				<div class="halo-hypercore-link-map" aria-label="HyperCore module status">
					<span class="${this.state.ecu?.live ? 'is-live' : ''}">HyperCore ECU</span>
					<span class="${this.state.bms?.live ? 'is-live' : ''}">HyperCore BMS</span>
				</div>`;
		}

		ecuPresentation() {
			const ecu = this.state.ecu || {};
			const status = text(ecu.status, ecu.supported ? 'idle' : 'unavailable');
			if (status === 'live') return { title: 'HyperCore ECU', badge: 'Live', badgeClass: 'halo-badge--good', copy: 'Halo is receiving live drive-system data from your motorcycle.' };
			if (status === 'scanning') return { title: 'HyperCore ECU', badge: 'Scanning', badgeClass: '', copy: 'Choose the HyperCore ECU in your phone’s Bluetooth window.' };
			if (status === 'connecting' || status === 'reconnecting') return { title: 'HyperCore ECU', badge: status === 'reconnecting' ? 'Reconnecting' : 'Connecting', badgeClass: '', copy: 'Halo is opening the ECU data link.' };
			if (status === 'waiting-for-data') return { title: 'HyperCore ECU', badge: 'Connected', badgeClass: '', copy: 'The link is open. Halo will mark the ECU live after its first valid update.' };
			if (status === 'stale') return { title: 'HyperCore ECU', badge: 'Delayed', badgeClass: 'halo-badge--attention', copy: 'The ECU signal is delayed. Values below are the last reading, not current data.' };
			if (status === 'error') return { title: 'HyperCore ECU', badge: 'Check', badgeClass: 'halo-badge--attention', copy: 'Halo could not open the ECU data link. Check that Bluetooth and the motorcycle are switched on, then try again.' };
			if (status === 'unavailable') return { title: 'HyperCore ECU', badge: 'Unavailable', badgeClass: 'halo-badge--attention', copy: ecu.reason === 'insecure-context' ? 'For security, ECU pairing requires Halo to be opened over HTTPS.' : 'This phone or app build does not expose the Bluetooth data access required by HyperCore ECU.' };
			if (status === 'disconnected') return { title: 'HyperCore ECU', badge: 'Offline', badgeClass: 'halo-badge--attention', copy: 'The ECU link ended. Values below are the last reading; pair again while safely parked to restore live data.' };
			return { title: 'HyperCore ECU', badge: 'Not connected', badgeClass: '', copy: ecu.reason === 'selection-cancelled' ? 'No ECU was selected. Pair again whenever you are ready.' : 'Pair HyperCore ECU to show motor speed, drive current, temperatures and input state.' };
		}

		bmsPresentation() {
			const bms = this.state.bms || {};
			const status = text(bms.status, bms.supported ? 'idle' : 'unavailable');
			if (status === 'live') return { title: 'HyperCore BMS', badge: 'Live', badgeClass: 'halo-badge--good', copy: 'Halo is receiving live energy-system data from your motorcycle.' };
			if (status === 'scanning') return { title: 'HyperCore BMS', badge: 'Scanning', badgeClass: '', copy: 'Choose the HyperCore BMS in your phone’s Bluetooth window.' };
			if (status === 'connecting') return { title: 'HyperCore BMS', badge: 'Connecting', badgeClass: '', copy: 'Halo is opening the BMS data link.' };
			if (status === 'waiting-for-data') return { title: 'HyperCore BMS', badge: 'Connected', badgeClass: '', copy: 'The link is open. Halo will mark the BMS live after its first valid update.' };
			if (status === 'stale') return { title: 'HyperCore BMS', badge: 'Delayed', badgeClass: 'halo-badge--attention', copy: 'The BMS signal is delayed. Values below are the last reading, not current data.' };
			if (status === 'error') return { title: 'HyperCore BMS', badge: 'Check', badgeClass: 'halo-badge--attention', copy: 'Halo could not open the BMS data link. Check that Bluetooth and the motorcycle are switched on, then try again.' };
			if (status === 'unavailable') return { title: 'HyperCore BMS', badge: 'Unavailable', badgeClass: 'halo-badge--attention', copy: bms.reason === 'insecure-context' ? 'For security, BMS pairing requires Halo to be opened over HTTPS.' : 'This phone or app build does not expose the Bluetooth data access required by HyperCore BMS. You can still enter starting charge manually before a ride.' };
			if (status === 'disconnected') return { title: 'HyperCore BMS', badge: 'Offline', badgeClass: 'halo-badge--attention', copy: 'The BMS link ended. Values below are the last reading; pair again while safely parked to restore live data.' };
			return { title: 'HyperCore BMS', badge: 'Not connected', badgeClass: '', copy: bms.reason === 'selection-cancelled' ? 'No BMS was selected. Pair again whenever you are ready.' : 'Pair HyperCore BMS to show live charge, pack voltage, current, cell balance and temperature.' };
		}

		telemetryNumberLabel(value, suffix, options) {
			const numeric = nullableFinite(value);
			return numeric === null ? '—' : `${formatNumber(numeric, options || {})}${suffix || ''}`;
		}

		hypercoreGearLabel(value) {
			const gear = nullableFinite(value);
			if (gear === 0) return 'N';
			if (gear === 1) return 'F';
			if (gear === 2) return 'R';
			return '—';
		}

		ecuCardContentHTML() {
			const ecu = this.state.ecu || {};
			const telemetry = isObject(ecu.telemetry) ? ecu.telemetry : null;
			const presentation = this.ecuPresentation();
			const busy = ['scanning', 'connecting', 'reconnecting'].includes(ecu.status);
			const paired = Boolean(ecu.connected);
			const supported = Boolean(ecu.supported);
			const hasDeliveredVehicle = this.state.lifecycle === 'owner' && Boolean(this.state.vehicle);
			const canPair = supported && hasDeliveredVehicle && !this.state.activeRide && !this.rideStarting;
			const speedMph = telemetry ? nullableFinite(telemetry.diagnosticSpeedMph) ?? (nullableFinite(telemetry.diagnosticSpeedKmh) === null ? null : Number(telemetry.diagnosticSpeedKmh) * 0.621371) : null;
			const metrics = telemetry ? `<div class="halo-hypercore-metrics" aria-label="Latest HyperCore ECU telemetry">
				<div><small>Motor speed</small><strong data-ecu-metric="rpm">${this.telemetryNumberLabel(telemetry.rpm, ' rpm', { maximumFractionDigits: 0 })}</strong></div>
				<div><small>ECU speed</small><strong data-ecu-metric="speed">${this.telemetryNumberLabel(speedMph, ' mph', { maximumFractionDigits: 1 })}</strong></div>
				<div><small>Line current</small><strong data-ecu-metric="current">${this.telemetryNumberLabel(telemetry.current, ' A', { maximumFractionDigits: 1 })}</strong></div>
				<div><small>Phase A / C</small><strong data-ecu-metric="phase-current">${this.telemetryNumberLabel(telemetry.phaseCurrentA, '', { maximumFractionDigits: 0 })} / ${this.telemetryNumberLabel(telemetry.phaseCurrentC, ' A', { maximumFractionDigits: 0 })}</strong></div>
				<div><small>Motor temperature</small><strong data-ecu-metric="motor-temperature">${this.telemetryNumberLabel(telemetry.motorTemperature, '°C', { maximumFractionDigits: 0 })}</strong></div>
				<div><small>ECU temperature</small><strong data-ecu-metric="ecu-temperature">${this.telemetryNumberLabel(telemetry.controllerTemperature, '°C', { maximumFractionDigits: 0 })}</strong></div>
				<div><small>Throttle</small><strong data-ecu-metric="throttle">${this.telemetryNumberLabel(telemetry.throttlePercent, '%', { maximumFractionDigits: 0 })}</strong></div>
				<div><small>Modulation</small><strong data-ecu-metric="modulation">${this.telemetryNumberLabel(telemetry.modulationPercent, '%', { maximumFractionDigits: 0 })}</strong></div>
				<div><small>Gear</small><strong data-ecu-metric="gear">${this.hypercoreGearLabel(telemetry.gear)}</strong></div>
				<div data-ecu-diagnostics class="${telemetry.faultActive === true ? 'is-attention' : ''}"><small>Diagnostics</small><strong data-ecu-metric="fault">${escapeHTML(telemetry.faultSummary || (telemetry.faultActive === false ? 'No active faults' : '—'))}</strong></div>
				<div><small>Last update</small><strong data-ecu-metric="updated">${escapeHTML(telemetry.measuredAt ? formatDate(telemetry.measuredAt, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—')}</strong></div>
			</div>` : '';
			const action = paired && hasDeliveredVehicle
				? '<button type="button" class="halo-button halo-button--secondary halo-full-width" data-action="disconnect-ecu">Disconnect HyperCore ECU</button>'
				: supported && hasDeliveredVehicle ? `<button type="button" class="halo-button halo-button--primary halo-full-width" data-action="connect-ecu" ${canPair && !busy ? '' : 'disabled'}>${this.state.activeRide || this.rideStarting ? 'Pair after this ride' : busy ? 'Connecting…' : ecu.status === 'error' || ecu.status === 'disconnected' ? 'Pair HyperCore ECU again' : 'Connect HyperCore ECU'}</button>` : '';
			return `<div class="halo-card-header"><div><p class="halo-card-kicker">DRIVE SYSTEM</p><h2>${escapeHTML(presentation.title)}</h2></div><span class="halo-badge ${presentation.badgeClass}">${escapeHTML(presentation.badge)}</span></div>
				<p class="halo-card-copy">${escapeHTML(presentation.copy)}</p>${metrics}${action ? `<div class="halo-button-stack halo-hypercore-actions">${action}</div>` : ''}
				<p class="halo-helper halo-hypercore-safety">Connect only while safely parked. Halo reads ECU diagnostics and cannot change powertrain settings. ECU speed is shown as a diagnostic and never replaces GPS ride speed.</p>`;
		}

		bmsCardContentHTML() {
			const bms = this.state.bms || {};
			const telemetry = isObject(bms.telemetry) ? bms.telemetry : null;
			const presentation = this.bmsPresentation();
			const busy = ['scanning', 'connecting'].includes(bms.status);
			const paired = Boolean(bms.connected);
			const supported = Boolean(bms.supported);
			const hasDeliveredVehicle = this.state.lifecycle === 'owner' && Boolean(this.state.vehicle);
			const canPair = supported && hasDeliveredVehicle && !this.state.activeRide && !this.rideStarting;
			const metrics = telemetry ? `<div class="halo-hypercore-metrics halo-bms-metrics" aria-label="Latest HyperCore BMS telemetry">
				<div><small>Charge</small><strong data-bms-metric="soc">${this.telemetryNumberLabel(telemetry.soc, '%', { maximumFractionDigits: 0 })}</strong></div>
				<div><small>Pack voltage</small><strong data-bms-metric="voltage">${this.telemetryNumberLabel(telemetry.voltage, ' V', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong></div>
				<div><small>Pack current</small><strong data-bms-metric="current">${this.telemetryNumberLabel(telemetry.current, ' A', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong></div>
				<div><small>Pack power</small><strong data-bms-metric="power">${this.telemetryNumberLabel(telemetry.powerKw, ' kW', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong></div>
				<div><small>Cell spread</small><strong data-bms-metric="cell-spread">${this.telemetryNumberLabel(telemetry.cellDeltaMv, ' mV', { maximumFractionDigits: 0 })}</strong></div>
				<div><small>Highest temperature</small><strong data-bms-metric="temperature">${this.telemetryNumberLabel(telemetry.maxTemperature, '°C', { maximumFractionDigits: 0 })}</strong></div>
				<div><small>Last update</small><strong data-bms-metric="updated">${escapeHTML(telemetry.measuredAt ? formatDate(telemetry.measuredAt, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—')}</strong></div>
			</div>` : '';
			const action = paired && hasDeliveredVehicle
				? '<button type="button" class="halo-button halo-button--secondary halo-full-width" data-action="disconnect-bms">Disconnect HyperCore BMS</button>'
				: supported && hasDeliveredVehicle ? `<button type="button" class="halo-button halo-button--primary halo-full-width" data-action="connect-bms" ${canPair && !busy ? '' : 'disabled'}>${this.state.activeRide || this.rideStarting ? 'Pair after this ride' : busy ? 'Connecting…' : bms.status === 'error' || bms.status === 'disconnected' ? 'Pair HyperCore BMS again' : 'Connect HyperCore BMS'}</button>` : '';
			return `<div class="halo-card-header"><div><p class="halo-card-kicker">ENERGY SYSTEM</p><h2>${escapeHTML(presentation.title)}</h2></div><span class="halo-badge ${presentation.badgeClass}">${escapeHTML(presentation.badge)}</span></div>
				<p class="halo-card-copy">${escapeHTML(presentation.copy)}</p>${metrics}${action ? `<div class="halo-button-stack halo-hypercore-actions halo-bms-actions">${action}</div>` : ''}
				<p class="halo-helper halo-hypercore-safety halo-bms-safety">Connect only while safely parked. Halo reads BMS information and cannot change BMS settings or other powertrain settings. Charge may be included with a ride or Emergency Assist alert.</p>`;
		}

		updateEcuStatus(status) {
			const previous = this.state.ecu || {};
			this.state.ecu = Object.assign({}, previous, status || {});
			if (previous.live && !this.state.ecu.live && this.state.activeRide) this.state.ecuRideWasLive = true;
			if (!this.state.activeRide) this.syncRideSetup();
			this.updateEcuSurfaces({ renderCard: true, renderSummary: true });
		}

		updateEcuTelemetry(telemetry) {
			this.state.ecu = Object.assign({}, this.state.ecu || {}, { status: 'live', connected: true, live: true, telemetry });
			if (this.state.activeRide) this.state.ecuRideWasLive = true;
			if (!this.state.activeRide) this.syncRideSetup();
			if (this.ecuSurfaceTimer !== null) return;
			this.ecuSurfaceTimer = window.setTimeout(() => {
				this.ecuSurfaceTimer = null;
				this.updateEcuSurfaces({ renderCard: false, renderSummary: false });
			}, 100);
		}

		updateBmsStatus(status) {
			const previous = this.state.bms || {};
			this.state.bms = Object.assign({}, previous, status || {});
			if (previous.live && !this.state.bms.live && this.state.activeRide) this.state.bmsRideWasLive = true;
			if (!this.state.activeRide) this.syncRideSetup();
			this.updateBmsSurfaces({ renderCards: true });
		}

		updateBmsTelemetry(telemetry) {
			this.state.bms = Object.assign({}, this.state.bms || {}, { status: 'live', connected: true, live: true, telemetry });
			if (this.state.activeRide) this.state.bmsRideWasLive = true;
			if (!this.state.activeRide) this.syncRideSetup();
			this.updateBmsSurfaces({ renderCards: false });
		}

		updateBmsSurfaces(options) {
			const settings = Object.assign({ renderCards: true }, options || {});
			this.updateHypercoreSurfaces({ renderSummary: settings.renderCards, renderEcuCard: false, renderBmsCard: settings.renderCards, updateEcuMetrics: false, updateBmsMetrics: true, updateBatterySurfaces: true });
		}

		updateEcuSurfaces(options) {
			const settings = Object.assign({ renderCard: true, renderSummary: true }, options || {});
			this.updateHypercoreSurfaces({ renderSummary: settings.renderSummary, renderEcuCard: settings.renderCard, renderBmsCard: false, updateEcuMetrics: true, updateBmsMetrics: false, updateBatterySurfaces: false });
		}

		updateHypercoreSurfaces(options) {
			const settings = Object.assign({ renderSummary: true, renderEcuCard: true, renderBmsCard: true, updateEcuMetrics: true, updateBmsMetrics: true, updateBatterySurfaces: true }, options || {});
			this.updateVehicleConnection();
			if (settings.renderSummary) $$('[data-hypercore-summary]', root).forEach((card) => { card.innerHTML = this.hypercoreSummaryHTML(); });
			if (settings.renderEcuCard) $$('[data-ecu-card]', root).forEach((card) => { card.innerHTML = this.ecuCardContentHTML(); });
			if (settings.renderBmsCard) $$('[data-bms-card]', root).forEach((card) => { card.innerHTML = this.bmsCardContentHTML(); });
			const pairing = [this.state.ecu?.status, this.state.bms?.status].some((status) => ['scanning', 'connecting', 'reconnecting'].includes(status));
			$$('[data-action="connect-ecu"], [data-action="connect-bms"]', root).forEach((button) => {
				button.disabled = pairing || Boolean(this.state.activeRide) || this.rideStarting;
			});
			const ecuTelemetry = isObject(this.state.ecu?.telemetry) ? this.state.ecu.telemetry : null;
			if (settings.updateEcuMetrics && ecuTelemetry) {
				const speedMph = nullableFinite(ecuTelemetry.diagnosticSpeedMph) ?? (nullableFinite(ecuTelemetry.diagnosticSpeedKmh) === null ? null : Number(ecuTelemetry.diagnosticSpeedKmh) * 0.621371);
				const metricValues = {
					rpm: this.telemetryNumberLabel(ecuTelemetry.rpm, ' rpm', { maximumFractionDigits: 0 }),
					speed: this.telemetryNumberLabel(speedMph, ' mph', { maximumFractionDigits: 1 }),
					current: this.telemetryNumberLabel(ecuTelemetry.current, ' A', { maximumFractionDigits: 1 }),
					'phase-current': `${this.telemetryNumberLabel(ecuTelemetry.phaseCurrentA, '', { maximumFractionDigits: 0 })} / ${this.telemetryNumberLabel(ecuTelemetry.phaseCurrentC, ' A', { maximumFractionDigits: 0 })}`,
					'motor-temperature': this.telemetryNumberLabel(ecuTelemetry.motorTemperature, '°C', { maximumFractionDigits: 0 }),
					'ecu-temperature': this.telemetryNumberLabel(ecuTelemetry.controllerTemperature, '°C', { maximumFractionDigits: 0 }),
					throttle: this.telemetryNumberLabel(ecuTelemetry.throttlePercent, '%', { maximumFractionDigits: 0 }),
					modulation: this.telemetryNumberLabel(ecuTelemetry.modulationPercent, '%', { maximumFractionDigits: 0 }),
					gear: this.hypercoreGearLabel(ecuTelemetry.gear),
					fault: text(ecuTelemetry.faultSummary, ecuTelemetry.faultActive === false ? 'No active faults' : '—'),
					updated: ecuTelemetry.measuredAt ? formatDate(ecuTelemetry.measuredAt, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
				};
				Object.entries(metricValues).forEach(([metric, value]) => {
					$$(`[data-ecu-metric="${metric}"]`, root).forEach((element) => { element.textContent = value; });
				});
				$$('[data-ecu-diagnostics]', root).forEach((element) => element.classList.toggle('is-attention', ecuTelemetry.faultActive === true));
			}
			const bmsTelemetry = isObject(this.state.bms?.telemetry) ? this.state.bms.telemetry : null;
			if (settings.updateBmsMetrics && bmsTelemetry) {
				const metricValues = {
					soc: this.telemetryNumberLabel(bmsTelemetry.soc, '%', { maximumFractionDigits: 0 }),
					voltage: this.telemetryNumberLabel(bmsTelemetry.voltage, ' V', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
					current: this.telemetryNumberLabel(bmsTelemetry.current, ' A', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
					power: this.telemetryNumberLabel(bmsTelemetry.powerKw, ' kW', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
					'cell-spread': this.telemetryNumberLabel(bmsTelemetry.cellDeltaMv, ' mV', { maximumFractionDigits: 0 }),
					temperature: this.telemetryNumberLabel(bmsTelemetry.maxTemperature, '°C', { maximumFractionDigits: 0 }),
					updated: bmsTelemetry.measuredAt ? formatDate(bmsTelemetry.measuredAt, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
				};
				Object.entries(metricValues).forEach(([metric, value]) => {
					$$(`[data-bms-metric="${metric}"]`, root).forEach((element) => { element.textContent = value; });
				});
			}
			if (settings.updateBatterySurfaces) {
				const battery = this.vehicleBattery();
				$$('[data-battery-soc]', root).forEach((element) => { element.textContent = battery.soc === null ? '—' : `${Math.round(battery.soc)}%`; });
				$$('[data-battery-status]', root).forEach((element) => {
					if (element.closest('#halo-home-content')) element.textContent = battery.status || 'Battery';
					else element.textContent = battery.soc === null ? 'Vehicle status' : `${formatMiles(battery.range, true)} estimated range`;
				});
				const rideCharge = $('[data-ride-bms-charge]', root);
				if (rideCharge) rideCharge.textContent = this.state.bms?.live && battery.soc !== null ? `${Math.round(battery.soc)}%` : '—';
			}
			this.renderHypercoreRideStatus();
		}

		renderBmsRideStatus() {
			this.renderHypercoreRideStatus();
		}

		renderHypercoreRideStatus() {
			const chip = $('[data-bms-ride-status]', root);
			if (!chip) return;
			const ecu = this.state.ecu || {};
			const bms = this.state.bms || {};
			const ecuTelemetry = isObject(ecu.telemetry) ? ecu.telemetry : {};
			const bmsTelemetry = isObject(bms.telemetry) ? bms.telemetry : {};
			const chargeField = $('[data-ride-bms-field]', root);
			const rideHud = $('.halo-ride-hud', root);
			if (chargeField) chargeField.hidden = !this.state.activeRide || !bms.live;
			rideHud?.classList.toggle('has-bms', Boolean(this.state.activeRide && bms.live));
			const bothLive = Boolean(ecu.live && bms.live);
			const oneLive = Boolean(ecu.live !== bms.live);
			const waiting = Boolean(this.state.activeRide && [ecu, bms].some((component) => component.connected && ['connecting', 'reconnecting', 'waiting-for-data', 'stale'].includes(component.status)));
			const lost = Boolean(this.state.activeRide && ((this.state.ecuRideWasLive && !ecu.live) || (this.state.bmsRideWasLive && !bms.live)));
			chip.hidden = !this.state.activeRide || (!bothLive && !oneLive && !waiting && !lost);
			if (chip.hidden) return;
			chip.classList.toggle('is-live', bothLive);
			chip.classList.toggle('is-warning', !bothLive);
			if (bothLive) {
				const motorTemperature = nullableFinite(ecuTelemetry.motorTemperature);
				chip.textContent = `HyperCore live · ECU + BMS · ${Math.round(Number(bmsTelemetry.soc) || 0)}%${motorTemperature === null ? '' : ` · Motor ${Math.round(motorTemperature)}°C`}`;
			} else if (oneLive) {
				const liveValue = ecu.live
					? (nullableFinite(ecuTelemetry.motorTemperature) === null ? '' : ` · Motor ${Math.round(ecuTelemetry.motorTemperature)}°C`)
					: (nullableFinite(bmsTelemetry.soc) === null ? '' : ` · ${Math.round(bmsTelemetry.soc)}%`);
				chip.textContent = `HyperCore partial · ${ecu.live ? 'ECU' : 'BMS'} only${liveValue} · Ride mode continues`;
			} else if ([ecu.status, bms.status].some((status) => ['waiting-for-data', 'connecting', 'reconnecting'].includes(status))) {
				chip.textContent = 'HyperCore connected · waiting for live data';
			} else {
				chip.textContent = 'HyperCore data unavailable · Ride mode continues';
			}
		}

		async connectEcu() {
			if (!this.state.vehicle || this.state.lifecycle !== 'owner') throw new HaloAPIError('A delivered Avenrà motorcycle must be linked before pairing HyperCore ECU.');
			if (this.state.activeRide || this.rideStarting) throw new HaloAPIError('Pair HyperCore ECU only while safely parked, before starting Ride mode.');
			if (this.hypercorePairingTokens.size) throw new HaloAPIError('Finish the current HyperCore pairing before connecting the other module.');
			if (!this.ecu?.supported) {
				this.updateEcuStatus(this.ecu?.getStatus?.() || { status: 'unavailable', supported: false, reason: window.isSecureContext ? 'unsupported' : 'insecure-context' });
				throw new HaloAPIError(this.ecuPresentation().copy);
			}
			this.state.ecuVehicleId = String(this.state.vehicle.id || '');
			const pairingToken = this.beginHypercorePairingAllowance();
			let status;
			try { status = await this.ecu.connect({ forceChooser: true }); }
			finally { this.endHypercorePairingAllowance(pairingToken); }
			if (!status.connected) this.state.ecuVehicleId = null;
			if (status.reason === 'selection-cancelled') this.toast('No HyperCore ECU selected.', 'success');
			else if (status.status === 'error') this.toast('Halo could not connect to HyperCore ECU. Check Bluetooth and try again.', 'error');
			else if (status.connected && !status.live) this.toast('HyperCore ECU connected. Waiting for live data.', 'success');
		}

		async disconnectEcu() {
			if (!this.ecu) return;
			await this.ecu.disconnect('user-disconnected');
			this.state.ecuVehicleId = null;
			if (!this.state.activeRide) this.state.ecuRideWasLive = false;
			this.toast('HyperCore ECU disconnected.', 'success');
		}

		async connectBms() {
			if (!this.state.vehicle || this.state.lifecycle !== 'owner') throw new HaloAPIError('A delivered Avenrà motorcycle must be linked before pairing HyperCore BMS.');
			if (this.state.activeRide || this.rideStarting) throw new HaloAPIError('Pair HyperCore BMS only while safely parked, before starting Ride mode.');
			if (this.hypercorePairingTokens.size) throw new HaloAPIError('Finish the current HyperCore pairing before connecting the other module.');
			if (!this.bms?.supported) {
				this.updateBmsStatus(this.bms?.getStatus?.() || { status: 'unavailable', supported: false, reason: window.isSecureContext ? 'unsupported' : 'insecure-context' });
				throw new HaloAPIError(this.bmsPresentation().copy);
			}
			this.state.bmsVehicleId = String(this.state.vehicle.id || '');
			const pairingToken = this.beginHypercorePairingAllowance();
			let status;
			try { status = await this.bms.connect(); }
			finally { this.endHypercorePairingAllowance(pairingToken); }
			if (!status.connected) this.state.bmsVehicleId = null;
			if (status.reason === 'selection-cancelled') this.toast('No HyperCore BMS selected.', 'success');
			else if (status.status === 'error') this.toast('Halo could not connect to HyperCore BMS. Check Bluetooth and try again.', 'error');
			else if (status.connected && !status.live) this.toast('HyperCore BMS connected. Waiting for live data.', 'success');
		}

		async disconnectBms() {
			if (!this.bms) return;
			await this.bms.disconnect('user-disconnected');
			this.state.bmsVehicleId = null;
			if (!this.state.activeRide) this.state.bmsRideWasLive = false;
			this.toast('HyperCore BMS disconnected.', 'success');
		}

		homeHero(options) {
			const settings = Object.assign({ title: '', subtitle: '', label: '', value: '', valueLabel: '', action: '', actionLabel: '', image: '', fallbackImage: '', canonicalImage: '', imageAlt: '', swatch: '', accent: '', compact: false, productStage: false, batteryValue: false }, options || {});
			const imageCandidate = String(settings.image || '');
			const imageUrl = imageCandidate.startsWith('blob:') && this.privateVehicleObjectUrls.has(imageCandidate)
				? safeUrl(imageCandidate, ['blob:'])
				: safeUrl(imageCandidate, ['https:']);
			const fallbackUrl = safeUrl(settings.fallbackImage, ['https:']);
			const canonicalUrl = safeUrl(settings.canonicalImage, ['https:']);
			const displayUrl = imageUrl || fallbackUrl || canonicalUrl;
			const accent = safeHexColour(settings.accent || settings.swatch, '#646b71');
			const paint = safePaint(settings.swatch || settings.accent);
			const nextFallback = [fallbackUrl, canonicalUrl].find((url) => url && url !== displayUrl) || '';
			const finalFallback = canonicalUrl && canonicalUrl !== displayUrl && canonicalUrl !== nextFallback ? canonicalUrl : '';
			const fallbackAttribute = nextFallback ? ` data-fallback-src="${escapeAttr(nextFallback)}"` : '';
			const canonicalAttribute = finalFallback ? ` data-canonical-src="${escapeAttr(finalFallback)}"` : '';
			const subtitle = settings.subtitle ? `<p class="halo-hero-subtitle">${settings.swatch ? '<span class="halo-paint-swatch" aria-hidden="true"></span>' : ''}<span>${escapeHTML(settings.subtitle)}</span></p>` : '';
			return `<article class="halo-hero${settings.compact ? ' halo-hero--compact' : ''}${settings.productStage ? ' halo-hero--product-stage' : ''}" style="--halo-vehicle-accent:${escapeAttr(accent)};--halo-colour-swatch:${escapeAttr(paint)}">
				<div class="halo-hero-heading"><p class="halo-eyebrow">${escapeHTML(settings.label)}</p><h1>${escapeHTML(settings.title)}</h1>${subtitle}</div>
				<div class="halo-bike-visual"><span class="halo-bike-plinth" aria-hidden="true"></span>${displayUrl ? `<img src="${escapeAttr(displayUrl)}" alt="${escapeAttr(settings.imageAlt || settings.title)}" loading="eager" decoding="async"${fallbackAttribute}${canonicalAttribute}>` : '<div class="halo-bike-silhouette" aria-hidden="true"></div>'}</div>
				<div class="halo-hero-footer"><div><strong${settings.batteryValue ? ' data-battery-soc' : ''}>${escapeHTML(settings.value)}</strong><small${settings.batteryValue ? ' data-battery-status' : ''}>${escapeHTML(settings.valueLabel)}</small></div>${settings.action ? `<button type="button" class="halo-hero-action" ${settings.action}>${escapeHTML(settings.actionLabel)}</button>` : ''}</div>
			</article>`;
		}

		renderAlerts() {
			const alerts = asArray(this.state.boot?.alerts).filter((alert) => alert && alert.message);
			if (!alerts.length) return '';
			return alerts.slice(0, 3).map((alert) => `<article class="halo-callout">${icon(alert.severity === 'critical' ? 'warning' : 'service')}<div><h3>${escapeHTML(alert.title || 'Halo update')}</h3><p>${escapeHTML(alert.message)}</p></div>${alert.action_route ? `<button type="button" class="halo-button halo-button--secondary" data-route-target="${escapeAttr(alert.action_route)}">${escapeHTML(alert.action_label || 'View')}</button>` : ''}</article>`).join('');
		}

		renderHome() {
			const container = $('#halo-home-content', root);
			if (!container) return;
			const customerName = this.state.customer.full_name || this.state.customer.name || this.state.customer.display_name;
			const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';
			const vehicle = this.state.vehicle || {};
			const colourLabel = vehicle.colour_label || vehicle.colour || vehicle.color || '';
			const links = Object.assign({}, CONFIG.links || {}, this.state.boot?.links || {});
			let html = `<header class="halo-page-header"><p class="halo-eyebrow">${escapeHTML(greeting.toUpperCase())}</p><h1 id="halo-home-title">Hello, ${escapeHTML(firstName(customerName))}</h1></header>${this.renderAlerts()}`;

			if (this.state.lifecycle === 'prospect') {
				html += this.homeHero({
					label: 'DISCOVER AVENRÀ', title: 'Your next ride starts here', subtitle: 'Explore the range, arrange a test ride or bring an approved-used Avenrà into Halo.',
					value: 'Halo', valueLabel: 'Your rider network', action: 'data-action="open-link" data-link-key="configurator"', actionLabel: 'Explore motorcycles',
					image: vehicle.colour_image_url || CONFIG.canonicalRangeImage, fallbackImage: vehicle.image_url || vehicle.fallback_image_url,
					canonicalImage: CONFIG.canonicalRangeImage, accent: vehicle.colour_swatch || '#000000', productStage: true,
					imageAlt: colourLabel ? `Avenrà motorcycle in ${colourLabel}` : 'Avenrà motorcycle in Silverstone Gloss Metallic Black'
				});
				html += `<div class="halo-action-grid">
					<button type="button" class="halo-action-card" data-action="open-link" data-link-key="test_ride">${icon('bike')}<span>Book a test ride</span><small>${links.test_ride ? 'Choose a time' : 'Availability shown when connected'}</small></button>
					<button type="button" class="halo-action-card" data-action="add-approved-used">${icon('check')}<span>Add approved used</span><small>Link a motorcycle</small></button>
					<button type="button" class="halo-action-card" data-route-target="more/boutique">${icon('bag')}<span>Boutique</span><small>Rider essentials</small></button>
					<button type="button" class="halo-action-card" data-route-target="more/manual">${icon('book')}<span>Owner's manual</span><small>Browse guides</small></button>
				</div>`;
			} else if (this.state.lifecycle === 'pre-delivery') {
				const build = vehicle.build || this.state.boot?.build || { status: vehicle.status, current_label: vehicle.status, estimated_delivery: vehicle.estimated_delivery_date };
				const stage = build.current_label || build.stage_label || build.status || 'Order confirmed';
				const date = build.estimated_delivery || vehicle.estimated_delivery || vehicle.estimated_delivery_date || '';
				html += this.homeHero({
					label: 'YOUR MOTORCYCLE', title: this.vehicleName(), subtitle: text(colourLabel, 'Your specification is linked to Halo.'),
					value: stage, valueLabel: date ? `Estimated delivery ${formatDate(date)}` : 'We will show a date once confirmed',
					action: 'data-route-target="vehicle"', actionLabel: 'View build', image: vehicle.image_url,
					fallbackImage: vehicle.fallback_image_url, canonicalImage: vehicle.colour_image_url, swatch: vehicle.colour_swatch,
					productStage: !vehicle.has_private_photo,
					imageAlt: [this.vehicleName(), colourLabel].filter(Boolean).join(' — ')
				});
				html += `<section class="halo-card"><div class="halo-card-header"><div><p class="halo-card-kicker">BUILD JOURNEY</p><h2>${escapeHTML(stage)}</h2></div><span class="halo-badge ${build.is_delayed ? 'halo-badge--attention' : ''}">${build.is_delayed ? 'Update' : 'In progress'}</span></div>${this.buildTrackerHTML(build, true)}</section>`;
				html += `<div class="halo-action-grid"><button type="button" class="halo-action-card" data-route-target="more/documents">${icon('document')}<span>Documents</span><small>Order & ownership</small></button><button type="button" class="halo-action-card" data-route-target="more/manual">${icon('book')}<span>Get familiar</span><small>Read the manual</small></button><button type="button" class="halo-action-card" data-route-target="more/boutique">${icon('bag')}<span>Boutique</span><small>Prepare to ride</small></button><button type="button" class="halo-action-card" data-action="contact-support">${icon('service')}<span>Ask Avenrà</span><small>Order support</small></button></div>`;
			} else {
				const battery = this.vehicleBattery();
				const security = isObject(vehicle.security) ? vehicle.security : {};
				const secureLabel = security.locked === true || security.status === 'secure' ? 'Bike secure' : security.status ? text(security.label || security.status) : 'Security status unavailable';
					html += this.homeHero({
					label: this.connectionState().connected ? 'CONNECTED' : 'YOUR MOTORCYCLE', title: this.vehicleName(),
					subtitle: [vehicle.registration || vehicle.registration_plate, colourLabel].filter(Boolean).join(' · '),
					value: battery.soc === null ? '—' : `${Math.round(battery.soc)}%`, valueLabel: battery.status ? text(battery.status) : 'Battery',
					action: 'data-route-target="ride"', actionLabel: 'Start a ride', image: vehicle.image_url,
					fallbackImage: vehicle.fallback_image_url, canonicalImage: vehicle.colour_image_url, swatch: vehicle.colour_swatch,
					productStage: !vehicle.has_private_photo, batteryValue: true,
					imageAlt: [this.vehicleName(), colourLabel].filter(Boolean).join(' — ')
				});
				html += `<div class="halo-metric-grid">
					<div class="halo-metric">${icon('battery')}<small>Estimated range</small><strong>${formatMiles(battery.range, true)}</strong><span>${battery.timeToFull ? escapeHTML(battery.timeToFull) : 'Based on current data'}</span></div>
					<div class="halo-metric">${icon('lock')}<small>Security</small><strong>${escapeHTML(secureLabel)}</strong><span>${security.last_updated ? `Updated ${escapeHTML(formatDate(security.last_updated, { hour: '2-digit', minute: '2-digit' }))}` : 'Tap for controls'}</span></div>
					<div class="halo-metric">${icon('activity')}<small>Odometer</small><strong>${formatMiles(vehicle.odometer_miles ?? vehicle.current_mileage, true)}</strong><span>${vehicle.odometer_miles == null && vehicle.current_mileage == null ? 'Awaiting vehicle data' : 'Recorded distance'}</span></div>
					<div class="halo-metric">${icon('service')}<small>Service</small><strong>${escapeHTML(vehicle.service?.status_label || vehicle.service?.status || 'No update')}</strong><span>${vehicle.service?.due_date ? `Due ${formatDate(vehicle.service.due_date)}` : 'View maintenance'}</span></div>
				</div>`;
				html += `<div class="halo-action-grid"><button type="button" class="halo-action-card" data-action="vehicle-security">${icon('shield')}<span>Security</span><small>Bike status</small></button><button type="button" class="halo-action-card" data-route-target="ride">${icon('route')}<span>Plan a ride</span><small>Routes & focus zones</small></button><button type="button" class="halo-action-card" data-route-target="more/documents">${icon('document')}<span>Glovebox</span><small>Vehicle documents</small></button><button type="button" class="halo-action-card" data-vehicle-view="service" data-route-target="vehicle">${icon('service')}<span>Service</span><small>Care & support</small></button></div>`;
			}
			if (this.state.community.enrolled) {
				const communityName = this.state.community.profile?.username || 'rider';
				html += `<button type="button" class="halo-community-home-card" data-route-target="more/community"><span class="halo-community-home-icon">${icon('community')}</span><span><small>HALO COMMUNITY</small><strong>Ride together, ${escapeHTML(firstName(communityName))}</strong><em>Rider conversations, forums and private messages</em></span>${icon('chevron')}</button>`;
			}
			container.innerHTML = html;
		}

		buildTrackerHTML(build, compact) {
			const steps = asArray(build?.steps || build?.timeline);
			if (!steps.length) return '<p class="halo-card-copy">Build updates will appear here as they are confirmed by Avenrà HQ.</p>';
			const limited = compact ? steps.slice(Math.max(0, steps.findIndex((step) => ['current', 'in_progress'].includes(step.status)) - 1), Math.max(3, steps.findIndex((step) => ['current', 'in_progress'].includes(step.status)) + 2)) : steps;
			return `<div class="halo-progress-track">${limited.map((step, index) => {
				const status = text(step.status).toLowerCase();
				const isComplete = step.complete === true || ['complete', 'completed'].includes(status);
				const isCurrent = step.current === true || ['current', 'in-progress', 'in_progress', 'active'].includes(status);
				return `<div class="halo-progress-step ${isComplete ? 'is-complete' : ''} ${isCurrent ? 'is-current' : ''}"><div class="halo-progress-dot">${isComplete ? icon('check') : index + 1}</div><div class="halo-progress-copy"><strong>${escapeHTML(step.label || step.name || step.title || `Stage ${index + 1}`)}</strong><small>${escapeHTML(step.description || (step.date ? formatDate(step.date) : isCurrent ? 'In progress' : ''))}</small></div></div>`;
			}).join('')}</div>`;
		}

		renderVehicle() {
			const container = $('#halo-vehicle-content', root);
			if (!container) return;
			$$('[data-vehicle-view]', root).forEach((button) => button.classList.toggle('is-active', button.dataset.vehicleView === this.state.vehicleView));
			if (!this.state.vehicle) {
				container.innerHTML = `<div class="halo-empty-state">${icon('bike')}<h2>No motorcycle linked</h2><p>Add an Avenrà Approved Used motorcycle, or return here when your new order is confirmed.</p><button type="button" class="halo-button halo-button--primary" data-action="add-approved-used">Add approved used</button><button type="button" class="halo-text-button" data-action="open-link" data-link-key="configurator">Explore new motorcycles</button></div>`;
				this.applyOfflineSnapshotMode();
				return;
			}
			if (this.state.vehicleView === 'build') this.renderVehicleBuild(container);
			else if (this.state.vehicleView === 'battery') this.renderVehicleBattery(container);
			else if (this.state.vehicleView === 'profile') this.renderRideProfile(container);
			else if (this.state.vehicleView === 'service') this.renderVehicleService(container);
			else this.renderVehicleOverview(container);
			this.applyOfflineSnapshotMode();
		}

		renderVehicleOverview(container) {
			const vehicle = this.state.vehicle || {};
			const battery = this.vehicleBattery();
			const colourLabel = vehicle.colour_label || vehicle.colour || vehicle.color || '';
			const specRows = customerSpecificationRows(vehicle);
			const specificationKicker = this.state.lifecycle === 'owner' ? 'AS BUILT' : 'YOUR BUILD';
			container.innerHTML = `${this.homeHero({ label: vehicle.first_edition_number ? `FIRST EDITION ${vehicle.first_edition_number}` : 'YOUR AVENRÀ', title: this.vehicleName(), subtitle: [colourLabel, vehicle.registration || vehicle.registration_plate].filter(Boolean).join(' · '), value: battery.soc === null ? text(vehicle.status_label || vehicle.status, 'Linked to Halo') : `${Math.round(battery.soc)}%`, valueLabel: battery.soc === null ? 'Vehicle status' : `${formatMiles(battery.range, true)} estimated range`, action: this.state.lifecycle === 'owner' ? 'data-action="refresh-vehicle"' : 'data-vehicle-view="build"', actionLabel: this.state.lifecycle === 'owner' ? 'Refresh' : 'Build status', image: vehicle.image_url, fallbackImage: vehicle.fallback_image_url, canonicalImage: vehicle.colour_image_url, swatch: vehicle.colour_swatch, imageAlt: [this.vehicleName(), colourLabel].filter(Boolean).join(' — '), compact: true, productStage: !vehicle.has_private_photo, batteryValue: this.state.lifecycle === 'owner' })}
				<section class="halo-card"><div class="halo-card-header"><div><p class="halo-card-kicker">IDENTITY</p><h2>Vehicle details</h2></div><span class="halo-badge halo-badge--good">${escapeHTML(vehicle.status_label || (this.state.lifecycle === 'owner' ? 'Active' : 'Ordered'))}</span></div><dl class="halo-spec-list">
					<div class="halo-spec-row"><dt>Model</dt><dd>${escapeHTML(this.vehicleName())}</dd></div>
					<div class="halo-spec-row"><dt>Registration</dt><dd>${escapeHTML(vehicle.registration || vehicle.registration_plate || 'Not assigned')}</dd></div>
					<div class="halo-spec-row"><dt>VIN</dt><dd>${escapeHTML(vehicle.vin_masked || vehicle.vin || 'Not assigned')}</dd></div>
					<div class="halo-spec-row"><dt>Colour</dt><dd>${escapeHTML(colourLabel || '—')}</dd></div>
				</dl><label class="halo-button halo-button--secondary halo-full-width halo-file-button" style="margin-top:16px">${icon('camera')} Update vehicle photo<input id="halo-vehicle-photo-file" type="file" accept="image/jpeg,image/png,image/webp"></label></section>
				${specRows.length ? `<section class="halo-card"><div class="halo-card-header"><div><p class="halo-card-kicker">${specificationKicker}</p><h2>Your specification</h2></div></div><dl class="halo-spec-list">${specRows.map((row) => `<div class="halo-spec-row"><dt>${escapeHTML(row.label)}</dt><dd>${escapeHTML(row.value)}</dd></div>`).join('')}</dl></section>` : '<section class="halo-card"><h2>Your specification</h2><p class="halo-card-copy">Your confirmed options will appear here when they are available.</p></section>'}`;
		}

		renderVehicleBattery(container) {
			if (this.state.lifecycle !== 'owner') {
				container.innerHTML = `<section class="halo-card"><div class="halo-card-header"><div><p class="halo-card-kicker">HYPERCORE POWERTRAIN</p><h2>Available after delivery</h2></div><span class="halo-badge">Not active</span></div><p class="halo-card-copy">Live HyperCore ECU and HyperCore BMS pairing becomes available when this motorcycle is recorded as delivered to you.</p></section>`;
				return;
			}
			const battery = this.vehicleBattery();
			container.innerHTML = `<section class="halo-card halo-hypercore-overview" data-hypercore-summary>${this.hypercoreSummaryHTML()}</section>
				<div class="halo-hypercore-components">
					<section class="halo-card halo-hypercore-component halo-ecu-card" data-ecu-card>${this.ecuCardContentHTML()}</section>
					<section class="halo-card halo-hypercore-component halo-bms-card" data-bms-card>${this.bmsCardContentHTML()}</section>
				</div>
				<section class="halo-card"><div class="halo-card-header"><div><p class="halo-card-kicker">RANGE</p><h2>Journey estimate</h2></div><span class="halo-badge">Estimate</span></div><dl class="halo-spec-list"><div class="halo-spec-row"><dt>Estimated range</dt><dd>${escapeHTML(formatMiles(battery.range, true))}</dd></div><div class="halo-spec-row"><dt>Starting charge for Ride mode</dt><dd data-bms-effective-start-charge>${escapeHTML(this.startingChargeLabel())}</dd></div></dl><p class="halo-helper">HyperCore BMS reports battery measurements, not dependable remaining mileage. Halo keeps range clearly labelled as an estimate.</p></section>`;
		}

		renderVehicleBuild(container) {
			const build = this.state.vehicle?.build || this.state.boot?.build || { status: this.state.vehicle?.status, current_label: this.state.vehicle?.status, estimated_delivery: this.state.vehicle?.estimated_delivery_date };
			container.innerHTML = `<section class="halo-card"><div class="halo-card-header"><div><p class="halo-card-kicker">BUILD JOURNEY</p><h2>${escapeHTML(build.current_label || build.stage_label || build.status || 'Build status')}</h2></div>${build.updated_at ? `<span class="halo-badge">Updated ${escapeHTML(formatDate(build.updated_at, { day: 'numeric', month: 'short' }))}</span>` : ''}</div>${this.buildTrackerHTML(build, false)}</section>${build.estimated_delivery ? `<section class="halo-card halo-card--tint"><p class="halo-card-kicker">ESTIMATED DELIVERY</p><h2>${escapeHTML(formatDate(build.estimated_delivery))}</h2><p class="halo-card-copy">This estimate will update if the production schedule changes.</p></section>` : ''}`;
		}

		renderRideProfile(container) {
			const profile = this.state.vehicle?.ride_profiles || this.state.vehicle?.ride_profile || this.state.boot?.ride_profile || {};
			const remote = Boolean(this.state.boot?.features?.remote_ride_profile);
			const mappings = profile.handlebar_mappings || profile.modes || profile;
			const modes = {
				mode_1: mappings.mode_1 || mappings['1'] || 'Profile A',
				mode_2: mappings.mode_2 || mappings['2'] || 'Profile B',
				mode_3: mappings.mode_3 || mappings['3'] || 'Profile E'
			};
			const regen = profile.regen_profile || profile.regeneration || profile.regen || 'Medium';
			const profileLabels = { 'Profile A': 'Profile A · 30 mph', 'Profile B': 'Profile B · 65 mph', 'Profile C': 'Profile C · 85 mph', 'Profile D': 'Profile D · 105 mph', 'Profile E': 'Profile E · 109 mph' };
			const modeOptions = (selected) => Object.entries(profileLabels).map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
			container.innerHTML = `<form id="halo-ride-profile-form" class="halo-view-content">
				<section class="halo-card"><div class="halo-card-header"><div><p class="halo-card-kicker">HANDLEBAR MODES</p><h2>Three-position mapping</h2></div></div><p class="halo-card-copy">${remote ? 'Halo will send supported mappings to your motorcycle when it next connects.' : 'These are your recorded Halo mappings. HyperCore ECU programming on the motorcycle remains a separate workshop action.'}</p><div class="halo-mode-mapping"><label class="halo-field"><span>Position 1</span><select name="mode_1">${modeOptions(modes.mode_1)}</select></label><label class="halo-field"><span>Position 2</span><select name="mode_2">${modeOptions(modes.mode_2)}</select></label><label class="halo-field"><span>Position 3</span><select name="mode_3">${modeOptions(modes.mode_3)}</select></label></div><div class="halo-field" style="margin-top:14px"><span>Regeneration profile</span><select name="regen_profile"><option value="Off" ${regen === 'Off' ? 'selected' : ''}>Off</option><option value="Light" ${regen === 'Light' ? 'selected' : ''}>Light</option><option value="Medium" ${regen === 'Medium' ? 'selected' : ''}>Medium</option><option value="Heavy" ${regen === 'Heavy' ? 'selected' : ''}>Heavy</option></select></div></section>
				<button type="submit" class="halo-button halo-button--primary">Save ride profile</button>
			</form>`;
		}

		renderVehicleService(container) {
			const service = this.state.vehicle?.service || {};
			const diagnostics = this.state.vehicle?.diagnostics || {};
			container.innerHTML = `<section class="halo-card"><div class="halo-card-header"><div><p class="halo-card-kicker">MAINTENANCE</p><h2>${escapeHTML(service.status_label || service.status || 'Service status')}</h2></div>${service.attention ? '<span class="halo-badge halo-badge--attention">Attention</span>' : '<span class="halo-badge halo-badge--good">Up to date</span>'}</div><dl class="halo-spec-list"><div class="halo-spec-row"><dt>Next service</dt><dd>${escapeHTML(service.due_date ? formatDate(service.due_date) : service.due_in_miles ? `In ${formatMiles(service.due_in_miles)}` : 'Not scheduled')}</dd></div><div class="halo-spec-row"><dt>Last service</dt><dd>${escapeHTML(service.last_date ? formatDate(service.last_date) : 'No record')}</dd></div><div class="halo-spec-row"><dt>Warranty</dt><dd>${escapeHTML(service.warranty_status || 'View documents')}</dd></div></dl></section>
				<section class="halo-card"><div class="halo-card-header"><div><p class="halo-card-kicker">VEHICLE HEALTH</p><h2>${escapeHTML(diagnostics.summary || 'Diagnostics')}</h2></div>${diagnostics.status ? `<span class="halo-badge ${diagnostics.status === 'healthy' ? 'halo-badge--good' : 'halo-badge--attention'}">${escapeHTML(diagnostics.status)}</span>` : ''}</div><p class="halo-card-copy">${escapeHTML(diagnostics.message || 'Connect your motorcycle to see current diagnostic information.')}</p><div class="halo-action-row"><button type="button" class="halo-button halo-button--secondary" data-action="share-diagnostics" ${diagnostics.available === false || !(diagnostics.share_endpoint || this.state.boot?.endpoints?.diagnostics_share) ? 'disabled' : ''}>Share with support</button></div>${diagnostics.available !== false && !(diagnostics.share_endpoint || this.state.boot?.endpoints?.diagnostics_share) ? '<p class="halo-helper">Diagnostic sharing is not enabled for this motorcycle.</p>' : ''}</section>
				<div class="halo-action-grid"><button type="button" class="halo-action-card" data-action="open-link" data-link-key="book_service">${icon('service')}<span>Book mobile service</span><small>Arrange a visit</small></button><button type="button" class="halo-action-card" data-action="open-link" data-link-key="dealer_locator">${icon('pin')}<span>Authorised dealer</span><small>Workshops and MOTs</small></button><button type="button" class="halo-action-card" data-action="contact-support">${icon('heart')}<span>Technical support</span><small>Speak to Avenrà</small></button></div>`;
		}

		getRides() {
			return asArray(this.state.boot?.activity?.rides || this.state.boot?.rides || this.state.boot?.ride_history);
		}

				renderActivity() {
			const container = $('#halo-activity-content', root);
			if (!container) return;
			const rides = this.getRides();
			const summary = this.state.boot?.activity?.summary || this.state.boot?.ride_summary || {};
			let html = `<div class="halo-summary-grid"><div class="halo-summary-metric"><strong>${formatMiles(summary.distance_miles ?? summary.total_miles, true)}</strong><small>Total distance</small></div><div class="halo-summary-metric"><strong>${formatNumber(summary.ride_count ?? rides.length)}</strong><small>Rides</small></div><div class="halo-summary-metric"><strong>${formatDuration(summary.duration_seconds)}</strong><small>Ride time</small></div></div>`;
			if (!rides.length) {
				html += `<div class="halo-empty-state">${icon('route')}<h2>Your journeys will appear here</h2><p>Plan a route or start a ride. Halo will save it once the ride ends.</p><button type="button" class="halo-button halo-button--primary" data-route-target="ride">Plan a ride</button></div>`;
				} else {
					html += `<div class="halo-section-heading"><h2>Recent rides</h2></div><div class="halo-ride-list">${rides.map((ride, index) => {
					const id = ride.id ?? ride.ride_id ?? index;
					const title = ride.title || ride.destination || ride.end_label || ride.end_location || 'Recorded ride';
					return `<button type="button" class="halo-ride-item" data-ride-id="${escapeAttr(id)}"><span class="halo-ride-item-icon">${icon('route')}</span><span><strong>${escapeHTML(title)}</strong><small>${escapeHTML(formatDate(ride.started_at || ride.date))} · ${escapeHTML(formatDuration(ride.duration_seconds))}</small></span><span class="halo-ride-item-distance">${escapeHTML(formatMiles(ride.distance_miles))}</span></button>`;
					}).join('')}</div>`;
				}
				html += `<div class="halo-section-heading"><h2>Ride Footage</h2><span class="halo-badge">Private device storage</span></div><section class="halo-ride-memory-library" data-ride-memory-library aria-live="polite"><div class="halo-skeleton halo-skeleton--hero" aria-label="Loading Ride Memories"></div></section>`;
				container.innerHTML = html;
				this.renderRideMemoryLibrary().catch(() => null);
			}

			async renderRideMemoryLibrary() {
				const container = $('[data-ride-memory-library]', root);
				if (!container) return;
				const generation = ++this.rideMemoryRenderGeneration;
				const customerKey = String(this.state.customer?.id || this.identityCustomerId || '');
				if (!this.rideMemories?.supported || !customerKey) {
					container.innerHTML = `<article class="halo-callout">${icon('camera')}<div><h3>Ride Footage unavailable</h3><p>This browser cannot provide Halo's private video library.</p></div></article>`;
					return;
				}
				try {
					const rides = await this.rideMemories.listRides({ customerKey });
					if (generation !== this.rideMemoryRenderGeneration || customerKey !== String(this.state.customer?.id || this.identityCustomerId || '')) return;
					const footage = asArray(rides).filter((ride) => Number(ride.segmentCount || 0) > 0);
					if (!footage.length) {
						container.innerHTML = `<article class="halo-callout">${icon('camera')}<div><h3>No Ride Memories yet</h3><p>Enable Record Ride Memories before starting a ride. Only HALO-owned footage saved for this account on this device appears here.</p></div></article>`;
						return;
					}
					const totalBytes = footage.reduce((sum, ride) => sum + Math.max(0, Number(ride.bytes) || 0), 0);
					const unfinishedCount = footage.filter((ride) => ride.status === 'recording').length;
					const savedCount = footage.length - unfinishedCount;
					const totalLabel = [savedCount ? `${savedCount} saved ride${savedCount === 1 ? '' : 's'}` : '', unfinishedCount ? `${unfinishedCount} unfinished` : '', formatBytes(totalBytes)].filter(Boolean).join(' · ');
					container.innerHTML = `<div class="halo-ride-memory-summary"><div><strong>HALO Ride Memories</strong><small>${escapeHTML(totalLabel)} · never uploaded automatically</small></div><span class="halo-badge">Audio off</span></div><div class="halo-ride-memory-list">${footage.map((ride) => {
						const summary = isObject(ride.summary) ? ride.summary : {};
						const unfinished = ride.status === 'recording';
						const cameras = Number(ride.counts?.front || 0) > 0 ? 'Front + rear' : 'Rear camera';
						const telemetry = Number(ride.telemetryPointCount || 0) > 0 ? ' · Telemetry' : '';
						const status = unfinished ? ' · Unfinished' : (ride.status === 'interrupted' || summary.incomplete ? ' · Incomplete' : '');
						const durationSeconds = finite(summary.duration_seconds) ?? (finite(ride.durationMs) === null ? null : Number(ride.durationMs) / 1000);
						const title = summary.title || 'Recorded ride';
						const actions = unfinished
							? `<button type="button" class="halo-button halo-button--secondary halo-ride-memory-recover" data-action="recover-ride-memory" data-memory-ride-id="${escapeAttr(ride.rideId)}">Recover footage</button>`
							: `<button type="button" class="halo-icon-button" data-action="open-ride-memory" data-memory-ride-id="${escapeAttr(ride.rideId)}" aria-label="Play ${escapeAttr(title)}">${icon('camera')}</button><button type="button" class="halo-icon-button halo-danger" data-action="delete-ride-memory" data-memory-ride-id="${escapeAttr(ride.rideId)}" aria-label="Delete ${escapeAttr(title)}">${icon('close')}</button>`;
						return `<article class="halo-ride-memory-item"><span class="halo-ride-memory-item__icon">${icon('camera')}</span><div class="halo-ride-memory-item__copy"><strong>${escapeHTML(title)}</strong><small>${escapeHTML(formatDate(ride.startedAt, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))} · ${escapeHTML(formatDuration(durationSeconds))}</small><small>${escapeHTML(cameras)}${escapeHTML(telemetry)} · ${escapeHTML(formatBytes(ride.bytes || 0))}${escapeHTML(status)}</small></div><div class="halo-ride-memory-item__actions">${actions}</div></article>`;
					}).join('')}</div>`;
				} catch (error) {
					if (generation !== this.rideMemoryRenderGeneration) return;
					container.innerHTML = `<article class="halo-callout">${icon('warning')}<div><h3>Ride Footage unavailable</h3><p>Halo could not open the private footage library on this device.</p></div></article>`;
				}
			}

			async openRideMemory(rideId) {
				const customerKey = String(this.state.customer?.id || this.identityCustomerId || '');
				if (!this.rideMemories?.supported || !customerKey) throw new HaloAPIError('Ride Footage is unavailable on this device.');
				const [rides, segments] = await Promise.all([
					this.rideMemories.listRides({ customerKey }),
					this.rideMemories.getSegments({ customerKey, rideId })
				]);
				if (customerKey !== String(this.state.customer?.id || this.identityCustomerId || '')) throw new HaloAPIError('This footage belongs to an earlier Halo session.', 0, 'stale_identity');
				const ride = asArray(rides).find((item) => String(item.rideId) === String(rideId));
				if (!ride || !segments.length) throw new HaloAPIError('That Ride Memory is no longer available on this device.');
				if (ride.status === 'recording') throw new HaloAPIError('Recover this unfinished Ride Memory before playback.', 0, 'ride_memories_recovery_required');
				const cameras = ['rear', 'front'].filter((camera) => segments.some((segment) => segment.camera === camera));
				const camera = cameras.includes('rear') ? 'rear' : cameras[0];
				const views = cameras.length > 1 ? cameras.concat('dual') : cameras.slice();
				const summary = isObject(ride.summary) ? ride.summary : {};
				this.closeRideMemoryPlayer();
				this.openDialog(summary.title || 'Ride footage', `<div class="halo-ride-memory-player"><div class="halo-ride-memory-player__stage" data-ride-memory-stage><video data-ride-memory-video controls controlslist="nofullscreen noremoteplayback" disablepictureinpicture playsinline preload="metadata" aria-label="Ride Memories video player"></video><span class="halo-ride-memory-player__view-label halo-ride-memory-player__view-label--primary" data-ride-memory-primary-label hidden>Rear</span><div class="halo-ride-memory-player__secondary" data-ride-memory-secondary-wrap hidden><video data-ride-memory-video-secondary muted playsinline preload="metadata" aria-label="Synchronized front camera footage"></video><span class="halo-ride-memory-player__view-label">Front</span></div><div class="halo-ride-memory-overlay" data-ride-memory-telemetry-overlay aria-hidden="true"><div class="halo-ride-memory-overlay__speed"><strong data-ride-memory-telemetry-speed>—</strong><span>MPH</span></div><div class="halo-ride-memory-overlay__detail"><div class="halo-ride-memory-overlay__time"><strong data-ride-memory-telemetry-elapsed>00:00</strong><span>RIDE TIME</span></div><div class="halo-ride-memory-overlay__location"><strong data-ride-memory-telemetry-location>Waiting for telemetry</strong><span><span data-ride-memory-telemetry-clock>—</span> · GPS estimate</span></div></div></div></div><div class="halo-ride-memory-player__meta"><span data-ride-memory-player-position>Preparing footage…</span><span>${escapeHTML(formatBytes(ride.bytes || 0))}</span></div>${views.length > 1 ? `<div class="halo-ride-memory-player__cameras" role="group" aria-label="Camera view">${views.map((role) => `<button type="button" class="halo-button halo-button--secondary ${role === camera ? 'is-active' : ''}" data-action="ride-memory-camera" data-memory-camera="${role}" aria-pressed="${role === camera ? 'true' : 'false'}">${role === 'rear' ? 'Rear' : role === 'front' ? 'Front' : 'Front + rear'}</button>`).join('')}</div>` : ''}<div class="halo-ride-memory-player__telemetry-controls"><button type="button" class="halo-button halo-button--secondary" data-action="ride-memory-telemetry-toggle" aria-pressed="true" disabled>Show telemetry</button><button type="button" class="halo-button halo-button--secondary" data-action="ride-memory-export" disabled>Export clip with telemetry</button></div><p class="halo-ride-memory-player__export-status" data-ride-memory-export-status role="status" aria-live="polite"></p><div class="halo-ride-memory-player__controls"><button type="button" class="halo-button halo-button--secondary" data-action="ride-memory-previous">Previous clip</button><button type="button" class="halo-button halo-button--secondary" data-action="ride-memory-next">Next clip</button></div><p class="halo-helper">Halo plays its recognised saved clips in order as one ride. Front + rear keeps both cameras synchronized in the same window. Telemetry can be hidden during playback. Export creates a new shareable copy of the selected single-camera clip; the private original is never changed.</p></div>`, 'RIDE MEMORIES');
				this.rideMemoryPlayer = { customerKey, rideId: String(rideId), ride, segments, cameras, views, camera, index: 0, token: 0, telemetryVisible: true, currentSegment: null, currentSecondarySegment: null, currentTelemetry: [] };
				await this.loadRideMemoryPlayerSegment(0, true);
			}

			async loadRideMemoryPlayerSegment(index, attemptPlayback) {
				const player = this.rideMemoryPlayer;
				if (!player) return;
				this.clearRideMemorySecondaryStallWatch(player);
				this.cancelRideMemoryExport();
				const primaryCamera = player.camera === 'dual' ? 'rear' : player.camera;
				const cameraSegments = player.segments.filter((segment) => segment.camera === primaryCamera);
				if (!cameraSegments.length) return;
				player.index = Math.max(0, Math.min(cameraSegments.length - 1, Number(index) || 0));
				const descriptor = cameraSegments[player.index];
				const secondaryDescriptor = player.camera === 'dual'
					? player.segments.find((segment) => segment.camera === 'front' && Number(segment.sequence) === Number(descriptor.sequence))
					: null;
				const token = ++player.token;
				const [stored, secondaryStored] = await Promise.all([
					this.rideMemories.getSegment({ customerKey: player.customerKey, rideId: player.rideId, camera: descriptor.camera, sequence: descriptor.sequence }),
					secondaryDescriptor
						? this.rideMemories.getSegment({ customerKey: player.customerKey, rideId: player.rideId, camera: secondaryDescriptor.camera, sequence: secondaryDescriptor.sequence })
						: Promise.resolve(null)
				]);
				if (!stored?.blob || player !== this.rideMemoryPlayer || token !== player.token) return;
				const video = $('[data-ride-memory-video]', this.dom.dialog);
				const secondaryVideo = $('[data-ride-memory-video-secondary]', this.dom.dialog);
				if (!video) return;
				const resetVideo = (element) => {
					if (!element) return;
					try {
						element.pause();
						for (const handler of ['onended', 'ontimeupdate', 'onloadedmetadata', 'onloadeddata', 'oncanplay', 'onseeking', 'onseeked', 'onplay', 'onplaying', 'onpause', 'onwaiting', 'onstalled', 'onratechange', 'onerror']) element[handler] = null;
						element.removeAttribute('src');
						element.load();
					} catch (error) { /* The previous clip is already released. */ }
				};
				resetVideo(video);
				resetVideo(secondaryVideo);
				this.releaseRideMemoryObjectUrl();
				const url = URL.createObjectURL(stored.blob);
				this.rideMemoryObjectUrl = url;
				player.currentSegment = stored;
				player.currentSecondarySegment = secondaryStored?.blob ? secondaryStored : null;
				player.secondaryPlaybackFailures = 0;
				player.secondaryPlayPending = false;
				player.currentTelemetry = asArray(stored.telemetry);
				video.src = url;
				const stage = $('[data-ride-memory-stage]', this.dom.dialog);
				const secondaryWrap = $('[data-ride-memory-secondary-wrap]', this.dom.dialog);
				const primaryLabel = $('[data-ride-memory-primary-label]', this.dom.dialog);
				const combined = player.camera === 'dual' && Boolean(secondaryStored?.blob && secondaryVideo);
				stage?.classList.toggle('is-dual', combined);
				if (secondaryWrap) secondaryWrap.hidden = !combined;
				if (primaryLabel) primaryLabel.hidden = !combined;
				if (combined) {
					const secondaryUrl = URL.createObjectURL(secondaryStored.blob);
					this.rideMemorySecondaryObjectUrl = secondaryUrl;
					secondaryVideo.src = secondaryUrl;
					secondaryVideo.onloadedmetadata = () => this.syncRideMemorySecondaryVideo(true);
					secondaryVideo.onloadeddata = () => this.syncRideMemorySecondaryVideo(true);
					secondaryVideo.oncanplay = () => this.syncRideMemorySecondaryVideo(true);
					secondaryVideo.onplaying = () => {
						if (player === this.rideMemoryPlayer) {
							this.clearRideMemorySecondaryStallWatch(player);
							player.secondaryPlaybackFailures = 0;
						}
					};
					secondaryVideo.ontimeupdate = () => {
						if (player === this.rideMemoryPlayer && secondaryVideo.readyState >= 3) this.clearRideMemorySecondaryStallWatch(player);
					};
					secondaryVideo.onwaiting = () => this.watchRideMemorySecondaryStall(player);
					secondaryVideo.onstalled = secondaryVideo.onwaiting;
					secondaryVideo.onerror = () => this.degradeRideMemorySecondaryVideo();
					secondaryVideo.load();
				}
				video.ontimeupdate = () => { this.updateRideMemoryTelemetryOverlay(); this.syncRideMemorySecondaryVideo(false); };
				video.onloadedmetadata = () => {
					const resumeRatio = finite(player.pendingResumeRatio);
					if (resumeRatio !== null && Number.isFinite(Number(video.duration)) && Number(video.duration) > 0) {
						try { video.currentTime = Math.max(0, Math.min(Number(video.duration), Number(video.duration) * resumeRatio)); } catch (error) { /* Seeking remains optional. */ }
					}
					player.pendingResumeRatio = null;
					this.updateRideMemoryTelemetryOverlay();
					this.syncRideMemorySecondaryVideo(true);
				};
				video.onseeking = () => { this.updateRideMemoryTelemetryOverlay(); this.syncRideMemorySecondaryVideo(true); };
				video.onseeked = () => this.syncRideMemorySecondaryVideo(true);
				video.onplay = () => this.syncRideMemorySecondaryVideo(true);
				video.onplaying = () => this.syncRideMemorySecondaryVideo(true);
				video.onpause = () => this.syncRideMemorySecondaryVideo(false);
				video.onwaiting = () => {
					this.clearRideMemorySecondaryStallWatch(player);
					try { secondaryVideo?.pause(); } catch (error) { /* The inset is already paused. */ }
				};
				video.onstalled = video.onwaiting;
				video.onratechange = () => this.syncRideMemorySecondaryVideo(true);
				video.onended = () => {
					try { secondaryVideo?.pause(); } catch (error) { /* The inset is already stopped. */ }
					if (player === this.rideMemoryPlayer && player.index < cameraSegments.length - 1) this.loadRideMemoryPlayerSegment(player.index + 1, true).catch(() => null);
				};
				video.load();
				if (attemptPlayback) video.play().then(() => this.syncRideMemorySecondaryVideo(true)).catch(() => null);
				const exportStatus = $('[data-ride-memory-export-status]', this.dom.dialog);
				if (exportStatus) exportStatus.textContent = '';
				this.updateRideMemoryTelemetryControls();
				this.updateRideMemoryTelemetryOverlay();
				const position = $('[data-ride-memory-player-position]', this.dom.dialog);
				if (position) position.textContent = `${combined ? 'Front + rear' : (primaryCamera === 'rear' ? 'Rear' : 'Front')} · clip ${player.index + 1} of ${cameraSegments.length}${player.camera === 'dual' && !combined ? ' · front clip unavailable' : ''}`;
				const previous = $('[data-action="ride-memory-previous"]', this.dom.dialog);
				const next = $('[data-action="ride-memory-next"]', this.dom.dialog);
				if (previous) previous.disabled = player.index === 0;
				if (next) next.disabled = player.index >= cameraSegments.length - 1;
			}

			clearRideMemorySecondaryStallWatch(player) {
				const target = player || this.rideMemoryPlayer;
				if (!target?.secondaryStallTimer) return;
				window.clearTimeout(target.secondaryStallTimer);
				target.secondaryStallTimer = null;
			}

			watchRideMemorySecondaryStall(player) {
				if (!player || player !== this.rideMemoryPlayer || player.camera !== 'dual' || !player.currentSecondarySegment) return;
				this.clearRideMemorySecondaryStallWatch(player);
				player.secondaryStallTimer = window.setTimeout(() => {
					player.secondaryStallTimer = null;
					if (player !== this.rideMemoryPlayer || player.camera !== 'dual' || !player.currentSecondarySegment) return;
					const primary = $('[data-ride-memory-video]', this.dom.dialog);
					const secondary = $('[data-ride-memory-video-secondary]', this.dom.dialog);
					if (!primary || primary.paused || primary.ended || !secondary) return;
					const primaryDuration = finite(primary.duration);
					const secondaryDuration = finite(secondary.duration);
					const expected = primaryDuration !== null && primaryDuration > 0 && secondaryDuration !== null && secondaryDuration > 0
						? (Math.max(0, Number(primary.currentTime) || 0) / primaryDuration) * secondaryDuration
						: Number(secondary.currentTime) || 0;
					const outOfSync = Math.abs((Number(secondary.currentTime) || 0) - expected) > .75;
					if (secondary.paused || secondary.readyState < 3 || outOfSync) this.degradeRideMemorySecondaryVideo();
				}, 3000);
			}

			degradeRideMemorySecondaryVideo() {
				const player = this.rideMemoryPlayer;
				if (!player || player.camera !== 'dual' || !player.currentSecondarySegment) return;
				this.clearRideMemorySecondaryStallWatch(player);
				player.currentSecondarySegment = null;
				player.secondaryPlayPending = false;
				const secondary = $('[data-ride-memory-video-secondary]', this.dom.dialog);
				try {
					secondary?.pause();
					secondary?.removeAttribute('src');
					secondary?.load();
				} catch (error) { /* The secondary decoder is already unavailable. */ }
				if (this.rideMemorySecondaryObjectUrl) {
					try { URL.revokeObjectURL(this.rideMemorySecondaryObjectUrl); } catch (error) { /* The URL is already unavailable. */ }
					this.rideMemorySecondaryObjectUrl = '';
				}
				$('[data-ride-memory-stage]', this.dom.dialog)?.classList.remove('is-dual');
				const secondaryWrap = $('[data-ride-memory-secondary-wrap]', this.dom.dialog);
				const primaryLabel = $('[data-ride-memory-primary-label]', this.dom.dialog);
				if (secondaryWrap) secondaryWrap.hidden = true;
				if (primaryLabel) primaryLabel.hidden = true;
				const rearCount = player.segments.filter((segment) => segment.camera === 'rear').length;
				const position = $('[data-ride-memory-player-position]', this.dom.dialog);
				if (position) position.textContent = `Rear · clip ${player.index + 1} of ${rearCount} · front playback unavailable`;
				const status = $('[data-ride-memory-export-status]', this.dom.dialog);
				if (status) status.textContent = 'This device could not decode both videos together. Choose Front to play it on its own.';
			}

			syncRideMemorySecondaryVideo(force) {
				const player = this.rideMemoryPlayer;
				if (!player || player.camera !== 'dual' || !player.currentSecondarySegment) return;
				const primary = $('[data-ride-memory-video]', this.dom.dialog);
				const secondary = $('[data-ride-memory-video-secondary]', this.dom.dialog);
				if (!primary || !secondary || !secondary.src) return;
				const primaryDuration = finite(primary.duration);
				const secondaryDuration = finite(secondary.duration);
				let synchronizedRate = primary.playbackRate;
				if (primaryDuration !== null && primaryDuration > 0 && secondaryDuration !== null && secondaryDuration > 0) {
					const target = Math.max(0, Math.min(secondaryDuration, (Math.max(0, Number(primary.currentTime) || 0) / primaryDuration) * secondaryDuration));
					if (force || Math.abs((Number(secondary.currentTime) || 0) - target) > .25) {
						try { secondary.currentTime = target; } catch (error) { /* Metadata may still be settling. */ }
					}
					/* Recorder tracks can encode to slightly different media durations even
					 * though they describe the same wall-clock segment. Match normalized
					 * progress continuously so the inset does not drift between corrections. */
					synchronizedRate = primary.playbackRate * (secondaryDuration / primaryDuration);
				}
				try { secondary.playbackRate = Math.max(.25, Math.min(4, synchronizedRate)); }
				catch (error) { try { secondary.playbackRate = primary.playbackRate; } catch (fallbackError) { /* Keep the platform default. */ } }
				if (primary.paused || primary.ended) {
					this.clearRideMemorySecondaryStallWatch(player);
					try { secondary.pause(); } catch (error) { /* The inset is already paused. */ }
				} else if (secondary.paused && secondary.readyState >= 2 && !player.secondaryPlayPending) {
					player.secondaryPlayPending = true;
					this.watchRideMemorySecondaryStall(player);
					secondary.play().then(() => {
						if (player === this.rideMemoryPlayer) {
							this.clearRideMemorySecondaryStallWatch(player);
							player.secondaryPlayPending = false;
							player.secondaryPlaybackFailures = 0;
						}
					}).catch((error) => {
						if (player !== this.rideMemoryPlayer) return;
						player.secondaryPlayPending = false;
						if (String(error?.name || '') === 'AbortError' || primary.paused) return;
						player.secondaryPlaybackFailures = Number(player.secondaryPlaybackFailures || 0) + 1;
						if (player.secondaryPlaybackFailures >= 2) this.degradeRideMemorySecondaryVideo();
					});
				} else if (secondary.readyState < 2 || secondary.paused) {
					this.watchRideMemorySecondaryStall(player);
				}
			}

			rideMemoryExportSupported() {
				const canvas = document.createElement('canvas');
				return Boolean(window.MediaRecorder && typeof canvas.captureStream === 'function');
			}

			resolveRideMemoryTelemetry(points, absoluteAt) {
				const telemetry = asArray(points)
					.filter((point) => Number.isFinite(Number(point?.at)))
					.sort((left, right) => Number(left.at) - Number(right.at));
				if (!telemetry.length || !Number.isFinite(Number(absoluteAt))) return null;
				if (telemetry.length === 1) return Math.abs(absoluteAt - Number(telemetry[0].at)) <= 3500 ? Object.assign({}, telemetry[0]) : null;
				if (absoluteAt <= Number(telemetry[0].at)) return Number(telemetry[0].at) - absoluteAt <= 3500 ? Object.assign({}, telemetry[0]) : null;
				const finalPoint = telemetry[telemetry.length - 1];
				if (absoluteAt >= Number(finalPoint.at)) return absoluteAt - Number(finalPoint.at) <= 3500 ? Object.assign({}, finalPoint) : null;
				let rightIndex = telemetry.findIndex((point) => Number(point.at) >= absoluteAt);
				if (rightIndex < 1) rightIndex = 1;
				const left = telemetry[rightIndex - 1];
				const right = telemetry[rightIndex];
				const span = Math.max(1, Number(right.at) - Number(left.at));
				if (span > 6000) {
					const nearest = absoluteAt - Number(left.at) <= Number(right.at) - absoluteAt ? left : right;
					return Math.abs(absoluteAt - Number(nearest.at)) <= 3000 ? Object.assign({}, nearest) : null;
				}
				const ratio = Math.max(0, Math.min(1, (absoluteAt - Number(left.at)) / span));
				const nearest = ratio < .5 ? left : right;
				const sample = Object.assign({}, nearest, { at: absoluteAt });
				for (const key of ['speedMph', 'lat', 'lng', 'accuracy', 'heading', 'elapsedSeconds']) {
					const from = finite(left[key]);
					const to = finite(right[key]);
					if (from !== null && to !== null) sample[key] = from + ((to - from) * ratio);
					else if (finite(nearest[key]) === null) delete sample[key];
				}
				sample.roadName = text(nearest.roadName).trim();
				return sample;
			}

			rideMemoryPlaybackTime(segment, video) {
				const startedAt = Date.parse(String(segment?.startedAt || ''));
				if (!Number.isFinite(startedAt)) return Date.now();
				const endedAt = Date.parse(String(segment?.endedAt || ''));
				const duration = finite(video?.duration);
				const currentTime = Math.max(0, Number(video?.currentTime) || 0);
				if (Number.isFinite(endedAt) && endedAt >= startedAt && duration !== null && duration > 0) {
					return startedAt + ((endedAt - startedAt) * Math.max(0, Math.min(1, currentTime / duration)));
				}
				return startedAt + (currentTime * 1000);
			}

			formatRideMemoryLocation(sample) {
				const roadName = text(sample?.roadName).trim();
				if (roadName) return roadName;
				const latitude = finite(sample?.lat);
				const longitude = finite(sample?.lng);
				if (latitude === null || longitude === null) return 'Location unavailable';
				return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
			}

			updateRideMemoryTelemetryControls() {
				const player = this.rideMemoryPlayer;
				if (!player) return;
				const hasTelemetry = asArray(player.currentTelemetry).length > 0;
				const overlay = $('[data-ride-memory-telemetry-overlay]', this.dom.dialog);
				const toggle = $('[data-action="ride-memory-telemetry-toggle"]', this.dom.dialog);
				const exportButton = $('[data-action="ride-memory-export"]', this.dom.dialog);
				const visible = hasTelemetry && player.telemetryVisible !== false;
				if (overlay) {
					overlay.hidden = !visible;
					overlay.setAttribute('aria-hidden', String(!visible));
				}
				if (toggle) {
					toggle.disabled = !hasTelemetry;
					toggle.setAttribute('aria-pressed', String(visible));
					toggle.textContent = !hasTelemetry ? 'Telemetry unavailable' : (visible ? 'Hide telemetry' : 'Show telemetry');
				}
				if (exportButton && !this.rideMemoryExport) {
					const supported = this.rideMemoryExportSupported();
					const combined = player.camera === 'dual';
					exportButton.disabled = !hasTelemetry || !supported || combined;
					exportButton.textContent = combined ? 'Choose one view to export' : (supported ? 'Export clip with telemetry' : 'Export unsupported');
				}
			}

			toggleRideMemoryTelemetry() {
				const player = this.rideMemoryPlayer;
				if (!player || !asArray(player.currentTelemetry).length) return;
				player.telemetryVisible = player.telemetryVisible === false;
				this.updateRideMemoryTelemetryControls();
				this.updateRideMemoryTelemetryOverlay();
			}

			updateRideMemoryTelemetryOverlay() {
				const player = this.rideMemoryPlayer;
				const video = $('[data-ride-memory-video]', this.dom.dialog);
				const segment = player?.currentSegment;
				if (!player || !video || !segment) return;
				const absoluteAt = this.rideMemoryPlaybackTime(segment, video);
				const sample = this.resolveRideMemoryTelemetry(player.currentTelemetry, absoluteAt);
				const rideStartedAt = Date.parse(String(player.ride?.startedAt || ''));
				const elapsedSeconds = finite(sample?.elapsedSeconds) ?? (Number.isFinite(rideStartedAt) ? Math.max(0, (absoluteAt - rideStartedAt) / 1000) : 0);
				const speed = $('[data-ride-memory-telemetry-speed]', this.dom.dialog);
				const elapsed = $('[data-ride-memory-telemetry-elapsed]', this.dom.dialog);
				const location = $('[data-ride-memory-telemetry-location]', this.dom.dialog);
				const clock = $('[data-ride-memory-telemetry-clock]', this.dom.dialog);
				if (speed) speed.textContent = finite(sample?.speedMph) === null ? '—' : String(Math.max(0, Math.round(sample.speedMph)));
				if (elapsed) elapsed.textContent = formatRideClock(elapsedSeconds);
				if (location) location.textContent = this.formatRideMemoryLocation(sample);
				if (clock) clock.textContent = new Date(absoluteAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
			}

			async switchRideMemoryCamera(camera) {
				const player = this.rideMemoryPlayer;
				if (!player || !asArray(player.views || player.cameras).includes(camera)) return;
				const currentSequence = Number(player.currentSegment?.sequence);
				const currentVideo = $('[data-ride-memory-video]', this.dom.dialog);
				const currentDuration = finite(currentVideo?.duration);
				player.pendingResumeRatio = currentDuration !== null && currentDuration > 0
					? Math.max(0, Math.min(1, (Number(currentVideo.currentTime) || 0) / currentDuration))
					: null;
				player.camera = camera;
				$$('[data-action="ride-memory-camera"]', this.dom.dialog).forEach((button) => {
					const active = button.dataset.memoryCamera === camera;
					button.classList.toggle('is-active', active);
					button.setAttribute('aria-pressed', String(active));
				});
				const targetCamera = camera === 'dual' ? 'rear' : camera;
				const targetSegments = player.segments.filter((segment) => segment.camera === targetCamera);
				const matchingIndex = Number.isFinite(currentSequence)
					? targetSegments.findIndex((segment) => Number(segment.sequence) === currentSequence)
					: -1;
				await this.loadRideMemoryPlayerSegment(matchingIndex >= 0 ? matchingIndex : player.index, true);
			}

			async stepRideMemory(direction) {
				if (!this.rideMemoryPlayer) return;
				await this.loadRideMemoryPlayerSegment(this.rideMemoryPlayer.index + (direction > 0 ? 1 : -1), true);
			}

			canvasRoundedRect(context, x, y, width, height, radius) {
				const corner = Math.max(0, Math.min(radius, width / 2, height / 2));
				context.beginPath();
				context.moveTo(x + corner, y);
				context.lineTo(x + width - corner, y);
				context.quadraticCurveTo(x + width, y, x + width, y + corner);
				context.lineTo(x + width, y + height - corner);
				context.quadraticCurveTo(x + width, y + height, x + width - corner, y + height);
				context.lineTo(x + corner, y + height);
				context.quadraticCurveTo(x, y + height, x, y + height - corner);
				context.lineTo(x, y + corner);
				context.quadraticCurveTo(x, y, x + corner, y);
				context.closePath();
			}

			fitRideMemoryCanvasText(context, value, maximumWidth) {
				const source = text(value);
				if (!source || context.measureText(source).width <= maximumWidth) return source;
				let output = source;
				while (output.length > 1 && context.measureText(`${output}…`).width > maximumWidth) output = output.slice(0, -1);
				return `${output}…`;
			}

			drawRideMemoryTelemetryFrame(context, canvas, video, segment, telemetry, ride) {
				const width = canvas.width;
				const height = canvas.height;
				context.clearRect(0, 0, width, height);
				context.drawImage(video, 0, 0, width, height);
				const scale = Math.max(.72, Math.min(2.2, Math.min(width, height) / 560));
				const margin = Math.round(18 * scale);
				const gap = Math.round(10 * scale);
				const panelHeight = Math.round(88 * scale);
				const speedWidth = Math.min(Math.round(126 * scale), Math.round(width * .31));
				const detailWidth = Math.max(1, width - (margin * 2) - speedWidth - gap);
				const y = Math.max(margin, height - margin - panelHeight);
				const absoluteAt = this.rideMemoryPlaybackTime(segment, video);
				const sample = this.resolveRideMemoryTelemetry(telemetry, absoluteAt);
				const rideStartedAt = Date.parse(String(ride?.startedAt || ''));
				const elapsedSeconds = finite(sample?.elapsedSeconds) ?? (Number.isFinite(rideStartedAt) ? Math.max(0, (absoluteAt - rideStartedAt) / 1000) : 0);
				const speed = finite(sample?.speedMph);
				const location = this.formatRideMemoryLocation(sample);
				const clock = new Date(absoluteAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

				context.save();
				context.fillStyle = 'rgba(8, 11, 14, .82)';
				this.canvasRoundedRect(context, margin, y, speedWidth, panelHeight, Math.round(17 * scale));
				context.fill();
				this.canvasRoundedRect(context, margin + speedWidth + gap, y, detailWidth, panelHeight, Math.round(17 * scale));
				context.fill();

				context.fillStyle = '#ffffff';
				context.textBaseline = 'alphabetic';
				context.font = `700 ${Math.round(40 * scale)}px Arial, sans-serif`;
				context.fillText(speed === null ? '—' : String(Math.max(0, Math.round(speed))), margin + Math.round(15 * scale), y + Math.round(50 * scale));
				context.fillStyle = 'rgba(255,255,255,.68)';
				context.font = `700 ${Math.round(10 * scale)}px Arial, sans-serif`;
				context.fillText('MPH · GPS ESTIMATE', margin + Math.round(16 * scale), y + Math.round(70 * scale));

				const detailX = margin + speedWidth + gap + Math.round(16 * scale);
				const maximumTextWidth = Math.max(1, detailWidth - Math.round(32 * scale));
				context.fillStyle = '#ffffff';
				context.font = `700 ${Math.round(17 * scale)}px Arial, sans-serif`;
				context.fillText(this.fitRideMemoryCanvasText(context, location, maximumTextWidth), detailX, y + Math.round(31 * scale));
				context.fillStyle = 'rgba(255,255,255,.75)';
				context.font = `600 ${Math.round(12 * scale)}px Arial, sans-serif`;
				context.fillText(`${formatRideClock(elapsedSeconds)} RIDE · ${clock}`, detailX, y + Math.round(57 * scale));
				context.fillStyle = 'rgba(255,255,255,.5)';
				context.font = `700 ${Math.round(9 * scale)}px Arial, sans-serif`;
				context.fillText('AVENRÀ HALO', detailX, y + Math.round(75 * scale));
				context.restore();
			}

			rideMemoryExportMimeTypes() {
				const candidates = ['video/mp4;codecs=h264', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
				if (typeof window.MediaRecorder?.isTypeSupported !== 'function') return [''];
				return candidates.filter((mimeType) => window.MediaRecorder.isTypeSupported(mimeType));
			}

			rideMemoryExportMimeType() {
				return this.rideMemoryExportMimeTypes()[0] || '';
			}

			async createRideMemoryTelemetryExport(job, segment, telemetry, ride) {
				const sourceUrl = URL.createObjectURL(segment.blob);
				const video = document.createElement('video');
				video.muted = true;
				video.playsInline = true;
				video.preload = 'auto';
				job.video = video;
				job.sourceUrl = sourceUrl;
				try {
					await new Promise((resolve, reject) => {
						job.rejectPrepare = reject;
						job.prepareTimeout = window.setTimeout(() => {
							job.prepareTimeout = null;
							reject(new HaloAPIError('Halo timed out while preparing this clip for export.', 0, 'ride_memory_export_timeout'));
						}, 15000);
						const prepared = () => {
							if (video.readyState < 2) return;
							if (job.prepareTimeout) window.clearTimeout(job.prepareTimeout);
							job.prepareTimeout = null;
							job.rejectPrepare = null;
							video.onloadeddata = null;
							video.oncanplay = null;
							resolve();
						};
						video.onloadeddata = prepared;
						video.oncanplay = prepared;
						video.onerror = () => {
							if (job.prepareTimeout) window.clearTimeout(job.prepareTimeout);
							job.prepareTimeout = null;
							job.rejectPrepare = null;
							reject(new HaloAPIError('Halo could not decode this saved clip for export.', 0, 'ride_memory_export_decode_failed'));
						};
						video.src = sourceUrl;
						video.load();
					});
					if (job.cancelled) throw new HaloAPIError('Ride Memory export cancelled.', 0, 'ride_memory_export_cancelled');
					const sourceWidth = Math.max(2, Number(video.videoWidth) || 1280);
					const sourceHeight = Math.max(2, Number(video.videoHeight) || 720);
					const dimensionScale = Math.min(1, 1920 / Math.max(sourceWidth, sourceHeight));
					const canvas = document.createElement('canvas');
					canvas.width = Math.max(2, Math.floor((sourceWidth * dimensionScale) / 2) * 2);
					canvas.height = Math.max(2, Math.floor((sourceHeight * dimensionScale) / 2) * 2);
					const context = canvas.getContext('2d', { alpha: false });
					if (!context) throw new HaloAPIError('Halo could not create the telemetry export surface.', 0, 'ride_memory_export_canvas_failed');
					const stream = canvas.captureStream(24);
					job.stream = stream;
					let recorder = null;
					let mimeType = '';
					const mimeCandidates = Array.from(new Set(this.rideMemoryExportMimeTypes().concat('')));
					for (const candidate of mimeCandidates) {
						const recorderOptions = { videoBitsPerSecond: 4000000 };
						if (candidate) recorderOptions.mimeType = candidate;
						try {
							recorder = new window.MediaRecorder(stream, recorderOptions);
							mimeType = candidate;
							break;
						} catch (error) { /* Try the next supported encoder contract. */ }
					}
					if (!recorder) throw new HaloAPIError('This device cannot encode a telemetry copy of the clip.', 0, 'ride_memory_export_encoder_unavailable');
					job.recorder = recorder;
					const chunks = [];
					const stopped = new Promise((resolve, reject) => {
						job.rejectStopped = reject;
						recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
						recorder.onerror = () => {
							const failure = new HaloAPIError('The telemetry export encoder stopped unexpectedly.', 0, 'ride_memory_export_encode_failed');
							job.rejectPlayback?.(failure);
							job.rejectStopped = null;
							reject(failure);
						};
						recorder.onstop = () => { job.rejectStopped = null; resolve(); };
					});
					/* The recorder can fail before playback has begun. Attach a handler now;
					 * the original promise is still awaited below and preserves the error. */
					stopped.catch(() => null);
					let animationFrame = 0;
					const draw = () => {
						if (job.cancelled) return;
						try { this.drawRideMemoryTelemetryFrame(context, canvas, video, segment, telemetry, ride); }
						catch (error) {
							job.rejectPlayback?.(new HaloAPIError('Halo could not render this clip for telemetry export.', 0, 'ride_memory_export_render_failed'));
							return;
						}
						animationFrame = window.requestAnimationFrame(draw);
					};
					job.cancelAnimation = () => { if (animationFrame) window.cancelAnimationFrame(animationFrame); };
					const playback = new Promise((resolve, reject) => {
						job.rejectPlayback = reject;
						video.onended = () => { job.rejectPlayback = null; resolve(); };
						video.onerror = () => reject(new HaloAPIError('The saved clip stopped while Halo was exporting it.', 0, 'ride_memory_export_decode_failed'));
						const durationSeconds = finite(video.duration) ?? 15;
						job.timeout = window.setTimeout(() => reject(new HaloAPIError('Halo timed out while exporting this clip.', 0, 'ride_memory_export_timeout')), Math.min(180000, Math.max(20000, (durationSeconds * 1000) + 15000)));
					});
					/* Cancellation may reject playback while play() is still pending. Keep
					 * that rejection handled until the original promise is awaited below. */
					playback.catch(() => null);
					recorder.start(1000);
					draw();
					video.currentTime = 0;
					try { await video.play(); }
					catch (error) {
						if (job.cancelled) throw new HaloAPIError('Ride Memory export cancelled.', 0, 'ride_memory_export_cancelled');
						throw new HaloAPIError('Halo could not start the saved clip for export.', 0, 'ride_memory_export_playback_failed');
					}
					await playback;
					if (job.cancelled) throw new HaloAPIError('Ride Memory export cancelled.', 0, 'ride_memory_export_cancelled');
					window.clearTimeout(job.timeout);
					job.timeout = null;
					this.drawRideMemoryTelemetryFrame(context, canvas, video, segment, telemetry, ride);
					job.cancelAnimation();
					if (recorder.state !== 'inactive') {
						try { recorder.stop(); }
						catch (error) { throw new HaloAPIError('Halo could not finalize the telemetry copy.', 0, 'ride_memory_export_finalize_failed'); }
					}
					job.finalizeTimeout = window.setTimeout(() => {
						job.finalizeTimeout = null;
						job.rejectStopped?.(new HaloAPIError('Halo timed out while finalizing the telemetry copy.', 0, 'ride_memory_export_finalize_timeout'));
					}, 10000);
					await stopped;
					if (job.finalizeTimeout) window.clearTimeout(job.finalizeTimeout);
					job.finalizeTimeout = null;
					if (job.cancelled) throw new HaloAPIError('Ride Memory export cancelled.', 0, 'ride_memory_export_cancelled');
					const outputType = String(recorder.mimeType || mimeType || 'video/webm').split(';')[0];
					const blob = new Blob(chunks, { type: outputType });
					if (!blob.size) throw new HaloAPIError('Halo did not receive any encoded export data.', 0, 'ride_memory_export_empty');
					return blob;
				} finally {
					job.rejectPrepare = null;
					job.rejectPlayback = null;
					job.rejectStopped = null;
					video.onloadeddata = null;
					video.oncanplay = null;
					video.onended = null;
					video.onerror = null;
					if (job.prepareTimeout) window.clearTimeout(job.prepareTimeout);
					job.prepareTimeout = null;
					if (job.finalizeTimeout) window.clearTimeout(job.finalizeTimeout);
					job.finalizeTimeout = null;
					if (job.timeout) window.clearTimeout(job.timeout);
					job.cancelAnimation?.();
					try { video.pause(); } catch (error) { /* Playback is already stopped. */ }
					if (job.recorder?.state && job.recorder.state !== 'inactive') {
						try { job.recorder.stop(); } catch (error) { /* Recorder cleanup is best-effort. */ }
					}
					job.stream?.getTracks?.().forEach((track) => track.stop());
					video.removeAttribute('src');
					video.load();
					URL.revokeObjectURL(sourceUrl);
				}
			}

			rideMemoryNativeExport(objectUrl, filename, mimeType) {
				const payload = {
					url: objectUrl,
					downloadUrl: objectUrl,
					fileName: filename,
					isBlob: true,
					mimeType,
					openFileAfterDownload: false
				};
				const android = window.WebToNativeInterface;
				if (typeof android?.downloadFile === 'function') {
					try { android.downloadFile(JSON.stringify(payload)); return true; }
					catch (error) { /* Try the pinned SDK or browser path. */ }
				}
				const ios = window.webkit?.messageHandlers?.webToNativeInterface;
				if (typeof ios?.postMessage === 'function') {
					try { ios.postMessage({ action: 'downloadBlobFile', fileName: filename, url: objectUrl }); return true; }
					catch (error) { /* Try the pinned SDK or browser path. */ }
				}
				if (window.WTN?.isAndroidApp && typeof window.WTN.customFileDownload === 'function') {
					try { window.WTN.customFileDownload(payload); return true; }
					catch (error) { /* Use the browser fallback. */ }
				}
				if (window.WTN?.isIosApp && typeof window.WTN.downloadBlobFile === 'function') {
					try { window.WTN.downloadBlobFile({ fileName: filename, downloadUrl: objectUrl }); return true; }
					catch (error) { /* Use the browser fallback. */ }
				}
				return false;
			}

			async deliverRideMemoryTelemetryExport(blob, filename) {
				let file = null;
				if (typeof window.File === 'function') {
					try { file = new window.File([blob], filename, { type: blob.type || 'video/webm', lastModified: Date.now() }); }
					catch (error) { file = null; }
				}
				const isNative = Boolean(this.nativeRide?.capabilities?.().nativeBridge
					|| window.WebToNativeInterface?.downloadFile
					|| window.webkit?.messageHandlers?.webToNativeInterface?.postMessage
					|| window.WTN?.isAndroidApp
					|| window.WTN?.isIosApp);
				let canShareFile = false;
				if (!isNative && file && typeof navigator.canShare === 'function') {
					try { canShareFile = navigator.canShare({ files: [file] }); }
					catch (error) { canShareFile = false; }
				}
				if (canShareFile && typeof navigator.share === 'function') {
					try {
						await navigator.share({ title: 'Avenrà Halo Ride Memory', text: 'Ride Memory with locally rendered telemetry.', files: [file] });
						return 'shared';
					} catch (error) {
						if (String(error?.name || '') === 'AbortError') return 'cancelled';
					}
				}
				const objectUrl = URL.createObjectURL(blob);
				if (this.rideMemoryNativeExport(objectUrl, filename, blob.type || 'video/webm')) {
					window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60 * 1000);
					return 'native';
				}
				try {
					const link = document.createElement('a');
					link.href = objectUrl;
					link.download = filename;
					link.rel = 'noopener';
					link.hidden = true;
					document.body.appendChild(link);
					link.click();
					link.remove();
					window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60 * 1000);
					return 'download';
				} catch (error) {
					URL.revokeObjectURL(objectUrl);
					throw new HaloAPIError('Halo created the telemetry copy but this device could not save or share it.', 0, 'ride_memory_export_delivery_failed');
				}
			}

			cancelRideMemoryExport(reason) {
				const job = this.rideMemoryExport;
				if (!job) return;
				if (reason === 'backgrounded' && job.phase !== 'encoding') return;
				job.cancelled = true;
				job.cancelReason = reason || '';
				const cancellation = new HaloAPIError('Ride Memory export cancelled.', 0, 'ride_memory_export_cancelled');
				job.rejectPrepare?.(cancellation);
				job.rejectPlayback?.(cancellation);
				job.rejectStopped?.(cancellation);
				if (job.prepareTimeout) window.clearTimeout(job.prepareTimeout);
				job.prepareTimeout = null;
				if (job.finalizeTimeout) window.clearTimeout(job.finalizeTimeout);
				job.finalizeTimeout = null;
				if (job.timeout) window.clearTimeout(job.timeout);
				job.cancelAnimation?.();
				try { job.video?.pause?.(); } catch (error) { /* Playback is already stopped. */ }
				if (job.recorder?.state && job.recorder.state !== 'inactive') {
					try { job.recorder.stop(); } catch (error) { /* Recorder is already stopping. */ }
				}
				job.stream?.getTracks?.().forEach((track) => track.stop());
				if (reason === 'backgrounded') {
					const status = $('[data-ride-memory-export-status]', this.dom.dialog);
					if (status) status.textContent = 'Export cancelled when Halo left the foreground. Start it again while Halo remains visible.';
				}
			}

			async exportRideMemoryClip(button) {
				const player = this.rideMemoryPlayer;
				const segment = player?.currentSegment;
				const telemetry = asArray(player?.currentTelemetry).map((point) => Object.assign({}, point));
				if (!player || !segment?.blob || !telemetry.length) throw new HaloAPIError('Telemetry is unavailable for this clip.');
				if (player.camera === 'dual') throw new HaloAPIError('Choose Rear or Front before exporting a telemetry copy.');
				if (!this.rideMemoryExportSupported()) throw new HaloAPIError('This device cannot export a burned-in telemetry copy. Playback telemetry remains available.');
				if (this.rideMemoryExport) return;
				const job = { cancelled: false, cancelReason: '', phase: 'encoding', prepareTimeout: null, finalizeTimeout: null, timeout: null, recorder: null, stream: null, video: null, rejectPrepare: null, rejectPlayback: null, rejectStopped: null };
				this.rideMemoryExport = job;
				const status = $('[data-ride-memory-export-status]', this.dom.dialog);
				if (status) status.textContent = 'Exporting this clip in real time. Keep Halo open until it finishes…';
				this.setLoading(button, true);
				try {
					const output = await this.createRideMemoryTelemetryExport(job, segment, telemetry, player.ride);
					if (job.cancelled || player !== this.rideMemoryPlayer) return;
					const sourceName = text(segment.filename, `HALO_RIDE_${player.rideId}_${player.camera}_${segment.sequence}.webm`);
					const extension = String(output.type || '').toLowerCase() === 'video/mp4' ? 'mp4' : 'webm';
					const filename = `${sourceName.replace(/\.[A-Za-z0-9]+$/, '')}_TELEMETRY.${extension}`;
					job.phase = 'delivery';
					const delivery = await this.deliverRideMemoryTelemetryExport(output, filename);
					if (job.cancelled || player !== this.rideMemoryPlayer) return;
					if (delivery === 'cancelled') {
						if (status) status.textContent = 'Telemetry copy was created, but sharing was cancelled. The private original is unchanged.';
						return;
					}
					const message = delivery === 'shared'
						? 'Telemetry copy shared. The private original is unchanged.'
						: delivery === 'native'
							? 'Telemetry copy save requested from your device. Check Downloads or its save prompt. The private original is unchanged.'
							: 'Telemetry copy download requested. The private original is unchanged.';
					if (status) status.textContent = message;
					this.toast(delivery === 'shared' ? 'Telemetry video shared.' : 'Telemetry video save requested.', 'success');
				} catch (error) {
					if (String(error?.code || '') !== 'ride_memory_export_cancelled') throw error;
				} finally {
					if (this.rideMemoryExport === job) this.rideMemoryExport = null;
					this.setLoading(button, false);
					this.updateRideMemoryTelemetryControls();
				}
			}

			releaseRideMemoryObjectUrl() {
				for (const url of [this.rideMemoryObjectUrl, this.rideMemorySecondaryObjectUrl]) {
					if (!url) continue;
					try { URL.revokeObjectURL(url); } catch (error) { /* The URL is already unavailable. */ }
				}
				this.rideMemoryObjectUrl = '';
				this.rideMemorySecondaryObjectUrl = '';
			}

			closeRideMemoryPlayer() {
				this.cancelRideMemoryExport();
				this.clearRideMemorySecondaryStallWatch(this.rideMemoryPlayer);
				const video = $('[data-ride-memory-video]', this.dom.dialog);
				const secondaryVideo = $('[data-ride-memory-video-secondary]', this.dom.dialog);
				for (const element of [video, secondaryVideo]) {
					if (!element) continue;
					try {
						element.pause();
						for (const handler of ['onended', 'ontimeupdate', 'onloadedmetadata', 'onloadeddata', 'oncanplay', 'onseeking', 'onseeked', 'onplay', 'onplaying', 'onpause', 'onwaiting', 'onstalled', 'onratechange', 'onerror']) element[handler] = null;
						element.removeAttribute('src');
						element.load();
					} catch (error) { /* The player is already closed. */ }
				}
				this.releaseRideMemoryObjectUrl();
				this.rideMemoryPlayer = null;
			}

			confirmDeleteRideMemory(rideId) {
				this.openDialog('Delete Ride Memory?', '<p>This permanently removes the selected ride footage from Halo on this device. The saved journey and any Emergency Assist evidence are unaffected.</p><div class="halo-button-stack"><button type="button" class="halo-button halo-button--danger" data-action="confirm-delete-ride-memory" data-memory-ride-id="' + escapeAttr(rideId) + '">Delete footage</button><button type="button" class="halo-button halo-button--secondary" data-action="close-dialog">Keep footage</button></div>', 'PRIVATE DEVICE STORAGE');
			}

			confirmRecoverRideMemory(rideId) {
				this.openDialog('Recover unfinished footage?', '<p>Use this only after the ride has ended and any other Halo window recording it has been closed. Halo will mark the saved clips as an incomplete ride so you can review or delete them.</p><div class="halo-button-stack"><button type="button" class="halo-button halo-button--primary" data-action="confirm-recover-ride-memory" data-memory-ride-id="' + escapeAttr(rideId) + '">Recover footage</button><button type="button" class="halo-button halo-button--secondary" data-action="close-dialog">Leave it recording</button></div>', 'PRIVATE DEVICE STORAGE');
			}

			async recoverRideMemory(rideId, button) {
				const customerKey = String(this.state.customer?.id || this.identityCustomerId || '');
				if (!customerKey || !this.rideMemories?.supported || !this.rideMemories?.recoverRide) return;
				this.setLoading(button, true);
				try {
					await this.rideMemories.recoverRide({ customerKey, rideId, confirmAbandoned: true });
					if (customerKey !== String(this.state.customer?.id || this.identityCustomerId || '')) return;
					this.dom.dialog.close();
					await this.renderRideMemoryLibrary();
					this.toast('Unfinished ride footage recovered as incomplete.', 'success');
				} finally { this.setLoading(button, false); }
			}

			async deleteRideMemory(rideId, button) {
				const customerKey = String(this.state.customer?.id || this.identityCustomerId || '');
				if (!customerKey || !this.rideMemories?.supported) return;
				this.setLoading(button, true);
				try {
					const result = await this.rideMemories.deleteRide({ customerKey, rideId });
					if (customerKey !== String(this.state.customer?.id || this.identityCustomerId || '')) return;
					this.dom.dialog.close();
					await this.renderRideMemoryLibrary();
					this.refreshRideMemoryStorageStatus().catch(() => null);
					this.toast(result?.deleted ? 'Ride footage deleted from this device.' : 'That Ride Memory was already unavailable.', result?.deleted ? 'success' : 'error');
				} finally { this.setLoading(button, false); }
			}

				renderMore() {
				const container = $('#halo-more-content', root);
				if (!container) return;
				const name = this.state.customer.full_name || this.state.customer.name || this.state.customer.display_name || 'Halo rider';
				const install = `<article class="halo-callout halo-install-card" data-install-surface>${icon('home')}<div><h3 data-install-label>Install Halo App</h3><p data-install-hint>Add Halo to your Home Screen for fast, full-screen access.</p></div><button type="button" class="halo-button halo-button--secondary" data-action="install-app" data-install-control><span data-install-button-label>Install Halo App</span></button></article>`;
				container.innerHTML = `<section class="halo-card halo-profile-summary"><div class="halo-profile-avatar">${escapeHTML(initials(name))}</div><div><h2>${escapeHTML(name)}</h2><p>${escapeHTML(this.state.customer.email || this.state.customer.email_address || '')}</p></div><button type="button" class="halo-icon-button" data-route-target="more/profile" aria-label="Edit profile">${icon('chevron')}</button></section>
				${install}
				<div class="halo-menu-list">
					<button type="button" class="halo-menu-item" data-action="welcome-pack"><span class="halo-menu-icon">${icon('heart')}</span><span class="halo-menu-copy"><strong>Welcome Pack</strong><small>Your Avenrà ownership guide</small></span>${icon('chevron')}</button>
					<button type="button" class="halo-menu-item" data-route-target="more/community"><span class="halo-menu-icon halo-menu-icon--community">${icon('community')}</span><span class="halo-menu-copy"><strong>Halo Community</strong><small>${this.state.community.enrolled ? `@${escapeHTML(this.state.community.profile?.username || 'rider')} · riders, forums and messages` : 'Join the private Avenrà rider network'}</small></span>${icon('chevron')}</button>
					<button type="button" class="halo-menu-item" data-route-target="more/safety"><span class="halo-menu-icon">${icon('shield')}</span><span class="halo-menu-copy"><strong>Halo Safety</strong><small>Emergency contact, medical details and consent</small></span>${icon('chevron')}</button>
					<button type="button" class="halo-menu-item" data-route-target="more/documents"><span class="halo-menu-icon">${icon('document')}</span><span class="halo-menu-copy"><strong>Glovebox</strong><small>Documents and ownership records</small></span>${icon('chevron')}</button>
					<button type="button" class="halo-menu-item" data-route-target="more/manual"><span class="halo-menu-icon">${icon('book')}</span><span class="halo-menu-copy"><strong>Owner's manual</strong><small>Guides, controls and technical information</small></span>${icon('chevron')}</button>
					<button type="button" class="halo-menu-item" data-route-target="more/boutique"><span class="halo-menu-icon">${icon('bag')}</span><span class="halo-menu-copy"><strong>Boutique</strong><small>Accessories and rider essentials</small></span>${icon('chevron')}</button>
				</div>
				<div class="halo-menu-list">
					<button type="button" class="halo-menu-item" data-route-target="more/profile"><span class="halo-menu-icon">${icon('user')}</span><span class="halo-menu-copy"><strong>Profile & security</strong><small>Contact details, PIN and passkeys</small></span>${icon('chevron')}</button>
					<button type="button" class="halo-menu-item" data-action="contact-support"><span class="halo-menu-icon">${icon('heart')}</span><span class="halo-menu-copy"><strong>Avenrà support</strong><small>Get help with Halo or your motorcycle</small></span>${icon('chevron')}</button>
					</div>
					<button type="button" class="halo-button halo-button--secondary halo-full-width halo-danger" data-action="logout">Sign out</button>
					<p class="halo-version">Halo ${escapeHTML(CONFIG.version || this.state.boot?.version || 'v2')}</p>`;
				this.updateInstallControls();
			}

		communityItems(payload, key) {
			if (Array.isArray(payload)) return payload;
			if (!isObject(payload)) return [];
			const candidates = [payload[key], payload.items, payload.results];
			return candidates.find(Array.isArray) || [];
		}

		communityBoolean(value, fallback) {
			if (value === null || value === undefined || value === '') return fallback === true;
			return value === true || value === 1 || ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
		}

		normaliseCommunityProfile(value) {
			const profile = isObject(value) ? value : {};
			return {
				id: profile.id ?? profile.member_id ?? profile.customer_id ?? '',
				username: text(profile.username || profile.handle).replace(/^@/, ''),
				bio: text(profile.bio || profile.about),
				allow_dms: this.communityBoolean(profile.allow_dms ?? profile.direct_messages, true),
				directory_visible: this.communityBoolean(profile.directory_visible, true),
				blocked: this.communityBoolean(profile.blocked ?? profile.is_blocked, false),
				is_self: this.communityBoolean(profile.is_self, false),
				joined_at: profile.joined_at || profile.created_at || '',
				unread_count: Math.max(0, Number(profile.unread_count) || 0)
			};
		}

		communityPrivacyHTML(compact) {
			return `<aside class="halo-community-privacy${compact ? ' is-compact' : ''}">${icon('lock')}<div><strong>Community privacy</strong><p>Your real name, email address, live or saved location, rides, Emergency Assist information and ride-risk indicator are never public in Halo Community. Only the public username and bio you choose appear.</p></div></aside>`;
		}

		communityLoadingHTML(label) {
			return `<div class="halo-community-loading" role="status"><div class="halo-community-loading-mark" aria-hidden="true"></div><strong>${escapeHTML(label || 'Loading Community')}</strong><span class="halo-sr-only">Please wait</span><div class="halo-community-loading-lines" aria-hidden="true"><i></i><i></i><i></i></div></div>`;
		}

		communityErrorHTML(message) {
			return `<div class="halo-error-state" role="alert">${icon('warning')}<h2>Community is unavailable</h2><p>${escapeHTML(message || 'Halo could not load Community right now.')}</p><button type="button" class="halo-button halo-button--secondary" data-action="community-retry">Try again</button></div>`;
		}

		handleCommunityLoadError(error) {
			if (error?.code === 'stale_identity') return;
			this.state.community.status = 'error';
			this.state.community.error = error?.message || 'Halo could not load Community right now.';
			this.renderCommunity();
		}

		async ensureCommunity(force) {
			const community = this.state.community;
			if (!force && ['loading', 'ready'].includes(community.status)) return;
			if (this.state.boot?.offline_snapshot || !navigator.onLine) {
				throw new HaloAPIError('Connect to the internet to open the private rider community.', 0, 'offline');
			}
			community.status = 'loading';
			community.error = '';
			this.renderCommunity();
			const scope = this.captureIdentityScope();
			try {
				const response = await this.api.get('/community/bootstrap');
				this.assertIdentityScope(scope);
				const supplied = response.profile ?? response.member ?? (response.enrolled === false ? null : response);
				const profile = supplied && isObject(supplied) ? this.normaliseCommunityProfile(supplied) : null;
				community.enrolled = Boolean(response.enabled && profile?.username);
				community.profile = community.enrolled ? Object.assign(profile, { is_self: true }) : null;
				community.counts = Object.assign({}, isObject(response.counts) ? response.counts : {}, { unread_messages: Math.max(0, Number(response.unread_messages) || 0) });
				community.termsVersion = text(response.terms?.required_version, community.termsVersion || '1');
				community.members = this.communityItems(response, 'members').map((item) => this.normaliseCommunityProfile(item));
				community.threads = this.communityItems(response, 'threads');
				community.conversations = this.communityItems(response, 'conversations');
				community.loaded = {
					members: Array.isArray(response.members),
					forum: Array.isArray(response.threads),
					inbox: Array.isArray(response.conversations),
					blocks: false
				};
				community.status = 'ready';
				community.error = '';
				this.renderCommunity();
				this.renderHome();
				this.renderMore();
				if (community.enrolled) await this.openCommunityTab(community.tab, false);
			} catch (error) {
				if (error?.status === 404 || ['community_profile_not_found', 'community_not_enrolled', 'not_found'].includes(error?.code)) {
					this.assertIdentityScope(scope);
					community.status = 'ready';
					community.enrolled = false;
					community.profile = null;
					community.error = '';
					this.renderCommunity();
					return;
				}
				throw error;
			}
		}

		renderCommunity() {
			const container = $('#halo-community-content', root);
			if (!container) return;
			const community = this.state.community;
			if (community.status === 'idle' || community.status === 'loading') {
				container.innerHTML = this.communityLoadingHTML('Opening Halo Community');
				return;
			}
			if (community.status === 'error') {
				container.innerHTML = this.communityErrorHTML(community.error);
				return;
			}
			if (!community.enrolled) {
				this.renderCommunityOnboarding(container);
				this.applyOfflineSnapshotMode();
				return;
			}
			const profile = community.profile || {};
			const unread = Math.max(0, Number(community.counts.unread_messages ?? profile.unread_count) || 0);
			const tabs = [
				['members', 'Members', 'community'], ['forum', 'Forum', 'chat'], ['inbox', 'Inbox', 'send'], ['profile', 'Profile', 'user']
			];
			container.innerHTML = `<section class="halo-community-hero"><div class="halo-community-mark">${icon('community')}</div><div><p class="halo-eyebrow">AVENRÀ RIDERS</p><h2>Halo Community</h2><p>Private conversation for people who ride differently.</p></div><span class="halo-community-handle">@${escapeHTML(profile.username)}</span></section>
				<nav class="halo-scroll-tabs halo-community-tabs" aria-label="Community sections">${tabs.map(([id, label, glyph]) => `<button type="button" class="${community.tab === id ? 'is-active' : ''}" data-action="community-tab" data-community-tab="${id}" ${community.tab === id ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span>${id === 'inbox' && unread ? `<b class="halo-community-unread" aria-label="${unread} unread messages">${unread > 99 ? '99+' : unread}</b>` : ''}</button>`).join('')}</nav>
				<div class="halo-community-panel">${this.renderCommunitySection()}</div>`;
			this.applyOfflineSnapshotMode();
		}

		renderCommunityOnboarding(container) {
			container.innerHTML = `<section class="halo-community-hero halo-community-hero--welcome"><div class="halo-community-mark">${icon('community')}</div><div><p class="halo-eyebrow">PRIVATE RIDER NETWORK</p><h2>Meet the people behind the ride.</h2><p>Choose a public identity, join rider-led conversations and message members privately.</p></div></section>
				${this.communityPrivacyHTML()}
				<form id="halo-community-profile-form" class="halo-community-form">
					<input type="hidden" name="mode" value="create">
					<section class="halo-card"><div class="halo-card-header"><div><p class="halo-card-kicker">YOUR PUBLIC PROFILE</p><h2>Choose how riders know you</h2></div><span class="halo-badge">Opt-in</span></div>
						<label class="halo-field"><span>Unique username</span><div class="halo-community-username"><span aria-hidden="true">@</span><input type="text" name="username" minlength="3" maxlength="24" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,23}" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="roadname" required></div><small>3–24 letters, numbers, dots, underscores or hyphens. Halo checks that it is unique.</small></label>
						<label class="halo-field"><span>Short bio <small>(optional)</small></span><textarea name="bio" maxlength="240" rows="4" placeholder="Your motorcycles, favourite roads or riding story"></textarea></label>
						<label class="halo-community-check"><input type="checkbox" name="directory_visible"><span><strong>Show me in the member directory</strong><small>This is off by default. Turn it on only if you want opted-in riders to find your username and bio in search.</small></span></label>
						<label class="halo-community-check"><input type="checkbox" name="allow_dms" checked><span><strong>Allow private messages</strong><small>You can switch this off at any time.</small></span></label>
					</section>
					<label class="halo-community-consent"><input type="checkbox" name="community_opt_in" required><span>I choose to make this Community profile visible to other opted-in Halo members. I understand that my Halo account and riding information remain private.</span></label>
					<button type="submit" class="halo-button halo-button--primary halo-full-width">Join Halo Community</button>
					<p class="halo-helper halo-centered-copy">Nothing is published until you choose to join.</p>
				</form>`;
		}

		renderCommunitySection() {
			if (this.state.community.tab === 'forum') return this.renderCommunityThreads();
			if (this.state.community.tab === 'inbox') return this.renderCommunityInbox();
			if (this.state.community.tab === 'profile') return this.renderCommunityProfile();
			return this.renderCommunityMembers();
		}

		renderCommunitySectionError() {
			const message = this.state.community.sectionError;
			if (!message) return '';
			return `<div class="halo-inline-alert" role="alert"><strong>Could not refresh this section.</strong><br>${escapeHTML(message)}<button type="button" class="halo-text-button" data-action="community-refresh">Try again</button></div>`;
		}

		communityMemberCard(member) {
			const profile = this.normaliseCommunityProfile(member);
			const label = profile.username ? `@${profile.username}` : 'Halo rider';
			return `<article class="halo-community-member${profile.blocked ? ' is-blocked' : ''}"><button type="button" class="halo-community-member-main" data-action="community-open-member" data-member-id="${escapeAttr(profile.id)}" aria-label="Open ${escapeAttr(label)}"><span class="halo-community-avatar">${escapeHTML(initials(label))}</span><span><strong>${escapeHTML(label)}</strong><small>@${escapeHTML(profile.username || 'rider')}${profile.blocked ? ' · Blocked' : ''}</small>${profile.bio ? `<em>${escapeHTML(profile.bio)}</em>` : ''}</span></button>${!profile.blocked && profile.allow_dms ? `<button type="button" class="halo-icon-button halo-community-dm-button" data-action="community-new-dm" data-member-id="${escapeAttr(profile.id)}" aria-label="Message ${escapeAttr(label)}">${icon('send')}</button>` : ''}</article>`;
		}

		renderCommunityMembers() {
			const community = this.state.community;
			if (community.loadingSection === 'members') return this.communityLoadingHTML('Finding riders');
			const error = this.renderCommunitySectionError();
			const members = asArray(community.members).filter((member) => {
				const profile = this.normaliseCommunityProfile(member);
				return !profile.is_self && String(profile.id) !== String(community.profile?.id ?? '');
			});
			return `<div class="halo-community-toolbar"><div><p class="halo-card-kicker">DIRECTORY</p><h2>Find your people</h2></div></div>
				<form id="halo-community-member-search" class="halo-search-field halo-community-search" role="search">${icon('search')}<label class="halo-sr-only" for="halo-community-member-query">Search Community members</label><input id="halo-community-member-query" type="search" name="search" maxlength="40" value="${escapeAttr(community.memberSearch)}" placeholder="Search username or bio" autocomplete="off"><button type="submit" class="halo-sr-only">Search</button></form>
				${error}${members.length ? `<div class="halo-community-list">${members.map((member) => this.communityMemberCard(member)).join('')}</div>` : `<div class="halo-empty-state halo-community-empty">${icon('community')}<h2>${community.memberSearch ? 'No riders found' : 'The road is quiet'}</h2><p>${community.memberSearch ? 'Try another username or keyword.' : 'Opted-in riders will appear here as Community grows.'}</p>${community.memberSearch ? '<button type="button" class="halo-text-button" data-action="community-clear-search">Clear search</button>' : ''}</div>`}
				${this.communityPrivacyHTML(true)}`;
		}

		communityThreadAuthor(thread) {
			return this.normaliseCommunityProfile(thread.author || thread.member || thread.user || {});
		}

		communityThreadCard(thread) {
			const id = thread.id ?? thread.thread_id ?? '';
			const author = this.communityThreadAuthor(thread);
			const replyCount = Math.max(0, Number(thread.reply_count ?? thread.replies_count) || 0);
			return `<button type="button" class="halo-community-thread" data-action="community-open-thread" data-thread-id="${escapeAttr(id)}"><span class="halo-community-thread-top"><span class="halo-community-avatar halo-community-avatar--small">${escapeHTML(initials(author.username))}</span><span><strong>${escapeHTML(thread.title || 'Rider conversation')}</strong><small>by ${escapeHTML(author.username ? `@${author.username}` : 'Halo rider')} · ${escapeHTML(formatDate(thread.updated_at || thread.created_at, { day: 'numeric', month: 'short' }))}</small></span></span><span class="halo-community-thread-excerpt">${escapeHTML(thread.excerpt || thread.body || thread.content || '')}</span><span class="halo-community-thread-meta">${icon('chat')} ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}</span></button>`;
		}

		renderCommunityThreads() {
			const community = this.state.community;
			if (community.loadingSection === 'forum' || community.loadingSection === 'thread') return this.communityLoadingHTML(community.loadingSection === 'thread' ? 'Opening conversation' : 'Loading the forum');
			if (community.activeThread) return this.renderCommunityThreadDetail(community.activeThread);
			const threads = asArray(community.threads);
			return `<div class="halo-community-toolbar"><div><p class="halo-card-kicker">RIDER FORUM</p><h2>Conversations</h2></div><button type="button" class="halo-button halo-button--primary halo-community-compact-button" data-action="community-create-thread">${icon('plus')} New thread</button></div>
				${this.renderCommunitySectionError()}${threads.length ? `<div class="halo-community-list">${threads.map((thread) => this.communityThreadCard(thread)).join('')}</div>` : `<div class="halo-empty-state halo-community-empty">${icon('chat')}<h2>Start the first conversation</h2><p>Ask a question, share a route idea or talk motorcycles.</p><button type="button" class="halo-button halo-button--primary" data-action="community-create-thread">Create a thread</button></div>`}`;
		}

		renderCommunityThreadDetail(thread) {
			const id = thread.id ?? thread.thread_id ?? '';
			const author = this.communityThreadAuthor(thread);
			const replies = asArray(thread.replies || thread.messages);
			return `<button type="button" class="halo-back-button halo-community-inline-back" data-action="community-back-threads">${icon('arrow')} Forum</button>
				<article class="halo-community-post halo-community-post--lead"><div class="halo-community-post-header"><span class="halo-community-avatar">${escapeHTML(initials(author.username))}</span><div><p class="halo-card-kicker">@${escapeHTML(author.username || 'rider')}</p><h2>${escapeHTML(thread.title || 'Rider conversation')}</h2><small>${escapeHTML(formatDate(thread.created_at || thread.updated_at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</small></div>${thread.can_edit ? '<span></span>' : `<button type="button" class="halo-icon-button" data-action="community-report" data-report-type="thread" data-report-id="${escapeAttr(id)}" aria-label="Report thread">${icon('flag')}</button>`}</div><p class="halo-community-body">${escapeHTML(thread.body || thread.content || '')}</p></article>
				<div class="halo-community-replies"><div class="halo-section-heading"><h2>Replies</h2><span class="halo-badge">${replies.length}</span></div>${replies.length ? replies.map((reply) => { const replyAuthor = this.communityThreadAuthor(reply); const replyId = reply.id ?? reply.reply_id ?? ''; return `<article class="halo-community-post"><div class="halo-community-post-header"><span class="halo-community-avatar halo-community-avatar--small">${escapeHTML(initials(replyAuthor.username))}</span><div><strong>${escapeHTML(replyAuthor.username ? `@${replyAuthor.username}` : 'Halo rider')}</strong><small>${escapeHTML(formatDate(reply.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</small></div>${reply.can_edit ? '<span></span>' : `<button type="button" class="halo-icon-button" data-action="community-report" data-report-type="reply" data-report-id="${escapeAttr(replyId)}" aria-label="Report reply">${icon('flag')}</button>`}</div><p class="halo-community-body">${escapeHTML(reply.body || reply.content || '')}</p></article>`; }).join('') : '<p class="halo-community-muted">No replies yet. Add the first thoughtful response.</p>'}</div>
				<form id="halo-community-reply-form" class="halo-community-composer"><input type="hidden" name="thread_id" value="${escapeAttr(id)}"><label class="halo-sr-only" for="halo-community-reply">Reply</label><textarea id="halo-community-reply" name="body" minlength="2" maxlength="2000" rows="2" placeholder="Write a reply…" required></textarea><button type="submit" class="halo-icon-button" aria-label="Send reply">${icon('send')}</button></form>`;
		}

		renderCommunityInbox() {
			const community = this.state.community;
			if (community.loadingSection === 'inbox' || community.loadingSection === 'conversation') return this.communityLoadingHTML(community.loadingSection === 'conversation' ? 'Opening messages' : 'Loading inbox');
			if (community.activeConversation) return this.renderCommunityConversation(community.activeConversation);
			const conversations = asArray(community.conversations);
			return `<div class="halo-community-toolbar"><div><p class="halo-card-kicker">PRIVATE MESSAGES</p><h2>Inbox</h2></div><button type="button" class="halo-button halo-button--primary halo-community-compact-button" data-action="community-new-dm">${icon('plus')} New</button></div>
				<p class="halo-helper">Messages are stored by Halo, are not end-to-end encrypted, and authorised moderators may see reported excerpts.</p>
				${this.renderCommunitySectionError()}${conversations.length ? `<div class="halo-community-list">${conversations.map((conversation) => { const id = conversation.id ?? conversation.conversation_id ?? ''; const member = this.normaliseCommunityProfile(conversation.member || conversation.participant || conversation.other_member || {}); const unread = Math.max(0, Number(conversation.unread_count) || 0); return `<button type="button" class="halo-community-conversation${unread ? ' is-unread' : ''}" data-action="community-open-conversation" data-conversation-id="${escapeAttr(id)}"><span class="halo-community-avatar">${escapeHTML(initials(member.username))}</span><span><strong>${escapeHTML(member.username ? `@${member.username}` : 'Halo rider')}</strong><small>${escapeHTML(conversation.last_message?.body || conversation.last_message || conversation.preview || 'Start the conversation')}</small></span>${unread ? `<b class="halo-community-unread" aria-label="${unread} unread">${unread > 99 ? '99+' : unread}</b>` : icon('chevron')}</button>`; }).join('')}</div>` : `<div class="halo-empty-state halo-community-empty">${icon('send')}<h2>Your inbox is ready</h2><p>Private messages stay between you and the rider you choose.</p><button type="button" class="halo-button halo-button--primary" data-action="community-new-dm">Start a message</button></div>`}`;
		}

		renderCommunityConversation(conversation) {
			const id = conversation.id ?? conversation.conversation_id ?? '';
			const member = this.normaliseCommunityProfile(conversation.member || conversation.participant || conversation.other_member || {});
			const messages = asArray(conversation.messages);
			return `<div class="halo-community-conversation-head"><button type="button" class="halo-back-button" data-action="community-back-conversations">${icon('arrow')} Inbox</button><button type="button" class="halo-community-person-chip" data-action="community-open-member" data-member-id="${escapeAttr(member.id)}"><span class="halo-community-avatar halo-community-avatar--small">${escapeHTML(initials(member.username))}</span><span><strong>${escapeHTML(member.username ? `@${member.username}` : 'Halo rider')}</strong></span></button></div>
				<div class="halo-community-message-list" aria-label="Conversation with ${escapeAttr(member.username ? `@${member.username}` : 'Halo rider')}">${messages.length ? messages.map((message) => { const mine = this.communityBoolean(message.mine ?? message.is_mine, false) || String(message.sender_id ?? '') === String(this.state.community.profile?.id ?? ''); return `<article class="halo-community-message${mine ? ' is-mine' : ''}"><p>${escapeHTML(message.body || message.content || message.message || '')}</p><small>${escapeHTML(formatDate(message.created_at || message.sent_at, { hour: '2-digit', minute: '2-digit' }))}</small>${mine ? '' : `<button type="button" data-action="community-report" data-report-type="message" data-report-id="${escapeAttr(message.id ?? message.message_id ?? '')}">Report</button>`}</article>`; }).join('') : '<p class="halo-community-muted">No messages yet.</p>'}</div>
				${conversation.blocked || member.allow_dms === false ? '<p class="halo-inline-alert">Private messages are unavailable for this conversation.</p>' : `<form id="halo-community-message-form" class="halo-community-composer"><input type="hidden" name="conversation_id" value="${escapeAttr(id)}"><label class="halo-sr-only" for="halo-community-message">Message</label><textarea id="halo-community-message" name="body" maxlength="2000" rows="2" placeholder="Write a private message…" required></textarea><button type="submit" class="halo-icon-button" aria-label="Send message">${icon('send')}</button></form>`}`;
		}

		renderCommunityProfile() {
			const profile = this.state.community.profile || {};
			const blocks = asArray(this.state.community.blocks);
			const blockedSection = this.state.community.loadingSection === 'blocks'
				? this.communityLoadingHTML('Loading blocked riders')
				: blocks.length
					? `<section class="halo-community-blocks"><div class="halo-section-heading"><h2>Blocked riders</h2><span class="halo-badge">${blocks.length}</span></div><div class="halo-community-list">${blocks.map((member) => this.communityMemberCard(Object.assign({}, member, { blocked: true }))).join('')}</div></section>`
					: '<p class="halo-community-muted">You have not blocked any riders.</p>';
			return `<div class="halo-community-toolbar"><div><p class="halo-card-kicker">PUBLIC IDENTITY</p><h2>Your Community profile</h2></div><span class="halo-community-handle">@${escapeHTML(profile.username)}</span></div>
				<form id="halo-community-profile-form" class="halo-community-form"><input type="hidden" name="mode" value="update"><section class="halo-card"><label class="halo-field"><span>Unique username</span><div class="halo-community-username"><span aria-hidden="true">@</span><input type="text" name="username" minlength="3" maxlength="24" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,23}" autocomplete="username" autocapitalize="none" spellcheck="false" value="${escapeAttr(profile.username)}" required></div></label><label class="halo-field"><span>Short bio <small>(optional)</small></span><textarea name="bio" maxlength="240" rows="4">${escapeHTML(profile.bio)}</textarea></label><label class="halo-community-check"><input type="checkbox" name="directory_visible" ${profile.directory_visible ? 'checked' : ''}><span><strong>Show me in the member directory</strong><small>When off, you can still use forums and existing messages.</small></span></label><label class="halo-community-check"><input type="checkbox" name="allow_dms" ${profile.allow_dms ? 'checked' : ''}><span><strong>Allow private messages</strong><small>Blocked members can never message you.</small></span></label></section><button type="submit" class="halo-button halo-button--primary halo-full-width">Save Community profile</button></form>
				${this.communityPrivacyHTML()}
				${this.renderCommunitySectionError()}
				${blockedSection}
				<section class="halo-card halo-community-leave"><h3>Leave Community</h3><p>Your profile will stop being visible. This does not delete your Halo account, motorcycle or rides.</p><button type="button" class="halo-text-button halo-danger" data-action="community-leave">Leave Halo Community</button></section>`;
		}

		async openCommunityTab(tab, force) {
			const community = this.state.community;
			const next = ['members', 'forum', 'inbox', 'profile'].includes(tab) ? tab : 'members';
			community.tab = next;
			community.sectionError = '';
			if (next !== 'forum') community.activeThread = null;
			if (next !== 'inbox') community.activeConversation = null;
			if (next === 'members' && !community.memberSearch) community.memberSearch = '';
			this.renderCommunity();
			if (next === 'members' && (force || !community.loaded?.members)) await this.loadCommunityMembers();
			else if (next === 'forum' && (force || !community.loaded?.forum)) await this.loadCommunityThreads();
			else if (next === 'inbox' && (force || !community.loaded?.inbox)) await this.loadCommunityConversations();
			else if (next === 'profile' && (force || !community.loaded?.blocks)) await this.loadCommunityBlocks();
		}

		async refreshCommunitySection() {
			const tab = this.state.community.tab;
			if (tab === 'members') await this.loadCommunityMembers();
			else if (tab === 'forum') await this.loadCommunityThreads();
			else if (tab === 'inbox') await this.loadCommunityConversations();
			else if (tab === 'profile') await this.loadCommunityBlocks();
			else await this.ensureCommunity(true);
		}

		async loadCommunityMembers() {
			const community = this.state.community;
			const scope = this.captureIdentityScope();
			community.loadingSection = 'members'; community.sectionError = ''; this.renderCommunity();
			try {
				const query = community.memberSearch ? `?search=${encodeURIComponent(community.memberSearch)}` : '';
				const response = await this.api.get(`/community/members${query}`);
				this.assertIdentityScope(scope);
				community.members = this.communityItems(response, 'members').map((item) => this.normaliseCommunityProfile(item));
				community.loaded.members = true;
				if (isObject(response.counts)) community.counts = Object.assign({}, community.counts, response.counts);
			} catch (error) {
				if (error?.code === 'stale_identity') return;
				community.sectionError = error?.message || 'The member directory could not be loaded.';
			} finally {
				if (this.identityScopeIsCurrent(scope)) { community.loadingSection = ''; this.renderCommunity(); }
			}
		}

		async loadCommunityThreads() {
			const community = this.state.community;
			const scope = this.captureIdentityScope();
			community.loadingSection = 'forum'; community.sectionError = ''; this.renderCommunity();
			try {
				const response = await this.api.get('/community/threads');
				this.assertIdentityScope(scope);
				community.threads = this.communityItems(response, 'threads');
				community.loaded.forum = true;
			} catch (error) {
				if (error?.code === 'stale_identity') return;
				community.sectionError = error?.message || 'The forum could not be loaded.';
			} finally {
				if (this.identityScopeIsCurrent(scope)) { community.loadingSection = ''; this.renderCommunity(); }
			}
		}

		async loadCommunityConversations() {
			const community = this.state.community;
			const scope = this.captureIdentityScope();
			community.loadingSection = 'inbox'; community.sectionError = ''; this.renderCommunity();
			try {
				const response = await this.api.get('/community/conversations');
				this.assertIdentityScope(scope);
				community.conversations = this.communityItems(response, 'conversations');
				community.loaded.inbox = true;
				if (isObject(response.counts)) community.counts = Object.assign({}, community.counts, response.counts);
			} catch (error) {
				if (error?.code === 'stale_identity') return;
				community.sectionError = error?.message || 'Your inbox could not be loaded.';
			} finally {
				if (this.identityScopeIsCurrent(scope)) { community.loadingSection = ''; this.renderCommunity(); }
			}
		}

		async loadCommunityBlocks() {
			const community = this.state.community;
			const scope = this.captureIdentityScope();
			community.loadingSection = 'blocks'; community.sectionError = ''; this.renderCommunity();
			try {
				const response = await this.api.get('/community/blocks');
				this.assertIdentityScope(scope);
				community.blocks = this.communityItems(response, 'blocks').map((item) => Object.assign(this.normaliseCommunityProfile(item), { blocked: true }));
				community.loaded.blocks = true;
			} catch (error) {
				if (error?.code === 'stale_identity') return;
				community.sectionError = error?.message || 'Your blocked-rider list could not be loaded.';
			} finally {
				if (this.identityScopeIsCurrent(scope)) { community.loadingSection = ''; this.renderCommunity(); }
			}
		}

		async searchCommunityMembers(form) {
			this.state.community.memberSearch = text(new FormData(form).get('search')).trim().slice(0, 40);
			await this.loadCommunityMembers();
		}

		async saveCommunityProfile(form) {
			const values = this.formObject(form);
			if (values.mode === 'create' && !values.community_opt_in) throw new HaloAPIError('Choose the Community opt-in before joining.');
			const payload = {
				username: text(values.username).trim().replace(/^@/, ''),
				bio: text(values.bio).trim(),
				allow_dms: values.allow_dms === true,
				directory_visible: values.directory_visible === true,
				opt_in: true,
				terms_version: this.state.community.termsVersion || '1'
			};
			const button = $('button[type="submit"]', form);
			const scope = this.captureIdentityScope();
			this.setLoading(button, true);
			try {
				const response = await this.api.put('/community/profile', payload);
				this.assertIdentityScope(scope);
				const supplied = response.profile || response.member || response;
				this.state.community.profile = Object.assign(this.normaliseCommunityProfile(supplied), { is_self: true });
				this.state.community.enrolled = true;
				this.state.community.status = 'ready';
				this.state.community.tab = values.mode === 'create' ? 'members' : 'profile';
				this.state.community.members = [];
				this.state.community.loaded = { members: false, forum: false, inbox: false, blocks: false };
				this.renderCommunity(); this.renderHome(); this.renderMore();
				this.toast(values.mode === 'create' ? 'Welcome to Halo Community.' : 'Community profile updated.', 'success');
				if (values.mode === 'create') await this.loadCommunityMembers();
			} finally { this.setLoading(button, false); }
		}

		openCommunityThreadComposer() {
			this.openSheet('Start a conversation', `<form id="halo-community-thread-form" class="halo-community-form"><p class="halo-card-copy">Share something useful, welcoming or inspiring with the Avenrà rider community.</p><label class="halo-field"><span>Title</span><input type="text" name="title" minlength="5" maxlength="100" required></label><label class="halo-field"><span>Post</span><textarea name="body" minlength="10" maxlength="4000" rows="7" required></textarea></label><button type="submit" class="halo-button halo-button--primary halo-full-width">Publish thread</button></form>`);
		}

		async createCommunityThread(form) {
			const values = this.formObject(form); const button = $('button[type="submit"]', form); const scope = this.captureIdentityScope();
			this.setLoading(button, true);
			try {
				const response = await this.api.post('/community/threads', { title: text(values.title).trim(), body: text(values.body).trim() });
				this.assertIdentityScope(scope);
				if (this.dom.sheet.open) this.dom.sheet.close();
				this.state.community.tab = 'forum';
				this.state.community.activeThread = response.thread || response;
				await this.loadCommunityThreads();
				this.state.community.activeThread = response.thread || response;
				this.renderCommunity();
				this.toast('Thread published.', 'success');
			} finally { this.setLoading(button, false); }
		}

		async openCommunityThread(threadId) {
			if (!threadId) return;
			const community = this.state.community; const scope = this.captureIdentityScope();
			community.loadingSection = 'thread'; community.sectionError = ''; this.renderCommunity();
			try {
				const [response, repliesResponse] = await Promise.all([
					this.api.get(`/community/threads/${encodeURIComponent(threadId)}`),
					this.api.get(`/community/threads/${encodeURIComponent(threadId)}/replies`)
				]);
				this.assertIdentityScope(scope);
				const thread = response.thread || response;
				community.activeThread = Object.assign({}, thread, { replies: this.communityItems(repliesResponse, 'replies') });
			} catch (error) {
				if (error?.code === 'stale_identity') return;
				community.activeThread = null;
				community.sectionError = error?.message || 'That conversation could not be opened.';
			} finally {
				if (this.identityScopeIsCurrent(scope)) { community.loadingSection = ''; this.renderCommunity(); }
			}
		}

		async replyToCommunityThread(form) {
			const values = this.formObject(form); const threadId = values.thread_id; const button = $('button[type="submit"]', form); const scope = this.captureIdentityScope();
			this.setLoading(button, true);
			try {
				await this.api.post(`/community/threads/${encodeURIComponent(threadId)}/replies`, { body: text(values.body).trim() });
				this.assertIdentityScope(scope);
				await this.openCommunityThread(threadId);
				this.toast('Reply posted.', 'success');
			} finally { this.setLoading(button, false); }
		}

		findCommunityMember(memberId) {
			const id = String(memberId ?? '');
			return asArray(this.state.community.members).concat(asArray(this.state.community.blocks)).find((member) => String(member.id ?? member.member_id ?? '') === id) || null;
		}

		async openCommunityMember(memberId) {
			let source = this.findCommunityMember(memberId);
			if (!source && memberId) {
				const scope = this.captureIdentityScope();
				this.openSheet('Rider profile', this.communityLoadingHTML('Opening rider profile'));
				try {
					const response = await this.api.get(`/community/members/${encodeURIComponent(memberId)}`);
					this.assertIdentityScope(scope);
					source = response.member || response.profile || response;
					const normalised = this.normaliseCommunityProfile(source);
					this.state.community.members.push(normalised);
				} catch (error) {
					if (error?.code === 'stale_identity') return;
					this.openSheet('Rider unavailable', `<div class="halo-error-state" role="alert">${icon('warning')}<h2>Profile unavailable</h2><p>${escapeHTML(error?.message || 'That Community profile could not be opened.')}</p><button type="button" class="halo-button halo-button--secondary" data-action="close-sheet">Close</button></div>`);
					return;
				}
			}
			const member = this.normaliseCommunityProfile(source || { id: memberId });
			const label = member.username ? `@${member.username}` : 'Halo rider';
			const blockButton = member.blocked
				? `<button type="button" class="halo-button halo-button--secondary" data-action="community-unblock-member" data-member-id="${escapeAttr(member.id)}">Unblock rider</button>`
				: `<button type="button" class="halo-button halo-button--secondary halo-danger" data-action="community-block-member" data-member-id="${escapeAttr(member.id)}">Block rider</button>`;
			this.openSheet(label, `<div class="halo-community-sheet-profile"><span class="halo-community-avatar halo-community-avatar--large">${escapeHTML(initials(label))}</span><p class="halo-community-handle">@${escapeHTML(member.username || 'rider')}</p>${member.bio ? `<p>${escapeHTML(member.bio)}</p>` : '<p class="halo-community-muted">This rider has not added a bio.</p>'}</div><div class="halo-button-stack">${!member.blocked && member.allow_dms ? `<button type="button" class="halo-button halo-button--primary" data-action="community-new-dm" data-member-id="${escapeAttr(member.id)}">Message rider</button>` : ''}${blockButton}<button type="button" class="halo-text-button halo-danger" data-action="community-report" data-report-type="profile" data-report-id="${escapeAttr(member.id)}">Report profile</button></div>`);
		}

		openCommunityNewDm(memberId) {
			const ownId = String(this.state.community.profile?.id ?? '');
			const eligible = asArray(this.state.community.members).map((item) => this.normaliseCommunityProfile(item)).filter((member) => !member.is_self && String(member.id) !== ownId && !member.blocked && member.allow_dms && member.id !== '');
			const chosen = memberId ? this.normaliseCommunityProfile(this.findCommunityMember(memberId) || { id: memberId }) : null;
			const recipient = chosen?.id ? `<input type="hidden" name="member_id" value="${escapeAttr(chosen.id)}"><section class="halo-community-recipient"><span class="halo-community-avatar">${escapeHTML(initials(chosen.username))}</span><span><strong>${escapeHTML(chosen.username ? `@${chosen.username}` : 'Halo rider')}</strong></span></section>` : `<label class="halo-field"><span>Rider</span><select name="member_id" required><option value="">Choose a rider</option>${eligible.map((member) => `<option value="${escapeAttr(member.id)}">@${escapeHTML(member.username)}</option>`).join('')}</select></label>`;
			this.openSheet('New private message', `<form id="halo-community-new-dm-form" class="halo-community-form">${recipient}${!chosen && !eligible.length ? '<p class="halo-inline-alert">Open the member directory first to choose an opted-in rider who accepts messages.</p>' : ''}<label class="halo-field"><span>Message</span><textarea name="message" maxlength="2000" rows="6" required></textarea></label><button type="submit" class="halo-button halo-button--primary halo-full-width" ${!chosen && !eligible.length ? 'disabled' : ''}>Send message</button><p class="halo-helper">Private messages are visible only to participants and authorised moderators handling a report.</p></form>`);
		}

		async createCommunityConversation(form) {
			const values = this.formObject(form); const button = $('button[type="submit"]', form); const scope = this.captureIdentityScope();
			this.setLoading(button, true);
			try {
				const response = await this.api.post('/community/conversations', { member_id: values.member_id, message: text(values.message).trim() });
				this.assertIdentityScope(scope);
				if (this.dom.sheet.open) this.dom.sheet.close();
				this.state.community.tab = 'inbox';
				this.state.community.activeConversation = response.conversation || response;
				await this.loadCommunityConversations();
				const id = response.conversation?.id ?? response.conversation_id ?? response.id;
				if (id) await this.openCommunityConversation(id);
				this.toast('Private message sent.', 'success');
			} finally { this.setLoading(button, false); }
		}

		async openCommunityConversation(conversationId) {
			if (!conversationId) return;
			const community = this.state.community; const scope = this.captureIdentityScope();
			community.loadingSection = 'conversation'; community.sectionError = ''; this.renderCommunity();
			try {
				const response = await this.api.get(`/community/conversations/${encodeURIComponent(conversationId)}/messages`);
				this.assertIdentityScope(scope);
				const summary = asArray(community.conversations).find((conversation) => String(conversation.id ?? conversation.conversation_id ?? '') === String(conversationId)) || community.activeConversation || {};
				const suppliedConversation = isObject(response.conversation) ? response.conversation : {};
				community.activeConversation = Object.assign({}, summary, suppliedConversation, {
					conversation_id: suppliedConversation.conversation_id || summary.conversation_id || conversationId,
					messages: this.communityItems(response, 'messages'),
					unread_count: 0
				});
				const previousUnread = Math.max(0, Number(summary.unread_count) || 0);
				if (previousUnread) community.counts.unread_messages = Math.max(0, (Number(community.counts.unread_messages) || 0) - previousUnread);
				if (summary) summary.unread_count = 0;
				this.api.post(`/community/conversations/${encodeURIComponent(conversationId)}/read`, {}).catch(() => null);
			} catch (error) {
				if (error?.code === 'stale_identity') return;
				community.activeConversation = null;
				community.sectionError = error?.message || 'That private conversation could not be opened.';
			} finally {
				if (this.identityScopeIsCurrent(scope)) { community.loadingSection = ''; this.renderCommunity(); }
			}
		}

		async sendCommunityMessage(form) {
			const values = this.formObject(form); const id = values.conversation_id; const button = $('button[type="submit"]', form); const scope = this.captureIdentityScope();
			this.setLoading(button, true);
			try {
				await this.api.post(`/community/conversations/${encodeURIComponent(id)}/messages`, { body: text(values.body).trim() });
				this.assertIdentityScope(scope);
				await this.openCommunityConversation(id);
			} finally { this.setLoading(button, false); }
		}

		async setCommunityBlock(memberId, shouldBlock, button) {
			if (!memberId) return;
			const scope = this.captureIdentityScope(); this.setLoading(button, true);
			try {
				if (shouldBlock) await this.api.post('/community/blocks', { member_id: memberId });
				else await this.api.delete(`/community/blocks/${encodeURIComponent(memberId)}`, {});
				this.assertIdentityScope(scope);
				const member = this.findCommunityMember(memberId); if (member) member.blocked = shouldBlock;
				if (shouldBlock) {
					const source = member || { id: memberId };
					if (!asArray(this.state.community.blocks).some((item) => String(item.id ?? item.member_id ?? '') === String(memberId))) this.state.community.blocks.push(Object.assign({}, source, { blocked: true }));
				} else {
					this.state.community.blocks = asArray(this.state.community.blocks).filter((item) => String(item.id ?? item.member_id ?? '') !== String(memberId));
				}
				this.state.community.loaded.blocks = true;
				if (shouldBlock) this.state.community.activeConversation = null;
				if (this.dom.sheet.open) this.dom.sheet.close();
				this.renderCommunity();
				this.toast(shouldBlock ? 'Rider blocked.' : 'Rider unblocked.', 'success');
			} finally { this.setLoading(button, false); }
		}

		openCommunityReport(type, id) {
			const allowed = ['profile', 'thread', 'reply', 'message'];
			if (!allowed.includes(type) || !id) return;
			this.openSheet('Report to Avenrà', `<form id="halo-community-report-form" class="halo-community-form"><input type="hidden" name="target_type" value="${escapeAttr(type)}"><input type="hidden" name="target_id" value="${escapeAttr(id)}"><p class="halo-card-copy">Reports are private and reviewed by an authorised Avenrà moderator. The reported member is not told who submitted it.</p><label class="halo-field"><span>Reason</span><select name="reason" required><option value="">Choose a reason</option><option value="harassment">Harassment or abuse</option><option value="spam">Spam or promotion</option><option value="hate">Hateful content</option><option value="privacy">Privacy concern</option><option value="impersonation">Impersonation</option><option value="unsafe">Unsafe or dangerous content</option><option value="other">Something else</option></select></label><label class="halo-field"><span>Details <small>(optional)</small></span><textarea name="details" maxlength="500" rows="5" placeholder="Tell the moderator what happened"></textarea></label><button type="submit" class="halo-button halo-button--primary halo-full-width">Submit report</button></form>`);
		}

		async submitCommunityReport(form) {
			const values = this.formObject(form); const button = $('button[type="submit"]', form); const scope = this.captureIdentityScope();
			this.setLoading(button, true);
			try {
				await this.api.post('/community/reports', { target_type: values.target_type, target_id: values.target_id, reason: values.reason, details: text(values.details).trim() });
				this.assertIdentityScope(scope);
				if (this.dom.sheet.open) this.dom.sheet.close();
				this.toast('Report sent privately to Avenrà.', 'success');
			} finally { this.setLoading(button, false); }
		}

		confirmLeaveCommunity() {
			this.openDialog('Leave Halo Community?', '<p>Your public Community profile will stop being visible. Existing forum contributions and private-message history are retained with a former-member identity for conversation integrity, safety and moderation. Your Halo account, motorcycle, rides and Emergency Assist settings are not affected.</p><div class="halo-button-stack"><button type="button" class="halo-button halo-button--danger" data-action="community-confirm-leave">Leave Community</button><button type="button" class="halo-button halo-button--secondary" data-action="close-dialog">Stay in Community</button></div>', 'COMMUNITY PRIVACY');
		}

		async leaveCommunity(button) {
			const scope = this.captureIdentityScope(); this.setLoading(button, true);
			try {
				await this.api.delete('/community/profile', {});
				this.assertIdentityScope(scope);
				this.state.community = { status: 'ready', enrolled: false, profile: null, tab: 'members', members: [], threads: [], conversations: [], blocks: [], activeThread: null, activeConversation: null, loadingSection: '', error: '', sectionError: '', memberSearch: '', counts: {}, termsVersion: '1', loaded: { members: false, forum: false, inbox: false, blocks: false } };
				if (this.dom.dialog.open) this.dom.dialog.close();
				this.renderCommunity(); this.renderHome(); this.renderMore();
				this.toast('You have left Halo Community.', 'success');
			} finally { this.setLoading(button, false); }
		}

		renderSafety() {
			const container = $('#halo-safety-content', root);
			if (!container) return;
			const safety = this.state.boot?.safety || {};
			const nok = safety.nok || safety.emergency_contact || { name: safety.nok_name, mobile: safety.nok_mobile, relationship: safety.nok_relation };
			const medical = safety.medical || { blood_group: safety.blood_type, weight_kg: safety.weight_kg, notes: safety.medical_notes };
			const suppliedConsents = safety.consents || {};
			const assist = isObject(safety.emergency_assist) ? safety.emergency_assist : {};
			const camera = isObject(safety.incident_camera) ? safety.incident_camera : {};
			const testRideMonitoring = isObject(safety.test_ride_monitoring) ? safety.test_ride_monitoring : {};
			const consents = {
				emergency_assist_enabled: suppliedConsents.emergency_assist_enabled ?? safety.emergency_assist_enabled ?? safety.halo_emergency_assist,
				incident_camera: suppliedConsents.incident_camera ?? camera.enabled ?? safety.incident_camera_enabled,
				nok_alerts: suppliedConsents.nok_alerts ?? safety.halo_nok_consent,
				medical_sharing: suppliedConsents.medical_sharing ?? safety.halo_emergency,
				proxy: suppliedConsents.proxy ?? safety.halo_proxy,
				law_enforcement: suppliedConsents.law_enforcement ?? safety.halo_law,
				ai_processing: suppliedConsents.ai_processing ?? safety.halo_ai
			};
			const bloodGroups = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'];
			const bloodOptions = bloodGroups.map((group) => `<option value="${escapeAttr(group)}" ${text(medical.blood_group || medical.blood_type) === group ? 'selected' : ''}>${group || 'Choose blood group'}</option>`).join('');
			const nokActive = Boolean(nok.mobile || nok.phone);
			const providerReady = assist.provider_ready !== false;
			const renewalRequired = assist.renewal_required === true;
			const requiredConsentVersion = text(assist.required_consent_version, '3');
			const medicalRenewalRequired = assist.medical_renewal_required === true;
			const requiredMedicalConsentVersion = text(assist.required_medical_consent_version, '1');
			const cameraRenewalRequired = camera.renewal_required === true;
			const requiredCameraConsentVersion = text(camera.required_consent_version, '1');
			const cameraReady = camera.provider_ready !== false && camera.storage_ready !== false;
			const cameraReadinessReason = text(camera.readiness_reason || asArray(camera.readiness_reasons)[0]);
			const testRideArmed = Boolean(testRideMonitoring.armed);
			const testRideActive = Boolean(testRideMonitoring.active);
			const testRideEnabled = testRideArmed || testRideActive;
			const testRideStoredArmed = Boolean(testRideMonitoring.stored_armed);
			const testRideConsentCurrent = testRideMonitoring.consent_current !== false;
			const requiredTestRideConsentVersion = text(testRideMonitoring.required_consent_version, '1');
			const testRideArmedUntil = testRideArmed && testRideMonitoring.armed_until
				? ` · available until ${formatDate(testRideMonitoring.armed_until, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
				: '';
			const cameraUnavailableNotice = {
				secure_schema_unavailable: '<article class="halo-callout"><div><h3>Incident-camera database setup incomplete</h3><p>Halo could not verify the protected incident-video database tables. An administrator must finish the camera schema update before a new camera consent can be enabled.</p></div></article>',
				private_storage_unavailable: '<article class="halo-callout"><div><h3>Incident-camera storage unavailable</h3><p>Halo cannot write to its protected incident-video directory. An administrator must configure writable private storage before a new camera consent can be enabled.</p></div></article>',
				video_verifier_unavailable: '<article class="halo-callout"><div><h3>Incident-camera verification unavailable</h3><p>Halo cannot securely verify recorded video files on this installation. An administrator must enable the incident-video verifier before a new camera consent can be enabled.</p></div></article>'
			};
			const cameraEvidencePending = this.incidentCameraEvidencePending();
			const assistNotice = !providerReady
				? '<article class="halo-callout"><div><h3>Emergency Assist setup incomplete</h3><p>Avenrà responder alerting is not configured on this installation, so a new consent cannot be enabled yet.</p></div></article>'
				: renewalRequired
					? '<article class="halo-callout"><div><h3>Review updated Emergency Assist terms</h3><p>Your earlier consent is paused. Review the current description below and switch Emergency Assist on again to renew it.</p><button type="button" class="halo-button halo-button--secondary" data-action="withdraw-assist-consent">Withdraw previous consent</button></div></article>'
					: '';
			const medicalNotice = medicalRenewalRequired
				? '<article class="halo-callout"><div><h3>Review medical-information sharing</h3><p>Your earlier setting is paused and no health data will be placed in a new incident unless you explicitly enable the current wording below.</p><button type="button" class="halo-button halo-button--secondary" data-action="withdraw-medical-consent">Withdraw previous consent</button></div></article>'
				: '';
			const cameraNotice = !cameraReady
				? (cameraUnavailableNotice[cameraReadinessReason] || '<article class="halo-callout"><div><h3>Incident-camera setup incomplete</h3><p>The secure incident-video backend is not ready on this installation, so a new camera consent cannot be enabled yet. Ride detection and Emergency Assist remain available without video.</p></div></article>')
				: cameraRenewalRequired
					? '<article class="halo-callout"><div><h3>Review updated incident-camera terms</h3><p>Your earlier camera choice is paused. Review the current recording and privacy wording below, then switch it on again if you still consent.</p><button type="button" class="halo-button halo-button--secondary" data-action="withdraw-camera-consent">Withdraw previous camera consent</button></div></article>'
					: '';
			const cameraEvidenceNotice = cameraEvidencePending
				? '<article class="halo-callout"><div><h3>Incident video awaiting secure delivery</h3><p>Halo is retaining an earlier incident buffer in this open app session. Keep Halo open and online while it retries; a page or app termination can remove this memory-only copy.</p><button type="button" class="halo-button halo-button--secondary" data-action="retry-incident-camera">Retry video delivery now</button></div></article>'
				: '';
			container.innerHTML = `<article class="halo-callout">${icon('shield')}<div><h3>Emergency Assist while Ride mode is open</h3><p>When you opt in, on-call Avenrà staff can see that you are online or riding, together with your live ride speed and location for operational monitoring. If the 20-second cancellation window expires, Halo opens an incident and continues updating its position. Your opted-in ride history is also used to calculate a persistent, explainable, staff-only ride-risk indicator based on speed exposure, ride dynamics and confirmed incidents. It is not an accident prediction or an insurance score. Withdrawing Emergency Assist stops monitoring and future scoring, and removes staff access to the indicator. Halo does not itself confirm that 999 has been contacted.</p></div></article>${assistNotice}${medicalNotice}${cameraNotice}${cameraEvidenceNotice}
				<form id="halo-safety-form" class="halo-view-content">
					<input type="hidden" name="emergency_assist_consent_version" value="${escapeAttr(requiredConsentVersion)}">
					<input type="hidden" name="medical_sharing_consent_version" value="${escapeAttr(requiredMedicalConsentVersion)}">
					<input type="hidden" name="incident_camera_consent_version" value="${escapeAttr(requiredCameraConsentVersion)}">
					<input type="hidden" name="test_ride_monitoring_consent_version" value="${escapeAttr(requiredTestRideConsentVersion)}">
					<section class="halo-card halo-test-ride-monitoring-card"><div class="halo-card-header"><div><p class="halo-card-kicker">ONE RIDE ONLY</p><h2>Avenrà test ride monitoring</h2></div><span class="halo-badge ${testRideEnabled ? 'halo-badge--good' : testRideStoredArmed && !testRideConsentCurrent ? 'halo-badge--attention' : ''}">${testRideActive ? 'Monitoring active' : testRideArmed ? 'Next ride armed' : testRideStoredArmed && !testRideConsentCurrent ? 'Review terms' : 'Off'}</span></div>
						<div class="halo-toggle-row halo-toggle-row--featured"><div class="halo-toggle-copy"><strong>${testRideActive ? 'Monitor this Halo test ride' : 'Monitor my next Halo ride'}</strong><small>For my next Halo ride only, I allow authorised Avenrà staff to view this phone’s live location, current road, calibrated GPS speed, ride peak and signal status in the private Emergency Assist console. Monitoring starts when Ride mode starts and ends when the ride ends or after four hours. It does not enable Emergency Assist, share medical information, use the camera or audio, or share previous rides. Terms version ${escapeHTML(requiredTestRideConsentVersion)}${escapeHTML(testRideArmedUntil)}.</small></div><label class="halo-switch"><input type="checkbox" name="test_ride_monitoring_armed" data-initial-enabled="${testRideEnabled ? 'true' : 'false'}" ${testRideEnabled ? 'checked' : ''}><span></span></label></div>
						<p class="halo-helper">${testRideActive ? 'Turn this off and save to stop staff monitoring now. Otherwise it ends with Ride mode or after four hours.' : 'The arm is consumed automatically as soon as that ride begins. Arm it again only for another test ride.'}</p>
					</section>
					<section class="halo-card"><div class="halo-card-header"><div><p class="halo-card-kicker">EMERGENCY DETAILS</p><h2>Rider & next of kin</h2></div><span class="halo-badge ${nokActive ? 'halo-badge--good' : 'halo-badge--attention'}">${nokActive ? 'Ready' : 'Not set'}</span></div><label class="halo-field"><span>Your mobile</span><input type="tel" name="mobile" autocomplete="tel" inputmode="tel" value="${escapeAttr(this.state.customer.mobile || this.state.customer.mobile_number || safety.mobile)}"><small>Used by an Emergency Assist responder to try to contact you.</small></label><label class="halo-field"><span>Date of birth</span><input type="date" name="date_of_birth" autocomplete="bday" value="${escapeAttr(safety.date_of_birth || this.state.customer.date_of_birth)}"><small>Your date of birth and mobile are required before enabling Emergency Assist.</small></label><div class="halo-field-row"><label class="halo-field"><span>Next-of-kin name</span><input type="text" name="nok_name" autocomplete="name" value="${escapeAttr(nok.name)}"></label><label class="halo-field"><span>Relationship</span><input type="text" name="nok_relationship" value="${escapeAttr(nok.relationship)}"></label></div><label class="halo-field"><span>Next-of-kin mobile</span><input type="tel" name="nok_mobile" autocomplete="tel" inputmode="tel" value="${escapeAttr(nok.mobile || nok.phone)}"></label><div class="halo-button-stack"><button type="button" class="halo-button halo-button--secondary halo-full-width" data-action="test-nok" ${nokActive ? '' : 'disabled'}>Send test alert</button><button type="button" class="halo-button halo-button--secondary halo-full-width" data-action="simulate-crash">Preview 20-second Emergency Assist countdown</button></div></section>
					<section class="halo-card"><div class="halo-card-header"><div><p class="halo-card-kicker">OPTIONAL</p><h2>Medical information</h2></div></div><p class="halo-card-copy">Add only information you want held in Halo for an incident.</p><div class="halo-field-row" style="margin-top:16px"><label class="halo-field"><span>Blood group</span><select name="blood_group">${bloodOptions}</select></label><label class="halo-field"><span>Weight (kg)</span><input type="number" name="weight_kg" min="1" max="350" step="0.1" inputmode="decimal" value="${escapeAttr(medical.weight_kg ?? safety.weight_kg)}"></label></div><label class="halo-field"><span>Allergies or important conditions</span><textarea name="medical_notes" maxlength="2000">${escapeHTML(medical.notes || medical.medical_notes)}</textarea></label></section>
					<section class="halo-card"><div class="halo-card-header"><div><p class="halo-card-kicker">YOUR CHOICE</p><h2>Emergency & data choices</h2></div></div>
						<div class="halo-toggle-row halo-toggle-row--featured"><div class="halo-toggle-copy"><strong>Emergency Assist</strong><small>By enabling, I ask Avenrà Emergency Assist to show on-call staff my online/riding state and, while Ride mode is active, my live speed and location for operational monitoring. If an incident countdown expires, they can also receive my rider, motorcycle, incident and continuing location data to assess it and contact me. My opted-in ride history will be used for a persistent, explainable staff-only ride-risk indicator based on speed exposure, ride dynamics and confirmed incidents; it is not an accident prediction or insurance score. Withdrawing this consent stops monitoring and future scoring and removes staff access to the indicator. Optional medical data is controlled separately below. Terms version ${escapeHTML(requiredConsentVersion)}.</small></div><label class="halo-switch"><input type="checkbox" name="emergency_assist_enabled" data-consent-renewal="${renewalRequired ? 'true' : 'false'}" ${consents.emergency_assist_enabled ? 'checked' : ''} ${!providerReady && !consents.emergency_assist_enabled ? 'disabled' : ''}><span></span></label></div>
						<div class="halo-toggle-row halo-toggle-row--featured"><div class="halo-toggle-copy"><strong>Incident camera — rear view</strong><small>While Ride mode is visible, keep a rolling buffer of up to the final 60 seconds from the rear camera. Audio is always off. Nothing is uploaded during the cancellation countdown; footage is discarded after a confirmed cancellation and sent only after Emergency Assist has durably activated. The phone will show its normal camera privacy indicator. Recording stops when Halo is hidden. Terms version ${escapeHTML(requiredCameraConsentVersion)}.</small></div><label class="halo-switch"><input type="checkbox" name="incident_camera_enabled" data-consent-renewal="${cameraRenewalRequired ? 'true' : 'false'}" ${consents.incident_camera ? 'checked' : ''} ${!cameraReady && !consents.incident_camera ? 'disabled' : ''}><span></span></label></div>
						<div class="halo-toggle-row"><div class="halo-toggle-copy"><strong>Also attempt front-facing view</strong><small>On compatible phones Halo will record front and rear views together. Many phones and WebViews allow only one camera, so Halo automatically uses rear-only. Dual capture uses more battery, processing power and storage.</small></div><label class="halo-switch"><input type="checkbox" name="incident_camera_dual_enabled" ${camera.dual_enabled ? 'checked' : ''} ${!consents.incident_camera || !cameraReady ? 'disabled' : ''}><span></span></label></div>
						<div class="halo-toggle-row"><div class="halo-toggle-copy"><strong>Next-of-kin incident alerts</strong><small>When Emergency Assist is enabled, a responder can send this only after recording a 999 call. Otherwise Halo uses it as the direct incident alert.</small></div><label class="halo-switch"><input type="checkbox" name="nok_alerts" ${consents.nok_alerts ? 'checked' : ''}><span></span></label></div>
						<div class="halo-toggle-row"><div class="halo-toggle-copy"><strong>Include optional medical details</strong><small>By enabling, I explicitly allow the date of birth, blood group, weight and medical notes I supply above to be placed in a protected Emergency Assist incident for responders. Terms version ${escapeHTML(requiredMedicalConsentVersion)}.</small></div><label class="halo-switch"><input type="checkbox" name="medical_sharing" data-consent-renewal="${medicalRenewalRequired ? 'true' : 'false'}" ${consents.medical_sharing ? 'checked' : ''}><span></span></label></div>
						<div class="halo-toggle-row"><div class="halo-toggle-copy"><strong>Next-of-kin proxy authority</strong><small>Allow your registered contact to authorise release of incident data after an incident.</small></div><label class="halo-switch"><input type="checkbox" name="proxy_consent" ${consents.proxy ? 'checked' : ''}><span></span></label></div>
						<div class="halo-toggle-row"><div class="halo-toggle-copy"><strong>Law or court requests</strong><small>Pre-authorise release of the incident telemetry record for a formal investigation.</small></div><label class="halo-switch"><input type="checkbox" name="law_consent" ${consents.law_enforcement ? 'checked' : ''}><span></span></label></div>
						<div class="halo-toggle-row"><div class="halo-toggle-copy"><strong>Road-safety research</strong><small>Allow de-identified incident dynamics to improve motorcycle safety.</small></div><label class="halo-switch"><input type="checkbox" name="ai_consent" ${consents.ai_processing ? 'checked' : ''}><span></span></label></div>
						<p class="halo-helper">Every choice is optional and can be changed at any time.</p>
					</section>
					<button type="submit" class="halo-button halo-button--primary">Save safety settings</button>
				</form>`;
		}

		getDocuments() {
			return asArray(this.state.boot?.documents || this.state.boot?.glovebox?.documents);
		}

		renderDocuments() {
			const container = $('#halo-documents-content', root);
			if (!container) return;
			const documents = this.getDocuments();
			const maxSize = Number(CONFIG.maxDocumentSizeMb || this.state.boot?.limits?.document_mb || 10);
			container.innerHTML = `<label class="halo-upload-zone" for="halo-document-file">${icon('upload')}<strong>Add a document</strong><small>PDF, JPG, PNG or WebP · up to ${escapeHTML(maxSize)} MB</small><input id="halo-document-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"></label>
				<div class="halo-section-heading"><h2>Your files</h2><span class="halo-badge">${documents.length}</span></div>
				${documents.length ? `<div class="halo-document-list">${documents.map((document) => `<div class="halo-document">${icon('document')}<div><strong>${escapeHTML(document.title || document.name || document.original_filename || document.filename || document.type_label || 'Document')}</strong><small>${escapeHTML(document.type_label || document.document_type || document.mime_type || '')}${document.created_at ? ` · ${escapeHTML(formatDate(document.created_at))}` : ''}</small></div><button type="button" class="halo-icon-button" data-action="open-document" data-document-id="${escapeAttr(document.id)}" aria-label="Open ${escapeAttr(document.title || document.name || 'document')}">${icon('chevron')}</button></div>`).join('')}</div>` : `<div class="halo-empty-state">${icon('document')}<h2>No documents yet</h2><p>Store ownership, insurance, warranty and service records in your Glovebox.</p></div>`}`;
		}

		getManualSections() {
			return asArray(this.state.boot?.manual?.sections || this.state.boot?.manual_sections);
		}

		renderManual(sections) {
			const container = $('#halo-manual-content', root);
			if (!container) return;
			const items = sections || this.getManualSections();
			if (!items.length) {
				container.innerHTML = `<div class="halo-empty-state">${icon('book')}<h2>Manual unavailable</h2><p>Connect to load the current manual for your motorcycle.</p><button type="button" class="halo-button halo-button--secondary" data-action="retry-manual">Try again</button></div>`;
				return;
			}
			const query = this.state.manualQuery.trim().toLowerCase();
			const filtered = !query ? items : items.filter((section) => `${section.title || ''} ${section.summary || ''} ${section.content || ''}`.toLowerCase().includes(query));
			if (!filtered.length) {
				container.innerHTML = `<div class="halo-empty-state">${icon('search')}<h2>No matching section</h2><p>Try a different phrase, such as charging, controls or high voltage.</p></div>`;
				return;
			}
			container.innerHTML = `${this.state.boot?.manual?.is_quick_guide ? `<article class="halo-callout">${icon('book')}<div><h3>Essential quick guide</h3><p>Your complete model-specific manual will replace this guide when it is supplied to Halo.</p></div><button type="button" class="halo-button halo-button--secondary" data-action="retry-manual">Check for full manual</button></article>` : ''}<div class="halo-accordion">${filtered.map((section, index) => {
				const id = `halo-manual-section-${index}`;
				const paragraphs = asArray(section.paragraphs).length ? asArray(section.paragraphs) : text(section.content || section.summary).split(/\n{2,}/).filter(Boolean);
				return `<div class="halo-accordion-item"><button type="button" class="halo-accordion-button" aria-expanded="false" aria-controls="${id}"><span>${escapeHTML(section.title || 'Manual section')}</span>${icon('chevron')}</button><div id="${id}" class="halo-accordion-panel" hidden>${paragraphs.map((paragraph) => `<p>${escapeHTML(typeof paragraph === 'string' ? paragraph : paragraph.text || '')}</p>`).join('')}</div></div>`;
			}).join('')}</div>`;
		}

		getProducts() {
			return asArray(this.state.boot?.boutique?.products || this.state.boot?.products);
		}

		renderBoutique(products) {
			const container = $('#halo-boutique-content', root);
			if (!container) return;
			const items = products || this.getProducts();
			if (!items.length) {
				container.innerHTML = `<div class="halo-empty-state">${icon('bag')}<h2>Boutique unavailable</h2><p>Connect to browse current accessories and rider essentials.</p><button type="button" class="halo-button halo-button--secondary" data-action="retry-products">Try again</button></div>`;
				return;
			}
			container.innerHTML = `<div class="halo-product-grid">${items.map((product) => {
				const image = safeUrl(product.image_url || product.image);
				return `<article class="halo-product-card"><div class="halo-product-image">${image ? `<img src="${escapeAttr(image)}" alt="" loading="lazy">` : `<span class="halo-product-placeholder">${icon('bag')}</span>`}</div><div class="halo-product-info"><h3>${escapeHTML(product.name)}</h3><strong>${escapeHTML(this.formatMoney(product.price, product.currency))}</strong><button type="button" class="halo-button halo-button--secondary" data-action="add-to-cart" data-product-id="${escapeAttr(product.id || product.sku)}" ${product.available === false ? 'disabled' : ''}>${product.available === false ? 'Unavailable' : 'Add to basket'}</button></div></article>`;
			}).join('')}</div>`;
		}

		renderProfile() {
			const container = $('#halo-profile-content', root);
			if (!container) return;
			const customer = this.state.customer || {};
			const passkeySupported = Boolean(CONFIG.passkeysEnabled && CONFIG.passkeyEndpoints?.registerOptions && CONFIG.passkeyEndpoints?.registerVerify && window.PublicKeyCredential && window.isSecureContext);
			container.innerHTML = `<form id="halo-profile-form" class="halo-view-content"><section class="halo-card"><div class="halo-card-header"><div><p class="halo-card-kicker">CONTACT DETAILS</p><h2>Your profile</h2></div></div><label class="halo-field"><span>Full name</span><input type="text" name="full_name" autocomplete="name" required value="${escapeAttr(customer.full_name || customer.name)}"></label><label class="halo-field"><span>Verified sign-in email</span><input type="email" name="email" autocomplete="email" readonly aria-readonly="true" value="${escapeAttr(customer.email || customer.email_address)}"><small>Email changes are security-sensitive. Contact Avenrà support to verify and update this address.</small></label><label class="halo-field"><span>Mobile</span><input type="tel" name="mobile" autocomplete="tel" value="${escapeAttr(customer.mobile || customer.mobile_number)}"></label><label class="halo-field"><span>Home address</span><textarea name="full_address" autocomplete="street-address" rows="2">${escapeHTML(customer.full_address || customer.address)}</textarea></label><label class="halo-field"><span>Postcode</span><input type="text" name="postcode" autocomplete="postal-code" value="${escapeAttr(customer.postcode)}"></label></section><button type="submit" class="halo-button halo-button--primary">Save profile</button></form>
				<form id="halo-pin-form" class="halo-card"><div class="halo-card-header"><div><p class="halo-card-kicker">SECURITY</p><h2>Change PIN</h2></div></div><label class="halo-field"><span>Current six-digit PIN</span><input type="password" name="current_pin" autocomplete="current-password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" data-pin-input required></label><label class="halo-field"><span>New six-digit PIN</span><input type="password" name="new_pin" autocomplete="new-password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" data-pin-input required></label><button type="submit" class="halo-button halo-button--secondary halo-full-width" style="margin-top:16px">Update PIN</button></form>
				${passkeySupported ? `<section class="halo-card"><div class="halo-card-header"><div><p class="halo-card-kicker">QUICK SIGN-IN</p><h2>Passkeys</h2></div></div><p class="halo-card-copy">Use your device fingerprint, face unlock or screen lock without changing your six-digit Halo PIN.</p><button type="button" class="halo-button halo-button--secondary halo-full-width" data-action="register-passkey" style="margin-top:16px">${icon('fingerprint')} Add a passkey</button></section>` : ''}`;
		}

		formatMoney(value, currency) {
			const number = finite(value);
			if (number === null) return 'Price unavailable';
			try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP' }).format(number); }
			catch (error) { return `£${number.toFixed(2)}`; }
		}

		async initialisePlannerMap() {
			const scope = this.captureIdentityScope();
			const element = $('#halo-route-map', root);
			if (!element || this.maps.instances.has('planner')) return;
			const map = await this.maps.create('planner', element, {
				mode: 'planner',
				onLocation: (position) => { if (this.identityScopeIsCurrent(scope)) this.state.currentLocation = position; },
				onRouteSelect: (index) => this.selectRoute(index)
			});
			this.assertIdentityScope(scope);
			if (map && this.state.routes.length) await this.maps.call('planner', ['showRoutes', 'renderRoutes'], [this.state.routes, { selectedIndex: this.state.routes.indexOf(this.state.selectedRoute) }]);
		}

		async useCurrentLocation(recenterOnly) {
			const scope = this.captureIdentityScope();
			if (!navigator.geolocation) throw new HaloAPIError('Location is not supported on this device.');
			const location = await new Promise((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(
					(position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, label: 'Current location' }),
					(error) => reject(new HaloAPIError(error.code === 1 ? 'Allow location access to use your current position.' : 'Halo could not find your current position.')),
					{ enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
				);
			});
			this.assertIdentityScope(scope);
			this.state.currentLocation = location;
			const origin = $('#halo-route-form [name="origin"]', root);
			if (origin && !recenterOnly) origin.value = 'Current location';
			await this.maps.call('planner', ['setUserLocation', 'updatePosition'], [location, false]);
			this.assertIdentityScope(scope);
			const result = await this.maps.call('planner', ['flyTo', 'setCenter'], [location, 15]);
			this.assertIdentityScope(scope);
			if (recenterOnly && this.state.activeRide) {
				await this.maps.call('active', ['setUserLocation', 'updatePosition'], [location, true]);
				this.assertIdentityScope(scope);
				const activeResult = await this.maps.call('active', ['flyTo', 'setCenter', 'recenter'], [location, 15]);
				this.assertIdentityScope(scope);
				if (!activeResult) this.rideEngine.recenter();
			}
			return location;
		}

		async planRoute(form) {
			const scope = this.captureIdentityScope();
			if (!navigator.onLine) throw new HaloAPIError('Route planning needs a connection. Saved rides remain available offline.', 0, 'offline');
			const values = this.formObject(form);
			const originValue = text(values.origin, 'Current location').trim();
			const destination = text(values.destination).trim();
			if (!destination) return;
			if ((!originValue || /^current location$/i.test(originValue)) && !this.state.currentLocation) {
				await this.useCurrentLocation(false);
				this.assertIdentityScope(scope);
			}
			this.setLoading($('.halo-route-submit', form), true);
			const mapState = $('[data-map-state]', $('#halo-route-map', root));
			if (mapState) {
				mapState.hidden = false;
				mapState.classList.remove('is-error');
				mapState.innerHTML = '<div class="halo-boot-mark"></div><p>Comparing routes</p>';
			}
			try {
				const usingCurrent = /^current location$/i.test(originValue);
				const payload = await this.api.post('/routes/plan', {
					start_query: usingCurrent ? '' : originValue,
					end_query: destination,
					start_lat: usingCurrent ? this.state.currentLocation?.lat : null,
					start_lng: usingCurrent ? this.state.currentLocation?.lng : null,
					end_lat: null,
					end_lng: null,
					exclude: this.state.routePreferences.avoid_motorways ? ['motorway'] : [],
					profile: this.state.routePreferences.profile,
					focus_zones: this.state.routePreferences.focus_zones !== false
				}, { timeout: 30000 });
				this.assertIdentityScope(scope);
				const routes = asArray(payload.routes || payload.alternatives).map((route, index) => this.normaliseRoute(route, index)).filter((route) => route.distance_miles !== null || route.geometry);
				if (!routes.length) throw new HaloAPIError(payload.message || 'No usable route was returned. Try a more specific destination.');
				this.state.routes = routes;
				this.state.selectedRoute = routes.find((route) => route.recommended) || routes[0];
				if (mapState) mapState.hidden = true;
				await this.initialisePlannerMap();
				this.assertIdentityScope(scope);
				await this.maps.call('planner', ['showRoutes', 'renderRoutes'], [routes, { selectedIndex: routes.indexOf(this.state.selectedRoute), origin: payload.origin, destination: payload.destination }]);
				this.assertIdentityScope(scope);
				this.renderRouteResults();
			} catch (error) {
				if (error.code === 'stale_identity') throw error;
				if (mapState) {
					const fallbackUrl = safeUrl(error.details?.fallback_url);
					mapState.hidden = false;
					mapState.classList.add('is-error');
					mapState.innerHTML = `${icon('warning')}<p>${escapeHTML(error.message || 'Route planning is unavailable.')}</p>${fallbackUrl ? `<a class="halo-button halo-button--secondary" href="${escapeAttr(fallbackUrl)}" target="_blank" rel="noopener noreferrer">Open in phone maps</a>` : ''}`;
				}
				throw error;
			} finally { this.setLoading($('.halo-route-submit', form), false); }
		}

		async submitRouteForm(form) {
			if (!(form instanceof HTMLFormElement) || !form.reportValidity()) return;
			await this.requireFreshAccount();
			await this.planRoute(form);
		}

		normaliseRoute(route, index) {
			const distanceMetres = finite(route.distance_m ?? route.distance_metres);
			const distanceMiles = finite(route.distance_miles ?? route.distance_mi ?? route.miles) ?? (distanceMetres === null ? null : distanceMetres / 1609.344);
			const durationSeconds = finite(route.duration_seconds ?? route.duration_s) ?? (finite(route.duration_minutes ?? route.duration_min) === null ? null : finite(route.duration_minutes ?? route.duration_min) * 60);
			const rawGeometry = route.geometry || route.coordinates || route.route;
			const coordinates = geometryCoordinates(rawGeometry);
			return Object.assign({}, route, {
				id: route.id ?? route.route_id ?? index,
				label: route.label || route.name || (route.recommended ? 'Halo recommended' : route.fastest ? 'Fastest route' : `Alternative ${index + 1}`),
				distance_miles: distanceMiles,
				duration_seconds: durationSeconds,
				arrival_soc: finite(route.arrival_soc ?? route.estimated_arrival_soc),
				hazards: asArray(route.hazards || route.focus_zones),
				recommended: route.recommended === true,
				geometry: coordinates.length ? coordinates : rawGeometry
			});
		}

		renderRouteResults() {
			const container = $('#halo-route-results', root);
			if (!container) return;
			if (!this.state.routes.length) { container.innerHTML = ''; return; }
			const selected = this.state.selectedRoute;
			container.innerHTML = `${this.state.routes.map((route, index) => {
				const isSelected = route === selected;
				const arrivalSoc = this.estimatedArrivalSoc(route);
				const detail = [formatMiles(route.distance_miles), formatDuration(route.duration_seconds), route.hazards.length ? `${route.hazards.length} focus zone${route.hazards.length === 1 ? '' : 's'}` : 'No mapped focus zones'].join(' · ');
				return `<button type="button" class="halo-route-option ${isSelected ? 'is-selected' : ''}" data-route-index="${index}" aria-pressed="${isSelected}"><span><strong>${escapeHTML(route.label)}</strong><small>${escapeHTML(detail)}</small></span><span>${arrivalSoc === null ? '' : `${Math.round(arrivalSoc)}%`}</span></button>`;
			}).join('')}<article class="halo-card halo-route-start"><div><p class="halo-card-kicker">SELECTED ROUTE</p><h2>${escapeHTML(selected.label)}</h2><p class="halo-card-copy">${escapeHTML(formatMiles(selected.distance_miles))} · ${escapeHTML(formatDuration(selected.duration_seconds))}. Advisory data may be incomplete; follow signs and visible road conditions.</p></div><button type="button" class="halo-button halo-button--primary halo-full-width" data-action="start-guidance" ${this.rideEngine.available ? '' : 'disabled'}>Start guidance</button>${this.rideEngine.available ? '' : '<p class="halo-helper">Live Ride mode is unavailable because the ride engine did not load. You can still review the route above.</p>'}</article>`;
		}

		async selectRoute(index) {
			if (!this.state.routes[index]) return;
			this.state.selectedRoute = this.state.routes[index];
			this.renderRouteResults();
			await this.maps.call('planner', ['selectRoute', 'highlightRoute', 'showRoute'], [index, this.state.selectedRoute]);
		}

		openRoutePreferences() {
			const preferences = this.state.routePreferences;
			const voiceSupported = Boolean('speechSynthesis' in window || this.rideEngine.engine?.capabilities?.voice);
			this.openSheet('Route preferences', `<form id="halo-route-preferences-form" class="halo-view-content"><label class="halo-field"><span>Route style</span><select name="profile"><option value="balanced" ${preferences.profile === 'balanced' ? 'selected' : ''}>Balanced</option><option value="fastest" ${preferences.profile === 'fastest' ? 'selected' : ''}>Fastest</option><option value="scenic" ${preferences.profile === 'scenic' ? 'selected' : ''}>Scenic</option></select></label><section class="halo-card halo-card--flat"><div class="halo-toggle-row"><div class="halo-toggle-copy"><strong>Avoid motorways</strong><small>Prefer A-roads and local routes when practical.</small></div><label class="halo-switch"><input type="checkbox" name="avoid_motorways" ${preferences.avoid_motorways ? 'checked' : ''}><span></span></label></div><div class="halo-toggle-row"><div class="halo-toggle-copy"><strong>Focus-zone advice</strong><small>Show mapped attention areas along the route.</small></div><label class="halo-switch"><input type="checkbox" name="focus_zones" ${preferences.focus_zones !== false ? 'checked' : ''}><span></span></label></div><div class="halo-toggle-row"><div class="halo-toggle-copy"><strong>Voice guidance</strong><small>${voiceSupported ? 'Speak upcoming manoeuvres while Ride mode is open.' : 'Voice guidance is unavailable on this device.'}</small></div><label class="halo-switch"><input type="checkbox" name="voice_guidance" ${preferences.voice_guidance ? 'checked' : ''} ${voiceSupported ? '' : 'disabled'}><span></span></label></div></section><button type="submit" class="halo-button halo-button--primary">Save preferences</button></form>`);
		}

		async saveRoutePreferences(form) {
			const preferences = this.formObject(form);
			this.setLoading(form, true);
			try {
				this.state.routePreferences = Object.assign({}, preferences);
				try { window.localStorage.setItem('avenra-halo-v2-route-preferences', JSON.stringify(this.state.routePreferences)); } catch (error) { /* Optional convenience only. */ }
				this.updateRoutePreferenceLabel();
				this.dom.sheet.close();
				this.toast('Route preferences saved.', 'success');
			} finally { this.setLoading(form, false); }
		}

		updateRoutePreferenceLabel() {
			const label = $('[data-route-preference-label]', root);
			if (!label) return;
			const profile = text(this.state.routePreferences.profile, 'balanced');
			label.textContent = profile.charAt(0).toUpperCase() + profile.slice(1);
		}

		async startGuidance(button) {
			if (!this.state.selectedRoute) throw new HaloAPIError('Choose a route first.');
			return this.beginRide(this.state.selectedRoute, button);
		}

		async startFreeRide(button) {
			return this.beginRide(null, button);
		}

		testRideMonitoringSettings() {
			const settings = this.state.boot?.safety?.test_ride_monitoring;
			return isObject(settings) ? settings : {};
		}

		testRideMonitoringArmed() {
			const settings = this.testRideMonitoringSettings();
			return settings.armed === true && settings.consent_current !== false;
		}

		consumeTestRideMonitoringArm(response) {
			if (!this.state.boot) return;
			this.state.boot.safety = isObject(this.state.boot.safety) ? this.state.boot.safety : {};
			const returned = isObject(response?.test_ride_monitoring)
				? response.test_ride_monitoring
				: isObject(response?.safety?.test_ride_monitoring) ? response.safety.test_ride_monitoring : null;
			const current = this.testRideMonitoringSettings();
			this.state.boot.safety.test_ride_monitoring = returned || Object.assign({}, current, {
				armed: false,
				active: Boolean(response?.session_id) || Boolean(current.active),
				stored_armed: false,
				consent_current: true,
				consented_at: response?.consented_at || current.consented_at || new Date().toISOString()
			});
		}

		markTestRideMonitoringInactive(response) {
			if (!this.state.boot) return;
			this.state.boot.safety = isObject(this.state.boot.safety) ? this.state.boot.safety : {};
			const returned = isObject(response?.test_ride_monitoring)
				? response.test_ride_monitoring
				: isObject(response?.safety?.test_ride_monitoring) ? response.safety.test_ride_monitoring : null;
			const current = this.testRideMonitoringSettings();
			this.state.boot.safety.test_ride_monitoring = returned || Object.assign({}, current, { active: false });
		}

		testRideMonitoringEndedError(error) {
			return Boolean(error && ([404, 410].includes(Number(error.status)) || [
				'test_ride_monitoring_not_found',
				'test_ride_monitoring_ended',
				'monitoring_not_found',
				'tracking_not_found',
				'tracking_ended',
				'not_found'
			].includes(error.code)));
		}

		async queueTestRideMonitoringRevoke(tracking) {
			if (!tracking?.session_id || !this.state.customer?.id) return false;
			const expiry = new Date(tracking.expires_at || '').getTime();
			await this.queue.add({
				endpoint: `/test-ride-monitoring/${encodeURIComponent(tracking.session_id)}`,
				method: 'DELETE',
				payload: {},
				customerId: this.state.customer.id,
				kind: 'test-ride-monitoring-revoke',
				sessionId: tracking.session_id,
				expiresAt: Number.isFinite(expiry) ? expiry : Date.now() + (4 * 60 * 60 * 1000)
			});
			return true;
		}

		startTestRideMonitoring(clientRideId, retryAttempt = 0, armClaimed = false) {
			if ((!armClaimed && !this.testRideMonitoringArmed()) || !clientRideId) {
				this.state.testRideTracking = null;
				this.renderTestRideMonitoringStatus();
				return Promise.resolve(false);
			}
			// Claim the displayed one-ride choice locally before the network request.
			// This prevents an offline or ambiguous start from silently carrying the
			// same consent into a later ride on this device.
			if (!armClaimed) this.consumeTestRideMonitoringArm();
			const scope = this.captureIdentityScope();
			const tracking = {
				ride_id: String(clientRideId),
				session_id: '',
				status: 'starting',
				active: false,
				stopping: false,
				sequence: 0,
				last_attempt_at: 0,
				last_sent_at: 0,
				updating: false,
				expires_at: '',
				monitor_url: '',
					warningShown: false
				};
			this.state.testRideTracking = tracking;
			this.renderTestRideMonitoringStatus();
			const operation = (async () => {
				try {
					const response = await this.api.post('/test-ride-monitoring', { client_ride_id: clientRideId });
					this.assertIdentityScope(scope);
					tracking.session_id = text(response.session_id || response.public_id);
					if (!tracking.session_id) throw new HaloAPIError('Halo did not confirm a test ride monitoring session.');
					tracking.server_status = text(response.status, 'active').toLowerCase();
					if (['ended', 'expired', 'revoked', 'inactive', 'failed'].includes(tracking.server_status)) {
						throw new HaloAPIError('Halo did not activate test ride monitoring.');
					}
					tracking.expires_at = response.expires_at || '';
					tracking.monitor_url = safeUrl(response.staff_url || response.monitor_url || '') || '';
					tracking.sequence = Math.max(0, Number(response.last_sequence) || 0);
					const activeClientRideId = this.state.activeRide?.session?.ride_id || this.state.activeRide?.id || '';
					if (tracking.stopping || this.state.testRideTracking !== tracking || String(activeClientRideId) !== String(clientRideId)) {
						try {
							await this.api.delete(`/test-ride-monitoring/${encodeURIComponent(tracking.session_id)}`, {}, { keepalive: true, timeout: 8000 });
						} catch (error) {
							if (!this.testRideMonitoringEndedError(error) && this.isRetryableRideSave(error)) await this.queueTestRideMonitoringRevoke(tracking);
						}
						if (this.state.testRideTracking === tracking) this.state.testRideTracking = null;
						this.renderTestRideMonitoringStatus();
						return false;
					}
					tracking.active = true;
					tracking.status = 'live';
					if (this.state.activeRide && String(this.state.activeRide.id || '') === String(clientRideId)) {
						this.state.activeRide.testRideMonitoring = true;
					}
					this.consumeTestRideMonitoringArm(response);
					if (this.state.rideDegradedMessages) delete this.state.rideDegradedMessages.testRideMonitoring;
					this.renderRideDegradedState();
					this.renderTestRideMonitoringStatus();
					this.toast('Avenrà test ride monitoring is live for this ride.', 'success');
					if (this.state.currentLocation) void this.updateTestRideMonitoringPosition(this.state.currentLocation, true);
					return true;
				} catch (error) {
					if (error.code === 'stale_identity' || tracking.stopping || this.state.testRideTracking !== tracking) return false;
					const ambiguousFailure = this.isRetryableRideSave(error);
					const retryable = ambiguousFailure && retryAttempt < 2
						&& String(this.state.activeRide?.id || '') === String(clientRideId);
					tracking.active = false;
					tracking.status = retryable ? 'degraded' : ambiguousFailure ? 'unconfirmed' : 'failed';
					this.state.rideDegradedMessages = Object.assign({}, this.state.rideDegradedMessages, {
						testRideMonitoring: retryable
							? 'Avenrà test ride monitoring is not yet confirmed. Halo will retry automatically.'
							: ambiguousFailure
								? 'Avenrà could not confirm monitoring. Phone updates have stopped while Halo withdraws any ambiguous server session.'
								: 'Avenrà test ride monitoring could not start. This ride is not being monitored.'
					});
					this.renderRideDegradedState();
					this.renderTestRideMonitoringStatus();
					if (retryable) {
						this.toast('Test ride monitoring is not yet confirmed. Halo will retry shortly.', 'error');
						tracking.retryTimer = window.setTimeout(() => {
							if (this.state.testRideTracking !== tracking || tracking.stopping || String(this.state.activeRide?.id || '') !== String(clientRideId)) return;
							this.state.testRideTracking = null;
							void this.startTestRideMonitoring(clientRideId, retryAttempt + 1, true);
						}, retryAttempt === 0 ? 8000 : 30000);
					} else if (ambiguousFailure) {
						this.toast('Monitoring could not be confirmed. Halo is stopping any session that may have started.', 'error');
						const revoked = await this.revokeTestRideMonitoringArm().catch(() => false);
						if (this.identityScopeIsCurrent(scope) && this.state.testRideTracking === tracking && revoked) {
							this.state.testRideTracking = null;
							this.renderTestRideMonitoringStatus();
						}
					} else {
						this.toast('Test ride monitoring could not start. The ride can continue, but Avenrà cannot monitor it.', 'error');
					}
					return false;
				}
			})();
			tracking.startPromise = operation;
			return operation;
		}

		async stopTestRideMonitoring(notify) {
			const tracking = this.state.testRideTracking;
			if (!tracking) return;
			tracking.active = false;
			tracking.stopping = true;
			tracking.status = 'stopping';
			this.markTestRideMonitoringInactive();
			window.clearTimeout(tracking.retryTimer);
			this.renderTestRideMonitoringStatus();
			await Promise.resolve(tracking.startPromise).catch(() => null);
			if (this.state.testRideTracking !== tracking) return;
			if (!tracking.session_id) {
				// A timeout may happen after the server consumed the arm and created a
				// session. Explicitly withdrawing the arm also closes any such ambiguous
				// session; queue that privacy boundary when the phone is offline.
				await this.revokeTestRideMonitoringArm().catch(() => null);
				this.state.testRideTracking = null;
				this.renderTestRideMonitoringStatus();
				return;
			}
			let queued = false;
			let failed = false;
			try {
				if (!navigator.onLine) throw new HaloAPIError('Halo is offline.', 0, 'offline');
				await this.api.delete(`/test-ride-monitoring/${encodeURIComponent(tracking.session_id)}`, {}, { keepalive: true, timeout: 8000 });
			} catch (error) {
				if (!this.testRideMonitoringEndedError(error)) {
					if (this.isRetryableRideSave(error)) queued = await this.queueTestRideMonitoringRevoke(tracking);
					else failed = true;
				}
			}
			if (this.state.testRideTracking === tracking) this.state.testRideTracking = null;
			this.renderTestRideMonitoringStatus();
			if (queued) this.toast('Monitoring updates stopped. Server revocation is queued and the private session will expire automatically.', 'error');
			else if (failed) this.toast('Monitoring updates stopped on this phone. The server session could not be ended and will expire automatically.', 'error');
			else if (notify) this.toast('Avenrà test ride monitoring ended.', 'success');
		}

		async revokeTestRideMonitoringArm() {
			const settings = this.testRideMonitoringSettings();
			const armId = text(settings.arm_id);
			const consentedAt = text(settings.consented_at);
			const payload = { test_ride_monitoring_armed: false };
			if (armId) payload.test_ride_monitoring_expected_arm_id = armId;
			else if (consentedAt) payload.test_ride_monitoring_expected_consented_at = consentedAt;
			let queued = null;
			if (this.state.customer?.id) {
				const queueIdentity = (armId || consentedAt || 'current').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'current';
				queued = await this.queue.add({
					queue_id: `test-ride-monitoring-disarm-${this.state.customer.id}-${queueIdentity}`,
					endpoint: '/safety',
					method: 'PUT',
					payload,
					customerId: this.state.customer.id,
					kind: 'test-ride-monitoring-disarm',
					// Persist the privacy boundary before the request. If the app closes
					// during an ambiguous response, the next authenticated launch retries it.
					expiresAt: Date.now() + (4 * 60 * 60 * 1000)
				});
			}
			try {
				if (!navigator.onLine) throw new HaloAPIError('Halo is offline.', 0, 'offline');
				const response = await this.api.put('/safety', payload, { timeout: 8000 });
				if (queued) await this.queue.remove(queued.queue_id);
				this.markTestRideMonitoringInactive(response);
				return true;
			} catch (error) {
				if (!this.isRetryableRideSave(error) && queued) await this.queue.remove(queued.queue_id);
				return false;
			}
		}

		async updateTestRideMonitoringPosition(position, immediate) {
			const tracking = this.state.testRideTracking;
			if (!tracking?.active || tracking.stopping || tracking.updating || !navigator.onLine || finite(position?.lat) === null || finite(position?.lng) === null) return;
			if (!immediate && Date.now() - tracking.last_attempt_at < 10000) return;
			const scope = this.captureIdentityScope();
			tracking.updating = true;
			tracking.last_attempt_at = Date.now();
			tracking.sequence += 1;
			try {
				await this.api.post(`/test-ride-monitoring/${encodeURIComponent(tracking.session_id)}/position`, {
					sequence: tracking.sequence,
					lat: Number(position.lat),
					lng: Number(position.lng),
					speed_mph: position.speedMph ?? position.speed_mph ?? this.state.lastTelemetry?.speedMph ?? this.state.lastTelemetry?.speed_mph ?? 0,
					top_speed_mph: this.state.lastTelemetry?.topSpeedMph ?? this.state.lastTelemetry?.top_speed_mph ?? position.speedMph ?? position.speed_mph ?? 0,
					road_name: this.state.currentRoadName || '',
					heading: position.heading ?? null,
					accuracy_m: position.accuracy ?? null
				});
				this.assertIdentityScope(scope);
				if (this.state.testRideTracking !== tracking || tracking.stopping) return;
				tracking.last_sent_at = Date.now();
				tracking.status = 'live';
				tracking.warningShown = false;
				if (this.state.rideDegradedMessages) delete this.state.rideDegradedMessages.testRideMonitoringSignal;
				this.renderRideDegradedState();
				this.renderTestRideMonitoringStatus();
			} catch (error) {
				if (error.code === 'stale_identity' || this.state.testRideTracking !== tracking || tracking.stopping) return;
				if (this.testRideMonitoringEndedError(error)) {
					tracking.active = false;
					tracking.status = 'failed';
					this.state.rideDegradedMessages = Object.assign({}, this.state.rideDegradedMessages, {
						testRideMonitoring: 'Avenrà test ride monitoring ended. This ride is no longer being monitored.'
					});
					this.toast('Avenrà test ride monitoring has ended for this ride.', 'error');
				} else {
					tracking.status = 'degraded';
					this.state.rideDegradedMessages = Object.assign({}, this.state.rideDegradedMessages, {
						testRideMonitoringSignal: 'Avenrà test ride monitoring signal is delayed. Halo will retry while Ride mode remains active.'
					});
					if (!tracking.warningShown) {
						tracking.warningShown = true;
						this.toast('Test ride monitoring signal is delayed. Halo will retry automatically.', 'error');
					}
				}
				this.renderRideDegradedState();
				this.renderTestRideMonitoringStatus();
			} finally {
				if (this.state.testRideTracking === tracking) tracking.updating = false;
			}
		}

		renderTestRideMonitoringStatus() {
			const chip = $('[data-test-ride-monitoring-status]', root);
			if (!chip) return;
			const tracking = this.state.testRideTracking;
			chip.hidden = !this.state.activeRide || !tracking;
			if (chip.hidden) return;
			const phase = String(tracking.status || 'starting');
			chip.classList.toggle('is-live', phase === 'live');
			chip.classList.toggle('is-starting', phase === 'starting' || phase === 'stopping');
			chip.classList.toggle('is-warning', phase === 'failed' || phase === 'degraded' || phase === 'unconfirmed');
			chip.textContent = phase === 'live'
				? 'Avenrà test ride monitoring live · location and speed'
				: phase === 'degraded' ? 'Avenrà test ride monitoring · signal delayed'
					: phase === 'unconfirmed' ? 'Monitoring unconfirmed · phone updates stopped'
					: phase === 'failed' ? 'Test ride monitoring unavailable · this ride is not monitored'
						: phase === 'stopping' ? 'Avenrà test ride monitoring ending…'
							: 'Avenrà test ride monitoring starting…';
		}

		async beginRide(route, button) {
			const scope = this.captureIdentityScope();
			const identitySignal = this.identityController.signal;
			const rideReturnFocus = document.activeElement;
			if (!this.rideEngine.available) throw new HaloAPIError('Live Ride mode is not available because the ride engine did not load.');
			if (this.rideStarting || this.state.activeRide) throw new HaloAPIError('Ride mode is already starting or active.');
			if ([this.state.ecu?.status, this.state.bms?.status].some((status) => ['scanning', 'connecting'].includes(status))) throw new HaloAPIError('Finish or cancel HyperCore pairing before starting Ride mode.');
			this.rideStarting = true;
			this.resetCameraAlignmentViewed();
			this.syncRideSetup();
			this.setLoading(button, true);
			let rideCameraCancelled = false;
			try {
				// A pre-ride preview must release every track before the recording pipeline
				// is allowed to request a camera from the same button gesture.
				this.closeCameraAlignment('ride-starting');
				const pendingAlignment = this.cameraAlignmentSettlement();
			this.state.rideDegradedMessages = {};
			const clientRideId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `ride-${Date.now()}-${Math.random().toString(16).slice(2)}`;
			const startedAt = new Date().toISOString();
			const testRideMonitoring = this.testRideMonitoringArmed();
				const cameraPreferences = this.incidentCameraPreferences();
				const memoryPreferences = this.rideMemoryPreferences();
				const cameraNeeded = cameraPreferences.enabled || memoryPreferences.enabled;
				const preferDual = (cameraPreferences.enabled && cameraPreferences.dual) || (memoryPreferences.enabled && memoryPreferences.dual);
				const customerKey = String(this.state.customer?.id || this.identityCustomerId || '');
				this.state.lastRideMemory = null;
				this.stopRideMemoryLeaseHeartbeat();
				this.rideMemoryWriteQueue = Promise.resolve();
				this.rideMemorySession = memoryPreferences.enabled ? {
					customerKey,
					rideId: clientRideId,
					identityEpoch: scope.epoch,
					startedAt,
					dual: memoryPreferences.dual,
					segmentCount: 0,
					bytes: 0,
					pendingBytes: 0,
					telemetryPoints: [],
					lastTelemetrySampleAt: 0,
					failed: false,
					finalized: false
				} : null;
				this.state.rideMemoryStatus = memoryPreferences.enabled ? { status: 'starting', segmentCount: 0, bytes: 0 } : null;
				this.renderRideMemoryStatus();
				this.rideMemoryStartPromise = memoryPreferences.enabled
					? (async () => {
						const estimate = await this.rideMemories.estimateStorage({ customerKey });
						if (finite(estimate.availableBytes) !== null && estimate.availableBytes < 64 * 1024 * 1024) {
							throw new HaloAPIError('This device has less than 64 MB available for Ride Memories. Free some storage and try again.', 0, 'ride_memories_low_storage');
						}
						const manifest = await this.rideMemories.beginRide({
							customerKey,
							rideId: clientRideId,
							startedAt,
							cameras: memoryPreferences.dual ? ['rear', 'front'] : ['rear'],
							audio: false
						});
						if (this.rideMemorySession && this.rideMemorySession.rideId === clientRideId && this.rideMemorySession.identityEpoch === scope.epoch) {
							this.startRideMemoryLeaseHeartbeat(this.rideMemorySession);
						}
						return manifest;
					})()
					: Promise.resolve(null);
				// Invoke before any await: iOS only permits motion/orientation prompts
				// and camera access directly inside the Start-button user gesture.
				const motionPermission = this.rideEngine.requestMotionPermission();
				const startRideCamera = () => {
					const activeClientRide = String(this.state.activeRide?.session?.ride_id || this.state.activeRide?.id || '');
					if (rideCameraCancelled || !this.identityScopeIsCurrent(scope)
						|| (!this.rideStarting && activeClientRide !== String(clientRideId))) {
						return { status: 'stopped', reason: 'ride-no-longer-active' };
					}
					return cameraNeeded && this.incidentCamera?.startRide
						? this.incidentCamera.startRide({ rideId: clientRideId, ride_id: clientRideId, preferDual })
						: null;
				};
				let cameraStart;
				try {
					cameraStart = pendingAlignment
						? pendingAlignment.then(startRideCamera)
						: Promise.resolve(startRideCamera());
				} catch (error) {
					cameraStart = Promise.resolve({ status: 'unavailable', error });
				}
				cameraStart = cameraStart.catch((error) => ({ status: 'unavailable', error }));
					await motionPermission;
					this.assertIdentityScope(scope);
					const memoryReady = await this.rideMemoryStartPromise.then(() => true, (error) => {
						this.handleRideMemoryFailure(error);
						return false;
					});
					this.assertIdentityScope(scope);
					if (!this.state.currentLocation) await this.useCurrentLocation(false);
					this.assertIdentityScope(scope);
					const setup = this.rideSetup();
					const session = { ride_id: clientRideId, local: true, started_at: startedAt, ride_mode: setup.mode, start_soc: setup.soc };
				this.state.currentRoadName = '';
				this.state.lastTelemetry = null;
				const arrival = $('[data-ride-arrival]', root);
				const gps = $('[data-ride-gps]', root);
				if (arrival) arrival.textContent = '—';
				if (gps) {
					gps.textContent = 'Finding';
					gps.removeAttribute('title');
					gps.removeAttribute('aria-label');
				}
				const activeMap = await this.maps.create('active', $('#halo-active-map', root), {
					mode: 'ride',
					route,
					follow: true,
					followMode: 'forward',
					followZoom: 17,
					lookAheadRatio: 0.2,
					maxLookAheadPixels: 220,
					bottomOverlayClearancePixels: 285,
					rotateWithCourse: true,
					controls: false,
					interactive: false
				});
				if (route) await this.maps.call('active', ['showRoute', 'renderRoute'], [route, { fit: true }]);
				const engineState = await this.rideEngine.start({ route, vehicleId: this.state.vehicle?.id || null, customerId: this.state.customer?.id || null, soc: setup.soc, mode: setup.mode, rideMode: testRideMonitoring ? 'test' : setup.mode, testRideMonitoring, map: activeMap, signal: identitySignal, clientRideId });
				this.assertIdentityScope(scope);
				const rideId = typeof engineState === 'string' ? engineState : engineState?.id || session.ride_id || session.id;
					if (!memoryReady) this.rideMemorySession = null;
					const memoryRecording = Boolean(memoryPreferences.enabled && memoryReady && !this.rideMemorySession?.failed);
					this.state.activeRide = { id: rideId, session, engineState, route, started_at: startedAt, freeRide: !route, mode: setup.mode, startSoc: setup.soc, rideMemories: memoryRecording, testRideMonitoring };
					this.state.ecuRideWasLive = Boolean(this.state.ecu?.live);
					this.state.bmsRideWasLive = Boolean(this.state.bms?.live);
					this.renderHypercoreRideStatus();
					this.state.testRideTracking = null;
					this.renderTestRideMonitoringStatus();
					if (testRideMonitoring) void this.startTestRideMonitoring(clientRideId);
					this.nativeRide?.start?.({ rideId });
					this.renderIncidentCameraStatus();
					this.renderRideMemoryStatus();
				this.sendPresence(true, true).catch(() => null);
				this.updateConnectivity();
				this.state.lastSpokenInstruction = '';
				this.state.offRouteSamples = 0;
				this.state.lastRerouteAt = 0;
				this.state.gpsDeniedDialogShown = false;
				this.renderRideDegradedState();
				$('[data-next-instruction]', root).textContent = route ? 'Route guidance ready' : 'Free ride recording';
				$('[data-next-distance]', root).textContent = route ? 'Starting' : 'No destination';
				this.updateRideTelemetry({ speedMph: 0, distanceMiles: 0, durationSeconds: 0, topSpeedMph: 0, maxLeanLeft: 0, maxLeanRight: 0, bestZeroToSixty: null, range_miles: this.vehicleBattery().range });
				this.state.rideReturnFocus = rideReturnFocus;
				this.dom.product.setAttribute('inert', '');
				this.dom.activeRide.hidden = false;
				document.documentElement.classList.add('halo-ride-active');
				window.requestAnimationFrame(() => {
					this.dom.activeRide.focus({ preventScroll: true });
					this.maps.call('active', ['invalidate', 'invalidateSize', 'resize'], [])
						.then(() => this.state.currentLocation
							? this.maps.call('active', ['updatePosition', 'setUserLocation'], [this.state.currentLocation])
							: route ? this.maps.call('active', ['showRoute', 'renderRoute'], [route, { fit: true }]) : null)
						.catch(() => null);
				});
				if (!this.nativeRide && navigator.wakeLock?.request) {
					const wakeLock = await navigator.wakeLock.request('screen').catch(() => null);
					if (!this.identityScopeIsCurrent(scope)) {
						wakeLock?.release?.().catch(() => {});
						this.assertIdentityScope(scope);
					}
					this.state.wakeLock = wakeLock;
				}
				this.assertIdentityScope(scope);
				this.rideFocus?.enter();
				this.bindHoldControl();
				if (this.state.currentLocation) this.loadNearbyHazards(this.state.currentLocation);
					void cameraStart.then((status) => {
						const activeClientRide = String(this.state.activeRide?.session?.ride_id || this.state.activeRide?.id || '');
						if (rideCameraCancelled || activeClientRide !== String(clientRideId) || status?.reason === 'ride-no-longer-active') return;
						if (!memoryRecording && memoryPreferences.enabled && !cameraPreferences.enabled) {
							const failedMemoryShutdown = this.stopIncidentCameraCapture('ride-memory-start-failed', { archive: false, preserveMemory: false });
							void failedMemoryShutdown.stopPromise;
							return;
						}
						this.handleRideCameraStarted(status, { enabled: memoryRecording, dual: memoryPreferences.dual });
					});
				} catch (error) {
					rideCameraCancelled = true;
					this.rideFocus?.leave();
					await this.stopTestRideMonitoring(false).catch(() => null);
					this.nativeRide?.stop?.('ride_start_failed').catch(() => null);
					const failedRideShutdown = this.stopIncidentCameraCapture('ride-start-failed', { archive: false, preserveMemory: false });
					await failedRideShutdown.stopPromise;
					const failedMemory = this.rideMemorySession;
					this.stopRideMemoryLeaseHeartbeat();
					this.rideMemorySession = null;
					this.state.rideMemoryStatus = null;
					this.renderRideMemoryStatus();
					if (failedMemory) {
						await this.rideMemoryStartPromise.catch(() => null);
						await this.rideMemoryWriteQueue.catch(() => null);
						await this.rideMemories?.deleteRide?.({ customerKey: failedMemory.customerKey, rideId: failedMemory.rideId }).catch(() => null);
					}
					this.dom.activeRide.hidden = true;
				this.dom.product.removeAttribute('inert');
				this.state.rideReturnFocus = null;
				document.documentElement.classList.remove('halo-ride-active');
				throw error;
			} finally {
				this.rideStarting = false;
				this.syncRideSetup();
				this.syncCameraAlignmentSetup();
				this.setLoading(button, false);
			}
		}

		bindHoldControl() {
			const button = $('[data-action="hold-end-ride"]', root);
			if (!button || button.dataset.bound) return;
			button.dataset.bound = 'true';
			let timer = null;
			const cancel = () => {
				window.clearTimeout(timer);
				timer = null;
				button.classList.remove('is-holding');
			};
			const start = (event) => {
				event.preventDefault();
				if (this.endingRide) return;
				button.classList.add('is-holding');
				timer = window.setTimeout(() => { cancel(); this.endRide(); }, 2000);
			};
			button.addEventListener('pointerdown', start);
			button.addEventListener('pointerup', cancel);
			button.addEventListener('pointercancel', cancel);
			button.addEventListener('pointerleave', cancel);
			button.addEventListener('keydown', (event) => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) start(event); });
			button.addEventListener('keyup', cancel);
		}

		updateGuidance(payload) {
			const guidance = payload || {};
			if (Object.prototype.hasOwnProperty.call(guidance, 'current_road_name')) {
				this.state.currentRoadName = guidance.off_route ? '' : text(guidance.current_road_name).trim().slice(0, 190);
			}
			const instruction = $('[data-next-instruction]', root);
			const distance = $('[data-next-distance]', root);
			const nextInstruction = text(guidance.instruction || guidance.next_instruction, 'Continue on route');
			if (instruction && instruction.textContent !== nextInstruction) instruction.textContent = nextInstruction;
			if (distance) {
				const metres = finite(guidance.distance_metres);
				distance.textContent = text(guidance.distance_label, metres === null ? '—' : metres >= 1000 ? `${(metres / 1609.344).toFixed(1)} mi` : `${Math.round(metres)} m`);
			}
			if (guidance.manoeuvre) $('.halo-manoeuvre', root).textContent = text(guidance.manoeuvre_symbol, '↑');
			const arrival = $('[data-ride-arrival]', root);
			if (arrival && Object.prototype.hasOwnProperty.call(guidance, 'eta')) {
				arrival.textContent = guidance.eta ? formatDate(guidance.eta, { hour: '2-digit', minute: '2-digit' }) : '—';
			}
			if (guidance.next_hazard) {
				const hazardKey = guidance.next_hazard.id || guidance.next_hazard.public_id || `${guidance.next_hazard.type || guidance.next_hazard.label}-${guidance.next_hazard.distance_along_route_m}`;
				if (hazardKey !== this.state.lastAnnouncedHazard) {
					this.state.lastAnnouncedHazard = hazardKey;
					this.toast(`${text(guidance.next_hazard.label || guidance.next_hazard.type, 'Focus zone')} ahead.`, 'error');
				}
			}
			if (guidance.off_route) {
				const accuracy = finite(guidance.accuracy ?? guidance.position?.accuracy ?? this.state.currentLocation?.accuracy);
				if (accuracy === null || accuracy <= 45) this.state.offRouteSamples = (this.state.offRouteSamples || 0) + 1;
				if (this.state.offRouteSamples >= 3) this.requestReroute(guidance.position || this.state.currentLocation);
			} else this.state.offRouteSamples = 0;
			const spoken = text(guidance.spoken_instruction || guidance.instruction || guidance.next_instruction);
			if (spoken && this.state.routePreferences.voice_guidance && spoken !== this.state.lastSpokenInstruction && 'speechSynthesis' in window && !this.rideEngine.engine?.capabilities?.voice) {
				this.state.lastSpokenInstruction = spoken;
				window.speechSynthesis.cancel();
				window.speechSynthesis.speak(new SpeechSynthesisUtterance(spoken));
			}
			this.maps.call('active', ['updateGuidance', 'setProgress'], [guidance]);
		}

		async requestReroute(position) {
			const scope = this.captureIdentityScope();
			if (!this.state.activeRide?.route || this.state.rerouteInFlight || !navigator.onLine) return;
			if (Date.now() - (this.state.lastRerouteAt || 0) < 45000) return;
			this.state.lastRerouteAt = Date.now();
			this.state.rerouteInFlight = true;
			this.toast('You appear to be off route. Finding an alternative.');
			try {
				const route = this.state.activeRide.route;
				const geometry = geometryCoordinates(route.geometry || route.coordinates || route.route);
				const endpointRaw = geometry[geometry.length - 1];
				const endpoint = Array.isArray(endpointRaw) ? { lng: Number(endpointRaw[0]), lat: Number(endpointRaw[1]) } : endpointRaw || {};
				const destinationLabel = route.destination_label || route.destination?.label || $('#halo-route-form [name="destination"]', root)?.value || '';
				const response = await this.api.post('/routes/plan', {
					start_query: '', start_lat: position?.lat, start_lng: position?.lng,
					end_query: destinationLabel,
					end_lat: finite(endpoint.lat), end_lng: finite(endpoint.lng),
					exclude: this.state.routePreferences.avoid_motorways ? ['motorway'] : []
				}, { timeout: 30000 });
				this.assertIdentityScope(scope);
				const alternatives = asArray(response.routes || response.alternatives).map((item, index) => this.normaliseRoute(item, index));
				const nextRoute = alternatives.find((item) => item.recommended) || alternatives[0];
				if (!nextRoute) throw new HaloAPIError('No alternative route was returned.');
				this.state.activeRide.route = nextRoute;
				this.state.selectedRoute = nextRoute;
				if (typeof this.rideEngine.engine?.prepareGuidance === 'function') this.rideEngine.engine.prepareGuidance(Object.assign({}, nextRoute, { geometry: geometryCoordinates(nextRoute.geometry) }));
				await this.maps.call('active', ['showRoute', 'renderRoute'], [nextRoute, { fit: false }]);
				this.assertIdentityScope(scope);
				this.toast('Route updated.', 'success');
			} catch (error) {
				if (error.code === 'stale_identity') return;
				this.toast('Halo could not recalculate yet. Follow road signs and continue safely.', 'error');
			} finally { this.state.rerouteInFlight = false; }
		}

		captureRideMemoryTelemetry(payload) {
			const session = this.rideMemorySession;
			if (!session || session.failed || session.finalized || session.identityEpoch !== this.identityEpoch) return;
			const at = Date.now();
			if (at - Number(session.lastTelemetrySampleAt || 0) < 1000) return;
			const telemetry = payload || this.state.lastTelemetry || {};
			const position = telemetry.position || this.state.currentLocation || {};
			const positionAt = finite(position.at ?? position.recordedAt ?? position.recorded_at);
			const positionFresh = positionAt !== null && Math.abs(at - positionAt) <= 5000;
			const point = {
				at,
				elapsedSeconds: Math.max(0, (at - Date.parse(session.startedAt)) / 1000)
			};
			const speedMph = finite(telemetry.speedMph ?? telemetry.speed_mph ?? telemetry.speed ?? position.speedMph ?? position.speed_mph);
			const latitude = finite(position.lat ?? position.latitude);
			const longitude = finite(position.lng ?? position.longitude);
			const accuracy = finite(position.accuracy);
			const heading = finite(position.heading);
			if (positionFresh && speedMph !== null) point.speedMph = Math.max(0, speedMph);
			if (positionFresh && latitude !== null && longitude !== null) {
				point.lat = latitude;
				point.lng = longitude;
			}
			if (positionFresh && accuracy !== null) point.accuracy = Math.max(0, accuracy);
			if (positionFresh && heading !== null) point.heading = ((heading % 360) + 360) % 360;
			const roadName = text(this.state.currentRoadName).trim().slice(0, 190);
			if (positionFresh && roadName) point.roadName = roadName;
			session.lastTelemetrySampleAt = at;
			session.telemetryPoints = asArray(session.telemetryPoints).concat(point).slice(-240);
		}

		telemetryForRideMemorySegment(session, segment) {
			const startedMs = Date.parse(String(segment?.startedAt || ''));
			const endedMs = Date.parse(String(segment?.endedAt || ''));
			if (!session || !Number.isFinite(startedMs) || !Number.isFinite(endedMs)) return [];
			const available = asArray(session.telemetryPoints)
				.filter((point) => Number.isFinite(Number(point?.at)))
				.sort((left, right) => Number(left.at) - Number(right.at));
			let baseline = null;
			const selected = [];
			for (const point of available) {
				const at = Number(point.at);
				if (at < startedMs) baseline = point;
				if (at >= startedMs - 1500 && at <= endedMs + 1000) selected.push(Object.assign({}, point));
			}
			if (baseline && startedMs - Number(baseline.at) <= 5000
				&& !selected.some((point) => Number(point.at) <= startedMs)) selected.unshift(Object.assign({}, baseline));
			session.telemetryPoints = available.filter((point) => Number(point.at) >= endedMs - 2000).slice(-240);
			return selected.slice(-64);
		}

		updateRideTelemetry(payload) {
			const telemetry = Object.assign({}, this.state.lastTelemetry || {}, payload || {});
			this.state.lastTelemetry = telemetry;
			const speedMph = finite(telemetry.speedMph ?? telemetry.speed_mph ?? telemetry.speed);
			const distanceMiles = finite(telemetry.distanceMiles ?? telemetry.distance_miles);
			const durationSeconds = finite(telemetry.durationSeconds ?? telemetry.duration_seconds);
			const topSpeedMph = finite(telemetry.topSpeedMph ?? telemetry.top_speed_mph);
			const leanLeft = finite(telemetry.maxLeanLeft ?? telemetry.max_lean_left);
			const leanRight = finite(telemetry.maxLeanRight ?? telemetry.max_lean_right);
			const zeroToSixty = finite(telemetry.bestZeroToSixty ?? telemetry.best_zero_to_sixty);
			const range = $('[data-ride-range]', root);
			const speed = $('[data-ride-speed]', root);
			const distance = $('[data-ride-distance]', root);
			const duration = $('[data-ride-duration]', root);
			const topSpeed = $('[data-ride-top-speed]', root);
			const maxLeanLeft = $('[data-ride-lean-left]', root);
			const maxLeanRight = $('[data-ride-lean-right]', root);
			const bestZeroToSixty = $('[data-ride-zero-sixty]', root);
			if (speed) speed.textContent = speedMph === null ? '0' : String(Math.max(0, Math.round(speedMph)));
			if (distance) distance.textContent = distanceMiles === null ? '0.0 mi' : `${distanceMiles.toFixed(1)} mi`;
			if (duration) duration.textContent = formatRideClock(durationSeconds);
			if (topSpeed) topSpeed.textContent = `${Math.max(0, Math.round(topSpeedMph || 0))} mph`;
			if (maxLeanLeft) maxLeanLeft.textContent = `${Math.abs(Math.round(leanLeft || 0))}°`;
			if (maxLeanRight) maxLeanRight.textContent = `${Math.abs(Math.round(leanRight || 0))}°`;
			if (bestZeroToSixty) bestZeroToSixty.textContent = zeroToSixty === null || zeroToSixty <= 0 ? '—' : `${zeroToSixty.toFixed(2)} s`;
			if (range) range.textContent = formatMiles(telemetry.range_miles ?? this.vehicleBattery().range, true);
			this.captureRideMemoryTelemetry(telemetry);
			/* Arrival, GPS and map position have dedicated event owners. Generic
			 * telemetry arrives every 100 ms and must update the HUD only. */
		}

		updateRidePosition(payload) {
			const position = payload?.position || payload;
			if (nullableFinite(position?.lat) !== null && nullableFinite(position?.lng) !== null) {
				this.state.currentLocation = {
					lat: Number(position.lat),
					lng: Number(position.lng),
					accuracy: nullableFinite(position.accuracy),
					altitude: nullableFinite(position.altitude),
					heading: nullableFinite(position.heading),
					speedMph: nullableFinite(position.speedMph ?? position.speed_mph),
					at: nullableFinite(position.at) || Date.now()
				};
			}
			this.maps.call('active', ['updatePosition', 'setUserLocation'], [position]);
			/* Guidance follows the position event in the same ride-engine turn. Queue
			 * sharing so the latest current-road label accompanies this GPS fix. */
				Promise.resolve().then(() => this.updateLiveTracking(position));
				Promise.resolve().then(() => this.updateTestRideMonitoringPosition(position));
				Promise.resolve().then(() => this.updateGuardianResumePosition(position));
				this.updateEmergencyAssistPosition(position);
			this.loadNearbyHazards(position);
		}

		async loadNearbyHazards(position) {
			const scope = this.captureIdentityScope();
			if (!this.state.activeRide || !navigator.onLine || finite(position?.lat) === null || finite(position?.lng) === null) return;
			if (Date.now() - (this.state.lastHazardLoadAt || 0) < 120000) return;
			this.state.lastHazardLoadAt = Date.now();
			const delta = 0.12;
			try {
				const hazards = await this.api.get(`/hazards?south=${encodeURIComponent(Number(position.lat) - delta)}&west=${encodeURIComponent(Number(position.lng) - delta)}&north=${encodeURIComponent(Number(position.lat) + delta)}&east=${encodeURIComponent(Number(position.lng) + delta)}&limit=100`);
				this.assertIdentityScope(scope);
				await this.maps.call('active', ['showHazards', 'setHazards'], [asArray(hazards)]);
			} catch (error) { /* Nearby advisories are optional; Ride recording continues. */ }
		}

		updateRideGps(payload) {
			if (payload?.state !== 'ready') this.maps.call('active', ['setCourseAvailable'], [false]);
			const gps = $('[data-ride-gps]', root);
			if (!gps) return;
			if (payload?.state === 'ready') {
				const accuracy = nullableFinite(payload?.accuracy);
				gps.textContent = 'Active';
				if (accuracy === null) {
					gps.removeAttribute('title');
					gps.setAttribute('aria-label', 'GPS active');
				} else {
					const accuracyLabel = `GPS active · accuracy approximately ${Math.round(accuracy)} metres`;
					gps.setAttribute('title', accuracyLabel);
					gps.setAttribute('aria-label', accuracyLabel);
				}
				if (this.state.rideDegradedMessages) delete this.state.rideDegradedMessages.gps;
				this.renderRideDegradedState();
			}
			else if (payload?.state === 'weak') {
				gps.textContent = 'Weak';
				gps.removeAttribute('title');
				gps.setAttribute('aria-label', 'GPS signal weak');
			}
			else if (payload?.state === 'denied') {
				gps.textContent = 'Denied';
				gps.removeAttribute('title');
				gps.setAttribute('aria-label', 'GPS access denied');
				this.state.rideDegradedMessages = Object.assign({}, this.state.rideDegradedMessages, { gps: 'Location access is off. This ride cannot record a reliable route.' });
				this.renderRideDegradedState();
				if (!this.state.gpsDeniedDialogShown && this.state.activeRide && this.dom.crash.hidden) {
					this.state.gpsDeniedDialogShown = true;
					this.openDialog('Location access required', '<p>Halo cannot record this ride without location access. End the ride, allow location for Halo, then start again.</p><button type="button" class="halo-button halo-button--primary halo-full-width" data-action="end-ride-now">End ride</button>', 'RIDE PAUSED');
				}
			}
			else {
				gps.textContent = 'Finding';
				gps.removeAttribute('title');
				gps.setAttribute('aria-label', 'Finding GPS signal');
			}
		}

		updateRidePermission(payload) {
			if (!['motion', 'orientation'].includes(payload?.permission) || payload?.state !== 'denied') return;
			const message = payload.permission === 'motion'
				? 'Motion access is off. Automatic incident detection is unavailable for this ride.'
				: 'Orientation access is off. Lean-angle metrics are unavailable for this ride.';
			this.state.rideDegradedMessages = Object.assign({}, this.state.rideDegradedMessages, { [payload.permission]: message });
			this.renderRideDegradedState();
		}

		renderRideDegradedState() {
			const banner = $('[data-ride-degraded]', root);
			if (!banner) return;
			const messages = Object.values(this.state.rideDegradedMessages || {}).filter(Boolean);
			banner.hidden = !messages.length;
			banner.textContent = messages.join(' ');
		}

			updateNativeRideStatus(status) {
			this.state.nativeRideStatus = status || null;
			const focus = $('[data-ride-focus-status]', root);
			if (focus) {
				const screen = String(status?.screen || 'starting');
				const active = ['native', 'wake-lock'].includes(screen);
				focus.classList.toggle('is-warning', screen === 'unavailable');
				focus.lastChild.textContent = active
					? (screen === 'native' ? 'Native screen-awake active' : 'Screen Wake Lock active')
					: screen === 'unavailable' ? 'Screen-awake control unavailable' : 'Ride Focus starting';
			}
			if (!this.state.activeRide) return;
			const screenUnavailable = String(status?.screen || '') === 'unavailable';
			if (screenUnavailable) {
				this.state.rideDegradedMessages = Object.assign({}, this.state.rideDegradedMessages, {
					screenAwake: 'Halo could not keep the display awake. Check the screen timeout and keep Halo visible.'
				});
			} else if (this.state.rideDegradedMessages) delete this.state.rideDegradedMessages.screenAwake;
			if (status?.environment !== 'webtonative') {
				this.renderRideDegradedState();
				return;
			}
			const unavailable = ['failed', 'unavailable'].includes(String(status?.backgroundLocation || ''));
			if (unavailable) {
				this.state.rideDegradedMessages = Object.assign({}, this.state.rideDegradedMessages, {
					nativeLocation: 'Native background location is unavailable. Keep Halo visible so foreground GPS can continue.'
				});
			} else if (this.state.rideDegradedMessages) delete this.state.rideDegradedMessages.nativeLocation;
				this.renderRideDegradedState();
			}

			handleRideCameraStarted(status, preferences) {
				const session = this.rideMemorySession;
				if (!session || preferences?.enabled !== true || session.identityEpoch !== this.identityEpoch) return;
				const phase = String(status?.status || 'unavailable');
				if (phase === 'recording' || status?.recording === true) {
					this.state.rideMemoryStatus = { status: 'recording', mode: status?.mode || 'rear', segmentCount: session.segmentCount, bytes: session.bytes };
				} else if (phase === 'paused-background') {
					this.state.rideMemoryStatus = { status: 'paused', message: 'Ride Memories paused while Halo is hidden', segmentCount: session.segmentCount, bytes: session.bytes };
				} else {
					this.state.rideMemoryStatus = { status: 'error', message: phase === 'pending-upload' ? 'Ride Memories unavailable while earlier incident footage is pending' : 'Ride Memories camera unavailable', segmentCount: session.segmentCount, bytes: session.bytes };
				}
				this.renderRideMemoryStatus();
			}

			updateRideMemoryCaptureStatus(status) {
				const session = this.rideMemorySession;
				if (!session || session.identityEpoch !== this.identityEpoch || session.finalized) return;
				const phase = String(status?.status || '');
				if (['paused-background', 'frozen', 'freezing', 'reconfiguring'].includes(phase)) {
					if (!this.rideMemoryGapStartedAt) this.rideMemoryGapStartedAt = new Date().toISOString();
					this.state.rideMemoryStatus = {
						status: 'paused',
						message: phase === 'paused-background'
							? 'Ride Memories paused while Halo is hidden'
							: phase === 'reconfiguring' ? 'Ride Memories switching camera settings' : 'Ride Memories paused while an incident is handled',
						segmentCount: session.segmentCount,
						bytes: session.bytes
					};
				} else if (phase === 'recording') {
					this.closeRideMemoryGap('capture-resumed');
					this.state.rideMemoryStatus = { status: 'recording', mode: status?.mode || 'rear', segmentCount: session.segmentCount, bytes: session.bytes };
				} else if (['unavailable', 'pending-upload', 'retained'].includes(phase)) {
					this.state.rideMemoryStatus = { status: 'error', message: 'Ride Memories camera unavailable', segmentCount: session.segmentCount, bytes: session.bytes };
				}
				this.renderRideMemoryStatus();
			}

			startRideMemoryLeaseHeartbeat(session) {
				this.stopRideMemoryLeaseHeartbeat();
				if (!session || !this.rideMemories?.refreshLease) return;
				this.rideMemoryLeaseTimer = window.setInterval(() => {
					this.refreshRideMemoryLease(session).catch(() => null);
				}, 15000);
			}

			stopRideMemoryLeaseHeartbeat() {
				if (this.rideMemoryLeaseTimer) window.clearInterval(this.rideMemoryLeaseTimer);
				this.rideMemoryLeaseTimer = null;
			}

			async refreshRideMemoryLease(expectedSession) {
				const session = expectedSession || this.rideMemorySession;
				// Keep ownership current until the final queued Blob and manifest commit.
				// A finalising session is still live storage work, even though capture stopped.
				if (!session || session !== this.rideMemorySession || session.failed || session.finalized || session.identityEpoch !== this.identityEpoch) return null;
				try {
					return await this.rideMemories.refreshLease({ customerKey: session.customerKey, rideId: session.rideId });
				} catch (error) {
					if (session === this.rideMemorySession && !session.finalizing) this.handleRideMemoryFailure(error);
					return null;
				}
			}

			closeRideMemoryGap(reason) {
				const session = this.rideMemorySession;
				const startedAt = this.rideMemoryGapStartedAt;
				if (!session || !startedAt || session.failed || session.finalized) return;
				this.rideMemoryGapStartedAt = '';
				const endedAt = new Date().toISOString();
				const work = this.rideMemoryWriteQueue.catch(() => null).then(async () => {
					if (session !== this.rideMemorySession || session.identityEpoch !== this.identityEpoch) return null;
					await this.rideMemoryStartPromise;
					return this.rideMemories.markGap({ customerKey: session.customerKey, rideId: session.rideId, startedAt, endedAt, reason: reason || 'capture-paused' });
				});
				this.rideMemoryWriteQueue = work.catch((error) => { this.handleRideMemoryFailure(error); return null; });
			}

			async archiveRideMemorySegment(segment) {
				const session = this.rideMemorySession;
				if (!session || session.failed || session.finalized || session.identityEpoch !== this.identityEpoch || !segment) return null;
				if (this.rideMemoryGapStartedAt && Number.isFinite(Date.parse(String(segment.endedAt || '')))
					&& Date.parse(String(segment.endedAt)) > Date.parse(this.rideMemoryGapStartedAt)) {
					this.rideMemoryGapStartedAt = new Date(segment.endedAt).toISOString();
				}
				const recordings = asArray(segment.recordings)
					.filter((recording) => recording?.blob && (recording.camera === 'rear' || (recording.camera === 'front' && session.dual)))
					.map((recording) => ({
						camera: recording.camera,
						blob: recording.blob,
						mimeType: recording.mimeType || recording.blob?.type || '',
						audio: false
					}));
				if (!recordings.length) return null;
				const incomingBytes = recordings.reduce((total, recording) => total + (Number(recording.blob?.size) || 0), 0);
				const maximumPendingBytes = 64 * 1024 * 1024;
				if ((Number(session.pendingBytes) || 0) + incomingBytes > maximumPendingBytes) {
					const error = new HaloAPIError('Ride Memories local storage is not keeping up with camera recording.', 0, 'ride_memories_write_backlog');
					this.handleRideMemoryFailure(error);
					return null;
				}
				session.pendingBytes = (Number(session.pendingBytes) || 0) + incomingBytes;
				const telemetry = this.telemetryForRideMemorySegment(session, segment);

				const segmentMeta = {
					sequence: Number(segment.sequence),
					startedAt: segment.startedAt,
					endedAt: segment.endedAt,
					durationMs: Number(segment.durationMs) || 0,
					telemetry
				};
				const work = this.rideMemoryWriteQueue.catch(() => null).then(async () => {
					try {
						if (session !== this.rideMemorySession || session.failed || session.finalized || session.identityEpoch !== this.identityEpoch) return null;
						await this.rideMemoryStartPromise;
						for (const recording of recordings) {
							await this.rideMemories.appendSegment(Object.assign({}, segmentMeta, recording, {
								customerKey: session.customerKey,
								rideId: session.rideId
							}));
							session.segmentCount += 1;
							session.bytes += Number(recording.blob.size) || 0;
						}
						this.state.rideMemoryStatus = { status: 'recording', segmentCount: session.segmentCount, bytes: session.bytes };
						this.renderRideMemoryStatus();
						return { stored: recordings.length };
					} finally {
						session.pendingBytes = Math.max(0, (Number(session.pendingBytes) || 0) - incomingBytes);
					}
				});
				this.rideMemoryWriteQueue = work.catch((error) => { this.handleRideMemoryFailure(error); return null; });
				return this.rideMemoryWriteQueue;
			}

			handleRideMemoryFailure(error) {
				const session = this.rideMemorySession;
				if (!session || session.failed) return;
				session.failed = true;
				this.stopRideMemoryLeaseHeartbeat();
				let currentError = error;
				let lowStorage = false;
				for (let depth = 0; currentError && depth < 5; depth += 1) {
					lowStorage = lowStorage
						|| ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'].includes(String(currentError?.name || ''))
						|| String(currentError?.code || '').toLowerCase().includes('quota');
					currentError = currentError?.cause;
				}
				const backlog = String(error?.code || '') === 'ride_memories_write_backlog';
				const message = lowStorage
					? 'Ride Memories stopped because private device storage is full.'
					: backlog ? 'Ride Memories stopped because local storage could not keep up with recording.'
					: 'Ride Memories stopped because Halo could not save the footage locally.';
				this.state.rideMemoryStatus = { status: 'error', message, segmentCount: session.segmentCount, bytes: session.bytes };
				this.state.rideDegradedMessages = Object.assign({}, this.state.rideDegradedMessages, { rideMemories: message });
				this.renderRideMemoryStatus();
				this.renderRideDegradedState();
				this.toast(message, 'error');
				if (!this.incidentCameraPreferences().enabled && this.state.activeRide && !this.endingRide) {
					const failedStorageShutdown = this.stopIncidentCameraCapture('ride-memory-storage-failed', { archive: false, preserveMemory: false });
					void failedStorageShutdown.stopPromise;
				}
			}

			renderRideMemoryStatus() {
				const chip = $('[data-ride-memory-status]', root);
				if (!chip) return;
				const status = this.state.rideMemoryStatus || {};
				const visible = Boolean(this.state.activeRide?.rideMemories && status.status);
				chip.hidden = !visible;
				if (!visible) return;
				chip.classList.toggle('is-warning', ['paused', 'error'].includes(status.status));
				const saved = Number(status.segmentCount || 0) > 0 ? ` · ${formatBytes(status.bytes || 0)} saved` : '';
				chip.textContent = status.message || (status.status === 'recording'
					? `Ride Memories recording · audio off${saved}`
					: status.status === 'saved' ? `Ride Memories saved · ${formatBytes(status.bytes || 0)}` : 'Ride Memories starting · audio off');
			}

			async finalizeRideMemory(activeRide, engineResult, cameraStopPromise) {
				const session = this.rideMemorySession;
				if (!session || session.finalizing || session.finalized) return null;
				session.finalizing = true;
				try {
					await Promise.resolve(cameraStopPromise).catch(() => null);
					this.closeRideMemoryGap('ride-ended');
					await this.rideMemoryWriteQueue.catch(() => null);
					if (session.segmentCount < 1) {
						await this.rideMemories.deleteRide({ customerKey: session.customerKey, rideId: session.rideId });
						return null;
					}
					const source = engineResult || {};
					const metrics = source.metrics || source;
					const route = activeRide?.route || {};
					const endedAt = source.endedAt || source.ended_at || new Date().toISOString();
					const saved = await this.rideMemories.finalizeRide({
						customerKey: session.customerKey,
						rideId: session.rideId,
						endedAt,
						summary: {
							title: route.destination_label || route.label || (activeRide?.freeRide ? 'Free ride' : 'Recorded ride'),
							distance_miles: metrics.distanceMiles ?? metrics.distance_miles ?? null,
							duration_seconds: metrics.durationSeconds ?? metrics.duration_seconds ?? null,
							top_speed_mph: metrics.topSpeedMph ?? metrics.top_speed_mph ?? null,
							incomplete: session.failed === true
						}
					});
					session.finalized = true;
					this.state.lastRideMemory = saved;
					this.state.rideMemoryStatus = { status: 'saved', segmentCount: session.segmentCount, bytes: session.bytes };
					return saved;
				} catch (error) {
					this.handleRideMemoryFailure(error);
					this.rideMemories?.close?.();
					return null;
				} finally {
					this.stopRideMemoryLeaseHeartbeat();
					if (this.rideMemorySession === session) this.rideMemorySession = null;
					this.rideMemoryStartPromise = Promise.resolve(null);
					this.rideMemoryWriteQueue = Promise.resolve();
					this.rideMemoryGapStartedAt = '';
					this.state.rideMemoryPreferences = { enabled: false, dual: false };
					this.syncRideMemorySetup();
					this.renderRideMemoryStatus();
					this.refreshRideMemoryStorageStatus().catch(() => null);
				}
			}

			incidentCameraPreferences() {
			const safety = this.state.boot?.safety || {};
			const camera = isObject(safety.incident_camera) ? safety.incident_camera : {};
			const storedEnabled = camera.enabled ?? camera.consent_current ?? safety.incident_camera_enabled ?? safety.consents?.incident_camera;
			const consentCurrent = camera.consent_current ?? !camera.renewal_required;
			const providerReady = camera.provider_ready !== false && camera.storage_ready !== false;
			return {
				enabled: Boolean(!this.incidentCameraLocallyDisabled && storedEnabled && consentCurrent && providerReady && this.emergencyAssistEnabled()),
				dual: Boolean(camera.dual_enabled ?? camera.dual ?? safety.incident_camera_dual_enabled)
			};
		}

		incidentCameraEvidencePending() {
			const status = this.incidentCamera?.getStatus?.() || this.state.incidentCameraStatus || {};
			const phase = String(status.status || '');
			const durableContext = Boolean(this.incidentCameraPendingContext?.event_id && this.incidentCameraPendingContext?.incident_id);
			return durableContext && ((Number(status.bufferedSegments || 0) > 0
				&& ['frozen', 'uploading', 'upload-failed', 'pending-upload', 'retained'].includes(phase))
				|| phase === 'freezing');
		}

		incidentCameraCanBindEvent(eventId) {
			const boundEventId = String(this.incidentCameraPendingContext?.event_id || '');
			return !this.incidentCameraEvidencePending() || !boundEventId || boundEventId === String(eventId || '');
		}

			updateIncidentCameraStatus(status) {
				this.state.incidentCameraStatus = status || null;
				this.updateRideMemoryCaptureStatus(status || {});
				const phase = String(status?.status || '');
				if (phase === 'uploaded') {
					this.clearIncidentCameraRetry();
					this.incidentCameraPendingContext = null;
					this.incidentCameraRetryAttempt = 0;
					if (this.state.activeRide && (this.incidentCameraPreferences().enabled || this.rideMemorySession)) {
						this.incidentCamera?.resumeAfterIncident?.('incident-evidence-complete').catch(() => null);
					}
				} else if (phase === 'confirmed-no-evidence') {
					this.clearIncidentCameraRetry();
					this.incidentCameraPendingContext = null;
					this.incidentCameraRetryAttempt = 0;
					this.state.incidentCameraConfirmedId = '';
					if (this.state.activeRide && (this.incidentCameraPreferences().enabled || this.rideMemorySession)) {
						this.incidentCamera?.resumeAfterIncident?.('incident-without-evidence').catch(() => null);
					}
				} else if (['upload-failed', 'retained', 'pending-upload'].includes(phase)) {
				this.scheduleIncidentCameraRetry();
			}
			this.renderIncidentCameraStatus();
		}

		clearIncidentCameraRetry() {
			if (this.incidentCameraRetryTimer) window.clearTimeout(this.incidentCameraRetryTimer);
			this.incidentCameraRetryTimer = null;
		}

		scheduleIncidentCameraRetry() {
			if (this.incidentCameraRetryTimer || !this.incidentCameraPendingContext?.incident_id || this.incidentCameraRetryAttempt >= 8) return;
			const delays = [5000, 20000, 60000, 120000, 300000, 600000, 900000, 1800000];
			this.incidentCameraRetryTimer = window.setTimeout(() => {
				this.incidentCameraRetryTimer = null;
				if (navigator.onLine) this.retryIncidentCameraUpload();
				else this.scheduleIncidentCameraRetry();
			}, delays[this.incidentCameraRetryAttempt] || 1800000);
		}

		renderIncidentCameraStatus() {
			const chip = $('[data-incident-camera-status]', root);
			if (!chip) return;
			const status = this.state.incidentCameraStatus || {};
			const enabled = Boolean(this.state.activeRide && (this.incidentCameraPreferences().enabled || this.incidentCameraEvidencePending()));
			chip.hidden = !enabled;
			if (!enabled) return;
			const phase = String(status.status || 'starting');
			chip.classList.toggle('is-warning', ['unavailable', 'upload-failed', 'paused-background', 'confirmed-no-evidence', 'pending-upload', 'retained'].includes(phase));
			chip.classList.toggle('is-secured', ['frozen', 'uploading', 'uploaded'].includes(phase));
			const label = phase === 'recording'
				? (status.mode === 'dual' ? 'Front + rear recording · audio off' : 'Rear camera recording · audio off')
				: phase === 'frozen' ? 'Incident video secured'
					: phase === 'uploading' ? 'Sending incident video'
						: phase === 'uploaded' ? 'Incident video sent'
						: phase === 'paused-background' ? 'Camera paused while Halo is hidden'
							: phase === 'unavailable' ? 'Incident camera unavailable'
								: phase === 'confirmed-no-evidence' ? 'No incident video was captured'
									: ['pending-upload', 'retained'].includes(phase) ? 'Earlier incident video awaiting upload'
								: phase === 'upload-failed' ? 'Incident video upload failed'
										: 'Incident camera starting · audio off';
			chip.textContent = label;
		}

			discardIncidentCameraCandidate(reason) {
			this.state.incidentCameraConfirmedId = '';
			this.clearIncidentCameraRetry();
			this.incidentCameraRetryAttempt = 0;
			if (this.incidentCameraPendingContext?.event_id) this.incidentMediaUploads.delete(String(this.incidentCameraPendingContext.event_id));
			this.incidentCameraPendingContext = null;
				return this.incidentCamera?.cancelCandidate?.({
					resume: Boolean(this.state.activeRide && (this.incidentCameraPreferences().enabled || this.rideMemorySession)),
					reason: reason || 'incident-not-activated'
				})?.catch?.(() => null) || Promise.resolve(null);
			}

			stopIncidentCameraCapture(reason, options) {
				const settings = Object.assign({ archive: Boolean(this.rideMemorySession), preserveMemory: true }, options || {});
				const retainCameraEvidence = this.incidentCameraEvidencePending();
				const preserveMemoryCapture = Boolean(this.rideMemorySession && !this.rideMemorySession.failed && settings.preserveMemory && !['ride-ended', 'identity-changed', 'ride-start-failed'].includes(String(reason || '')));
				if (preserveMemoryCapture && retainCameraEvidence) {
					this.incidentCamera?.setCapturePreference?.({ preferDual: Boolean(this.rideMemorySession?.dual) });
					this.scheduleIncidentCameraRetry();
					return { retainCameraEvidence: true, stopPromise: Promise.resolve(this.incidentCamera?.getStatus?.() || null), captureContinues: false };
				}
				if (preserveMemoryCapture) {
					this.clearIncidentCameraRetry();
					this.incidentCameraPendingContext = null;
					this.incidentCameraRetryAttempt = 0;
					this.state.incidentCameraConfirmedId = '';
					this.incidentMediaUploads.clear();
					const continuation = this.incidentCamera?.continueForRideMemory
						? this.incidentCamera.continueForRideMemory({
							preferDual: Boolean(this.rideMemorySession?.dual),
							reason: reason || 'incident-camera-consumer-stopped'
						})
						: this.incidentCamera?.cancelCandidate?.({ resume: true, reason: reason || 'incident-camera-consumer-stopped' });
					const stopPromise = Promise.resolve(continuation).catch(() => null).then(() => {
						this.state.incidentCameraStatus = this.incidentCamera?.getStatus?.() || this.state.incidentCameraStatus || null;
						this.renderIncidentCameraStatus();
					});
					return { retainCameraEvidence: false, stopPromise, captureContinues: true };
				}
				const stopPromise = Promise.resolve(this.incidentCamera?.stopRide?.({
					discard: !retainCameraEvidence,
					archive: settings.archive,
					reason: reason || 'camera-capture-stopped'
			})).catch(() => null).then(() => {
				this.state.incidentCameraStatus = retainCameraEvidence
					? (this.incidentCamera?.getStatus?.() || this.state.incidentCameraStatus || null)
					: null;
				this.renderIncidentCameraStatus();
			});
			if (retainCameraEvidence) this.scheduleIncidentCameraRetry();
			else {
				this.clearIncidentCameraRetry();
				this.incidentCameraPendingContext = null;
				this.incidentCameraRetryAttempt = 0;
				this.state.incidentCameraConfirmedId = '';
				this.incidentMediaUploads.clear();
			}
			return { retainCameraEvidence, stopPromise };
		}

			async stopIncidentCameraForConsentWithdrawal(reason) {
				const shutdown = this.stopIncidentCameraCapture(reason || 'camera-consent-withdrawn', {
					archive: Boolean(this.rideMemorySession),
					preserveMemory: true
				});
				await shutdown.stopPromise;
				this.state.incidentCameraStatus = this.incidentCamera?.getStatus?.() || null;
			this.renderIncidentCameraStatus();
		}

		async uploadIncidentCameraSegment(item) {
			const context = item?.context || {};
			const eventId = String(context.event_id || context.id || '');
			const rideId = String(context.ride_id || this.state.activeRide?.id || '');
			if (!/^[A-Za-z0-9._:-]{8,80}$/.test(eventId) || !/^[A-Za-z0-9._:-]{8,64}$/.test(rideId)) {
				throw new HaloAPIError('Incident video is missing its secure event or ride reference.', 422, 'incident_media_context_invalid');
			}
			let upload = this.incidentMediaUploads.get(eventId);
			if (!upload) {
				upload = {
					grant: this.api.post(`/safety/incidents/${encodeURIComponent(eventId)}/media-grant`, { client_ride_id: rideId }, { signal: item.signal || null }),
					nextIndex: { rear: 0, front: 0 },
					counts: { rear: 0, front: 0 }
				};
				this.incidentMediaUploads.set(eventId, upload);
			}
			const grant = await upload.grant;
			const token = String(grant?.upload_token || '');
			if (!/^[A-Za-z0-9_-]{40,90}$/.test(token)) throw new HaloAPIError('Halo did not issue a valid incident-video upload grant.', 503, 'incident_media_grant_invalid');

			const camera = item.camera === 'front' ? 'front' : 'rear';
			const segmentIndex = upload.nextIndex[camera];
			upload.nextIndex[camera] += 1;
			const mimeType = String(item.recording?.mimeType || item.blob?.type || 'video/webm').split(';')[0];
			const extension = mimeType === 'video/mp4' ? 'mp4' : 'webm';
			const data = new FormData();
			data.append('segment', item.blob, `halo-${camera}-${segmentIndex + 1}.${extension}`);
			data.append('camera_role', camera);
			data.append('segment_index', String(segmentIndex));
			data.append('client_segment_id', String(item.recording?.id || `${item.segment?.id || eventId}-${camera}`));
			data.append('duration_ms', String(Math.max(100, Math.round(Number(item.segment?.durationMs) || 0))));
			data.append('captured_at', String(item.segment?.startedAt || new Date().toISOString()));
			data.append('audio', 'false');
			const response = await this.api.post(
				`/safety/incidents/${encodeURIComponent(eventId)}/media/segments`,
				data,
				{ headers: { 'X-Halo-Media-Token': token }, timeout: 60000, signal: item.signal || null }
			);
			upload.counts[camera] += 1;
			if (Number(item.index) === Number(item.total) - 1) {
				const finalized = await this.api.post(
					`/safety/incidents/${encodeURIComponent(eventId)}/media/finalize`,
					{ expected_front: upload.counts.front, expected_rear: upload.counts.rear },
					{ headers: { 'X-Halo-Media-Token': token }, timeout: 20000, signal: item.signal || null }
				);
				this.incidentMediaUploads.delete(eventId);
				return finalized;
			}
			return response;
		}

		retryIncidentCameraUpload() {
			const context = this.incidentCameraPendingContext;
			const phase = String(this.state.incidentCameraStatus?.status || '');
			if (!navigator.onLine || !['upload-failed', 'retained', 'pending-upload'].includes(phase) || !context?.event_id || !context?.incident_id || !context?.ride_id) return;
			this.clearIncidentCameraRetry();
			this.incidentCameraRetryAttempt += 1;
			this.incidentMediaUploads.delete(String(context.event_id));
			this.incidentCamera?.confirmIncident?.(context).catch(() => null);
		}

		confirmIncidentCamera(response, payload) {
			const eventId = String(payload?.event_id || response?.event_id || '');
			const incidentId = String(response?.incident_id || response?.id || '');
			const rideId = String(payload?.client_ride_id || this.incidentCameraPendingContext?.ride_id || this.state.activeRide?.id || '');
			if (this.incidentCameraLocallyDisabled && !this.incidentCameraEvidencePending()) return Promise.resolve(null);
			if (!eventId || !incidentId || !rideId || !this.incidentCamera?.confirmIncident || !this.incidentCameraCanBindEvent(eventId)) return Promise.resolve(null);
			const key = incidentId || eventId;
			const createdAt = Number(this.incidentCameraPendingContext?.created_at || Date.now());
			this.incidentCameraPendingContext = { event_id: eventId, incident_id: incidentId, ride_id: rideId, created_at: createdAt };
			if (key === this.state.incidentCameraConfirmedId) {
				this.scheduleIncidentCameraRetry();
				return Promise.resolve(null);
			}
			this.state.incidentCameraConfirmedId = key;
			this.incidentCameraRetryAttempt = 0;
			return this.incidentCamera.confirmIncident(this.incidentCameraPendingContext).catch(() => null);
		}

		handleRideError(payload) {
			this.toast(text(payload?.message, 'Ride guidance encountered a problem.'), 'error');
		}

		async onRideEngineEnded(payload) {
			if (!this.state.activeRide || this.endingRide) return;
			await this.endRide(payload || {});
		}

		rideSyncPayload(engineResult, activeRide) {
			const result = engineResult || {};
			const active = activeRide || {};
			const metrics = result.metrics || result;
			const points = asArray(result.points || metrics.points);
			const firstPoint = points[0] || {};
			const lastPoint = points[points.length - 1] || {};
			return {
				client_ride_id: result.id || active.id,
				started_at: result.startedAt || result.started_at || active.started_at,
				ended_at: result.endedAt || result.ended_at || new Date().toISOString(),
				duration_seconds: metrics.durationSeconds ?? metrics.duration_seconds ?? 0,
				distance_miles: metrics.distanceMiles ?? metrics.distance_miles ?? 0,
				top_speed_mph: metrics.topSpeedMph ?? metrics.top_speed_mph ?? 0,
				max_lean_left: metrics.maxLeanLeft ?? metrics.max_lean_left ?? 0,
				max_lean_right: metrics.maxLeanRight ?? metrics.max_lean_right ?? 0,
				best_zero_to_sixty: metrics.bestZeroToSixty ?? metrics.best_zero_to_sixty ?? null,
				peak_g_force: metrics.peakGForce ?? metrics.peak_g_force ?? null,
				harsh_event_count: metrics.harshEventCount ?? metrics.harsh_event_count ?? 0,
				telemetry_quality: metrics.telemetryQuality ?? metrics.telemetry_quality ?? null,
				route: points.length ? points.map((point) => ({ lat: point.lat, lng: point.lng })) : geometryCoordinates(active.route?.geometry || active.route?.coordinates || result.context?.route?.geometry),
				telemetry: points,
				start_lat: finite(firstPoint.lat),
				start_lng: finite(firstPoint.lng),
				end_lat: finite(lastPoint.lat),
				end_lng: finite(lastPoint.lng),
				vehicle_id: active.vehicleId || result.context?.vehicleId || this.state.vehicle?.id || null,
				ride_mode: active.testRideMonitoring ? 'test' : (active.mode || result.context?.mode || result.context?.rideMode || null),
				start_soc: active.startSoc ?? result.context?.soc ?? null
			};
		}

		isRetryableRideSave(error) {
			return Boolean(error && (['offline', 'timeout', 'session_expired', 'authentication_required', 'not_authenticated', 'csrf_failed', 'invalid_csrf'].includes(error.code)
				|| error.details?.retryable === true || Number(error.status) >= 500));
		}

		async endRide(enginePayload) {
			const scope = this.captureIdentityScope();
			if (!this.state.activeRide || this.endingRide) return;
			this.rideFocus?.leave();
			this.endingRide = true;
			const active = this.state.activeRide;
			// End device capture immediately. Ride persistence and tracking cleanup can
			// involve slow network waits, but must never extend camera or native GPS use.
			this.nativeRide?.stop?.('ride_ended').catch(() => null);
				const cameraShutdown = this.stopIncidentCameraCapture('ride-ended', { archive: Boolean(this.rideMemorySession) });
				const testRideShutdown = this.stopTestRideMonitoring(false).catch(() => null);
				void cameraShutdown.stopPromise;
				let rideMemorySnapshot = enginePayload && Object.keys(enginePayload).length ? enginePayload : null;
				if (!rideMemorySnapshot) {
					let currentMetrics = this.state.lastTelemetry || {};
					try { currentMetrics = this.rideEngine.engine?.metrics?.() || currentMetrics; } catch (error) { /* The last rendered telemetry remains a safe summary fallback. */ }
					rideMemorySnapshot = { endedAt: new Date().toISOString(), metrics: currentMetrics };
				}
				// Local footage completion must not wait behind ride synchronisation or
				// live-tracking network shutdown. It only waits for the final camera Blob.
				const rideMemoryFinalizePromise = this.rideMemorySession
					? this.finalizeRideMemory(active, rideMemorySnapshot, cameraShutdown.stopPromise)
					: Promise.resolve(null);
				void rideMemoryFinalizePromise;
				let engineResult = null;
				let response = null;
				let keptLocally = false;
				let deferredSessionExpiry = false;
				let rideMemoryFinalized = false;
			try {
				if (enginePayload && Object.keys(enginePayload).length) {
					engineResult = enginePayload;
					response = engineResult.server || null;
					if (!response && engineResult.syncState !== 'synced') {
						if (typeof this.rideEngine.engine?.flushPending === 'function') {
							keptLocally = true;
							await this.flushRideEnginePending();
							this.assertIdentityScope(scope);
						} else {
							const payload = this.rideSyncPayload(engineResult, active);
							try { response = await this.api.post('/rides', payload); this.assertIdentityScope(scope); }
							catch (error) {
								deferredSessionExpiry = error instanceof HaloSessionExpiredError || ['session_expired', 'authentication_required', 'not_authenticated'].includes(error.code);
								if (!this.isRetryableRideSave(error)) throw error;
								this.assertIdentityScope(scope);
								await this.queue.add({ endpoint: '/rides', payload, customerId: this.state.customer?.id || null });
								this.assertIdentityScope(scope);
								keptLocally = true;
							}
						}
					}
				} else {
					engineResult = await this.rideEngine.end({
						reason: 'rider',
						syncRide: async (record) => {
							try {
								this.assertIdentityScope(scope);
								response = await this.api.post('/rides', this.rideSyncPayload(record, active));
								this.assertIdentityScope(scope);
									return response;
								} catch (error) {
									deferredSessionExpiry = error instanceof HaloSessionExpiredError || ['session_expired', 'authentication_required', 'not_authenticated'].includes(error.code);
									throw error;
								}
							}
					});
					this.assertIdentityScope(scope);
					keptLocally = engineResult?.syncState === 'pending' || engineResult?.synced === false;
					if (!response && !keptLocally && engineResult?.server) response = engineResult.server;
				}
						await rideMemoryFinalizePromise;
						rideMemoryFinalized = true;
						if (keptLocally) this.toast('Ride saved on this device. Halo will sync it after you reconnect and sign in.', 'success');
					await testRideShutdown;
					await this.stopLiveTracking(false).catch(() => {});
					await this.stopGuardianResumeTracking(false).catch(() => {});
					this.assertIdentityScope(scope);
				this.hideActiveRide();
				this.showRideSummary(response?.ride || response?.summary || engineResult || {});
				if (deferredSessionExpiry || this.state.sessionExpiryDeferred) this.handleSessionExpired();
					if (response && navigator.onLine) await this.bootstrap({ silent: true });
				} catch (error) {
					if (!rideMemoryFinalized) {
						await rideMemoryFinalizePromise;
						rideMemoryFinalized = true;
					}
					await testRideShutdown;
					if (error.code === 'stale_identity') return;
				if (engineResult && this.isRetryableRideSave(error)) {
					const payload = this.rideSyncPayload(engineResult, active);
					this.assertIdentityScope(scope);
						await this.queue.add({ endpoint: '/rides', payload, customerId: this.state.customer?.id || null });
						this.assertIdentityScope(scope);
						await this.stopLiveTracking(false).catch(() => {});
						await this.stopGuardianResumeTracking(false).catch(() => {});
						this.hideActiveRide();
					this.showRideSummary(engineResult);
					this.toast('Ride saved on this device. Halo will retry when your secure session is available.', 'success');
					if (deferredSessionExpiry || this.state.sessionExpiryDeferred) this.handleSessionExpired();
					} else this.handleError(error);
				} finally {
					if (!rideMemoryFinalized) await rideMemoryFinalizePromise;
					await testRideShutdown;
					this.endingRide = false;
				}
		}

		hideActiveRide() {
			this.rideFocus?.leave();
			this.stopEmergencyAssistPositionUpdates();
			this.state.emergencyIncident = null;
			this.state.crashPhase = 'idle';
			this.state.crashPayload = null;
			this.state.crashCandidateEventId = null;
			this.rideEngine.completeCrash('idle');
			if (!this.dom.crash.hidden) this.clearCrashState();
			this.dom.activeRide.hidden = true;
			this.dom.product.removeAttribute('inert');
			this.state.rideReturnFocus = null;
			document.documentElement.classList.remove('halo-ride-active');
			if (this.state.wakeLock) this.state.wakeLock.release().catch(() => {});
			this.state.wakeLock = null;
			this.state.activeRide = null;
			this.state.ecuRideWasLive = false;
			this.state.bmsRideWasLive = false;
			const startSoc = $('#halo-route-form [name="start_soc"]', root);
			if (startSoc) delete startSoc.dataset.userAdjusted;
			this.syncRideSetup();
			this.state.testRideTracking = null;
			this.state.nativeRideStatus = null;
			this.renderIncidentCameraStatus();
			this.renderRideMemoryStatus();
			this.renderTestRideMonitoringStatus();
			this.renderHypercoreRideStatus();
			this.state.currentRoadName = '';
			this.sendPresence(true, false).catch(() => null);
			this.updateConnectivity();
			this.maps.destroy('active');
		}

		showRideSummary(ride) {
			const source = ride || {};
			const metrics = source.metrics || source;
			const summary = Object.assign({}, source, {
				distance_miles: source.distance_miles ?? metrics.distanceMiles,
				duration_seconds: source.duration_seconds ?? metrics.durationSeconds,
				top_speed_mph: source.top_speed_mph ?? metrics.topSpeedMph,
				max_lean_degrees: source.max_lean_degrees ?? Math.max(Number(source.max_lean_left ?? metrics.maxLeanLeft) || 0, Number(source.max_lean_right ?? metrics.maxLeanRight) || 0)
			});
				const memory = this.state.lastRideMemory;
				const memoryNotice = memory
					? `<article class="halo-callout" style="margin-top:16px">${icon('camera')}<div><h3>Ride Memories saved</h3><p>${escapeHTML(formatBytes(memory.bytes || 0))} of audio-free footage is stored privately on this device. Open Activity to review it.</p></div></article>`
					: '';
				this.openDialog('Ride complete', `<div class="halo-summary-grid"><div class="halo-summary-metric"><strong>${escapeHTML(formatMiles(summary.distance_miles, true))}</strong><small>Distance</small></div><div class="halo-summary-metric"><strong>${escapeHTML(formatDuration(summary.duration_seconds))}</strong><small>Time</small></div><div class="halo-summary-metric"><strong>${finite(summary.energy_kwh) === null ? '—' : `${formatNumber(summary.energy_kwh, { maximumFractionDigits: 1 })} kWh`}</strong><small>Energy</small></div></div>${finite(summary.top_speed_mph) === null && finite(summary.max_lean_degrees) === null ? '' : `<dl class="halo-spec-list" style="margin-top:16px"><div class="halo-spec-row"><dt>Top speed</dt><dd>${finite(summary.top_speed_mph) === null ? '—' : `${formatNumber(summary.top_speed_mph)} mph`}</dd></div><div class="halo-spec-row"><dt>Maximum lean</dt><dd>${finite(summary.max_lean_degrees) === null ? '—' : `${formatNumber(summary.max_lean_degrees)}°`}</dd></div></dl>`}${memoryNotice}<div class="halo-button-stack">${summary.id ? `<button type="button" class="halo-button halo-button--secondary halo-full-width" data-action="share-ride" data-share-ride-id="${escapeAttr(summary.id)}">Share ride</button>` : ''}<button type="button" class="halo-button halo-button--primary halo-full-width" data-route-target="activity" data-action="close-dialog">View activity</button></div>`, 'JOURNEY SAVED');
		}

		async flushRideQueue() {
			if (!navigator.onLine || !this.state.customer?.id) return;
			const scope = this.captureIdentityScope();
			const customerId = String(this.state.customer.id);
			const pending = await this.queue.all();
			this.assertIdentityScope(scope);
			for (const item of pending) {
				this.assertIdentityScope(scope);
				if (!item.customerId || String(item.customerId) !== customerId) continue;
				if (item.kind === 'incident-alert' && (!item.expiresAt || Date.now() > Number(item.expiresAt))) {
					await this.queue.remove(item.queue_id);
					this.assertIdentityScope(scope);
					this.toast('A queued incident alert expired and was not sent. Contact your emergency contact directly if help is still needed.', 'error');
					continue;
				}
				if (['live-tracking-revoke', 'test-ride-monitoring-revoke', 'test-ride-monitoring-disarm'].includes(item.kind) && item.expiresAt && Date.now() > Number(item.expiresAt)) {
					await this.queue.remove(item.queue_id);
					this.assertIdentityScope(scope);
					if (this.state.liveTracking?.viewer_token === item.viewerToken) this.state.liveTracking = null;
					if (item.kind === 'test-ride-monitoring-revoke' && this.state.testRideTracking?.session_id === item.sessionId) {
						this.state.testRideTracking = null;
						this.renderTestRideMonitoringStatus();
					}
					continue;
				}
				try {
					this.assertIdentityScope(scope);
					let queuedResponse = null;
					if (item.method === 'DELETE') queuedResponse = await this.api.delete(item.endpoint, item.payload || {});
					else if (item.method === 'PUT') queuedResponse = await this.api.put(item.endpoint, Object.assign({}, item.payload, { queued_at: item.queued_at }));
					else queuedResponse = await this.api.post(item.endpoint, Object.assign({}, item.payload, { queued_at: item.queued_at }));
					this.assertIdentityScope(scope);
					await this.queue.remove(item.queue_id);
					this.assertIdentityScope(scope);
					if (item.kind === 'incident-alert') this.toast('Your queued incident alert was accepted by Halo. Check directly with your contact if help is still needed.', 'success');
					if (item.kind === 'live-tracking-revoke') {
						if (this.state.liveTracking?.viewer_token === item.viewerToken) this.state.liveTracking = null;
						this.toast('Live-location sharing has now ended.', 'success');
					}
					if (item.kind === 'test-ride-monitoring-revoke') {
						if (this.state.testRideTracking?.session_id === item.sessionId) this.state.testRideTracking = null;
						this.renderTestRideMonitoringStatus();
						this.toast('Avenrà test ride monitoring has now ended.', 'success');
					}
					if (item.kind === 'test-ride-monitoring-disarm') this.markTestRideMonitoringInactive(queuedResponse);
				} catch (error) {
					if (error.code === 'stale_identity') return;
					if (this.isRetryableRideSave(error)) break;
					if (item.kind === 'incident-alert') {
						await this.queue.remove(item.queue_id);
						this.assertIdentityScope(scope);
						this.toast('A queued incident alert was not accepted and will not be retried. Contact your emergency contact directly.', 'error');
					}
					if (item.kind === 'live-tracking-revoke' && error.code === 'tracking_not_found') {
						await this.queue.remove(item.queue_id);
						this.assertIdentityScope(scope);
						if (this.state.liveTracking?.viewer_token === item.viewerToken) this.state.liveTracking = null;
					}
					if (item.kind === 'test-ride-monitoring-revoke' && this.testRideMonitoringEndedError(error)) {
						await this.queue.remove(item.queue_id);
						this.assertIdentityScope(scope);
						if (this.state.testRideTracking?.session_id === item.sessionId) this.state.testRideTracking = null;
						this.renderTestRideMonitoringStatus();
					}
					if (item.kind === 'test-ride-monitoring-disarm' && !this.isRetryableRideSave(error)) {
						await this.queue.remove(item.queue_id);
						this.assertIdentityScope(scope);
					}
				}
			}
			await this.flushRideEnginePending();
		}

		async flushRideEnginePending() {
			const scope = this.captureIdentityScope();
			const engine = this.rideEngine.engine;
			const customerId = this.state.customer?.id;
			if (!navigator.onLine || !customerId || typeof engine?.flushPending !== 'function') return;
			try {
				const result = await engine.flushPending(async (record) => {
					this.assertIdentityScope(scope);
					const owner = record?.context?.customerId;
					if (!owner || String(owner) !== String(customerId)) throw new Error('Pending ride belongs to another or unknown Halo account.');
					const response = await this.api.post('/rides', this.rideSyncPayload(record, {
						id: record.id,
						started_at: record.startedAt,
						vehicleId: record.context?.vehicleId,
						testRideMonitoring: Boolean(record.context?.testRideMonitoring || record.context?.rideMode === 'test'),
						mode: record.context?.mode || record.context?.rideMode,
						startSoc: record.context?.soc,
						route: record.context?.route
					}));
					this.assertIdentityScope(scope);
					return response;
				});
				this.assertIdentityScope(scope);
				if (Number(result?.synced) > 0) {
					this.toast(`${result.synced} saved ${Number(result.synced) === 1 ? 'ride was' : 'rides were'} recovered and synchronised.`, 'success');
					await this.loadRides();
				}
			} catch (error) { /* The engine retains unsynchronised records for a later matching session. */ }
		}

		openHazardSheet() {
			if (!this.state.activeRide) return;
			this.openSheet('Report a hazard', `<p class="halo-card-copy">Choose only when safe. Reports are advisory and may be reviewed before appearing to other riders.</p><div class="halo-action-grid halo-hazard-grid"><button type="button" class="halo-action-card" data-action="submit-hazard" data-hazard-type="Deep Pothole"><span>Deep pothole</span><small>Severe road surface</small></button><button type="button" class="halo-action-card" data-action="submit-hazard" data-hazard-type="Debris"><span>Debris</span><small>Object in carriageway</small></button><button type="button" class="halo-action-card" data-action="submit-hazard" data-hazard-type="Roadworks"><span>Roadworks</span><small>Unexpected restriction</small></button><button type="button" class="halo-action-card" data-action="submit-hazard" data-hazard-type="Other"><span>Other hazard</span><small>General caution</small></button></div>`);
		}

		async submitHazard(type, button) {
			const scope = this.captureIdentityScope();
			if (!this.state.activeRide) throw new HaloAPIError('No ride is active.');
			this.setLoading(button, true);
			try {
				const local = await this.rideEngine.reportHazard(type, { clientRideId: this.state.activeRide.id });
				this.assertIdentityScope(scope);
				const location = local?.location || this.state.currentLocation || this.rideEngine.engine?.lastPosition;
				if (finite(location?.lat) === null || finite(location?.lng) === null) throw new HaloAPIError('A current GPS position is required to report a hazard.');
				await this.api.post('/hazards', { hazard_type: type, lat: location.lat, lng: location.lng, severity: 2 });
				this.assertIdentityScope(scope);
				this.dom.sheet.close();
				this.toast('Hazard report received.', 'success');
			} finally { this.setLoading(button, false); }
		}

		emergencyAssistEnabled() {
			const safety = this.state.boot?.safety || {};
			const value = safety.consents?.emergency_assist_enabled ?? safety.emergency_assist_enabled ?? safety.halo_emergency_assist;
			return value === true || value === 1 || ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
		}

		makeCrashEventId(payload) {
			return payload?.event_id || payload?.id || (window.crypto?.randomUUID ? window.crypto.randomUUID() : `crash-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		}

		crashDeadlineFrom(payload) {
			const now = Date.now();
			const numeric = nullableFinite(payload?.deadline_ms);
			const parsed = payload?.deadline_at ? Date.parse(payload.deadline_at) : NaN;
			const supplied = numeric !== null ? numeric : (Number.isFinite(parsed) ? parsed : null);
			return supplied === null ? now + 20000 : Math.min(supplied, now + 20000);
		}

		showCrashState(payload) {
			if (!this.state.activeRide && !payload?.simulation) return;
			if (['sending', 'active'].includes(this.state.crashPhase)) return;
			if (this.dom.dialog?.open) this.dom.dialog.close();
			if (this.dom.sheet?.open) this.dom.sheet.close();
			const incoming = Object.assign({}, payload || {});
			const existingEventId = this.state.crashPayload?.event_id;
			if (!incoming.simulation) incoming.event_id = existingEventId || this.makeCrashEventId(incoming);
			if (this.state.crashPhase === 'countdown' && !this.dom.crash.hidden) {
				this.state.crashPayload = Object.assign({}, this.state.crashPayload || {}, incoming, { event_id: existingEventId || incoming.event_id });
				return;
			}

			this.state.crashPayload = incoming;
			this.state.crashPhase = incoming.simulation ? 'simulation' : 'countdown';
			if (!incoming.simulation && this.incidentCameraPreferences().enabled && this.incidentCameraCanBindEvent(incoming.event_id)) {
				this.clearIncidentCameraRetry();
				this.incidentCameraRetryAttempt = 0;
				this.incidentCameraPendingContext = {
					event_id: String(incoming.event_id || ''),
					incident_id: '',
					ride_id: String(this.state.activeRide?.id || incoming.client_ride_id || ''),
					created_at: Date.now()
				};
				this.incidentCamera?.freezeCandidate?.(incoming).catch(() => null);
			} else if (!incoming.simulation && this.incidentCameraEvidencePending()) {
				incoming.incident_camera_skipped = 'previous-evidence-pending';
			}
			this.state.crashDeadline = this.crashDeadlineFrom(incoming);
			this.state.crashLastVisualSecond = null;
			this.state.crashLastAnnouncedSecond = null;
			this.state.crashReturnFocus = document.activeElement;

			const countdownView = $('[data-crash-countdown-view]', this.dom.crash);
			const activeView = $('[data-crash-active]', this.dom.crash);
			const title = $('[data-crash-title]', this.dom.crash);
			const copy = $('[data-crash-copy]', this.dom.crash);
			const disclaimer = $('[data-crash-disclaimer]', this.dom.crash);
			const counter = $('[data-crash-countdown]', this.dom.crash);
			const cancel = $('[data-action="cancel-crash"]', this.dom.crash);
			const sendNow = $('[data-action="send-nok-now"]', this.dom.crash);
			if (countdownView) countdownView.hidden = false;
			if (activeView) activeView.hidden = true;
			if (title) title.textContent = incoming.simulation ? 'Emergency Assist preview' : 'Are you okay?';
			if (copy) copy.textContent = incoming.simulation
				? 'This is a 20-second simulation. No incident or alert will be sent.'
				: this.emergencyAssistEnabled()
					? 'A possible incident was detected. Cancel if you are okay, or Emergency Assist will activate when the timer reaches zero.'
					: 'A possible incident was detected. Cancel if you are okay, or Halo will alert your configured emergency contact.';
			if (disclaimer) disclaimer.textContent = incoming.simulation
				? 'Preview only — no safety data leaves this device.'
				: 'Emergency Assist can coordinate support but does not replace calling 999 when urgent help is needed.';
			if (counter) counter.setAttribute('aria-label', 'Seconds until Emergency Assist');
			if (cancel) {
				cancel.hidden = false;
				cancel.disabled = false;
				cancel.textContent = "I'm okay — cancel";
			}
			if (sendNow) {
				sendNow.hidden = Boolean(incoming.simulation);
				sendNow.textContent = this.emergencyAssistEnabled() ? 'Activate Emergency Assist now' : 'Alert emergency contact now';
			}

			this.dom.crash.hidden = false;
			this.state.crashInertElements = [this.dom.boot, this.dom.auth, this.dom.product, this.dom.activeRide, this.dom.dialog, this.dom.sheet]
				.filter((element) => element && element !== this.dom.crash && !element.hidden);
			this.state.crashInertElements.forEach((element) => element.setAttribute('inert', ''));

			window.clearInterval(this.state.crashTimer);
			this.state.crashTimer = window.setInterval(() => this.tickCrashCountdown(), 250);
			this.tickCrashCountdown();
			if (!incoming.simulation && this.emergencyAssistEnabled()) this.postIncidentCandidate(incoming);
			$('[data-action="cancel-crash"]', this.dom.crash)?.focus();
		}

		updateCrashCountdownDisplay(remaining) {
			const seconds = Math.max(0, Math.ceil(Number(remaining) || 0));
			if (seconds !== this.state.crashLastVisualSecond) {
				const counter = $('[data-crash-countdown]', this.dom.crash);
				if (counter) counter.textContent = String(seconds);
				this.state.crashLastVisualSecond = seconds;
			}
			const milestones = [20, 10, 5, 0];
			if ((this.state.crashLastAnnouncedSecond === null || milestones.includes(seconds)) && seconds !== this.state.crashLastAnnouncedSecond) {
				const announcement = $('[data-crash-announcement]', this.dom.crash);
				if (announcement) announcement.textContent = seconds > 0 ? `${seconds} seconds until Emergency Assist.` : 'Emergency Assist is being activated.';
				this.state.crashLastAnnouncedSecond = seconds;
			}
		}

		tickCrashCountdown() {
			if (!['countdown', 'simulation'].includes(this.state.crashPhase) || !this.state.crashDeadline) return;
			const remaining = Math.max(0, Math.ceil((this.state.crashDeadline - Date.now()) / 1000));
			this.updateCrashCountdownDisplay(remaining);
			if (Date.now() < this.state.crashDeadline) return;
			window.clearInterval(this.state.crashTimer);
			this.state.crashTimer = null;
			if (this.state.crashPhase === 'simulation') {
				this.state.crashPhase = 'complete';
				this.clearCrashState();
				this.toast('Emergency Assist preview complete. Nothing was sent.', 'success');
				return;
			}
			this.activateCrashAlert('deadline').catch((error) => this.handleError(error));
		}

		updateCrashCountdown(payload) {
			if (this.dom.crash.hidden && this.state.crashPhase !== 'sending') this.showCrashState(Object.assign({}, payload, { engine_managed: true }));
			if (this.state.crashPhase !== 'countdown') return;
			this.state.crashPayload = Object.assign({}, this.state.crashPayload || {}, payload || {}, {
				event_id: this.state.crashPayload?.event_id || this.makeCrashEventId(payload)
			});
			this.tickCrashCountdown();
		}

		handleEngineCrashCancelled() {
			if (this.state.crashCancelInProgress || ['sending', 'active'].includes(this.state.crashPhase)) return;
			if (this.state.crashPhase === 'countdown') {
				this.state.crashPhase = 'cancelled';
				this.clearCrashState();
			}
		}

		async confirmCrash(payload) {
			const eventId = this.state.crashPayload?.event_id || this.makeCrashEventId(payload);
			this.state.crashPayload = Object.assign({}, this.state.crashPayload || {}, payload || {}, { event_id: eventId });
			if (this.dom.crash.hidden && this.state.crashPhase === 'idle') this.showCrashState(Object.assign({}, payload, { engine_managed: true }));
			return this.activateCrashAlert('engine');
		}

		clearCrashState(options) {
			const settings = Object.assign({ preserveIncident: false, keepPhase: false }, options || {});
			window.clearInterval(this.state.crashTimer);
			this.state.crashTimer = null;
			this.state.crashDeadline = 0;
			this.dom.crash.hidden = true;
			const countdownView = $('[data-crash-countdown-view]', this.dom.crash);
			const activeView = $('[data-crash-active]', this.dom.crash);
			const sendNow = $('[data-action="send-nok-now"]', this.dom.crash);
			const cancel = $('[data-action="cancel-crash"]', this.dom.crash);
			const counter = $('[data-crash-countdown]', this.dom.crash);
			if (countdownView) countdownView.hidden = false;
			if (activeView) activeView.hidden = true;
			if (sendNow) sendNow.hidden = false;
			if (cancel) { cancel.hidden = false; cancel.disabled = false; cancel.textContent = "I'm okay — cancel"; }
			if (counter) counter.setAttribute('aria-label', 'Seconds until Emergency Assist');
			asArray(this.state.crashInertElements).forEach((element) => {
				element.removeAttribute('inert');
				if (element === this.dom.product && this.state.activeRide && !this.dom.activeRide.hidden) element.setAttribute('inert', '');
			});
			this.state.crashInertElements = [];
			this.state.crashPayload = null;
			this.state.crashCandidateEventId = null;
			this.state.crashCandidatePromise = null;
			this.state.crashCandidateOutcome = 'idle';
			this.state.crashCancelPromise = null;
			this.state.crashCancellationStatus = '';
			if (!settings.preserveIncident) {
				this.stopEmergencyAssistPositionUpdates();
				this.state.emergencyIncident = null;
			}
			if (!settings.keepPhase) this.state.crashPhase = 'idle';
			const returnFocus = this.state.crashReturnFocus;
			this.state.crashReturnFocus = null;
			if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') window.setTimeout(() => returnFocus.focus(), 0);
		}

		async cancelCrashAlert() {
			const retrying = this.state.crashPhase === 'cancel_unconfirmed';
			if (!retrying && !['countdown', 'simulation'].includes(this.state.crashPhase)) {
				this.toast('Emergency Assist is already being activated and can no longer be cancelled here.', 'error');
				return false;
			}
			if (this.state.crashCancelPromise) return this.state.crashCancelPromise;

			const crash = this.state.crashPayload || {};
			const simulation = !retrying && (this.state.crashPhase === 'simulation' || Boolean(crash.simulation));
			const scope = this.captureIdentityScope();
			this.state.crashPhase = 'cancelling';
			window.clearInterval(this.state.crashTimer);
			this.state.crashTimer = null;
			this.setCrashCancellationBusy(true);

			if (!retrying) {
				this.state.crashCancelInProgress = true;
				const engineManaged = Boolean(crash.engine_managed);
				const engineCancelled = simulation || !engineManaged ? true : Boolean(this.rideEngine.cancelCrash('rider'));
				this.state.crashCancelInProgress = false;
				if (!engineCancelled) {
					this.state.crashPhase = 'sending';
					this.setCrashCancellationBusy(false);
					this.toast('Emergency Assist is already being activated and could not be cancelled.', 'error');
					return false;
				}
			}

			if (simulation || !this.emergencyAssistEnabled()) {
				this.state.crashPhase = 'cancelled';
				this.clearCrashState();
				this.toast(simulation ? 'Emergency Assist preview cancelled. Nothing was sent.' : 'Emergency-contact countdown cancelled.', 'success');
				return true;
			}

			const eventId = String(crash.event_id || this.state.crashCandidateEventId || '');
			if (!/^[A-Za-z0-9._:-]{8,80}$/.test(eventId)) {
				this.showCancellationUnconfirmed(eventId, { status: '', error: new HaloAPIError('Halo no longer has the incident reference needed to confirm cancellation.', 0, 'event_id_missing') });
				return false;
			}
			// Persist the rider's intent before awaiting either request. If the tab is
			// killed mid-flight, bootstrap can reconcile this exact incident safely.
			this.storePendingEmergency(eventId, null, { cancellationPending: true });

			const statusOnly = retrying && ['active', 'acknowledged'].includes(String(this.state.crashCancellationStatus || '').toLowerCase());
			const request = this.cancelIncidentCandidate(eventId, scope, { statusOnly });
			this.state.crashCancelPromise = request;
			try {
				const outcome = await request;
				this.assertIdentityScope(scope);
				return this.applyCrashCancellationOutcome(eventId, crash, outcome);
			} catch (error) {
				if (error?.code === 'stale_identity') return false;
				this.showCancellationUnconfirmed(eventId, { status: this.state.crashCancellationStatus, error });
				return false;
			} finally {
				if (this.state.crashCancelPromise === request) this.state.crashCancelPromise = null;
				if (this.state.crashPhase === 'cancel_unconfirmed') this.setCrashCancellationBusy(false);
			}
		}

		setCrashCancellationBusy(busy) {
			const button = $('[data-action="cancel-crash"]', this.dom.crash);
			if (!button) return;
			button.disabled = Boolean(busy);
			if (busy) button.textContent = 'Confirming cancellation…';
		}

		showCancellationUnconfirmed(eventId, outcome) {
			const durable = isObject(outcome) ? outcome : {};
			const status = String(durable.status || '').toLowerCase();
			const activated = ['active', 'acknowledged'].includes(status);
			this.state.crashPhase = 'cancel_unconfirmed';
			this.state.crashCancellationStatus = status;
			this.state.crashPayload = Object.assign({}, this.state.crashPayload || {}, { event_id: eventId });
			this.storePendingEmergency(eventId, durable.incident?.incident_id || durable.incident?.id || null, { cancellationPending: true });

			if (this.dom.dialog?.open) this.dom.dialog.close();
			if (this.dom.sheet?.open) this.dom.sheet.close();
			if (this.dom.crash.hidden) {
				this.state.crashReturnFocus = this.state.crashReturnFocus || document.activeElement;
				this.state.crashInertElements = [this.dom.boot, this.dom.auth, this.dom.product, this.dom.activeRide, this.dom.dialog, this.dom.sheet]
					.filter((element) => element && element !== this.dom.crash && !element.hidden);
				this.state.crashInertElements.forEach((element) => element.setAttribute('inert', ''));
				this.dom.crash.hidden = false;
			}
			const countdownView = $('[data-crash-countdown-view]', this.dom.crash);
			const activeView = $('[data-crash-active]', this.dom.crash);
			const title = $('[data-crash-title]', this.dom.crash);
			const copy = $('[data-crash-copy]', this.dom.crash);
			const counter = $('[data-crash-countdown]', this.dom.crash);
			const announcement = $('[data-crash-announcement]', this.dom.crash);
			const cancel = $('[data-action="cancel-crash"]', this.dom.crash);
			const sendNow = $('[data-action="send-nok-now"]', this.dom.crash);
			const disclaimer = $('[data-crash-disclaimer]', this.dom.crash);
			if (countdownView) countdownView.hidden = false;
			if (activeView) activeView.hidden = true;
			if (title) title.textContent = activated ? 'Cancellation window closed' : 'Cancellation not confirmed';
			if (copy) copy.textContent = activated
				? 'The incident has already activated. Halo is checking whether a responder alert was accepted.'
				: 'Halo could not confirm that the saved incident was cancelled. Emergency Assist may still activate.';
			if (counter) { counter.textContent = '!'; counter.setAttribute('aria-label', 'Cancellation not confirmed'); }
			if (announcement) announcement.textContent = 'Cancellation was not confirmed. Emergency Assist may still activate.';
			if (cancel) {
				cancel.hidden = false;
				cancel.disabled = false;
				cancel.textContent = activated ? 'Check responder status' : (navigator.onLine ? 'Retry cancellation' : 'Retry when online');
			}
			if (sendNow) sendNow.hidden = true;
			if (disclaimer) disclaimer.textContent = 'Do not assume the alert stopped. If anyone may be injured, call 999 now.';
			cancel?.focus();
			this.toast(activated ? 'Emergency Assist has activated; cancellation is no longer available.' : 'Cancellation was not confirmed. Emergency Assist may still activate.', 'error');
		}

		applyCrashCancellationOutcome(eventId, crash, outcome) {
			const durable = isObject(outcome) ? outcome : {};
			const incident = isObject(durable.incident) ? durable.incident : {};
			const status = String(durable.status || incident.status || '').toLowerCase();
			if (status === 'cancelled') {
				this.state.crashPhase = 'cancelled';
				this.discardIncidentCameraCandidate('incident-cancelled');
				this.clearPendingEmergency(eventId);
				this.clearCrashState();
				this.toast('Emergency Assist cancellation confirmed.', 'success');
				return true;
			}
			if (['false_alarm', 'resolved'].includes(status)) {
				this.discardIncidentCameraCandidate(status);
				this.clearPendingEmergency(eventId);
				this.clearCrashState();
				this.toast('The Emergency Assist incident is already closed.', 'success');
				return false;
			}
			if (['active', 'acknowledged'].includes(status) && (incident.incident_id || incident.id)) {
				const incidentPayload = Object.assign({}, crash, { event_id: eventId });
				this.storePendingEmergency(eventId, incident.incident_id || incident.id);
				this.confirmIncidentCamera(incident, incidentPayload);
				if (incident.accepted === true) {
					this.showEmergencyAssistActive(incident, incidentPayload);
					this.toast('Cancellation did not complete before Emergency Assist activated.', 'error');
					return false;
				}
			}
			this.showCancellationUnconfirmed(eventId, { status, incident, error: durable.error });
			return false;
		}

		async captureSafetyDeviceState() {
			const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
			let battery = null;
			if (typeof navigator.getBattery === 'function') {
				try {
					const result = await Promise.race([navigator.getBattery(), sleep(800).then(() => null)]);
					if (result) battery = { levelPercent: Math.round(Number(result.level) * 100), charging: Boolean(result.charging) };
				} catch (error) { battery = null; }
			}
			return {
				battery,
				online: navigator.onLine,
				network: connection ? {
					type: connection.type || null,
					effectiveType: connection.effectiveType || null,
					downlinkMbps: nullableFinite(connection.downlink),
					rttMs: nullableFinite(connection.rtt),
					saveData: Boolean(connection.saveData)
				} : null,
				visibility: document.visibilityState || (document.hidden ? 'hidden' : 'visible'),
				screenOrientation: window.screen?.orientation?.type || null
			};
		}

		normaliseSafetyPosition(value) {
			if (nullableFinite(value?.lat) === null || nullableFinite(value?.lng) === null) return null;
			return {
				lat: Number(value.lat),
				lng: Number(value.lng),
				accuracy: nullableFinite(value.accuracy),
				altitude: nullableFinite(value.altitude),
				heading: nullableFinite(value.heading),
				speed_mph: nullableFinite(value.speedMph ?? value.speed_mph),
				recorded_at: nullableFinite(value.recordedAt ?? value.at) || Date.now()
			};
		}

		async buildCrashAlertPayload(crash, location, includeAssistTelemetry = true) {
			const engine = this.rideEngine.engine;
			const snapshot = typeof engine?.crashSnapshot === 'function' ? engine.crashSnapshot(crash || {}) : {};
			const source = Object.assign({}, snapshot || {}, crash || {});
			const position = this.normaliseSafetyPosition(location || source.location || source.position || this.state.currentLocation);
			const metrics = typeof engine?.metrics === 'function' ? engine.metrics() : {};
			const eventId = source.event_id || this.makeCrashEventId(source);
			const vehicleBattery = this.vehicleBattery();
			const base = {
				event_id: eventId,
				occurred_at: source.occurred_at || source.at || new Date().toISOString(),
				lat: position?.lat ?? null,
				lng: position?.lng ?? null,
				speed_mph: source.speedMph ?? source.speed_mph ?? position?.speed_mph ?? this.state.lastTelemetry?.speedMph ?? 0,
				peak_g_force: source.peakG ?? source.gForce ?? source.peak_g_force ?? source.acceleration?.resultantG ?? null,
				max_lean_left: metrics.maxLeanLeft ?? 0,
				max_lean_right: metrics.maxLeanRight ?? 0,
				battery: vehicleBattery.soc === null ? '' : `${Math.round(vehicleBattery.soc)}%`
			};
			if (!includeAssistTelemetry) return base;
			const device = await this.captureSafetyDeviceState();
			const recentTelemetry = asArray(source.recentTelemetry || source.recent_telemetry).slice(-18);
			const recentTrace = asArray(source.recentTrace || source.recent_route_points).slice(-18);
			const axes = {
				x: nullableFinite(source.acceleration?.x),
				y: nullableFinite(source.acceleration?.y),
				z: nullableFinite(source.acceleration?.z)
			};
			const orientationLabel = [
				source.orientation?.screenType || source.orientation?.screen_type || null,
				nullableFinite(source.leanDegrees ?? source.lean_degrees ?? source.orientation?.leanDegrees) === null
					? null
					: `lean ${Number(source.leanDegrees ?? source.lean_degrees ?? source.orientation?.leanDegrees).toFixed(1)} degrees`
			].filter(Boolean).join(', ');
			const moving = source.moving ?? ((nullableFinite(source.speedMph ?? position?.speed_mph) || 0) >= 3);
			const movementLabel = source.movementState || source.movement_state || (moving ? 'moving' : 'stationary');
			return Object.assign(base, {
				countdown_deadline: source.deadline_at || (this.state.crashDeadline ? new Date(this.state.crashDeadline).toISOString() : null),
				client_ride_id: source.clientRideId || source.rideId || this.state.activeRide?.id || null,
				vehicle_id: source.vehicleId || this.state.vehicle?.id || null,
				accuracy: position?.accuracy ?? null,
				accuracy_m: position?.accuracy ?? null,
				altitude: position?.altitude ?? null,
				heading: position?.heading ?? null,
				position,
				previous_speed_mph: source.previousSpeedMph ?? source.previous_speed_mph ?? null,
				moving,
				movement_state: source.movementState || source.movement_state || null,
				movement: movementLabel,
				acceleration: source.acceleration || null,
				axes,
				axis_x: axes.x,
				axis_y: axes.y,
				axis_z: axes.z,
				acceleration_x: axes.x,
				acceleration_y: axes.y,
				acceleration_z: axes.z,
				resultant_g: nullableFinite(source.acceleration?.resultantG ?? source.acceleration?.resultant_g ?? source.peakG ?? source.gForce),
				orientation: source.orientation || null,
				estimated_orientation: orientationLabel,
				lean_degrees: source.leanDegrees ?? source.lean_degrees ?? this.state.lastTelemetry?.leanDegrees ?? null,
				impact: {
					occurred_at: base.occurred_at,
					speed_mph: base.speed_mph,
					peak_g_force: base.peak_g_force,
					axes,
					heading: position?.heading ?? null,
					estimated_orientation: orientationLabel,
					movement: movementLabel
				},
				device: {
					battery: device.battery?.levelPercent === null || device.battery?.levelPercent === undefined ? '' : `${device.battery.levelPercent}%`,
					platform: navigator.userAgentData?.platform || navigator.platform || '',
					model: ''
				},
				network: {
					online: device.online,
					connection_type: device.network?.type || null,
					effective_type: device.network?.effectiveType || null
				},
				recent_route: recentTrace,
				recent_route_points: recentTrace,
				recent_telemetry: recentTelemetry,
				planned_route: source.plannedRoute || source.planned_route || null,
				impact_device_state: source.deviceState || source.device_state || null,
				device_state: Object.assign({}, source.deviceState || source.device_state || {}, device),
				phone_battery: device.battery,
				vehicle_battery_percent: vehicleBattery.soc
			});
		}

		postIncidentCandidate(crash) {
			if (!this.emergencyAssistEnabled()) return Promise.resolve(null);
			const eventId = crash?.event_id || this.state.crashPayload?.event_id;
			if (!eventId) return Promise.resolve(null);
			if (this.state.crashCandidateEventId === eventId) return this.state.crashCandidatePromise || Promise.resolve(null);
			this.state.crashCandidateEventId = eventId;
			this.state.crashCandidateOutcome = 'pending';
			const request = (async () => {
				try {
					const payload = await this.buildCrashAlertPayload(Object.assign({}, crash, { event_id: eventId }), crash?.location || crash?.position);
					if (!['countdown', 'cancelling', 'cancel_unconfirmed', 'sending', 'active'].includes(this.state.crashPhase) || this.state.crashPayload?.event_id !== eventId || !this.emergencyAssistEnabled()) {
						if (this.state.crashCandidateEventId === eventId) this.state.crashCandidateOutcome = 'skipped';
						return null;
					}
					const result = await this.api.post('/safety/incident-candidate', payload);
					if (this.state.crashCandidateEventId === eventId) this.state.crashCandidateOutcome = 'recorded';
					return result;
				} catch (error) {
					if (this.state.crashCandidateEventId === eventId) this.state.crashCandidateOutcome = error?.code === 'stale_identity' ? 'stale' : 'failed';
					return null;
				}
			})();
			this.state.crashCandidatePromise = request;
			return request;
		}

		async cancelIncidentCandidate(eventId, scope, options) {
			const settings = Object.assign({ statusOnly: false }, options || {});
			if (!this.emergencyAssistEnabled() || !eventId) return { status: '', incident: null, error: new HaloAPIError('Emergency Assist cancellation is unavailable.', 0, 'cancellation_unavailable') };
			let lastError = null;

			if (!settings.statusOnly) {
				if (navigator.onLine && !this.state.boot?.offline_snapshot) {
					// Do not await the candidate POST: the cancellation endpoint owns the
					// insert race with a server-side tombstone. Only a brief retry is made
					// for an explicit lock/insert race; an uncertain response is reconciled.
					for (let attempt = 0; attempt < 2; attempt += 1) {
						try {
							const response = await this.api.post(`/safety/incidents/${encodeURIComponent(eventId)}/cancel`, {
								event_id: eventId,
								cancelled_at: new Date().toISOString(),
								reason: 'rider_okay'
							}, { timeout: 3500, keepalive: true });
							this.assertIdentityScope(scope);
							const responseStatus = String(response?.status || '').toLowerCase();
							if (responseStatus === 'cancelled') return { status: responseStatus, incident: response, error: null };
							break;
						} catch (error) {
							if (error?.code === 'stale_identity') throw error;
							lastError = error;
							const retryableRace = ['emergency_incident_busy', 'emergency_incident_missing', 'emergency_cancel_failed', 'emergency_storage_unavailable', 'csrf_refreshed'].includes(String(error?.code || ''));
							if (!retryableRace || attempt > 0) break;
							await sleep(200);
							this.assertIdentityScope(scope);
						}
					}
				} else {
					lastError = new HaloAPIError('Halo cannot reach the service to confirm cancellation.', 0, 'offline');
				}
			}

			if (navigator.onLine && !this.state.boot?.offline_snapshot) {
				try {
					const incident = await this.api.get(`/safety/incidents/${encodeURIComponent(eventId)}`, { timeout: 3000 });
					this.assertIdentityScope(scope);
					return { status: String(incident?.status || '').toLowerCase(), incident, error: lastError };
				} catch (error) {
					if (error?.code === 'stale_identity') throw error;
					lastError = error;
				}
			}
			return { status: '', incident: null, error: lastError };
		}

		storePendingEmergency(eventId, incidentId, options) {
			if (!eventId || !this.state.customer?.id) return;
			const settings = Object.assign({ cancellationPending: false }, options || {});
			try {
				window.sessionStorage.setItem('avenra-halo-v2-emergency-pending', JSON.stringify({
					customerId: String(this.state.customer.id),
					eventId: String(eventId),
					incidentId: incidentId ? String(incidentId) : null,
					cancellationPending: Boolean(settings.cancellationPending),
					createdAt: Date.now()
				}));
			} catch (error) { /* Durable server state remains authoritative. */ }
		}

		clearEmergencyReconciliation() {
			if (this.emergencyReconcileTimer) window.clearTimeout(this.emergencyReconcileTimer);
			this.emergencyReconcileTimer = null;
			this.emergencyReconcileAttempt = 0;
			this.emergencyReconcileEventId = '';
		}

		scheduleEmergencyReconciliation(eventId, payload) {
			const id = String(eventId || '');
			if (!/^[A-Za-z0-9._:-]{8,80}$/.test(id) || this.state.boot?.offline_snapshot) return;
			if (this.emergencyReconcileEventId && this.emergencyReconcileEventId !== id) this.clearEmergencyReconciliation();
			this.emergencyReconcileEventId = id;
			if (this.emergencyReconcileTimer) return;
			if (this.emergencyReconcileAttempt >= 8) {
				if (String(this.incidentCameraPendingContext?.event_id || '') === id && !this.incidentCameraPendingContext?.incident_id) {
					this.discardIncidentCameraCandidate('incident-reconciliation-expired');
				}
				return;
			}
			const delays = [3000, 10000, 30000, 60000, 120000, 180000, 300000, 600000];
			const delay = delays[this.emergencyReconcileAttempt] || 600000;
			this.emergencyReconcileTimer = window.setTimeout(async () => {
				this.emergencyReconcileTimer = null;
				this.emergencyReconcileAttempt += 1;
				if (!navigator.onLine) {
					this.scheduleEmergencyReconciliation(id, payload);
					return;
				}
				const latest = await this.reconcileEmergencyIncident(id, payload);
				const status = String(latest?.status || '').toLowerCase();
				const finished = ['cancelled', 'false_alarm', 'resolved'].includes(status)
					|| (Boolean(latest?.incident_id) && ['active', 'acknowledged', 'accepted'].includes(status));
				if (finished) this.clearEmergencyReconciliation();
				else this.scheduleEmergencyReconciliation(id, payload);
			}, delay);
		}

		readPendingEmergency() {
			try {
				const value = JSON.parse(window.sessionStorage.getItem('avenra-halo-v2-emergency-pending') || 'null');
				if (!value || String(value.customerId || '') !== String(this.state.customer?.id || '') || !/^[A-Za-z0-9._:-]{8,80}$/.test(String(value.eventId || '')) || Date.now() - Number(value.createdAt || 0) > 24 * 60 * 60 * 1000) {
					window.sessionStorage.removeItem('avenra-halo-v2-emergency-pending');
					return null;
				}
				return value;
			} catch (error) {
				try { window.sessionStorage.removeItem('avenra-halo-v2-emergency-pending'); } catch (storageError) { /* Best effort. */ }
				return null;
			}
		}

		clearPendingEmergency(eventId) {
			try {
				const stored = this.readPendingEmergency();
				if (!eventId || !stored || String(stored.eventId) === String(eventId)) {
					window.sessionStorage.removeItem('avenra-halo-v2-emergency-pending');
					if (!eventId || this.emergencyReconcileEventId === String(eventId)) this.clearEmergencyReconciliation();
				}
			} catch (error) { /* Best effort. */ }
		}

		async reconcilePendingCrashCancellation(stored) {
			const pending = isObject(stored) ? stored : this.readPendingEmergency();
			const eventId = String(pending?.eventId || this.state.crashPayload?.event_id || '');
			if (!pending?.cancellationPending || !/^[A-Za-z0-9._:-]{8,80}$/.test(eventId)) return null;
			if (this.state.crashCancelPromise) return this.state.crashCancelPromise;
			if (this.state.crashPhase !== 'cancel_unconfirmed') {
				this.state.crashPayload = Object.assign({}, this.state.crashPayload || {}, { event_id: eventId });
				this.state.crashCandidateEventId = eventId;
				this.showCancellationUnconfirmed(eventId, { status: this.state.crashCancellationStatus || '', incident: pending.incidentId ? { incident_id: pending.incidentId } : null });
			}
			return this.cancelCrashAlert();
		}

		async reconcileEmergencyIncident(eventId, payload) {
			if (!eventId || !navigator.onLine || this.state.boot?.offline_snapshot) return null;
			try {
				const response = await this.api.get(`/safety/incidents/${encodeURIComponent(eventId)}`);
				const status = String(response?.status || '').toLowerCase();
				if (['cancelled', 'false_alarm', 'resolved'].includes(status)) {
					this.clearEmergencyReconciliation();
					this.clearPendingEmergency(eventId);
					await this.discardIncidentCameraCandidate(`incident-${status}`);
					return response;
				}
				const durableActive = Boolean(response?.incident_id) && ['active', 'acknowledged', 'accepted'].includes(status);
				if (durableActive) {
					this.clearEmergencyReconciliation();
					this.storePendingEmergency(eventId, response.incident_id);
					const incidentPayload = Object.assign({ event_id: eventId }, payload || {});
					this.confirmIncidentCamera(response, incidentPayload);
					if (response?.accepted === true) this.showEmergencyAssistActive(response, incidentPayload);
					return response;
				}
				this.scheduleEmergencyReconciliation(eventId, payload);
				return response;
			} catch (error) {
				this.scheduleEmergencyReconciliation(eventId, payload);
				return null;
			}
		}

		async pollEmergencyIncident(eventId, payload, attempts = 5) {
			let latest = null;
			for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
				latest = await this.reconcileEmergencyIncident(eventId, payload);
				if (latest?.accepted === true) return latest;
				const status = String(latest?.status || '').toLowerCase();
				const deliveryStates = [latest?.primary_status, latest?.backup_status].map(value => String(value || '').toLowerCase());
				const processing = latest?.processing === true || deliveryStates.some(value => ['pending', 'attempting'].includes(value));
				if (!latest || ['cancelled', 'false_alarm', 'resolved'].includes(status)) return latest;
				if (!processing || status === 'candidate') {
					const pendingCancellation = this.readPendingEmergency()?.cancellationPending === true;
					const durableActive = Boolean(latest?.incident_id) && ['active', 'acknowledged', 'accepted'].includes(status);
					if (!durableActive && !pendingCancellation) this.scheduleEmergencyReconciliation(eventId, payload);
					if (status === 'active' && latest?.accepted !== true && this.state.lastEmergencyFailureEventId !== eventId) {
						this.state.lastEmergencyFailureEventId = eventId;
						this.openDialog('Responder alert not accepted', '<p>Neither Emergency Assist responder message was confirmed as accepted by the SMS provider.</p><p><strong>Do not wait for Halo if anyone may be injured.</strong> Call emergency services now.</p><a class="halo-button halo-button--primary halo-full-width" href="tel:999">Call 999</a>', 'ACTION REQUIRED');
					}
					return latest;
				}
				if (attempt < attempts - 1) await sleep(1500);
			}
			return latest;
		}

		reconcileStoredEmergency() {
			const stored = this.readPendingEmergency();
			if (stored?.cancellationPending) return this.reconcilePendingCrashCancellation(stored);
			const bootstrapIncident = isObject(this.state.boot?.emergency_incident) ? this.state.boot.emergency_incident : null;
			const eventId = stored?.eventId || bootstrapIncident?.event_id || null;
			if (!eventId) return Promise.resolve(null);
			if (!stored) this.storePendingEmergency(eventId, bootstrapIncident?.incident_id || null);
			return this.pollEmergencyIncident(eventId, { event_id: eventId }, 3);
		}

		startEmergencyAssistPositionUpdates() {
			this.stopEmergencyAssistPositionUpdates();
			if (!this.state.emergencyIncident?.eventId || !this.state.activeRide || !this.emergencyAssistEnabled()) return;
			this.state.incidentPositionTimer = window.setInterval(() => {
				const latest = this.rideEngine.engine?.lastPosition || this.state.currentLocation;
				this.updateEmergencyAssistPosition(latest);
			}, 5000);
		}

		stopEmergencyAssistPositionUpdates() {
			if (this.state.incidentPositionTimer) window.clearInterval(this.state.incidentPositionTimer);
			this.state.incidentPositionTimer = null;
			this.state.incidentPositionLastSentAt = 0;
			this.state.incidentPositionInFlight = false;
		}

		updateEmergencyAssistPosition(position) {
			const incident = this.state.emergencyIncident;
			const normalised = this.normaliseSafetyPosition(position);
			if (!incident?.eventId || !this.state.activeRide || !this.emergencyAssistEnabled() || !normalised || !navigator.onLine) return;
			const now = Date.now();
			if (this.state.incidentPositionInFlight || now - (this.state.incidentPositionLastSentAt || 0) < 5000) return;
			this.state.incidentPositionInFlight = true;
			this.state.incidentPositionLastSentAt = now;
			this.api.post(`/safety/incidents/${encodeURIComponent(incident.eventId)}/position`, {
				event_id: incident.eventId,
				incident_id: incident.incidentId || null,
				client_ride_id: this.state.activeRide.id || null,
				vehicle_id: this.state.vehicle?.id || null,
				occurred_at: new Date().toISOString(),
				...normalised,
				accuracy_m: normalised.accuracy,
				moving: normalised.speed_mph === null ? null : normalised.speed_mph >= 3,
				device_state: { online: navigator.onLine, visibility: document.visibilityState || 'visible' }
			}).catch(() => null).finally(() => { this.state.incidentPositionInFlight = false; });
		}

		activateCrashAlert(reason, button) {
			if (this.state.crashPhase === 'sending') return this.state.crashSendPromise || Promise.resolve(null);
			if (this.state.crashPhase !== 'countdown') return Promise.resolve(null);
			this.state.crashPhase = 'sending';
			this.state.crashAlertSending = true;
			window.clearInterval(this.state.crashTimer);
			this.state.crashTimer = null;
			this.rideEngine.cancelCrash('send');
			const cancel = $('[data-action="cancel-crash"]', this.dom.crash);
			const sendNow = $('[data-action="send-nok-now"]', this.dom.crash);
			const copy = $('[data-crash-copy]', this.dom.crash);
			if (cancel) cancel.hidden = true;
			if (sendNow) sendNow.hidden = true;
			if (copy) copy.textContent = this.emergencyAssistEnabled() ? 'Activating Emergency Assist…' : 'Sending your emergency-contact alert…';
			const request = this.performCrashAlert(reason, button);
			this.state.crashSendPromise = request;
			return request.finally(() => {
				if (this.state.crashSendPromise === request) this.state.crashSendPromise = null;
				this.state.crashAlertSending = false;
			});
		}

		async performCrashAlert(reason, button) {
			const scope = this.captureIdentityScope();
			const assistEnabled = this.emergencyAssistEnabled();
			this.setLoading(button, true);
			try {
				const crash = this.state.crashPayload || {};
				let location = crash.location || crash.position || this.rideEngine.engine?.lastPosition || this.state.currentLocation;
				if (nullableFinite(location?.lat) === null || nullableFinite(location?.lng) === null) {
					location = await this.currentPositionForSafety();
					this.assertIdentityScope(scope);
				}
				const payload = await this.buildCrashAlertPayload(crash, location, assistEnabled);
				payload.activation_reason = reason || 'countdown';
				payload.alert_mode = assistEnabled ? 'emergency_assist' : 'next_of_kin';
				if (assistEnabled) this.storePendingEmergency(payload.event_id);
				this.assertIdentityScope(scope);
				let response;
				try {
					response = await this.api.post('/safety/crash-alert', payload);
					this.assertIdentityScope(scope);
				} catch (error) {
					if (error.code === 'stale_identity') throw error;
					if (assistEnabled) {
						const reconciled = await this.pollEmergencyIncident(payload.event_id, payload);
						if (reconciled?.accepted === true) return reconciled;
					}
					if (!assistEnabled && this.isRetryableRideSave(error) && this.state.customer?.id) {
						this.assertIdentityScope(scope);
						await this.queue.add({ endpoint: '/safety/crash-alert', payload, customerId: this.state.customer.id, kind: 'incident-alert', expiresAt: Date.now() + (5 * 60 * 1000) });
						this.assertIdentityScope(scope);
						this.rideEngine.completeCrash('idle');
						this.clearCrashState();
						this.openDialog('Alert not delivered', '<p>Your emergency-contact alert was <strong>not delivered</strong>. Halo will retry it for up to five minutes when this account reconnects; it will not send a stale alert later.</p><p>Do not wait for Halo if anyone may be injured. Contact emergency services now.</p><a class="halo-button halo-button--primary halo-full-width" href="tel:999">Call 999</a>', 'ACTION REQUIRED');
						return null;
					}
					throw error;
				}

				const assistDetails = isObject(response.emergency_assist) ? response.emergency_assist : {};
				const assistResponse = Object.assign({}, response, assistDetails);
				if (assistEnabled && assistResponse.accepted !== true) {
					const deliveryStates = [assistResponse.primary_status, assistResponse.backup_status].map(value => String(value || '').toLowerCase());
					if (assistResponse.processing === true || deliveryStates.some(value => ['pending', 'attempting'].includes(value))) {
						const reconciled = await this.pollEmergencyIncident(payload.event_id, payload);
						if (reconciled?.accepted === true) return reconciled;
					}
				}
				const assistStatus = String(assistResponse.status || '').toLowerCase();
				const assistFlag = response.emergency_assist === true || (Object.keys(assistDetails).length > 0 && assistDetails.enabled !== false);
				const responderAlertAccepted = assistResponse.accepted === true;
				const durableActive = assistEnabled && Boolean(assistResponse.incident_id) && ['active', 'accepted', 'acknowledged'].includes(assistStatus);
				if (durableActive) {
					this.storePendingEmergency(payload.event_id, assistResponse.incident_id);
					this.confirmIncidentCamera(assistResponse, payload);
				} else if (['cancelled', 'false_alarm', 'resolved'].includes(assistStatus)) {
					await this.discardIncidentCameraCandidate(`incident-${assistStatus}`);
				}
				const assistAccepted = assistEnabled && assistFlag && responderAlertAccepted && Boolean(assistResponse.incident_id) && ['active', 'accepted', 'acknowledged'].includes(assistStatus);
				if (assistAccepted) {
					this.showEmergencyAssistActive(assistResponse, payload);
				} else if (!assistEnabled) {
					this.rideEngine.completeCrash('idle');
					this.clearCrashState();
					this.toast(response.message || 'Halo accepted your emergency-contact alert.', 'success');
				} else {
					this.rideEngine.completeCrash('idle');
					this.state.crashPhase = 'failed';
					this.clearCrashState();
					this.openDialog('Responder alert not confirmed', '<p>Halo did not confirm that a responder alert was accepted. Do not wait for Halo if anyone may be injured.</p><a class="halo-button halo-button--primary halo-full-width" href="tel:999">Call 999</a>', 'ACTION REQUIRED');
				}
				return response;
			} catch (error) {
				if (error?.code === 'stale_identity') return null;
				const unresolvedEventId = String(this.state.crashPayload?.event_id || this.incidentCameraPendingContext?.event_id || '');
				if (assistEnabled && unresolvedEventId) this.scheduleEmergencyReconciliation(unresolvedEventId, { event_id: unresolvedEventId });
				this.rideEngine.completeCrash('idle');
				this.state.crashPhase = 'failed';
				this.clearCrashState();
				const title = assistEnabled ? 'Emergency Assist not activated' : 'Alert not delivered';
				const copy = assistEnabled
					? '<p>Halo could not confirm that Emergency Assist was activated. Do not wait for Halo if anyone may be injured.</p>'
					: '<p>Halo could not confirm that your emergency-contact alert was delivered. Contact them directly when safe.</p>';
				this.openDialog(title, `${copy}<a class="halo-button halo-button--primary halo-full-width" href="tel:999">Call 999</a>`, 'ACTION REQUIRED');
				if (error instanceof HaloSessionExpiredError || ['session_expired', 'authentication_required', 'not_authenticated'].includes(error?.code)) this.handleSessionExpired();
				return null;
			} finally { this.setLoading(button, false); }
		}

		showEmergencyAssistActive(response, payload) {
			this.state.crashPhase = 'active';
			this.storePendingEmergency(payload.event_id, response.incident_id);
			this.state.emergencyIncident = {
				eventId: payload.event_id,
				incidentId: response.incident_id || null,
				status: response.status || 'active',
				backupDueSeconds: nullableFinite(response.backup_due_seconds),
				message: response.message || ''
			};
			this.rideEngine.completeCrash('active');
			this.confirmIncidentCamera(response, payload);
			if (this.dom.crash.hidden) {
				this.state.crashReturnFocus = document.activeElement;
				this.state.crashInertElements = [this.dom.boot, this.dom.auth, this.dom.product, this.dom.activeRide, this.dom.dialog, this.dom.sheet]
					.filter((element) => element && element !== this.dom.crash && !element.hidden);
				this.state.crashInertElements.forEach((element) => element.setAttribute('inert', ''));
				this.dom.crash.hidden = false;
			}
			const countdownView = $('[data-crash-countdown-view]', this.dom.crash);
			const activeView = $('[data-crash-active]', this.dom.crash);
			const title = $('[data-crash-title]', this.dom.crash);
			const message = $('[data-emergency-message]', this.dom.crash);
			const status = $('[data-emergency-status]', this.dom.crash);
			if (countdownView) countdownView.hidden = true;
			if (activeView) activeView.hidden = false;
			if (title) title.textContent = 'Emergency Assist is active';
			if (message) message.textContent = 'A responder alert was accepted. Halo will keep sharing your ride position while this ride remains active.';
			if (status) status.textContent = nullableFinite(response.backup_due_seconds) !== null
				? `Status: ${text(response.status, 'active')}. Backup action is due in about ${Math.max(0, Math.round(response.backup_due_seconds))} seconds.`
				: `Status: ${text(response.status, 'active')}.`;
			this.startEmergencyAssistPositionUpdates();
			this.updateEmergencyAssistPosition(payload.position || this.state.currentLocation);
			$('[data-emergency-call]', this.dom.crash)?.focus();
		}

		async sendNokAlert(test, button) {
			if (!test) return this.activateCrashAlert('manual', button);
			const scope = this.captureIdentityScope();
			this.setLoading(button, true);
			try {
				const location = await this.currentPositionForSafety();
				this.assertIdentityScope(scope);
				const response = await this.api.post('/safety/test-alert', { lat: location.lat, lng: location.lng });
				this.assertIdentityScope(scope);
				this.toast(response.message || 'Test alert accepted for your emergency contact.', 'success');
			} finally { this.setLoading(button, false); }
		}

		async currentPositionForSafety() {
			if (!navigator.geolocation) throw new HaloAPIError('Location is required to send a safety alert.');
			return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
				(position) => resolve({
					lat: position.coords.latitude,
					lng: position.coords.longitude,
					accuracy: position.coords.accuracy,
					altitude: position.coords.altitude,
					heading: position.coords.heading,
					speedMph: gpsMetresPerSecondToMph(position.coords.speed),
					at: Number(position.timestamp) || Date.now()
				}),
				(error) => reject(new HaloAPIError(error.code === 1 ? 'Allow location access before sending a safety alert.' : 'Halo could not obtain a reliable position for the alert.')),
				{ enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
			));
		}

		async saveSafety(form) {
			const scope = this.captureIdentityScope();
			const cameraWasEnabled = this.incidentCameraPreferences().enabled;
			this.setLoading(form, true);
			try {
				const values = this.formObject(form);
				if (values.emergency_assist_enabled && (!String(values.date_of_birth || '').trim() || !String(values.mobile || '').trim())) {
					throw new HaloAPIError('Add your date of birth and mobile number before enabling Emergency Assist.');
				}
				if (values.incident_camera_enabled && !values.emergency_assist_enabled) {
					throw new HaloAPIError('Enable Emergency Assist before enabling the incident camera.');
				}
				if (values.nok_alerts && !values.date_of_birth) throw new HaloAPIError('Add your date of birth before enabling automatic incident alerts.');
				const assistToggle = form.elements.emergency_assist_enabled;
				const consentRenewalPending = assistToggle?.dataset.consentRenewal === 'true' && !assistToggle.checked;
				const medicalToggle = form.elements.medical_sharing;
				const medicalRenewalPending = medicalToggle?.dataset.consentRenewal === 'true' && !medicalToggle.checked;
				const cameraToggle = form.elements.incident_camera_enabled;
				const cameraRenewalPending = cameraToggle?.dataset.consentRenewal === 'true' && !cameraToggle.checked;
				const cameraOffIntent = !cameraRenewalPending && !Boolean(values.incident_camera_enabled);
				let cameraShutdown = null;
				// Honour an explicit local camera-off choice before either settings request.
				// A failed save must not leave live capture running against that choice.
				if (cameraOffIntent) this.incidentCameraLocallyDisabled = true;
				if (cameraOffIntent && (cameraWasEnabled || this.incidentCameraEvidencePending())) {
					cameraShutdown = this.stopIncidentCameraCapture('camera-disabled-from-safety');
				}
					const payload = {
					mobile: values.mobile,
					nok_name: values.nok_name,
					nok_relation: values.nok_relationship,
					nok_mobile: values.nok_mobile,
					date_of_birth: values.date_of_birth,
					blood_type: values.blood_group,
					weight_kg: values.weight_kg === '' ? null : values.weight_kg,
					medical_notes: values.medical_notes,
					halo_nok_consent: Boolean(values.nok_alerts),
					halo_proxy: Boolean(values.proxy_consent),
						halo_law: Boolean(values.law_consent),
						halo_ai: Boolean(values.ai_consent)
					};
					const testRideToggle = form.elements.test_ride_monitoring_armed;
					const testRideInitiallyEnabled = testRideToggle?.dataset.initialEnabled === 'true';
					const testRideRequested = Boolean(values.test_ride_monitoring_armed);
					if (testRideRequested !== testRideInitiallyEnabled) {
						payload.test_ride_monitoring_armed = testRideRequested;
						payload.test_ride_monitoring_consent_version = values.test_ride_monitoring_consent_version;
					}
					// Stop sending positions as soon as an active rider explicitly switches
					// monitoring off. The Safety write below remains the authoritative,
					// audited server-side revocation and also closes any ambiguous session.
					if (testRideInitiallyEnabled && !testRideRequested && this.state.testRideTracking) {
						await this.stopTestRideMonitoring(false).catch(() => null);
					}
				// Do not silently revoke an older consent merely because a rider saved
				// unrelated safety details. Checking the renewed toggle submits the
				// exact displayed terms version and records a new affirmative event.
				if (!consentRenewalPending) {
					payload.emergency_assist_enabled = Boolean(values.emergency_assist_enabled);
					payload.emergency_assist_consent_version = values.emergency_assist_consent_version;
				}
				if (!medicalRenewalPending) {
					payload.halo_emergency = Boolean(values.medical_sharing);
					payload.medical_sharing_consent_version = values.medical_sharing_consent_version;
				}
				const response = await this.api.put('/safety', payload);
				this.assertIdentityScope(scope);
				this.state.customer.mobile = values.mobile;
				this.state.customer.mobile_number = values.mobile;
				if (this.state.boot.customer) {
					this.state.boot.customer.mobile = values.mobile;
					this.state.boot.customer.mobile_number = values.mobile;
				}
				// Commit the first durable response before the separate camera request. If
				// that second request fails, local consent state must still reflect that
				// Emergency Assist has already been disabled on the server.
				this.state.boot.safety = response.safety || response;
				if (!this.emergencyAssistEnabled() && !cameraShutdown && (cameraWasEnabled || this.incidentCameraEvidencePending())) {
					this.incidentCameraLocallyDisabled = true;
					cameraShutdown = this.stopIncidentCameraCapture('assist-disabled-from-safety');
				}
				if (cameraShutdown) {
					await cameraShutdown.stopPromise;
					this.assertIdentityScope(scope);
				}
				let cameraResponse = null;
				if (!cameraRenewalPending) {
					cameraResponse = await this.api.put('/safety/incident-camera', {
						enabled: Boolean(values.incident_camera_enabled),
						dual_enabled: Boolean(values.incident_camera_enabled && values.incident_camera_dual_enabled),
						consent_version: values.incident_camera_consent_version
					});
					this.assertIdentityScope(scope);
				}
				if (cameraResponse) {
					this.incidentCameraLocallyDisabled = cameraResponse.enabled !== true;
					this.state.boot.safety.incident_camera = cameraResponse;
					this.state.boot.safety.incident_camera_enabled = Boolean(cameraResponse.enabled);
					this.state.boot.safety.incident_camera_dual_enabled = Boolean(cameraResponse.dual_enabled);
					if (this.state.boot.safety.consents) this.state.boot.safety.consents.incident_camera = Boolean(cameraResponse.enabled);
				}
				this.renderSafety();
				this.sendPresence(true, this.state.activeRide && this.emergencyAssistEnabled()).catch(() => null);
				this.toast('Safety settings saved.', 'success');
			} finally { this.setLoading(form, false); }
		}

		async withdrawSafetyConsent(kind, button) {
			const scope = this.captureIdentityScope();
			const isCamera = kind === 'camera';
			let localCameraShutdown = null;
			if (isCamera || kind === 'assist') {
				this.incidentCameraLocallyDisabled = true;
				localCameraShutdown = this.stopIncidentCameraForConsentWithdrawal(isCamera ? 'camera-consent-withdrawn' : 'assist-consent-withdrawn');
			}
			this.setLoading(button, true);
			try {
				const payload = kind === 'medical'
					? { halo_emergency: false }
					: isCamera
						? { enabled: false, dual_enabled: false, consent_version: text(this.state.boot?.safety?.incident_camera?.required_consent_version, '1') }
						: { emergency_assist_enabled: false };
				const response = isCamera
					? await this.api.put('/safety/incident-camera', payload)
					: await this.api.put('/safety', payload);
				this.assertIdentityScope(scope);
				if (isCamera) {
					this.state.boot.safety = this.state.boot.safety || {};
					this.state.boot.safety.incident_camera = response;
					this.state.boot.safety.incident_camera_enabled = false;
					this.state.boot.safety.incident_camera_dual_enabled = false;
					if (this.state.boot.safety.consents) this.state.boot.safety.consents.incident_camera = false;
				} else {
					this.state.boot.safety = response.safety || response;
				}
				if (localCameraShutdown) await localCameraShutdown;
				this.renderSafety();
				this.sendPresence(true, kind === 'medical' || isCamera ? Boolean(this.state.activeRide && this.emergencyAssistEnabled()) : false).catch(() => null);
				const message = kind === 'medical'
					? 'Previous medical-information consent withdrawn.'
					: isCamera ? 'Previous incident-camera consent withdrawn.' : 'Previous Emergency Assist consent withdrawn.';
				this.toast(message, 'success');
			} finally {
				this.setLoading(button, false);
			}
		}

		async saveProfile(form) {
			const scope = this.captureIdentityScope();
			this.setLoading(form, true);
			try {
				const response = await this.api.put('/profile', this.formObject(form));
				this.assertIdentityScope(scope);
				this.state.customer = response.customer || response.profile || response || Object.assign({}, this.state.customer, this.formObject(form));
				if (this.state.boot.customer) this.state.boot.customer = this.state.customer;
				this.renderHome();
				this.renderMore();
				this.renderProfile();
				$('[data-avatar-initials]', root).textContent = initials(this.state.customer.full_name || this.state.customer.name);
				this.toast('Profile saved.', 'success');
			} finally { this.setLoading(form, false); }
		}

		async changePin(form) {
			const scope = this.captureIdentityScope();
			const values = this.formObject(form);
			if (!isSixDigitPin(values.current_pin) || !isSixDigitPin(values.new_pin)) throw new HaloAPIError('Both PINs must contain exactly six digits.');
			if (values.current_pin === values.new_pin) throw new HaloAPIError('Choose a different six-digit PIN.');
			this.setLoading(form, true);
			try {
				await this.api.post('/profile/pin', values);
				this.assertIdentityScope(scope);
				form.reset();
				this.toast('Your six-digit PIN has been updated.', 'success');
			} finally { this.setLoading(form, false); }
		}

		async saveRideProfile(form) {
			const scope = this.captureIdentityScope();
			this.setLoading(form, true);
			try {
				const submitted = this.formObject(form);
				const response = await this.api.put(`/vehicles/${encodeURIComponent(this.state.vehicle?.id || '')}/ride-profiles`, submitted);
				this.assertIdentityScope(scope);
				/* factory_profile preserves the exact Profile A–E + regen contract;
				 * ride_profile is a friendly backend summary and must not replace it. */
				this.state.vehicle.ride_profiles = response.factory_profile || response.ride_profiles || submitted;
				this.renderVehicle();
				this.toast(response.applied ? 'Ride profile saved and queued for your motorcycle.' : 'Ride profile preference saved.', 'success');
			} finally { this.setLoading(form, false); }
		}

		openApprovedUsedForm() {
			const paints = ['Silverstone Gloss Metallic Black', 'Brands Hatch Blue', 'Thruxton Racing Red', 'Snetterton Gloss White', 'Oulton Black', 'Knockhill Blue', 'Donnington Grey', 'Cadwell Green', 'Personality Colour'];
			this.openSheet('Add approved used', `<form id="halo-approved-used-form" class="halo-view-content"><p class="halo-card-copy">Enter the details from the motorcycle and your ownership document. Avenrà will verify the link before vehicle services become active.</p><section class="halo-card halo-card--flat"><div class="halo-field-row"><label class="halo-field"><span>Model</span><select name="model" required><option value="">Choose model</option><option value="Avenrà ONE">Avenrà ONE</option><option value="Avenrà R">Avenrà R</option><option value="Avenrà EVO">Avenrà EVO</option></select></label><label class="halo-field"><span>Colour</span><input type="text" name="color" list="halo-paint-options" autocomplete="off" required><datalist id="halo-paint-options">${paints.map((paint) => `<option value="${escapeAttr(paint)}"></option>`).join('')}</datalist></label></div><label class="halo-field"><span>Registration</span><input type="text" name="registration" maxlength="10" autocapitalize="characters" required></label><label class="halo-field"><span>Complete 17-character VIN</span><input type="text" name="vin" minlength="17" maxlength="17" pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{17}" autocapitalize="characters" required></label><div class="halo-field-row"><label class="halo-field"><span>Current mileage</span><input type="number" name="current_mileage" min="0" step="1" inputmode="numeric" required></label><label class="halo-field"><span>First registered</span><input type="date" name="first_registration_date" required></label></div><label class="halo-field"><span>Last service <small>(optional)</small></span><input type="date" name="last_service_date"></label></section><button type="submit" class="halo-button halo-button--primary">Submit for verification</button></form>`);
		}

		async submitApprovedUsed(form) {
			const scope = this.captureIdentityScope();
			this.setLoading(form, true);
			try {
				const response = await this.api.post('/vehicles/claim', this.formObject(form));
				this.assertIdentityScope(scope);
				this.dom.sheet.close();
				this.toast(response.message || 'Motorcycle submitted for verification.', 'success');
				await this.bootstrap({ silent: true });
			} finally { this.setLoading(form, false); }
		}

		openConfiguredLink(key) {
			const links = this.state.boot?.links || {};
			const url = safeUrl(links[key] || CONFIG.links?.[key]);
			if (!url) throw new HaloAPIError('That service is not available in Halo right now.');
			window.location.assign(url);
		}

		openConnectionDetail() {
			if (!this.state.vehicle || this.state.lifecycle !== 'owner') {
				this.openSheet('Halo status', '<p class="halo-card-copy">Your profile is ready. Vehicle connection will appear after an Avenrà motorcycle is linked.</p>');
				return;
			}
			this.openSheet('HyperCore', `<section class="halo-card halo-card--flat halo-hypercore-overview" data-hypercore-summary>${this.hypercoreSummaryHTML()}</section>
				<section class="halo-card halo-card--flat halo-hypercore-component halo-ecu-card" data-ecu-card>${this.ecuCardContentHTML()}</section>
				<section class="halo-card halo-card--flat halo-hypercore-component halo-bms-card" data-bms-card>${this.bmsCardContentHTML()}</section>`);
		}

		openVehicleSecurity() {
			if (!this.state.vehicle) throw new HaloAPIError('No motorcycle is linked.');
			const security = this.state.vehicle.security || {};
			const commandEndpoint = security.command_endpoint || this.state.boot?.endpoints?.security_command || '';
			const commands = commandEndpoint ? asArray(security.available_commands || this.state.boot?.features?.security_commands) : [];
			const commandButtons = commands.length ? commands.map((command) => {
				const value = typeof command === 'string' ? command : command.id;
				const label = typeof command === 'string' ? command.replace(/_/g, ' ') : command.label;
				return `<button type="button" class="halo-button halo-button--secondary" data-action="security-command" data-command="${escapeAttr(value)}">${escapeHTML(label)}</button>`;
			}).join('') : '<p class="halo-helper">Remote security controls are not enabled for this motorcycle.</p>';
			this.openSheet('Vehicle security', `<section class="halo-card halo-card--flat"><div class="halo-card-header"><div><p class="halo-card-kicker">CURRENT STATUS</p><h2>${escapeHTML(security.label || security.status || 'Status unavailable')}</h2></div>${security.status ? `<span class="halo-badge ${security.status === 'secure' || security.locked ? 'halo-badge--good' : 'halo-badge--attention'}">${escapeHTML(security.status)}</span>` : ''}</div>${security.last_location_label ? `<p class="halo-card-copy">Last parked near ${escapeHTML(security.last_location_label)}.</p>` : '<p class="halo-card-copy">Location is shown only when Sentinel data is available.</p>'}</section><div class="halo-button-stack">${commandButtons}</div>`);
		}

		async sendSecurityCommand(command, button) {
			const scope = this.captureIdentityScope();
			if (!command) return;
			const endpoint = this.state.vehicle?.security?.command_endpoint || this.state.boot?.endpoints?.security_command || '';
			if (!endpoint || !String(endpoint).startsWith('/')) throw new HaloAPIError('Remote security controls are not enabled for this motorcycle.');
			this.setLoading(button, true);
			try {
				const response = await this.api.post(endpoint, { vehicle_id: this.state.vehicle?.id, command });
				this.assertIdentityScope(scope);
				if (response.security) this.state.vehicle.security = response.security;
				this.dom.sheet.close();
				this.renderHome();
				this.toast(response.message || 'Security command confirmed.', 'success');
			} finally { this.setLoading(button, false); }
		}

		async refreshVehicleStatus(showToast) {
			if (!this.state.vehicle || !navigator.onLine) return;
			const scope = this.captureIdentityScope();
			try {
				const response = await this.api.get('/bootstrap');
				this.assertIdentityScope(scope);
				await this.acceptBootstrap(response);
				this.renderAll();
				if (this.dom.sheet.open) this.dom.sheet.close();
				if (showToast) this.toast('Vehicle status refreshed.', 'success');
			} catch (error) {
				if (error.code === 'stale_identity') return;
				if (showToast) this.handleError(error);
			}
		}

		async shareDiagnostics(button) {
			const scope = this.captureIdentityScope();
			const endpoint = this.state.vehicle?.diagnostics?.share_endpoint || this.state.boot?.endpoints?.diagnostics_share || '';
			if (!endpoint || !String(endpoint).startsWith('/')) throw new HaloAPIError('Diagnostic sharing is not enabled for this motorcycle.');
			this.setLoading(button, true);
			try {
				const response = await this.api.post(endpoint, { vehicle_id: this.state.vehicle?.id });
				this.assertIdentityScope(scope);
				this.toast(response.message || `Diagnostic summary shared${response.reference ? ` · ${response.reference}` : ''}.`, 'success');
			} finally { this.setLoading(button, false); }
		}

		contactSupport() {
			const support = this.state.boot?.support || CONFIG.support || {};
			const configured = support.url || this.state.boot?.links?.support || CONFIG.links?.support;
			const link = safeUrl(configured, ['https:', 'mailto:', 'tel:']) || safeUrl(support.phone ? `tel:${support.phone}` : '', ['tel:']) || safeUrl(support.email ? `mailto:${support.email}` : '', ['mailto:']);
			if (!link) throw new HaloAPIError('Avenrà support details are not available right now.');
			window.location.assign(link);
		}

		async uploadVehiclePhoto(file, input) {
			const scope = this.captureIdentityScope();
			if (!this.state.vehicle) throw new HaloAPIError('No motorcycle is linked.');
			if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new HaloAPIError('Choose a JPG, PNG or WebP image.');
			const maxBytes = Number(CONFIG.maxVehiclePhotoMb || 8) * 1024 * 1024;
			if (file.size > maxBytes) throw new HaloAPIError(`Vehicle photos must be under ${Number(CONFIG.maxVehiclePhotoMb || 8)} MB.`);
			const body = new FormData();
			body.append('photo', file, file.name);
			body.append('vehicle_id', this.state.vehicle.id || '');
			input.disabled = true;
			this.toast('Uploading vehicle photo…');
			try {
				const endpoint = this.state.boot?.endpoints?.vehicle_photo || `/vehicles/${encodeURIComponent(this.state.vehicle.id || '')}/photo`;
				const response = await this.api.post(endpoint, body, { timeout: 45000 });
				this.assertIdentityScope(scope);
				const vehicle = response.vehicle || response;
				this.state.vehicle = Object.assign({}, this.state.vehicle, vehicle);
				if (this.state.boot?.vehicle) this.state.boot.vehicle = Object.assign({}, this.state.boot.vehicle, vehicle);
				let previewLoaded = true;
				try {
					await this.hydratePrivateVehiclePhoto(this.state.vehicle);
					this.assertIdentityScope(scope);
				} catch (error) {
					if (error.code === 'stale_identity') throw error;
					previewLoaded = false;
				}
				this.renderVehicle();
				this.renderHome();
				this.writeSessionSnapshot();
				this.toast(previewLoaded ? 'Vehicle photo updated.' : 'Vehicle photo saved securely. Refresh to load the preview.', 'success');
			} finally { input.disabled = false; input.value = ''; }
		}

		revokePrivateVehicleObjectUrls() {
			for (const objectUrl of this.privateVehicleObjectUrls) URL.revokeObjectURL(objectUrl);
			this.privateVehicleObjectUrls.clear();
		}

		async hydratePrivateVehiclePhoto(vehicle) {
			const endpoint = vehicle?.private_photo_endpoint;
			if (!endpoint) return vehicle;
			const scope = this.captureIdentityScope();
			const vehicleId = String(vehicle.id || '');
			const file = await this.api.download(endpoint, { timeout: 45000 });
			this.assertIdentityScope(scope);
			const objectUrl = URL.createObjectURL(file.blob);
			try {
				this.assertIdentityScope(scope);
				if (!this.state.vehicle || String(this.state.vehicle.id || '') !== vehicleId) {
					throw new HaloAPIError('This photo belongs to an earlier Halo vehicle.', 0, 'stale_identity');
				}
				this.revokePrivateVehicleObjectUrls();
				this.privateVehicleObjectUrls.add(objectUrl);
				this.state.vehicle.image_url = objectUrl;
				this.state.vehicle._private_image_object_url = objectUrl;
				this.renderVehicle();
				this.renderHome();
				return this.state.vehicle;
			} catch (error) {
				URL.revokeObjectURL(objectUrl);
				throw error;
			}
		}

		async uploadDocument(file, input) {
			const scope = this.captureIdentityScope();
			const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
			if (!allowed.includes(file.type)) throw new HaloAPIError('Choose a PDF, JPG, PNG or WebP document.');
			const maxMb = Number(CONFIG.maxDocumentSizeMb || this.state.boot?.limits?.document_mb || 10);
			if (file.size > maxMb * 1024 * 1024) throw new HaloAPIError(`Documents must be under ${maxMb} MB.`);
			const body = new FormData();
			body.append('file', file, file.name);
			body.append('label', file.name.replace(/\.[^.]+$/, ''));
			input.disabled = true;
			this.toast('Adding document…');
			try {
				const response = await this.api.post('/documents', body, { timeout: 45000 });
				this.assertIdentityScope(scope);
				const document = response.document || response;
				const documents = this.getDocuments();
				if (this.state.boot.documents) this.state.boot.documents = [document].concat(documents.filter((item) => item.id !== document.id));
				else {
					this.state.boot.glovebox = this.state.boot.glovebox || {};
					this.state.boot.glovebox.documents = [document].concat(documents.filter((item) => item.id !== document.id));
				}
				this.renderDocuments();
				this.toast('Document added to your Glovebox.', 'success');
			} finally { input.disabled = false; input.value = ''; }
		}

		async openDocument(documentId) {
			const scope = this.captureIdentityScope();
			const record = this.getDocuments().find((item) => String(item.id) === String(documentId));
			if (!record) throw new HaloAPIError('That document is no longer available.');
			const preview = window.open('', '_blank');
			if (preview) preview.opener = null;
			try {
				const file = await this.api.download(`/documents/${encodeURIComponent(documentId)}/download`, { timeout: 45000 });
				this.assertIdentityScope(scope);
				const objectUrl = URL.createObjectURL(file.blob);
				const filename = file.filename || record.original_filename || record.filename || record.title || 'halo-document';
				if (preview && !preview.closed) {
					preview.location.replace(objectUrl);
				} else {
					const link = window.document.createElement('a');
					link.href = objectUrl;
					link.target = '_blank';
					link.rel = 'noopener noreferrer';
					link.download = filename;
					link.click();
				}
				window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60 * 1000);
			} catch (error) {
				if (preview && !preview.closed) preview.close();
				throw error;
			}
		}

		confirmDeleteDocument(documentId) {
			const document = this.getDocuments().find((item) => String(item.id) === String(documentId));
			this.openDialog('Remove document?', `<p>This removes <strong>${escapeHTML(document?.title || document?.name || document?.original_filename || document?.filename || 'the document')}</strong> from your Halo Glovebox.</p><div class="halo-button-stack"><button type="button" class="halo-button halo-button--danger" data-action="confirm-delete-document" data-document-id="${escapeAttr(documentId)}">Remove document</button><button type="button" class="halo-button halo-button--secondary" data-action="close-dialog">Keep document</button></div>`, 'GLOVEBOX');
		}

		async deleteDocument(documentId, button) {
			const scope = this.captureIdentityScope();
			this.setLoading(button, true);
			try {
				await this.api.delete(`/documents/${encodeURIComponent(documentId)}`);
				this.assertIdentityScope(scope);
				const documents = this.getDocuments().filter((item) => String(item.id) !== String(documentId));
				if (this.state.boot.documents) this.state.boot.documents = documents;
				else this.state.boot.glovebox.documents = documents;
				this.dom.dialog.close();
				this.renderDocuments();
				this.toast('Document removed.', 'success');
			} finally { this.setLoading(button, false); }
		}

		async loadRides() {
			const scope = this.captureIdentityScope();
			const container = $('#halo-activity-content', root);
			if (container) container.innerHTML = '<div class="halo-skeleton halo-skeleton--hero" aria-label="Loading rides"></div>';
			try {
				const rides = await this.api.get('/rides?per_page=50');
				this.assertIdentityScope(scope);
				this.state.boot.rides = asArray(rides);
				if (!isObject(this.state.boot.activity)) this.state.boot.activity = {};
				this.state.boot.activity.rides = this.state.boot.rides;
				this.state.ridesLoaded = true;
				this.renderActivity();
			} catch (error) {
				if (error.code === 'stale_identity') return;
				this.renderActivity();
				this.handleError(error);
			}
		}

		async loadDocuments() {
			const scope = this.captureIdentityScope();
			const container = $('#halo-documents-content', root);
			if (container) container.innerHTML = '<div class="halo-skeleton halo-skeleton--hero" aria-label="Loading documents"></div>';
			try {
				const documents = await this.api.get('/documents');
				this.assertIdentityScope(scope);
				this.state.boot.documents = asArray(documents);
				this.state.documentsLoaded = true;
				this.renderDocuments();
			} catch (error) {
				if (error.code === 'stale_identity') return;
				this.renderDocuments();
				this.handleError(error);
			}
		}

		defaultManualSections() {
			return [
				{ title: 'High-voltage safety', paragraphs: ['Never open the battery enclosure or touch orange high-voltage cabling. Switch the motorcycle off, move away and contact Avenrà if the pack or cabling is damaged.', 'After a collision, do not charge or ride the motorcycle until it has been inspected.'] },
				{ title: 'Before every ride', paragraphs: ['Check tyre condition and pressure, brake operation, steering movement, lighting, mirrors, charge level and that no warning remains on the display.'] },
				{ title: 'Controls and ride profiles', paragraphs: ['The three-position handlebar selector uses the mappings recorded under Vehicle → Ride profile. Confirm the active mode on the vehicle display before moving away.', 'Regeneration changes deceleration when the throttle is released. Build familiarity in a safe area after changing it.'] },
				{ title: 'Charging', paragraphs: ['Park on a stable surface, switch the motorcycle off and inspect the connector before charging. Use only compatible, undamaged charging equipment and keep the connector dry.', 'Allow the battery and charging system to cool if Halo or the vehicle reports a temperature warning.'] },
				{ title: 'Service and faults', paragraphs: ['Stop riding if a red warning appears, braking or steering changes, or the motorcycle makes an unfamiliar mechanical noise. Use Vehicle → Service to contact Avenrà.', 'The complete model-specific manual is supplied through Halo when available.'] }
			];
		}

		async loadManual() {
			const scope = this.captureIdentityScope();
			const container = $('#halo-manual-content', root);
			if (container) container.innerHTML = '<div class="halo-skeleton halo-skeleton--hero" aria-label="Loading manual"></div>';
			let supplied = asArray(CONFIG.manualSections || (!this.state.boot?.manual?.is_quick_guide ? this.state.boot?.manual?.sections : null) || this.state.boot?.manual_sections);
			if (!supplied.length && navigator.onLine) {
				try {
					const response = await this.api.get('/manual');
					this.assertIdentityScope(scope);
					supplied = asArray(response.sections || response.manual?.sections || response);
				} catch (error) { if (error.code === 'stale_identity') return; /* A reviewed essential guide remains available when the model manual cannot load. */ }
			}
			this.assertIdentityScope(scope);
			const sections = supplied.length ? supplied : this.defaultManualSections();
			this.state.boot.manual = Object.assign({}, this.state.boot.manual || {}, { sections, is_quick_guide: !supplied.length });
			this.renderManual(sections);
		}

		async loadProducts() {
			const scope = this.captureIdentityScope();
			const container = $('#halo-boutique-content', root);
			if (container) container.innerHTML = '<div class="halo-skeleton halo-skeleton--hero" aria-label="Loading Boutique"></div>';
			try {
				const response = await this.api.get('/shop/catalog');
				this.assertIdentityScope(scope);
				const products = asArray(response.products || response.items || response);
				this.state.boot.boutique = Object.assign({}, this.state.boot.boutique || {}, { products });
				this.state.productsLoaded = true;
				this.renderBoutique(products);
			} catch (error) {
				if (error.code === 'stale_identity') return;
				this.renderBoutique([]);
				throw error;
			}
		}

		updateCartCount() {
			$$('[data-cart-count]', root).forEach((element) => { element.textContent = String(this.state.cart.count || 0); });
		}

		async addToCart(productId, button) {
			if (!productId) return;
			this.setLoading(button, true);
			try {
				const product = this.getProducts().find((item) => String(item.id || item.sku) === String(productId));
				if (!product || product.available === false) throw new HaloAPIError('That item is not currently available.');
				const items = this.state.cart.items.slice();
				const existing = items.find((item) => String(item.product_id || item.id) === String(productId));
				if (existing) existing.quantity = Math.min(10, (Number(existing.quantity) || 1) + 1);
				else items.push({ id: product.id, product_id: product.id, name: product.name, price: product.price, currency: product.currency || 'GBP', quantity: 1 });
				this.state.cart = this.normaliseCart({ items, currency: product.currency || this.state.cart.currency });
				this.saveLocalCart();
				this.updateCartCount();
				this.toast('Added to your basket.', 'success');
			} finally { this.setLoading(button, false); }
		}

		async openCart() {
			this.renderCartSheet();
		}

		renderCartSheet() {
			const cart = this.state.cart;
			if (!cart.items.length) {
				this.openSheet('Your basket', `<div class="halo-empty-state">${icon('bag')}<h2>Your basket is empty</h2><p>Browse the Boutique to add accessories and rider essentials.</p><button type="button" class="halo-button halo-button--primary" data-action="close-sheet">Continue browsing</button></div>`);
				return;
			}
			this.openSheet('Your basket', `<div class="halo-cart-list">${cart.items.map((item) => `<div class="halo-cart-line"><div><strong>${escapeHTML(item.name || item.product_name)}</strong><small>Quantity ${formatNumber(item.quantity || 1)}</small></div><span>${escapeHTML(this.formatMoney(item.line_total ?? item.total ?? item.price, item.currency || cart.currency))}</span><button type="button" class="halo-text-button halo-danger" data-action="remove-cart-item" data-line-id="${escapeAttr(item.line_id || item.id)}">Remove</button></div>`).join('')}</div><div class="halo-cart-total"><span>Total</span><strong>${escapeHTML(this.formatMoney(cart.total, cart.currency))}</strong></div><button type="button" class="halo-button halo-button--primary halo-full-width" data-action="checkout">Continue to secure checkout</button>`);
		}

		async removeCartItem(lineId, button) {
			this.setLoading(button, true);
			try {
				const items = this.state.cart.items.filter((item) => String(item.line_id || item.id || item.product_id) !== String(lineId));
				this.state.cart = this.normaliseCart({ items, currency: this.state.cart.currency });
				this.saveLocalCart();
				this.updateCartCount();
				this.renderCartSheet();
			} finally { this.setLoading(button, false); }
		}

		async checkout(button) {
			const scope = this.captureIdentityScope();
			this.setLoading(button, true);
			try {
				const response = await this.api.post('/shop/order-handoff', { items: this.state.cart.items.map((item) => ({ product_id: item.product_id || item.id, quantity: item.quantity || 1 })) });
				this.assertIdentityScope(scope);
				const url = safeUrl(response.checkout_url || response.url);
				if (url) {
					window.location.assign(url);
					return;
				}
				throw new HaloAPIError('Secure checkout is not available right now. Your basket has been kept.');
			} finally { this.setLoading(button, false); }
		}

		async openRideDetail(rideId) {
			const scope = this.captureIdentityScope();
			let ride = this.getRides().find((item, index) => String(item.id ?? item.ride_id ?? index) === String(rideId));
			if (!ride || !ride.details_loaded) {
				try { const response = await this.api.get(`/rides/${encodeURIComponent(rideId)}`); this.assertIdentityScope(scope); ride = response.ride || response; }
				catch (error) {
					if (error.code === 'stale_identity' || !ride) throw error;
				}
			}
			this.assertIdentityScope(scope);
			const energyKwh = finite(ride.energy_kwh) ?? (finite(ride.energy_wh) === null ? null : finite(ride.energy_wh) / 1000);
			const maxLean = finite(ride.max_lean_degrees) ?? Math.max(Number(ride.max_lean_left) || 0, Number(ride.max_lean_right) || 0);
			await this.maps.destroy('ride-detail');
			this.assertIdentityScope(scope);
			this.openDialog(ride.title || ride.destination || ride.end_location || 'Ride detail', `<div id="halo-ride-detail-map" class="halo-map halo-ride-detail-map"><div class="halo-map-state" data-map-state><p>Loading route</p></div></div><div class="halo-summary-grid" style="margin-top:16px"><div class="halo-summary-metric"><strong>${escapeHTML(formatMiles(ride.distance_miles, true))}</strong><small>Distance</small></div><div class="halo-summary-metric"><strong>${escapeHTML(formatDuration(ride.duration_seconds))}</strong><small>Time</small></div><div class="halo-summary-metric"><strong>${energyKwh === null ? '—' : `${formatNumber(energyKwh, { maximumFractionDigits: 1 })} kWh`}</strong><small>Energy</small></div></div><dl class="halo-spec-list" style="margin-top:14px"><div class="halo-spec-row"><dt>Date</dt><dd>${escapeHTML(formatDate(ride.started_at || ride.date))}</dd></div><div class="halo-spec-row"><dt>Top speed</dt><dd>${finite(ride.top_speed_mph) === null ? '—' : `${formatNumber(ride.top_speed_mph)} mph`}</dd></div><div class="halo-spec-row"><dt>Maximum lean</dt><dd>${maxLean === null ? '—' : `${formatNumber(maxLean)}°`}</dd></div></dl><button type="button" class="halo-button halo-button--secondary halo-full-width" data-action="share-ride" data-share-ride-id="${escapeAttr(rideId)}">Share ride</button>`, 'JOURNEY');
			const map = await this.maps.create('ride-detail', $('#halo-ride-detail-map', root), { mode: 'history', controls: false });
			this.assertIdentityScope(scope);
			if (map) await this.maps.call('ride-detail', ['showRoute', 'renderRoute'], [ride, { fit: true }]);
		}

		async shareRide(rideId, button) {
			const scope = this.captureIdentityScope();
			this.setLoading(button, true);
			try {
				const ride = this.getRides().find((item, index) => String(item.id ?? item.ride_id ?? index) === String(rideId)) || {};
				const endpoint = ride.share_endpoint || this.state.boot?.endpoints?.ride_share || `/rides/${encodeURIComponent(rideId)}/share`;
				const response = await this.api.post(endpoint, {});
				this.assertIdentityScope(scope);
				await this.sharePayload({ title: response.title || 'My Avenrà ride', text: response.text || 'A ride recorded with Avenrà Halo.', url: safeUrl(response.url || response.share_url) });
			} finally { this.setLoading(button, false); }
		}

			async shareLiveLocation(button, skipActiveCheck) {
				const scope = this.captureIdentityScope();
				if (!this.state.activeRide) throw new HaloAPIError('No ride is active.');
				if (this.state.liveTracking?.stopping) throw new HaloAPIError('Halo is still securely ending the previous live link. Reconnect to finish.');
				if (this.state.liveTracking) {
					const guardianCopy = this.state.liveTracking.guardian_enabled
						? `<p class="halo-guardian-active-note">${icon('shield')} <span><strong>Guardian recovery on</strong><small>${escapeHTML(this.state.liveTracking.guardian_label || 'Trusted contact')} can request a fresh update if the signal becomes delayed.</small></span></p>`
						: '<p class="halo-helper">Guardian recovery is off for this link.</p>';
					this.openSheet('Live ride sharing', `<article class="halo-callout">${icon('route')}<div><h3>Sharing is active</h3><p>Your latest location, mapped road and GPS ride speeds update while Halo Ride mode remains open. This link expires ${escapeHTML(formatDate(this.state.liveTracking.expires_at, { hour: '2-digit', minute: '2-digit' }))}.</p></div></article>${guardianCopy}<div class="halo-button-stack"><button type="button" class="halo-button halo-button--primary" data-action="reshare-live-location">Share link again</button><button type="button" class="halo-button halo-button--secondary halo-danger" data-action="stop-live-location">Stop sharing</button></div>`);
					return;
				}
				this.setLoading(button, true);
				try {
				if (!skipActiveCheck) {
					const overview = await this.api.get('/live-tracking');
					this.assertIdentityScope(scope);
					if (asArray(overview.sessions).length) {
						this.openLiveTrackingManager(overview);
							return;
						}
					}
					this.openLiveShareSetup();
				} finally { this.setLoading(button, false); }
			}

			openLiveShareSetup() {
				this.openSheet('Share this ride', `<form id="halo-live-share-form" class="halo-view-content">
					<article class="halo-callout halo-callout--dark">${icon('route')}<div><h3>Private live ride link</h3><p>Your location, current road and GPS ride speeds update while Halo Ride mode remains open. The link expires after four hours.</p></div></article>
					<section class="halo-card halo-card--flat halo-guardian-setup"><div class="halo-card-header"><div><p class="halo-card-kicker">OPTIONAL · PER LINK</p><h2>Halo Guardian</h2></div><span class="halo-badge">Off by default</span></div><p class="halo-card-copy">Allow one trusted contact to request a fresh GPS update if this link becomes delayed. This is not an emergency alert and does not share medical information.</p><div class="halo-toggle-row halo-toggle-row--featured"><div class="halo-toggle-copy"><strong>Guardian recovery</strong><small>Give this link a separate, revocable request key.</small></div><label class="halo-switch"><input type="checkbox" name="guardian_recovery_enabled"><span></span></label></div><div data-guardian-setup-details hidden><label class="halo-field"><span>Trusted-contact label</span><input type="text" name="guardian_label" minlength="2" maxlength="80" autocomplete="off" disabled placeholder="e.g. Mum, Dad or Alex"><small>Use a name you recognise. It appears on this ride link only.</small></label><div class="halo-guardian-capability-warning">${icon('warning')}<p><strong>This creates a more powerful link</strong><span>Anyone you give the Guardian-enabled link to can request a fresh location while it remains active. Share it only with the trusted contact named above.</span></p></div><div class="halo-guardian-privacy">${icon('lock')}<p><strong>Privacy by design</strong><span>The contact can ask for a location only while this private ride link is active. They cannot start a ride, see your Halo account or access emergency/medical details.</span></p></div></div></section>
					<button type="submit" class="halo-button halo-button--primary halo-full-width">Create & share private link</button>
				</form>`);
			}

			async createLiveTracking(form) {
				const scope = this.captureIdentityScope();
				if (!this.state.activeRide) throw new HaloAPIError('No ride is active.');
				const values = this.formObject(form);
				const guardianEnabled = Boolean(values.guardian_recovery_enabled);
				const guardianLabel = text(values.guardian_label).trim().slice(0, 80);
				if (guardianEnabled && guardianLabel.length < 2) {
					form.elements.guardian_label?.focus();
					throw new HaloAPIError('Add a trusted-contact label before enabling Guardian recovery.');
				}
				this.setLoading(form, true);
				try {
					const response = await this.api.post('/live-tracking', {
						lifetime_seconds: 14400,
						guardian_enabled: guardianEnabled,
						guardian_recovery_enabled: guardianEnabled,
						guardian_label: guardianEnabled ? guardianLabel : ''
					});
					this.assertIdentityScope(scope);
					const url = safeUrl(response.tracking_url || response.share_url || response.url);
					if (!url) throw new HaloAPIError('Live-location sharing is not enabled for this ride.');
					let viewerToken = text(response.viewer_token);
					try { viewerToken = viewerToken || new URL(url).searchParams.get('track') || ''; } catch (error) { /* URL was already validated. */ }
					const enabled = response.guardian_enabled ?? response.guardian_recovery_enabled ?? guardianEnabled;
					this.state.liveTracking = {
						viewer_token: viewerToken,
						writer_token: text(response.writer_token),
						session_id: text(response.session_id || response.public_id),
						guardian_enabled: Boolean(enabled),
						guardian_label: Boolean(enabled) ? guardianLabel : '',
						tracking_url: url,
						expires_at: response.expires_at,
						sequence: Math.max(0, Number(response.last_sequence) || 0),
						last_sent_at: 0,
						updating: false,
						last_recovery_request_id: ''
					};
					if (!this.state.liveTracking.viewer_token || !this.state.liveTracking.writer_token) throw new HaloAPIError('Halo did not return secure live-sharing keys.');
					if (this.dom.sheet.open) this.dom.sheet.close();
					if (this.state.currentLocation) await this.updateLiveTracking(this.state.currentLocation, true);
					if (this.state.liveTracking.guardian_enabled && this.state.liveTracking.session_id) this.startGuardianRecoveryPolling();
					this.assertIdentityScope(scope);
					const guardianText = this.state.liveTracking.guardian_enabled ? ` ${guardianLabel} can request a fresh update if the signal is delayed.` : '';
					await this.sharePayload({ title: 'My live Avenrà ride', text: `Follow my latest location, mapped road and GPS ride speeds while Halo is open.${guardianText} This private link expires ${formatDate(response.expires_at, { hour: '2-digit', minute: '2-digit' })}.`, url });
					this.assertIdentityScope(scope);
				} catch (error) {
					if (error.code === 'live_tracking_limit_reached') {
						const overview = await this.api.get('/live-tracking');
						this.assertIdentityScope(scope);
						this.openLiveTrackingManager(overview);
						return;
					}
					throw error;
				} finally { this.setLoading(form, false); }
			}

		openLiveTrackingManager(overview) {
			const sessions = asArray(overview?.sessions);
			const sessionRows = sessions.map((session, index) => {
				const started = formatDate(session.started_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
				const expires = formatDate(session.expires_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
				const activity = session.last_ping_at
					? `Last update ${formatDate(session.last_ping_at, { hour: '2-digit', minute: '2-digit' })}`
					: 'No location received yet';
				return `<div class="halo-spec-row"><dt>Link ${index + 1}<small>${escapeHTML(activity)}</small></dt><dd>${escapeHTML(started)}<small>Expires ${escapeHTML(expires)}</small></dd></div>`;
			}).join('');
			const createAnother = overview?.can_create
				? '<button type="button" class="halo-button halo-button--secondary" data-action="create-another-live-location">Keep links & create another</button>'
				: '';
			this.openSheet('Manage live links', `<article class="halo-callout">${icon('route')}<div><h3>${sessions.length} active ${sessions.length === 1 ? 'link' : 'links'}</h3><p>Halo found sharing links created earlier on this account. For privacy, their secret link and update keys are never returned after creation.</p></div></article><dl class="halo-spec-list">${sessionRows}</dl><div class="halo-button-stack"><button type="button" class="halo-button halo-button--primary" data-action="replace-live-location">End previous links & start new</button>${createAnother}<button type="button" class="halo-button halo-button--secondary halo-danger" data-action="end-all-live-location">End all live links</button></div>`);
		}

		async replaceLiveTracking(button) {
			const scope = this.captureIdentityScope();
			this.setLoading(button, true);
			try {
					await this.api.delete('/live-tracking', {});
					this.assertIdentityScope(scope);
					this.stopGuardianRecoveryPolling();
					this.state.liveTracking = null;
				if (this.dom.sheet.open) this.dom.sheet.close();
				await this.shareLiveLocation(button, true);
			} finally { this.setLoading(button, false); }
		}

		async endAllLiveTracking(notify, button) {
			const scope = this.captureIdentityScope();
			this.setLoading(button, true);
			try {
					const response = await this.api.delete('/live-tracking', {});
					this.assertIdentityScope(scope);
					this.stopGuardianRecoveryPolling();
					this.state.liveTracking = null;
				if (this.dom.sheet.open) this.dom.sheet.close();
				if (notify) this.toast(response.count ? `${response.count} live ${response.count === 1 ? 'link' : 'links'} ended.` : 'No active live links remain.', 'success');
			} finally { this.setLoading(button, false); }
		}

		async reshareLiveLocation(button) {
			if (!this.state.liveTracking) throw new HaloAPIError('Live sharing is not active.');
			this.setLoading(button, true);
			try {
				const guardianText = this.state.liveTracking.guardian_enabled ? ` ${this.state.liveTracking.guardian_label || 'My trusted contact'} can use this Guardian-enabled link to request a fresh location if the signal is delayed.` : '';
				await this.sharePayload({ title: 'My live Avenrà ride', text: `Follow my latest location, mapped road and GPS ride speeds while Halo is open.${guardianText} This private link expires ${formatDate(this.state.liveTracking.expires_at, { hour: '2-digit', minute: '2-digit' })}.`, url: this.state.liveTracking.tracking_url });
			} finally { this.setLoading(button, false); }
		}

			async updateLiveTracking(position, immediate) {
			const scope = this.captureIdentityScope();
			const tracking = this.state.liveTracking;
			if (!tracking || tracking.stopping || tracking.updating || !navigator.onLine || finite(position?.lat) === null || finite(position?.lng) === null) return;
			if (!immediate && Date.now() - tracking.last_sent_at < 10000) return;
			tracking.updating = true;
			tracking.sequence += 1;
			try {
				await this.api.post(`/live-tracking/${encodeURIComponent(tracking.viewer_token)}/position`, {
					writer_token: tracking.writer_token,
					sequence: tracking.sequence,
					lat: position.lat,
					lng: position.lng,
					speed_mph: position.speedMph ?? this.state.lastTelemetry?.speedMph ?? 0,
					top_speed_mph: this.state.lastTelemetry?.topSpeedMph ?? this.state.lastTelemetry?.top_speed_mph ?? position.speedMph ?? 0,
					road_name: this.state.currentRoadName || '',
					heading: position.heading ?? null,
					accuracy_m: position.accuracy ?? null
				});
				this.assertIdentityScope(scope);
				tracking.last_sent_at = Date.now();
			} catch (error) {
				if (error.code === 'stale_identity') return;
				/* Sequence numbers are never reused: a response may be lost after the
				 * server accepts an update. The next position must still be newer. */
					if (error.code === 'tracking_not_found' || error.code === 'tracking_ended') {
						this.stopGuardianRecoveryPolling();
						this.state.liveTracking = null;
					this.toast('Live sharing has ended.', 'error');
				}
				} finally { if (this.state.liveTracking === tracking) tracking.updating = false; }
			}

			startGuardianRecoveryPolling() {
				this.stopGuardianRecoveryPolling();
				const tracking = this.state.liveTracking;
				if (!tracking?.guardian_enabled || !tracking.session_id || !tracking.writer_token) return;
				this.state.guardianRecoveryTimer = window.setInterval(() => this.pollGuardianRecoveryStatus().catch(() => null), 15000);
				this.pollGuardianRecoveryStatus().catch(() => null);
			}

			stopGuardianRecoveryPolling() {
				window.clearInterval(this.state.guardianRecoveryTimer);
				this.state.guardianRecoveryTimer = null;
				this.state.guardianRecoveryInFlight = false;
			}

			async pollGuardianRecoveryStatus() {
				const tracking = this.state.liveTracking;
				if (!tracking?.guardian_enabled || !tracking.session_id || !tracking.writer_token || tracking.stopping || !navigator.onLine || this.state.guardianRecoveryInFlight) return;
				this.state.guardianRecoveryInFlight = true;
				const scope = this.captureIdentityScope();
				try {
					const response = await this.api.get(
						`/live-tracking/session/${encodeURIComponent(tracking.session_id)}/recovery-status`,
						{ headers: { 'X-Halo-Writer': tracking.writer_token }, timeout: 12000 }
					);
					this.assertIdentityScope(scope);
					if (this.state.liveTracking !== tracking) return;
					const recovery = isObject(response.recovery) ? response.recovery : (isObject(response.recovery_status) ? response.recovery_status : response);
					const recoveryStatus = text(recovery.status || response.recovery_status || response.guardian_recovery_status).toLowerCase();
					const requestId = text(recovery.request_id || response.request_id);
					if (!['requested', 'queued', 'pending', 'acknowledged'].includes(recoveryStatus) || !requestId || requestId === tracking.last_recovery_request_id) return;
					if (recoveryStatus !== 'acknowledged') {
						await this.api.post(
							`/live-tracking/session/${encodeURIComponent(tracking.session_id)}/recovery-ack`,
							{ writer_token: tracking.writer_token, request_id: requestId },
							{ headers: { 'X-Halo-Writer': tracking.writer_token } }
						);
					}
					this.assertIdentityScope(scope);
					tracking.last_recovery_request_id = requestId;
					this.rideEngine.restartGps();
					this.toast(`${tracking.guardian_label || 'Your trusted contact'} requested a fresh location. Halo is refreshing GPS.`, 'success');
					const position = await this.captureGuardianPosition().catch(() => null);
					if (position && this.state.liveTracking === tracking) await this.updateLiveTracking(position, true);
				} catch (error) {
					if (['tracking_not_found', 'tracking_ended'].includes(error.code) || [404, 410].includes(error.status)) this.stopGuardianRecoveryPolling();
					else if (error.code !== 'stale_identity' && CONFIG.debug) console.warn('Halo Guardian recovery polling failed.', error);
				} finally {
					this.state.guardianRecoveryInFlight = false;
				}
			}

			captureGuardianPosition() {
				if (!navigator.geolocation) return Promise.reject(new HaloAPIError('Location is not supported on this device.'));
				return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
					(position) => resolve({
						lat: Number(position.coords.latitude),
						lng: Number(position.coords.longitude),
						accuracy: nullableFinite(position.coords.accuracy),
						heading: nullableFinite(position.coords.heading),
						speedMph: gpsMetresPerSecondToMph(position.coords.speed) ?? 0,
						at: Number(position.timestamp) || Date.now()
					}),
					(error) => reject(new HaloAPIError(error.code === 1 ? 'Allow location access so Halo can answer the Guardian request.' : 'Halo could not obtain a fresh GPS position.')),
					{ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
				));
			}

			async stopLiveTracking(notify, button) {
			const scope = this.captureIdentityScope();
			const tracking = this.state.liveTracking;
			if (!tracking) return;
			this.setLoading(button, true);
			const endpoint = `/live-tracking/${encodeURIComponent(tracking.viewer_token)}`;
			try {
				if (!navigator.onLine) throw new HaloAPIError('Halo is offline.', 0, 'offline');
					await this.api.delete(endpoint);
					this.assertIdentityScope(scope);
					this.stopGuardianRecoveryPolling();
					this.state.liveTracking = null;
				if (this.dom.sheet.open) this.dom.sheet.close();
				if (notify) this.toast('Live sharing stopped.', 'success');
			} catch (error) {
				if (error.code === 'stale_identity') return;
					if (error.code === 'tracking_not_found') {
						this.stopGuardianRecoveryPolling();
						this.state.liveTracking = null;
					if (this.dom.sheet.open) this.dom.sheet.close();
					if (notify) this.toast('Live sharing has already ended.', 'success');
					return;
				}
				if (!this.isRetryableRideSave(error) || !this.state.customer?.id) throw error;
				tracking.stopping = true;
				this.stopGuardianRecoveryPolling();
				const expiry = new Date(tracking.expires_at).getTime();
				await this.queue.add({ endpoint, method: 'DELETE', payload: {}, customerId: this.state.customer.id, kind: 'live-tracking-revoke', viewerToken: tracking.viewer_token, expiresAt: Number.isFinite(expiry) ? expiry : Date.now() + (4 * 60 * 60 * 1000) });
				if (this.dom.sheet.open) this.dom.sheet.close();
				this.toast('Halo could not end the public link yet. Position updates have stopped; revocation is queued, and the link will expire automatically.', 'error');
				} finally { this.setLoading(button, false); }
			}

			maybePromptGuardianResume() {
				const sessionId = this.state.guardianResumeSessionId;
				if (!sessionId || this.state.guardianResumePrompted || !this.state.boot || this.state.boot.offline_snapshot || this.state.publicTrackingMode) return;
				this.state.guardianResumePrompted = true;
				this.openDialog('Share a fresh location?', `<div class="halo-guardian-resume-prompt">${icon('shield')}<p>A trusted contact used your private Halo Guardian link because its location became delayed.</p><p><strong>Only continue when it is safe to use your phone.</strong> Halo will start a high-accuracy location update and keep it active until you stop sharing.</p><div class="halo-button-stack"><button type="button" class="halo-button halo-button--primary" data-action="guardian-resume">Share fresh location</button><button type="button" class="halo-button halo-button--secondary" data-action="dismiss-guardian-resume">Not now</button></div><small>This request is not an emergency alert and does not contact emergency services.</small></div>`, 'HALO GUARDIAN');
			}

			dismissGuardianResumePrompt() {
				if (this.dom.dialog.open) this.dom.dialog.close();
				this.state.guardianResumeSessionId = '';
				this.clearGuardianResumeQuery();
				this.toast('Fresh-location sharing was not started.');
			}

			clearGuardianResumeQuery() {
				try {
					const url = new URL(window.location.href);
					url.searchParams.delete('guardian_resume');
					window.history.replaceState(window.history.state || {}, '', `${url.pathname}${url.search}${url.hash}`);
				} catch (error) { /* The query is non-secret and can expire server-side. */ }
			}

			async resumeGuardianLocation(button) {
				const scope = this.captureIdentityScope();
				const sessionId = this.state.guardianResumeSessionId;
				if (!sessionId) throw new HaloAPIError('This Guardian request is no longer available.');
				if (!navigator.onLine) throw new HaloAPIError('Reconnect before sharing a fresh location.', 0, 'offline');
				this.setLoading(button, true);
				try {
					const response = await this.api.post(`/live-tracking/session/${encodeURIComponent(sessionId)}/resume`, {});
					this.assertIdentityScope(scope);
					const writerToken = text(response.writer_token);
					if (!writerToken) throw new HaloAPIError('Halo could not create a secure Guardian update key.');
					this.state.guardianResumeSession = {
						session_id: sessionId,
						writer_token: writerToken,
						request_id: text(response.request_id),
						sequence: Math.max(0, Number(response.last_sequence) || 0),
						last_sent_at: 0,
						updating: false,
						top_speed_mph: 0,
						tracking_only: !this.state.activeRide
					};
					this.state.guardianResumeSessionId = '';
					this.clearGuardianResumeQuery();
					if (this.dom.dialog.open) this.dom.dialog.close();
					await this.startGuardianResumeTracking();
					this.assertIdentityScope(scope);
					this.toast('Halo Guardian location sharing is active.', 'success');
				} catch (error) {
					const resumed = this.state.guardianResumeSession;
					if (resumed?.writer_token) {
						await this.api.delete(
							`/live-tracking/session/${encodeURIComponent(resumed.session_id)}`,
							{ writer_token: resumed.writer_token },
							{ headers: { 'X-Halo-Writer': resumed.writer_token }, keepalive: true }
						).catch(() => null);
					}
					this.clearGuardianResumeTrackingLocal();
					if ([404, 410].includes(error.status) || ['tracking_not_found', 'tracking_ended'].includes(error.code)) {
						this.state.guardianResumeSessionId = '';
						this.clearGuardianResumeQuery();
					}
					throw error;
				} finally { this.setLoading(button, false); }
			}

			async startGuardianResumeTracking() {
				const session = this.state.guardianResumeSession;
				if (!session) return;
				if (!navigator.geolocation) throw new HaloAPIError('Location is not supported on this device.');
				const banner = $('#halo-guardian-sharing', root);
				if (banner) banner.hidden = false;
				root.classList.add('is-guardian-tracking');
				this.updateGuardianSharingStatus('Finding a precise GPS position…');
				if (this.state.activeRide) {
					this.rideEngine.restartGps();
					const position = await this.captureGuardianPosition();
					await this.updateGuardianResumePosition(position, true);
					return;
				}
				if (this.state.guardianResumeWatchId !== null) navigator.geolocation.clearWatch(this.state.guardianResumeWatchId);
				this.state.guardianResumeWatchId = navigator.geolocation.watchPosition(
					(position) => {
						const coords = position.coords || {};
						const point = {
							lat: Number(coords.latitude),
							lng: Number(coords.longitude),
							accuracy: nullableFinite(coords.accuracy),
							heading: nullableFinite(coords.heading),
							speedMph: gpsMetresPerSecondToMph(coords.speed) ?? 0,
							at: Number(position.timestamp) || Date.now()
						};
						if (finite(point.lat) === null || finite(point.lng) === null) return;
						this.state.currentLocation = point;
						this.updateGuardianResumePosition(point).catch((error) => {
							if (CONFIG.debug) console.warn('Guardian location update failed.', error);
						});
					},
					(error) => this.updateGuardianSharingStatus(error.code === 1 ? 'Location permission is required. Stop sharing, allow location, then open the Guardian link again.' : 'Waiting for a reliable GPS signal…', true),
					{ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
				);
			}

			updateGuardianSharingStatus(message, error) {
				const status = $('[data-guardian-sharing-status]', root);
				if (status && status.textContent !== message) status.textContent = message;
				const banner = $('#halo-guardian-sharing', root);
				if (banner) banner.classList.toggle('is-error', Boolean(error));
			}

			async updateGuardianResumePosition(position, immediate) {
				const session = this.state.guardianResumeSession;
				if (!session || session.updating || !navigator.onLine || finite(position?.lat) === null || finite(position?.lng) === null) return;
				if (!immediate && Date.now() - session.last_sent_at < 10000) return;
				session.updating = true;
				session.sequence += 1;
				const speed = Math.max(0, nullableFinite(position.speedMph ?? position.speed_mph) || 0);
				session.top_speed_mph = Math.max(session.top_speed_mph || 0, speed, nullableFinite(this.state.lastTelemetry?.topSpeedMph ?? this.state.lastTelemetry?.top_speed_mph) || 0);
				try {
					await this.api.post(
						`/live-tracking/session/${encodeURIComponent(session.session_id)}/position`,
						{
							writer_token: session.writer_token,
							sequence: session.sequence,
							lat: position.lat,
							lng: position.lng,
							speed_mph: speed,
							top_speed_mph: session.top_speed_mph,
							road_name: this.state.currentRoadName || '',
							heading: position.heading ?? null,
							accuracy_m: position.accuracy ?? null,
							request_id: session.request_id || ''
						},
						{ headers: { 'X-Halo-Writer': session.writer_token } }
					);
					if (this.state.guardianResumeSession !== session) return;
					session.last_sent_at = Date.now();
					this.updateGuardianSharingStatus(`Location shared ${formatDate(new Date(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.`);
				} catch (error) {
					if (['tracking_not_found', 'tracking_ended'].includes(error.code) || [404, 410].includes(error.status)) {
						this.clearGuardianResumeTrackingLocal();
						this.toast('This Guardian sharing session has ended.', 'error');
						return;
					}
					this.updateGuardianSharingStatus('A location update could not be sent. Halo will retry when the connection returns.', true);
					throw error;
				} finally {
					if (this.state.guardianResumeSession === session) session.updating = false;
				}
			}

			clearGuardianResumeTrackingLocal() {
				if (this.state.guardianResumeWatchId !== null) navigator.geolocation?.clearWatch(this.state.guardianResumeWatchId);
				this.state.guardianResumeWatchId = null;
				this.state.guardianResumeSession = null;
				const banner = $('#halo-guardian-sharing', root);
				if (banner) { banner.hidden = true; banner.classList.remove('is-error'); }
				root.classList.remove('is-guardian-tracking');
			}

			async stopGuardianResumeTracking(notify, button) {
				const session = this.state.guardianResumeSession;
				if (!session) { this.clearGuardianResumeTrackingLocal(); return; }
				this.setLoading(button, true);
				this.clearGuardianResumeTrackingLocal();
				try {
					await this.api.delete(
						`/live-tracking/session/${encodeURIComponent(session.session_id)}`,
						{ writer_token: session.writer_token },
						{ headers: { 'X-Halo-Writer': session.writer_token }, keepalive: true }
					);
					if (notify) this.toast('Guardian location sharing stopped.', 'success');
				} catch (error) {
					if (![404, 410].includes(error.status) && !['tracking_not_found', 'tracking_ended'].includes(error.code)) throw error;
					if (notify) this.toast('Guardian location sharing has already ended.', 'success');
				} finally { this.setLoading(button, false); }
			}

			async sharePayload(payload) {
			const scope = this.captureIdentityScope();
			if (navigator.share) {
				try { await navigator.share(payload); this.assertIdentityScope(scope); return; }
				catch (error) { if (error.name === 'AbortError') return; }
			}
			if (payload.url && navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(payload.url);
				this.assertIdentityScope(scope);
				this.toast('Share link copied.', 'success');
				return;
			}
			throw new HaloAPIError('Sharing is not available on this device.');
		}

		async recenterRideMap() {
			const handled = await this.maps.call('active', ['recenter', 'followUser', 'setFollow'], [true]);
			if (handled === null) this.rideEngine.recenter();
		}

		async overviewRideMap() {
			const handled = await this.maps.call('active', ['showOverview', 'fitRoute', 'fitBounds'], [this.state.activeRide?.route]);
			if (!handled) this.toast(this.state.activeRide?.freeRide ? 'Route overview is not available during a free ride.' : 'Route overview is unavailable on this map.', 'error');
		}

		async openWelcomePack(button) {
			const scope = this.captureIdentityScope();
			this.setLoading(button, true);
			try {
				let pack = this.state.boot?.welcome_pack || null;
				if (!pack) {
					const response = await this.api.get('/welcome-pack');
					this.assertIdentityScope(scope);
					pack = response.welcome_pack || response;
					this.state.boot.welcome_pack = pack;
					if (pack.support) this.state.boot.support = pack.support;
				}
				const sections = asArray(pack.sections || pack.items);
				const checklist = asArray(pack.checklist);
				const routes = { profile: 'more/profile', nok: 'more/safety', ride_profiles: 'vehicle', documents: 'more/documents' };
				const checklistContent = checklist.length ? `<section class="halo-card halo-card--flat"><p class="halo-card-kicker">GET READY</p><div class="halo-progress-track">${checklist.map((item, index) => `<div class="halo-progress-step ${item.complete ? 'is-complete' : index === checklist.findIndex((entry) => !entry.complete) ? 'is-current' : ''}"><div class="halo-progress-dot">${item.complete ? icon('check') : index + 1}</div><div class="halo-progress-copy"><strong>${escapeHTML(item.label)}</strong>${!item.complete && routes[item.id] ? `<button type="button" class="halo-text-button" data-route-target="${escapeAttr(routes[item.id])}" ${item.id === 'ride_profiles' ? 'data-vehicle-view="profile"' : ''}>Complete setup</button>` : '<small>Complete</small>'}</div></div>`).join('')}</div></section>` : '';
				const sectionsContent = sections.length ? `<div class="halo-accordion">${sections.map((section, index) => { const id = `halo-welcome-${index}`; return `<div class="halo-accordion-item"><button type="button" class="halo-accordion-button" aria-expanded="false" aria-controls="${id}"><span>${escapeHTML(section.title)}</span>${icon('chevron')}</button><div id="${id}" class="halo-accordion-panel" hidden><p>${escapeHTML(section.content || section.summary)}</p>${section.action_route ? `<button type="button" class="halo-button halo-button--secondary" data-route-target="${escapeAttr(section.action_route)}">${escapeHTML(section.action_label || 'Open')}</button>` : ''}</div></div>`; }).join('')}</div>` : '';
				const content = checklistContent || sectionsContent ? `${checklistContent}${sectionsContent}` : '<p class="halo-card-copy">Your Welcome Pack is not available yet.</p>';
				this.openDialog(pack.title || 'Welcome to Avenrà', content, 'WELCOME PACK');
			} finally { this.setLoading(button, false); }
		}

		isStandaloneApp() {
			return Boolean(
				window.matchMedia?.('(display-mode: standalone)').matches
				|| window.matchMedia?.('(display-mode: fullscreen)').matches
				|| window.navigator.standalone === true
				|| document.referrer.startsWith('android-app://')
			);
		}

		installPlatform() {
			const ua = `${navigator.userAgent || ''} ${navigator.userAgentData?.platform || navigator.platform || ''}`;
			if (window.WTN?.isAndroidApp === true || /Android[^;]*;[^)]*\bwv\b/i.test(ua)) return 'embedded-android';
			if (window.WTN?.isIosApp === true) return 'embedded-ios';
			const ios = /iPad|iPhone|iPod/i.test(ua) || (/Mac/i.test(ua) && navigator.maxTouchPoints > 1);
			if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua) ? 'ios-other' : 'ios-safari';
			if (/Android/i.test(ua)) {
				if (/SamsungBrowser/i.test(ua)) return 'android-samsung';
				if (/Firefox|FxiOS/i.test(ua)) return 'android-firefox';
				return 'android-chromium';
			}
			return 'desktop';
		}

		installGuidance() {
			const platform = this.installPlatform();
			const guidance = {
				'embedded-android': {
					intro: 'Home Screen installation and live HyperCore pairing need Halo to be opened in Chrome, outside this app wrapper.',
					steps: ['Open or copy this Halo page into Chrome.', 'In Chrome, open the browser menu.', 'Choose Install app and confirm Install.']
				},
				'embedded-ios': {
					intro: 'Home Screen installation must be completed in Safari, outside this app wrapper.',
					steps: ['Open or copy this Halo page into Safari.', 'Tap Safari\'s Share button.', 'Choose Add to Home Screen, then tap Add.']
				},
				'ios-safari': {
					intro: 'Safari installs Halo directly from its Share menu.',
					steps: ['Tap the Share button in Safari.', 'Scroll and choose Add to Home Screen.', 'Confirm the name Halo, then tap Add.']
				},
				'ios-other': {
					intro: 'Apple requires Home Screen installation to be completed in Safari.',
					steps: ['Open this page in Safari.', 'Tap Safari\'s Share button.', 'Choose Add to Home Screen, then tap Add.']
				},
				'android-samsung': {
					intro: 'Samsung Internet installs Halo from its browser menu.',
					steps: ['Open the Samsung Internet menu.', 'Choose Add page to.', 'Choose Home screen and confirm.']
				},
				'android-firefox': {
					intro: 'Firefox installs Halo from its browser menu.',
					steps: ['Open the Firefox menu.', 'Choose Install or Add to Home screen.', 'Confirm the installation.']
				},
				'android-chromium': {
					intro: 'Your Android browser installs Halo from its app menu.',
					steps: ['Open the browser menu.', 'Choose Install app or Add to Home screen.', 'Confirm Install.']
				},
				desktop: {
					intro: 'Install Halo from your browser for a dedicated app window.',
					steps: ['Look for the Install icon in the address bar.', 'Or open the browser menu and choose Install Halo.', 'Confirm Install.']
				}
			};
			return guidance[platform] || guidance.desktop;
		}

		updateInstallControls() {
			const installed = this.isStandaloneApp() || this.state.installState === 'installed';
			const ready = !installed && Boolean(this.state.installPrompt);
			const installing = !installed && this.state.installState === 'installing';
			this.state.installState = installed ? 'installed' : (ready ? 'prompt-ready' : (installing ? 'installing' : 'manual'));
			const buttonLabel = installing ? 'Installing Halo…' : 'Install Halo App';
			const hint = installing
				? 'Complete the browser installation prompt.'
				: ready
					? 'Add Halo to your Home Screen for fast, full-screen access.'
					: 'See the secure Home Screen steps for this browser.';
			$$('[data-install-surface]', root).forEach((surface) => { surface.hidden = installed; });
			$$('[data-install-control]', root).forEach((control) => {
				const waitingForPrompt = control.hasAttribute('data-install-retry') && !ready && !installing;
				control.dataset.installState = this.state.installState;
				control.disabled = installing || waitingForPrompt;
				control.setAttribute('aria-label', waitingForPrompt ? 'Waiting for Chrome installation' : buttonLabel);
			});
			$$('[data-install-button-label]', root).forEach((label) => {
				const control = label.closest('[data-install-control]');
				label.textContent = control?.hasAttribute('data-install-retry') && !ready && !installing ? 'Waiting for Chrome…' : buttonLabel;
			});
			$$('[data-install-label]', root).forEach((label) => { label.textContent = 'Install Halo App'; });
			$$('[data-install-hint]', root).forEach((label) => { label.textContent = hint; });
		}

		openInstallInstructions(installed) {
			const guidance = this.installGuidance();
			if (installed) {
				this.openSheet('Halo App installed', `<div class="halo-install-instructions halo-install-instructions--installed">${icon('check')}<h3>Halo is ready from your Home Screen</h3><p>Open the Halo icon for a focused, full-screen experience and faster access before a ride.</p><small>If you no longer see the icon, reinstall it using your browser's website or app menu.</small></div>`);
				return;
			}
			const canReceivePrompt = ['android-chromium', 'desktop'].includes(this.installPlatform());
			const retry = canReceivePrompt ? `<div class="halo-install-instructions__retry" data-install-surface><button type="button" class="halo-button halo-button--primary halo-full-width" data-action="install-app" data-install-control data-install-retry disabled><span data-install-button-label>Waiting for Chrome…</span></button><p>If Chrome makes direct installation available, this button will become active automatically.</p></div>` : '';
			this.openSheet('Install Halo App', `<div class="halo-install-instructions">${icon('home')}<div><p class="halo-eyebrow">ADD TO HOME SCREEN</p><h3>A dedicated Halo experience</h3><p>${escapeHTML(guidance.intro)}</p></div><ol>${guidance.steps.map((step) => `<li><span aria-hidden="true">${guidance.steps.indexOf(step) + 1}</span><p>${escapeHTML(step)}</p></li>`).join('')}</ol>${retry}<p class="halo-install-note">Installation does not change your Halo account or location permissions. Browser menu wording can vary by device.</p></div>`);
			this.updateInstallControls();
		}

		openInstallHandoff() {
			try {
				const cleanUrl = new URL(window.location.href);
				cleanUrl.searchParams.delete('install');
				window.history.replaceState(window.history.state, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
			} catch (error) { /* Installation remains available if URL cleanup is blocked. */ }

			if (this.isStandaloneApp() || this.state.installState === 'installed') {
				this.openInstallInstructions(true);
				return;
			}

			this.openSheet('Install Avenrà HALO', `<div class="halo-install-handoff" data-install-handoff>
				<div class="halo-install-handoff__mark">${icon('home')}</div>
				<div class="halo-install-handoff__intro"><p class="halo-eyebrow">HALO ON YOUR HOME SCREEN</p><h3>Ready when you ride</h3><p>Install HALO for focused, full-screen access to Ride, Safety, ownership and your unified HyperCore powertrain view.</p></div>
				<ul class="halo-install-handoff__benefits" aria-label="HALO app benefits"><li>${icon('check')}<span>One tap from your Home Screen</span></li><li>${icon('check')}<span>Automatic updates from Avenrà</span></li><li>${icon('check')}<span>HyperCore ECU and BMS together</span></li></ul>
				<p class="halo-install-handoff__compatibility">${icon('bluetooth')}<span><strong>For live HyperCore data</strong> Install with Chrome on a compatible Android phone, then allow Bluetooth access only when you choose to connect.</span></p>
				<div class="halo-install-handoff__action" data-install-surface><button type="button" class="halo-button halo-button--primary halo-full-width" data-action="install-app" data-install-control><span data-install-button-label>Install Halo App</span></button><p data-install-hint>Add Halo to your Home Screen for fast, full-screen access.</p></div>
				<p class="halo-install-note">HALO is installed directly from Avenrà. No APK download or separate app-store account is required.</p>
			</div>`);
			this.updateInstallControls();
		}

		async installApp(button) {
			if (this.isStandaloneApp() || this.state.installState === 'installed' || this.state.installInFlight) return;
			const prompt = this.state.installPrompt;
			if (!prompt) {
				this.openInstallInstructions(false);
				return;
			}
			this.state.installInFlight = true;
			this.state.installPrompt = null;
			this.setLoading(button, true);
			try {
				await prompt.prompt();
				const choice = await prompt.userChoice;
				this.state.installState = choice?.outcome === 'accepted' ? 'installing' : 'manual';
				if (choice?.outcome !== 'accepted') this.openInstallInstructions(false);
			} finally {
				this.state.installInFlight = false;
				this.setLoading(button, false);
				if (this.state.boot) this.renderMore();
				this.updateInstallControls();
			}
		}

			confirmLogout() {
				this.openDialog('Sign out of Halo?', '<p>You will need your email and six-digit PIN to sign in again on this device. Any active live-location links will end immediately. Private Ride Memories stay on this device and reappear only when this Halo account signs in again.</p><div class="halo-button-stack"><button type="button" class="halo-button halo-button--danger" data-action="confirm-logout">Sign out</button><button type="button" class="halo-button halo-button--secondary" data-action="close-dialog">Cancel</button></div>', 'ACCOUNT');
			}

		async logout(button) {
			this.setLoading(button, true);
			try {
				// Local privacy shutdown starts before the network request. The logout
				// request deliberately keeps its captured CSRF/customer headers and is
				// not cancelled when resetIdentityBoundState advances the local identity.
				const resetPromise = this.resetIdentityBoundState({ clearHash: true, preserveSnapshot: false });
				const logoutPromise = navigator.onLine
					? this.api.post('/auth/logout', {}, { identityBound: false, keepalive: true, csrfRetry: false })
					: Promise.reject(new HaloAPIError('Halo is offline and could not confirm server sign-out.', 0, 'offline'));
				const [resetResult, logoutResult] = await Promise.allSettled([resetPromise, logoutPromise]);
				if (resetResult.status === 'rejected') throw resetResult.reason;
				this.dom.boot.hidden = true;
				this.dom.product.hidden = true;
				this.dom.auth.hidden = false;
				root.dataset.appState = 'authentication';
				root.setAttribute('aria-busy', 'false');
				this.selectAuthView('login');
				this.updateInstallControls();
				if (logoutResult.status === 'fulfilled') {
					this.clearPendingEmergency();
					this.broadcastIdentityChange('logout');
				} else {
					this.setAuthAlert('Local camera and account access have stopped, but Halo could not confirm server sign-out. Reconnect and sign out again before leaving this device.', false);
				}
			} finally { this.setLoading(button, false); }
		}

		openDialog(title, content, eyebrow) {
			if (!this.dom.dialog) return;
			this.closeCameraAlignment('dialog-replaced');
			this.closeRideMemoryPlayer();
			if (this.dom.dialog.open) this.dom.dialog.close();
			$('[data-dialog-title]', this.dom.dialog).textContent = title || 'Details';
			const eyebrowElement = $('[data-dialog-eyebrow]', this.dom.dialog);
			eyebrowElement.textContent = eyebrow || '';
			eyebrowElement.hidden = !eyebrow;
			$('[data-dialog-content]', this.dom.dialog).innerHTML = content || '';
			if (typeof this.dom.dialog.showModal === 'function') this.dom.dialog.showModal();
			else this.dom.dialog.setAttribute('open', '');
		}

		openSheet(title, content) {
			if (!this.dom.sheet) return;
			if (this.dom.sheet.open) this.dom.sheet.close();
			$('[data-sheet-title]', this.dom.sheet).textContent = title || 'Details';
			$('[data-sheet-content]', this.dom.sheet).innerHTML = content || '';
			if (typeof this.dom.sheet.showModal === 'function') this.dom.sheet.showModal();
			else this.dom.sheet.setAttribute('open', '');
		}

		toast(message, type) {
			if (!message) return;
			const toast = document.createElement('div');
			toast.className = `halo-toast${type ? ` is-${type}` : ''}`;
			toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
			toast.innerHTML = `${icon(type === 'error' ? 'warning' : type === 'success' ? 'check' : 'activity')}<span>${escapeHTML(message)}</span>`;
			this.dom.toasts.appendChild(toast);
			window.setTimeout(() => {
				toast.style.opacity = '0';
				toast.style.transform = 'translateY(8px)';
				window.setTimeout(() => toast.remove(), 200);
			}, type === 'error' ? 6000 : 3800);
		}

		handleError(error, context) {
			if (CONFIG.debug) console.error(error);
			if (error?.code === 'stale_identity') return;
			if (['identity_mismatch', 'identity_context_required'].includes(error?.code)) {
				this.refreshSharedIdentity().catch((refreshError) => {
					if (CONFIG.debug) console.error(refreshError);
					this.showAuth('login').catch(() => {});
				});
				return;
			}
			if (error instanceof HaloSessionExpiredError || ['session_expired', 'authentication_required', 'not_authenticated'].includes(error.code)) {
				this.handleSessionExpired();
				return;
			}
			if (error?.code === 'stale_browser_session' && (context === 'auth' || !this.dom.auth.hidden)) {
				this.selectAuthView('login');
				const resetDeviceButton = $('[data-reset-device-session]', root);
				if (resetDeviceButton) resetDeviceButton.hidden = false;
				this.setAuthAlert(error.message || 'Reset this device session, then sign in again.');
				return;
			}
			if ((['session_cookie_failed', 'session_not_retained', 'csrf_cookie_failed', 'csrf_cookie_not_retained'].includes(error?.code) || error?.details?.reset_required === true) && (context === 'auth' || !this.dom.auth.hidden)) {
				const resetDeviceButton = $('[data-reset-device-session]', root);
				if (resetDeviceButton) resetDeviceButton.hidden = false;
				this.setAuthAlert(error.message || 'Halo could not retain the secure session. Reset this device session and try again.');
				return;
			}
				const reference = text(error?.details?.request_id);
				const baseMessage = error && error.message ? error.message : 'Halo could not complete that request.';
				const message = reference && !baseMessage.includes(reference) ? `${baseMessage} Reference: ${reference}.` : baseMessage;
			if (context === 'auth') this.setAuthAlert(message);
			else this.toast(message, 'error');
		}

		handleSessionExpired() {
			if (this.state.activeRide) {
				if (!this.state.sessionExpiryDeferred) {
					this.state.rideDegradedMessages = Object.assign({}, this.state.rideDegradedMessages, { session: 'Your Halo session expired. Ride recording can continue locally; sign in again after ending the ride.' });
					this.dom.connectivity.hidden = true;
					this.renderRideDegradedState();
					this.toast('Secure session expired. This ride will be kept on your device until you sign in again.', 'error');
				}
				this.state.isSessionExpired = true;
				this.state.sessionExpiryDeferred = true;
				return;
			}
			if (this.state.isSessionExpired && !this.state.sessionExpiryDeferred) return;
			this.state.isSessionExpired = true;
			this.state.sessionExpiryDeferred = false;
			this.dom.product.hidden = true;
			root.dataset.appState = 'session-expired';
			this.resetIdentityBoundState({ clearHash: true, preserveSnapshot: false })
				.then(() => this.openDialog('Session expired', '<p>Your secure Halo session has ended. Sign in again with your email and six-digit PIN.</p><button type="button" class="halo-button halo-button--primary halo-full-width" data-action="session-sign-in">Sign in again</button>', 'SECURITY'))
				.catch(() => this.openDialog('Session expired', '<p>Your secure Halo session has ended. Sign in again with your email and six-digit PIN.</p><button type="button" class="halo-button halo-button--primary halo-full-width" data-action="session-sign-in">Sign in again</button>', 'SECURITY'));
		}
	}

	const app = new AvenraHaloApp();
	window.AvenraHaloV2 = app;
	app.start();
}());
