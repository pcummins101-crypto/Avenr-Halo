(function () {
    'use strict';

    const TRANSITIONS = {
        idle: ['planning', 'ready', 'starting'],
        planning: ['ready', 'idle', 'error'],
        ready: ['planning', 'starting', 'idle'],
        starting: ['riding', 'idle', 'error'],
        riding: ['ending', 'error'],
        ending: ['pending-sync', 'completed', 'error'],
        'pending-sync': ['completed', 'starting', 'idle', 'error'],
        completed: ['planning', 'ready', 'starting', 'idle'],
        error: ['idle', 'starting'],
    };

    const nowIso = () => new Date().toISOString();
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const METRES_PER_SECOND_TO_MPH = 2.2369362921;
    const GPS_SPEED_CALIBRATION_FACTOR = 1.15;
    const toMph = metresPerSecond => metresPerSecond * METRES_PER_SECOND_TO_MPH;
    const calibrateGpsMph = rawMph => rawMph * GPS_SPEED_CALIBRATION_FACTOR;
    const gpsMetresPerSecondToMph = metresPerSecond => calibrateGpsMph(toMph(metresPerSecond));
    const makeId = () => window.crypto?.randomUUID?.() || `ride-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const rounded = (value, places = 5) => {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        if (!Number.isFinite(number)) return null;
        const factor = 10 ** places;
        return Math.round(number * factor) / factor;
    };

    function haversineMiles(a, b) {
        const earthMiles = 3958.7613;
        const toRad = value => value * Math.PI / 180;
        const dLat = toRad(b.lat - a.lat);
        const dLng = toRad(b.lng - a.lng);
        const value = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
        return earthMiles * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
    }

    function normaliseRoutePoint(value) {
        if (Array.isArray(value) && value.length >= 2) {
            if (value[0] === null || value[0] === undefined || value[0] === '' || value[1] === null || value[1] === undefined || value[1] === '') return null;
            const lng = Number(value[0]);
            const lat = Number(value[1]);
            return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
        }
        if (!value || typeof value !== 'object') return null;
        const rawLat = value.lat ?? value.latitude;
        const rawLng = value.lng ?? value.lon ?? value.longitude;
        if (rawLat === null || rawLat === undefined || rawLat === '' || rawLng === null || rawLng === undefined || rawLng === '') return null;
        const lat = Number(rawLat);
        const lng = Number(rawLng);
        return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    }

    class RideStore {
        constructor(name = 'avenra-halo-v2') {
            this.name = name;
            this.dbPromise = null;
            this.memory = new Map();
        }

        open() {
            if (this.dbPromise) return this.dbPromise;
            if (!('indexedDB' in window)) return Promise.resolve(null);
            this.dbPromise = new Promise(resolve => {
                const request = indexedDB.open(this.name, 1);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains('rides')) {
                        const store = db.createObjectStore('rides', { keyPath: 'id' });
                        store.createIndex('syncState', 'syncState', { unique: false });
                        store.createIndex('updatedAt', 'updatedAt', { unique: false });
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
                request.onblocked = () => resolve(null);
            });
            return this.dbPromise;
        }

        async put(record) {
            const memoryCopy = typeof window.structuredClone === 'function'
                ? window.structuredClone(record)
                : JSON.parse(JSON.stringify(record));
            this.memory.set(record.id, memoryCopy);
            const db = await this.open();
            if (!db) return record;
            return new Promise(resolve => {
                const request = db.transaction('rides', 'readwrite').objectStore('rides').put(record);
                request.onsuccess = () => resolve(record);
                request.onerror = () => resolve(record);
            });
        }

        async get(id) {
            const db = await this.open();
            if (!db) return this.memory.get(id) || null;
            return new Promise(resolve => {
                const request = db.transaction('rides').objectStore('rides').get(id);
                request.onsuccess = () => resolve(request.result || this.memory.get(id) || null);
                request.onerror = () => resolve(this.memory.get(id) || null);
            });
        }

        async pending() {
            const db = await this.open();
            if (!db) {
                const records = [...this.memory.values()];
                const interrupted = records.filter(record => record?.syncState === 'recording').map(record => this.recoverInterrupted(record));
                await Promise.all(interrupted.map(record => this.put(record)));
                return records.filter(record => record?.syncState === 'pending');
            }
            return new Promise(resolve => {
                const request = db.transaction('rides').objectStore('rides').getAll();
                request.onsuccess = async () => {
                    const records = request.result || [];
                    const interrupted = records.filter(record => record?.syncState === 'recording').map(record => this.recoverInterrupted(record));
                    await Promise.all(interrupted.map(record => this.put(record)));
                    resolve(records.filter(record => record?.syncState === 'pending'));
                };
                request.onerror = () => resolve([...this.memory.values()].map(record => this.recoverInterrupted(record)).filter(record => record?.syncState === 'pending'));
            });
        }

        recoverInterrupted(record) {
            if (!record || record.syncState !== 'recording') return record;
            const endedAt = record.updatedAt || nowIso();
            const startedAt = new Date(record.startedAt || endedAt).getTime();
            const endedTime = new Date(endedAt).getTime();
            const elapsed = Number.isFinite(startedAt) && Number.isFinite(endedTime)
                ? Math.max(0, Math.floor((endedTime - startedAt) / 1000))
                : 0;
            record.endedAt = endedAt;
            record.updatedAt = nowIso();
            record.syncState = 'pending';
            record.interrupted = true;
            record.metrics = {
                durationSeconds: elapsed,
                distanceMiles: 0,
                topSpeedMph: 0,
                maxLeanLeft: 0,
                maxLeanRight: 0,
                bestZeroToSixty: null,
                peakGForce: 0,
                harshEventCount: 0,
                telemetryQuality: 'limited',
                ...(record.metrics || {}),
            };
            return record;
        }

        async delete(id) {
            this.memory.delete(id);
            const db = await this.open();
            if (!db) return;
            return new Promise(resolve => {
                const request = db.transaction('rides', 'readwrite').objectStore('rides').delete(id);
                request.onsuccess = () => resolve();
                request.onerror = () => resolve();
            });
        }

        clearMemory() {
            this.memory.clear();
        }
    }

    class AvenraHaloRideEngine extends EventTarget {
        constructor(options = {}) {
            super();
            this.options = {
                highAccuracy: true,
                gpsTimeout: 15000,
                maximumAge: 1000,
                maxAccuracyMetres: 100,
                crashGThreshold: 2.5,
                crashCountdownSeconds: 20,
                maxTrackPoints: 12000,
                persistEveryPoints: 8,
                telemetryIntervalMs: 100,
                syncRide: null,
                ...options,
            };
            this.store = new RideStore(this.options.dbName || 'avenra-halo-v2-rides');
            this.state = 'idle';
            this.resetRuntime();
            this.onVisibility = () => {
                if (!document.hidden && this.state === 'riding') {
                    this.acquireWakeLock();
                    this.tickCrashCountdown();
                }
            };
            document.addEventListener('visibilitychange', this.onVisibility);
        }

        resetRuntime() {
            this.session = null;
			this.plannedRoute = null;
            this.watchId = null;
            this.wakeLock = null;
            this.telemetryTimer = null;
            this.lastPosition = null;
            this.lastAcceptedAt = 0;
            this.currentSpeed = 0;
            this.previousSpeed = 0;
            this.maxSpeed = 0;
            this.distanceMiles = 0;
            this.maxLeanLeft = 0;
            this.maxLeanRight = 0;
            this.lean = 0;
            this.orientationBaseline = null;
            this.orientationSnapshot = null;
            this.lastOrientationAt = 0;
            this.lastAcceleration = null;
            this.peakDynamicG = 0;
            this.harshEventCount = 0;
            this.lastHarshEventAt = 0;
            this.motionSamples = 0;
            this.orientationSamples = 0;
            this.gpsSamples = 0;
            this.accurateGpsSamples = 0;
            this.motionAvailable = false;
            this.orientationAvailable = false;
            this.zeroToSixtyStartedAt = null;
            this.bestZeroToSixty = null;
            this.pendingImpact = null;
            this.crashTimer = null;
            this.crashSeconds = 0;
            this.crashDeadline = 0;
            this.crashEventId = null;
            this.crashImpact = null;
            this.crashPhase = 'idle';
            this.lastCrashSecondEmitted = null;
            this.pointsSincePersist = 0;
            this.motionBound = false;
            this.motionPermissionPromise = this.motionPermissionPromise || null;
            this.guidanceRoute = null;
            this.guidanceStepIndex = 0;
            this.offRouteSamples = 0;
        }

        transition(next, detail = {}) {
            const allowed = TRANSITIONS[this.state] || [];
            if (!allowed.includes(next) && next !== this.state) {
                throw new Error(`Invalid ride state transition: ${this.state} to ${next}`);
            }
            const previous = this.state;
            this.state = next;
            this.emit('statechange', { previous, state: next, ...detail });
        }

        emit(type, detail = {}) {
            this.dispatchEvent(new CustomEvent(type, { detail }));
        }

        plan(route = null) {
            if (!['idle', 'ready', 'completed'].includes(this.state)) return false;
            if (this.state !== 'planning') this.transition('planning');
            this.plannedRoute = route;
            return true;
        }

        ready(route = this.plannedRoute) {
            if (!['idle', 'planning', 'completed'].includes(this.state)) return false;
            this.plannedRoute = route;
            this.transition('ready');
            return true;
        }

        async start(context = {}) {
            if (!['idle', 'ready', 'completed', 'pending-sync', 'error'].includes(this.state)) {
                throw new Error('A ride is already starting or active.');
            }
			const plannedRoute = context.route || this.plannedRoute || null;
			const identitySignal = context.signal || null;
			const assertIdentity = () => {
				if (identitySignal?.aborted) throw new DOMException('Halo identity changed.', 'AbortError');
			};
			assertIdentity();
            if (this.state !== 'starting') this.transition('starting');
            this.resetRuntime();
            this.state = 'starting';
			const suppliedRideId = String(context.clientRideId || context.rideId || '').trim();
			this.session = {
				id: /^[A-Za-z0-9._:-]{8,80}$/.test(suppliedRideId) ? suppliedRideId : makeId(),
                startedAt: nowIso(),
                endedAt: null,
                updatedAt: nowIso(),
                syncState: 'recording',
				context: {
					customerId: context.customerId || null,
					vehicleId: context.vehicleId || null,
					mode: Number(context.mode) || 2,
					rideMode: context.testRideMonitoring ? 'test' : (context.rideMode ?? context.mode ?? 2),
					testRideMonitoring: Boolean(context.testRideMonitoring),
					startSoc: clamp(Number(context.soc) || 100, 0, 100),
					route: plannedRoute,
                },
                points: [],
                metrics: {},
            };
            this.prepareGuidance(this.session.context.route);
            try {
                await this.store.put(this.session);
				assertIdentity();
                await this.enableMotion();
				assertIdentity();
                this.startGps();
                this.telemetryTimer = window.setInterval(() => this.publishTelemetry(), this.options.telemetryIntervalMs);
                this.transition('riding', { rideId: this.session.id });
                return this.session.id;
            } catch (error) {
				this.cleanupSensors();
				if (identitySignal?.aborted) {
					this.resetRuntime();
					this.store.clearMemory();
					this.state = 'idle';
				} else {
					this.transition('error', { code: 'start_failed', message: error.message });
				}
                throw error;
            }
        }

        requestMotionPermission() {
            if (this.motionPermissionPromise) return this.motionPermissionPromise;

            /* Both iOS permission prompts must be initiated before the first
             * asynchronous boundary of the rider's Start-button gesture. */
            const request = (eventClass) => {
                if (!eventClass || typeof eventClass.requestPermission !== 'function') return Promise.resolve('granted');
                try { return Promise.resolve(eventClass.requestPermission()); }
                catch (error) { return Promise.resolve('denied'); }
            };
            const motionRequest = request(typeof DeviceMotionEvent === 'undefined' ? null : DeviceMotionEvent);
            const orientationRequest = request(typeof DeviceOrientationEvent === 'undefined' ? null : DeviceOrientationEvent);
            this.motionPermissionPromise = Promise.allSettled([motionRequest, orientationRequest]).then((results) => {
                const granted = results.map(result => result.status === 'fulfilled' && result.value === 'granted');
                if (!granted[0]) this.emit('permission', { permission: 'motion', state: 'denied', optional: true });
                if (!granted[1]) this.emit('permission', { permission: 'orientation', state: 'denied', optional: true });
                return { motion: granted[0], orientation: granted[1] };
            });
            return this.motionPermissionPromise;
        }

        async enableMotion() {
            const permissions = await this.requestMotionPermission();
            if (permissions.motion) window.addEventListener('devicemotion', this.handleMotion, { passive: true });
            if (permissions.orientation) window.addEventListener('deviceorientation', this.handleOrientation, { passive: true });
            this.motionAvailable = Boolean(permissions.motion);
            this.orientationAvailable = Boolean(permissions.orientation);
            this.motionBound = Boolean(permissions.motion || permissions.orientation);
        }

        handleMotion = event => {
            if (this.state !== 'riding') return;
            const readAxes = acceleration => {
                if (!acceleration) return null;
                const raw = [acceleration.x, acceleration.y, acceleration.z];
                if (raw.some(value => value === null || value === undefined || value === '')) return null;
                const axes = raw.map(Number);
                return axes.every(Number.isFinite) ? axes : null;
            };
            const linearValues = readAxes(event.acceleration);
            const gravityValues = readAxes(event.accelerationIncludingGravity);
            const usingLinear = Boolean(linearValues);
            const values = usingLinear ? linearValues : gravityValues;
            if (!values) return;
            const gForce = Math.sqrt(values[0] ** 2 + values[1] ** 2 + values[2] ** 2) / 9.80665;
            // DeviceMotion may expose either linear acceleration or a vector
            // containing gravity. Store a comparable dynamic value for the ride
            // summary while preserving the raw resultant used by crash detection.
			const dynamicG = usingLinear ? gForce : Math.abs(gForce - 1);
			const sampledAt = Date.now();
			this.motionSamples += 1;
			if (this.currentSpeed >= 3) this.peakDynamicG = Math.max(this.peakDynamicG, dynamicG);
            if (this.currentSpeed >= 5 && dynamicG >= 0.65 && sampledAt - this.lastHarshEventAt >= 3000) {
                this.harshEventCount += 1;
                this.lastHarshEventAt = sampledAt;
            }
            this.lastAcceleration = {
                x: rounded(values[0], 3),
                y: rounded(values[1], 3),
                z: rounded(values[2], 3),
                resultantG: rounded(gForce, 3),
                dynamicG: rounded(dynamicG, 3),
                includesGravity: !usingLinear,
                intervalMs: rounded(event.interval, 1),
                at: sampledAt,
            };
            if (gForce < this.options.crashGThreshold || this.currentSpeed < 15) return;
            const recentTelemetry = this.compactTrace(this.session?.points || [], 18);
            const impactAt = Date.now();
            this.pendingImpact = {
                gForce,
                speedMph: this.currentSpeed,
                previousSpeedMph: this.previousSpeed,
                moving: this.currentSpeed >= 3,
                movingAtImpact: this.currentSpeed >= 3,
                movementState: this.currentSpeed >= 3 ? 'moving' : 'stationary',
                acceleration: { ...this.lastAcceleration },
                location: this.lastPosition ? { ...this.lastPosition, recordedAt: this.lastPosition.at } : null,
                orientation: this.orientationSnapshot ? { ...this.orientationSnapshot, leanDegrees: rounded(this.lean, 1) } : { leanDegrees: rounded(this.lean, 1) },
                leanDegrees: rounded(this.lean, 1),
                recentTrace: recentTelemetry.map(point => ({ lat: point.lat, lng: point.lng, at: point.at })),
                recentTelemetry,
                plannedRoute: this.plannedRouteSummary(),
                occurred_at: new Date(impactAt).toISOString(),
                at: impactAt,
            };
            if (gForce >= this.options.crashGThreshold * 1.8) this.raiseCrashCandidate(this.pendingImpact);
        };

        handleOrientation = event => {
            if (this.state !== 'riding') return;
            const timestamp = performance.now();
            if (timestamp - this.lastOrientationAt < 100) return;
            this.lastOrientationAt = timestamp;
            this.orientationSnapshot = {
                alpha: rounded(event.alpha, 1),
                beta: rounded(event.beta, 1),
                gamma: rounded(event.gamma, 1),
                absolute: Boolean(event.absolute),
                screenAngle: rounded(window.screen?.orientation?.angle ?? window.orientation, 0),
                screenType: String(window.screen?.orientation?.type || ''),
                at: Date.now(),
            };
            const landscape = Math.abs(Number(window.orientation) || 0) === 90;
            const rawValue = landscape ? event.beta : event.gamma;
            if (rawValue === null || rawValue === undefined || rawValue === '') return;
            const raw = Number(rawValue);
            if (!Number.isFinite(raw)) return;
            this.orientationSamples += 1;
            if (this.orientationBaseline === null && this.currentSpeed < 3) this.orientationBaseline = raw;
            const lean = clamp(raw - (this.orientationBaseline || 0), -65, 65);
            this.lean = lean;
            if (lean < 0) this.maxLeanLeft = Math.max(this.maxLeanLeft, Math.abs(lean));
            if (lean > 0) this.maxLeanRight = Math.max(this.maxLeanRight, lean);
        };

        startGps() {
            if (!navigator.geolocation) throw new Error('Location is not supported on this device.');
            this.watchId = navigator.geolocation.watchPosition(
                position => this.acceptPosition(position),
                error => this.emit('gps', {
                    state: error.code === 1 ? 'denied' : 'unavailable',
                    code: error.code,
                    message: error.code === 1 ? 'Location permission is required to record a ride.' : 'Waiting for a reliable GPS signal.',
                }),
                { enableHighAccuracy: this.options.highAccuracy, timeout: this.options.gpsTimeout, maximumAge: this.options.maximumAge }
            );
        }

        restartGps() {
            if (this.state !== 'riding' || !this.session || !navigator.geolocation) return false;
            if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
            this.emit('gps', { state: 'acquiring', reason: 'guardian_recovery' });
            try {
                this.startGps();
                return true;
            } catch (error) {
                this.emit('gps', { state: 'unavailable', reason: 'guardian_recovery', message: error.message });
                return false;
            }
        }

        acceptPosition(position) {
            if (this.state !== 'riding' || !this.session) return;
            const coords = position.coords;
            if (coords.latitude === null || coords.latitude === undefined || coords.longitude === null || coords.longitude === undefined) return;
            const next = {
                lat: Number(coords.latitude),
                lng: Number(coords.longitude),
                accuracy: Number(coords.accuracy) || null,
                altitude: coords.altitude !== null && coords.altitude !== undefined && Number.isFinite(Number(coords.altitude)) ? Number(coords.altitude) : null,
                heading: coords.heading !== null && coords.heading !== undefined && Number.isFinite(Number(coords.heading)) ? Number(coords.heading) : null,
                at: Number(position.timestamp) || Date.now(),
            };
            if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return;
            if (next.accuracy && next.accuracy > this.options.maxAccuracyMetres) {
                this.emit('gps', { state: 'weak', accuracy: next.accuracy });
                return;
            }
            this.gpsSamples += 1;
            if (!next.accuracy || next.accuracy <= 30) this.accurateGpsSamples += 1;

            let speed = coords.speed === null || coords.speed === undefined || coords.speed === '' ? null : Number(coords.speed);
            if (speed !== null && (!Number.isFinite(speed) || speed < 0)) speed = null;
            let rawMph = speed === null ? null : toMph(speed);
            if (this.lastPosition) {
                const elapsedHours = Math.max(0.000001, (next.at - this.lastPosition.at) / 3600000);
                const deltaMiles = haversineMiles(this.lastPosition, next);
                const impliedMph = deltaMiles / elapsedHours;
                if (impliedMph > 160 && (rawMph === null || rawMph < 140)) return;
                if (deltaMiles < 1) this.distanceMiles += deltaMiles;
                if (rawMph === null) rawMph = impliedMph;
            }

            if (rawMph === null || rawMph < 1.5) rawMph = 0;
            this.previousSpeed = this.currentSpeed;
			/* Apply Avenrà's vehicle-matched +15% GPS calibration once at the
			 * canonical speed boundary. Every downstream consumer—including the
			 * HUD, tracking, ride metrics and Ride Memories—then receives the same
			 * calibrated value, while distance remains based on raw GPS positions. */
            this.currentSpeed = Math.max(0, Math.round(calibrateGpsMph(rawMph)));
            this.maxSpeed = Math.max(this.maxSpeed, this.currentSpeed);
            this.trackAcceleration(next.at);

            this.lastPosition = next;
            this.lastAcceptedAt = next.at;
            const point = { ...next, speedMph: this.currentSpeed };
            this.session.points.push(point);
            if (this.session.points.length > this.options.maxTrackPoints) {
                this.session.points = this.session.points.filter((_, index) => index % 2 === 0);
            }
            this.pointsSincePersist += 1;
            if (this.pointsSincePersist >= this.options.persistEveryPoints) this.persistRecording();
            this.emit('position', { ...point, distanceMiles: this.distanceMiles });
            this.emit('gps', { state: 'ready', accuracy: next.accuracy });
            this.publishGuidance(next);

            if (this.pendingImpact && Date.now() - this.pendingImpact.at < 5000 && this.currentSpeed < 5) {
                this.raiseCrashCandidate(this.pendingImpact);
            } else if (this.pendingImpact && Date.now() - this.pendingImpact.at >= 5000) {
                this.pendingImpact = null;
            }
        }

        prepareGuidance(route) {
            if (!route || typeof route !== 'object') return null;
            let source = route.geometry || route.coordinates || route.route || [];
            if (typeof source === 'string') {
                try { source = JSON.parse(source); } catch (error) { return null; }
            }
            const stride = Math.max(1, Math.ceil((Array.isArray(source) ? source.length : 0) / 1600));
            const points = [];
            for (let index = 0; index < source.length; index += stride) {
                const point = normaliseRoutePoint(source[index]);
                if (point) points.push(point);
            }
            const finalPoint = normaliseRoutePoint(source[source.length - 1]);
            const lastPoint = points[points.length - 1];
            if (finalPoint && (!lastPoint || lastPoint.lat !== finalPoint.lat || lastPoint.lng !== finalPoint.lng)) points.push(finalPoint);
            if (points.length < 2) return null;

            const cumulative = [0];
            for (let index = 1; index < points.length; index += 1) {
                cumulative[index] = cumulative[index - 1] + haversineMiles(points[index - 1], points[index]) * 1609.344;
            }
            const durationSeconds = Number(route.duration_seconds ?? route.duration_s)
                || Number(route.duration_minutes ?? route.duration_min) * 60
                || 0;
            this.guidanceRoute = {
                points,
                cumulative,
                totalMetres: cumulative[cumulative.length - 1],
                durationSeconds,
                steps: Array.isArray(route.steps) ? route.steps : [],
                hazards: Array.isArray(route.hazards || route.focus_zones) ? (route.hazards || route.focus_zones) : [],
            };
            this.guidanceStepIndex = 0;
            this.offRouteSamples = 0;
            return this.guidanceRoute;
        }

        matchGuidancePosition(position) {
            const prepared = this.guidanceRoute;
            if (!prepared) return null;
            const cosLat = Math.cos(position.lat * Math.PI / 180);
            let closestDistance = Infinity;
            let distanceAlong = 0;
            for (let index = 1; index < prepared.points.length; index += 1) {
                const a = prepared.points[index - 1];
                const b = prepared.points[index];
                const x1 = (a.lng - position.lng) * 111320 * cosLat;
                const y1 = (a.lat - position.lat) * 110540;
                const x2 = (b.lng - position.lng) * 111320 * cosLat;
                const y2 = (b.lat - position.lat) * 110540;
                const dx = x2 - x1;
                const dy = y2 - y1;
                const lengthSquared = dx * dx + dy * dy;
                const t = lengthSquared > 0 ? clamp(-((x1 * dx) + (y1 * dy)) / lengthSquared, 0, 1) : 0;
                const distance = Math.hypot(x1 + t * dx, y1 + t * dy);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    distanceAlong = prepared.cumulative[index - 1]
                        + t * (prepared.cumulative[index] - prepared.cumulative[index - 1]);
                }
            }
            return { distanceFromRoute: closestDistance, distanceAlong };
        }

        publishGuidance(position) {
            const prepared = this.guidanceRoute;
            const match = this.matchGuidancePosition(position);
            if (!prepared || !match) return;
            while (this.guidanceStepIndex < prepared.steps.length - 1
                && Number(prepared.steps[this.guidanceStepIndex]?.distance_along_m) < match.distanceAlong + 18) {
                this.guidanceStepIndex += 1;
            }
            const remainingMetres = Math.max(0, prepared.totalMetres - match.distanceAlong);
            const remainingRatio = prepared.totalMetres > 0 ? remainingMetres / prepared.totalMetres : 0;
            const step = prepared.steps[this.guidanceStepIndex] || {
                instruction: remainingMetres < 45 ? 'You have arrived' : 'Continue on route',
                distance_along_m: prepared.totalMetres,
                type: remainingMetres < 45 ? 'arrive' : 'continue',
            };
            const currentStep = prepared.steps[Math.max(0, this.guidanceStepIndex - 1)] || step;
            const distanceMetres = Math.max(0, Number(step.distance_along_m ?? prepared.totalMetres) - match.distanceAlong);
            const modifier = String(step.modifier || step.maneuver?.modifier || '').toLowerCase();
            const type = String(step.type || step.maneuver?.type || '').toLowerCase();
            const manoeuvreSymbol = type.includes('roundabout') || type === 'rotary' ? '↻'
                : modifier.includes('left') ? '↰'
                    : modifier.includes('right') ? '↱'
                        : type === 'arrive' ? '●' : '↑';
            const threshold = Math.max(80, Math.min(180, Number(position.accuracy || 25) * 2));
            this.offRouteSamples = match.distanceFromRoute > threshold ? this.offRouteSamples + 1 : 0;
            const nextHazard = prepared.hazards.find(hazard => Number(hazard.distance_along_route_m) > match.distanceAlong + 20);
            this.emit('guidance', {
                instruction: step.instruction || step.voice || 'Continue',
                spoken_instruction: step.voice || step.instruction || 'Continue',
                current_road_name: currentStep.road_name || currentStep.name || '',
                road_name: step.road_name || step.name || '',
                manoeuvre: type || 'continue',
                manoeuvre_symbol: manoeuvreSymbol,
                distance_metres: distanceMetres,
                remaining_metres: remainingMetres,
                remaining_seconds: Math.max(0, Math.round(prepared.durationSeconds * remainingRatio)),
                eta: prepared.durationSeconds ? new Date(Date.now() + prepared.durationSeconds * remainingRatio * 1000).toISOString() : null,
                off_route: this.offRouteSamples >= 3,
                distance_from_route_metres: Math.round(match.distanceFromRoute),
                next_hazard: nextHazard || null,
                position: { ...position },
            });
        }

        trackAcceleration(timestamp) {
            if (this.currentSpeed === 0) {
                this.zeroToSixtyStartedAt = null;
                return;
            }
            if (this.previousSpeed === 0 && this.currentSpeed > 0) this.zeroToSixtyStartedAt = timestamp;
            if (this.zeroToSixtyStartedAt && this.currentSpeed >= 60) {
                const seconds = Math.round(((timestamp - this.zeroToSixtyStartedAt) / 1000) * 10) / 10;
                if (seconds > 0.5 && seconds < 30 && (this.bestZeroToSixty === null || seconds < this.bestZeroToSixty)) {
                    this.bestZeroToSixty = seconds;
                }
                this.zeroToSixtyStartedAt = null;
            }
        }

        publishTelemetry() {
            if (this.state !== 'riding' || !this.session) return;
            const started = new Date(this.session.startedAt).getTime();
            this.emit('telemetry', {
                rideId: this.session.id,
                durationSeconds: Math.max(0, Math.floor((Date.now() - started) / 1000)),
                speedMph: this.currentSpeed,
                topSpeedMph: this.maxSpeed,
                distanceMiles: this.distanceMiles,
                leanDegrees: this.lean,
                maxLeanLeft: this.maxLeanLeft,
                maxLeanRight: this.maxLeanRight,
                bestZeroToSixty: this.bestZeroToSixty,
                peakGForce: this.peakDynamicG,
                harshEventCount: this.harshEventCount,
                telemetryQuality: this.telemetryQuality(),
                position: this.lastPosition ? { ...this.lastPosition } : null,
                accuracy: this.lastPosition?.accuracy || null,
                gps_status: this.lastPosition ? 'Active' : 'Finding',
            });
        }

        async persistRecording() {
            if (!this.session) return;
            this.pointsSincePersist = 0;
            this.session.updatedAt = nowIso();
            this.session.metrics = this.metrics();
            await this.store.put(this.session);
        }

        metrics() {
            return {
                durationSeconds: this.session ? Math.max(0, Math.floor((Date.now() - new Date(this.session.startedAt).getTime()) / 1000)) : 0,
                distanceMiles: Math.round(this.distanceMiles * 100) / 100,
                topSpeedMph: this.maxSpeed,
                maxLeanLeft: Math.round(this.maxLeanLeft * 10) / 10,
                maxLeanRight: Math.round(this.maxLeanRight * 10) / 10,
                bestZeroToSixty: this.bestZeroToSixty,
                peakGForce: rounded(this.peakDynamicG, 3),
                harshEventCount: this.harshEventCount,
                telemetryQuality: this.telemetryQuality(),
            };
        }

        telemetryQuality() {
            const accurateRatio = this.gpsSamples > 0 ? this.accurateGpsSamples / this.gpsSamples : 0;
            if (this.gpsSamples >= 20 && this.motionSamples >= 50 && this.orientationSamples >= 20 && accurateRatio >= 0.6) {
                return 'high';
            }
            if (this.gpsSamples >= 5 && this.motionSamples >= 10) return 'medium';
            if (this.gpsSamples >= 5) return 'gps-only';
            return 'limited';
        }

        compactTrace(points = this.session?.points || [], maximum = 18) {
            const recent = Array.isArray(points) ? points.slice(-90) : [];
            if (!recent.length) return [];
            const limit = clamp(Number(maximum) || 18, 2, 24);
            const stride = Math.max(1, Math.ceil(recent.length / limit));
            const sampled = recent.filter((point, index) => index % stride === 0);
            const finalPoint = recent[recent.length - 1];
            if (sampled[sampled.length - 1] !== finalPoint) sampled.push(finalPoint);
            return sampled.slice(-limit).map(point => ({
                lat: rounded(point.lat, 5),
                lng: rounded(point.lng, 5),
                accuracy: rounded(point.accuracy, 1),
                altitude: rounded(point.altitude, 1),
                heading: rounded(point.heading, 0),
                speedMph: rounded(point.speedMph, 1),
                at: Number(point.at) || null,
            }));
        }

        plannedRouteSummary() {
            const route = this.session?.context?.route || this.plannedRoute;
            if (!route || typeof route !== 'object') return null;
            const preparedPoints = this.guidanceRoute?.points || [];
            const stride = Math.max(1, Math.ceil(preparedPoints.length / 12));
            const sampled = preparedPoints.filter((point, index) => index % stride === 0);
            const finalPoint = preparedPoints[preparedPoints.length - 1];
            if (finalPoint && sampled[sampled.length - 1] !== finalPoint) sampled.push(finalPoint);
            const limited = sampled.length > 12 && finalPoint ? [...sampled.slice(0, 11), finalPoint] : sampled;
            const points = limited.map(point => ({ lat: rounded(point.lat, 5), lng: rounded(point.lng, 5) }));
            return {
                id: route.id || route.route_id || null,
                title: route.title || route.name || route.destination_label || null,
                startLabel: route.start_label || route.origin_label || null,
                destinationLabel: route.destination_label || route.end_label || route.destination?.label || null,
                distanceMiles: rounded(route.distance_miles ?? route.distance, 2),
                durationSeconds: rounded(route.duration_seconds ?? route.duration_s ?? (Number(route.duration_minutes ?? route.duration_min) * 60), 0),
                profile: route.profile || route.route_profile || null,
                pointCount: preparedPoints.length,
                points,
            };
        }

        crashSnapshot(impact = {}) {
            const impactPosition = impact.location || impact.position;
            const hasImpactPosition = impactPosition?.lat !== null && impactPosition?.lat !== undefined && impactPosition?.lat !== ''
                && impactPosition?.lng !== null && impactPosition?.lng !== undefined && impactPosition?.lng !== ''
                && Number.isFinite(Number(impactPosition.lat)) && Number.isFinite(Number(impactPosition.lng));
            const positionSource = hasImpactPosition
                ? impactPosition
                : this.lastPosition;
            const position = positionSource ? {
                lat: rounded(positionSource.lat, 6),
                lng: rounded(positionSource.lng, 6),
                accuracy: rounded(positionSource.accuracy, 1),
                altitude: rounded(positionSource.altitude, 1),
                heading: rounded(positionSource.heading, 0),
                recordedAt: Number(positionSource.recordedAt ?? positionSource.at) || null,
            } : null;
            const acceleration = impact.acceleration || this.lastAcceleration;
            const orientationSource = impact.orientation || this.orientationSnapshot;
            const orientation = orientationSource ? {
                ...orientationSource,
                leanDegrees: rounded(orientationSource.leanDegrees ?? impact.leanDegrees ?? this.lean, 1),
            } : { leanDegrees: rounded(impact.leanDegrees ?? this.lean, 1) };
            const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            const recentTelemetry = Array.isArray(impact.recentTelemetry)
                ? impact.recentTelemetry.slice(-18)
                : this.compactTrace(this.session?.points || [], 18);
            return {
                event_id: this.crashEventId || impact.event_id || impact.id || makeId(),
                occurred_at: impact.occurred_at || impact.atIso || (impact.at !== null && impact.at !== undefined && impact.at !== '' && Number.isFinite(Number(impact.at)) ? new Date(Number(impact.at)).toISOString() : nowIso()),
                impact_timestamp: Number(impact.at) || Date.now(),
                deadline_at: this.crashDeadline ? new Date(this.crashDeadline).toISOString() : null,
                deadline_ms: this.crashDeadline || null,
                countdown_seconds: this.options.crashCountdownSeconds,
                rideId: this.session?.id || null,
                clientRideId: this.session?.id || null,
                vehicleId: this.session?.context?.vehicleId || null,
                location: position,
                position,
                speedMph: rounded(impact.speedMph ?? this.currentSpeed, 1),
                previousSpeedMph: rounded(impact.previousSpeedMph ?? this.previousSpeed, 1),
                moving: impact.moving ?? this.currentSpeed >= 3,
                movingAtImpact: (Number(impact.speedMph ?? this.currentSpeed) || 0) >= 3,
                movementState: impact.movementState || (this.currentSpeed >= 3 ? 'moving' : 'stationary'),
                peakG: rounded(impact.gForce ?? acceleration?.resultantG, 3),
                acceleration: acceleration ? { ...acceleration } : null,
                orientation,
                leanDegrees: rounded(impact.leanDegrees ?? orientation.leanDegrees ?? this.lean, 1),
                recentTrace: Array.isArray(impact.recentTrace) ? impact.recentTrace.slice(-18) : recentTelemetry.map(point => ({ lat: point.lat, lng: point.lng, at: point.at })),
                recentTelemetry,
                plannedRoute: impact.plannedRoute || this.plannedRouteSummary(),
                deviceState: impact.deviceState || {
                    online: navigator.onLine,
                    visibility: document.visibilityState || (document.hidden ? 'hidden' : 'visible'),
                    screenOrientation: String(window.screen?.orientation?.type || ''),
                    network: connection ? {
                        effectiveType: connection.effectiveType || null,
                        downlinkMbps: rounded(connection.downlink, 2),
                        rttMs: rounded(connection.rtt, 0),
                        saveData: Boolean(connection.saveData),
                    } : null,
                },
            };
        }

        raiseCrashCandidate(impact) {
            if (this.crashPhase !== 'idle' || this.state !== 'riding') return false;
            this.pendingImpact = null;
            this.crashEventId = impact?.event_id || impact?.id || makeId();
            this.crashDeadline = Date.now() + (this.options.crashCountdownSeconds * 1000);
            this.crashSeconds = this.options.crashCountdownSeconds;
            this.lastCrashSecondEmitted = this.crashSeconds;
            this.crashPhase = 'countdown';
            this.crashImpact = this.crashSnapshot(impact || {});
            this.emit('crashcandidate', { ...this.crashImpact, seconds: this.crashSeconds, phase: this.crashPhase });
            navigator.vibrate?.([400, 180, 400, 180, 400]);
            this.crashTimer = window.setInterval(() => this.tickCrashCountdown(), 250);
            return true;
        }

        tickCrashCountdown() {
            if (this.crashPhase !== 'countdown' || !this.crashDeadline) return false;
            const remaining = Math.max(0, Math.ceil((this.crashDeadline - Date.now()) / 1000));
            this.crashSeconds = remaining;
            if (remaining !== this.lastCrashSecondEmitted) {
                this.lastCrashSecondEmitted = remaining;
                this.emit('crashcountdown', { ...this.crashImpact, seconds: remaining, phase: this.crashPhase });
            }
            if (Date.now() >= this.crashDeadline) this.confirmCrash(this.crashImpact || {});
            return true;
        }

        cancelCrash(reason = 'rider') {
            if (this.crashPhase !== 'countdown') return false;
            window.clearInterval(this.crashTimer);
            this.crashTimer = null;
            this.crashSeconds = 0;
            this.crashPhase = reason === 'send' ? 'sending' : 'cancelled';
            if (reason !== 'send') {
                const eventId = this.crashEventId;
                this.emit('crashcancelled', { event_id: eventId, reason });
                this.crashPhase = 'idle';
                this.crashDeadline = 0;
                this.crashEventId = null;
                this.crashImpact = null;
                this.lastCrashSecondEmitted = null;
            }
            return true;
        }

        confirmCrash(impact = this.crashImpact || this.pendingImpact || {}) {
            if (this.crashPhase !== 'countdown') return null;
            window.clearInterval(this.crashTimer);
            this.crashTimer = null;
            this.crashPhase = 'sending';
            const detail = {
                ...this.crashSnapshot(impact),
                event_id: this.crashEventId,
                id: this.crashEventId,
                confirmed_at: nowIso(),
                phase: this.crashPhase,
                deliveryState: 'not-sent',
            };
            this.emit('crash', detail);
            return detail;
        }

        completeCrash(status = 'active') {
            window.clearInterval(this.crashTimer);
            this.crashTimer = null;
            this.crashSeconds = 0;
            this.crashPhase = status === 'active' ? 'active' : 'idle';
            if (this.crashPhase === 'idle') {
                this.crashDeadline = 0;
                this.crashEventId = null;
                this.crashImpact = null;
                this.lastCrashSecondEmitted = null;
            }
            return this.crashPhase;
        }

        async acquireWakeLock() {
            if (!navigator.wakeLock?.request || document.hidden) return null;
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
                this.wakeLock.addEventListener?.('release', () => this.emit('wakelock', { active: false }));
                this.emit('wakelock', { active: true });
            } catch (error) {
                this.emit('wakelock', { active: false, message: error.message });
            }
            return this.wakeLock;
        }

        cleanupSensors() {
            if (this.watchId !== null) navigator.geolocation?.clearWatch(this.watchId);
            this.watchId = null;
            if (this.telemetryTimer) window.clearInterval(this.telemetryTimer);
            this.telemetryTimer = null;
            if (this.motionBound) {
                window.removeEventListener('devicemotion', this.handleMotion);
                window.removeEventListener('deviceorientation', this.handleOrientation);
                this.motionBound = false;
            }
            if (this.crashTimer) window.clearInterval(this.crashTimer);
            this.crashTimer = null;
            this.wakeLock?.release?.().catch(() => {});
            this.wakeLock = null;
        }

        async stop(options = {}) {
            if (this.state !== 'riding') throw new Error('No active ride to stop.');
            this.transition('ending');
            this.cleanupSensors();
            this.session.endedAt = nowIso();
            this.session.updatedAt = nowIso();
            this.session.metrics = this.metrics();
            this.session.syncState = 'pending';
            await this.store.put(this.session);
            const summary = typeof window.structuredClone === 'function'
                ? window.structuredClone(this.session)
                : JSON.parse(JSON.stringify(this.session));

			const sync = Object.prototype.hasOwnProperty.call(options, 'syncRide') ? options.syncRide : this.options.syncRide;
            if (typeof sync === 'function' && navigator.onLine) {
                try {
                    const response = await sync(summary);
                    this.session.syncState = 'synced';
                    this.session.server = response || null;
                    this.session.updatedAt = nowIso();
                    // Once the server accepts the ride it becomes the source of
                    // truth. Remove the high-resolution local trace rather than
                    // retaining precise location history indefinitely.
                    await this.store.delete(this.session.id);
                    this.transition('completed', { rideId: this.session.id, synced: true, summary: this.session });
                    this.emit('summary', { ...this.session, synced: true });
                    return this.session;
                } catch (error) {
                    this.emit('sync', { state: 'pending', rideId: this.session.id, message: error.message });
                }
            }

            this.transition('pending-sync', { rideId: this.session.id, synced: false, summary });
            this.emit('summary', { ...summary, synced: false });
            return summary;
        }

        async end(options = {}) {
            const summary = await this.stop(options);
            this.emit('ended', summary);
            return summary;
        }

        reportHazard(type, payload = {}) {
            const detail = {
                type: String(type || '').trim(),
                rideId: this.session?.id || null,
                location: this.lastPosition ? { ...this.lastPosition } : null,
                at: nowIso(),
                ...payload,
            };
            this.emit('hazard', detail);
            return detail;
        }

        recenter() {
            const detail = this.lastPosition ? { ...this.lastPosition } : null;
            this.emit('recenter', detail);
            return detail;
        }

        async flushPending(syncRide = this.options.syncRide) {
            if (typeof syncRide !== 'function' || !navigator.onLine) return { synced: 0, pending: (await this.store.pending()).length };
            const pending = await this.store.pending();
            let synced = 0;
            for (const record of pending) {
                try {
                    const response = await syncRide(record);
                    record.syncState = 'synced';
                    record.server = response || null;
                    record.updatedAt = nowIso();
                    await this.store.delete(record.id);
                    synced += 1;
                } catch (error) {
                    this.emit('sync', { state: 'pending', rideId: record.id, message: error.message });
                }
            }
            const remaining = (await this.store.pending()).length;
            this.emit('sync', { state: remaining ? 'pending' : 'synced', synced, pending: remaining });
            return { synced, pending: remaining };
        }

        abandon() {
            const previous = this.state;
            this.cleanupSensors();
            this.resetRuntime();
            this.state = 'idle';
            if (previous !== 'idle') this.emit('statechange', { previous, state: 'idle', abandoned: true });
        }

		clearIdentityState() {
			this.abandon();
			this.store.clearMemory();
		}

        destroy() {
            this.cleanupSensors();
            document.removeEventListener('visibilitychange', this.onVisibility);
            this.resetRuntime();
            this.state = 'idle';
        }
    }

    window.AvenraHaloGpsSpeed = Object.freeze({
        factor: GPS_SPEED_CALIBRATION_FACTOR,
        metresPerSecondToMph: gpsMetresPerSecondToMph,
        rawMphToCalibratedMph: calibrateGpsMph,
    });
    window.AvenraHaloRideEngineClass = AvenraHaloRideEngine;
    window.AvenraHaloRideEngine = new AvenraHaloRideEngine();
}());
