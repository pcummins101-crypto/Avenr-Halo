(function () {
    'use strict';

    const TILE_SIZE = 256;
    const MIN_LAT = -85.05112878;
    const MAX_LAT = 85.05112878;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const wrap = (value, max) => ((value % max) + max) % max;

    function normalisePoint(point) {
        if (Array.isArray(point) && point.length >= 2) {
            const first = Number(point[0]);
            const second = Number(point[1]);
            if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
            return { lng: first, lat: second };
        }
        if (!point || typeof point !== 'object') return null;
        const lat = Number(point.lat ?? point.latitude);
        const lng = Number(point.lng ?? point.lon ?? point.longitude);
        return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    }

    function finiteNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function normaliseHeading(value) {
        const heading = finiteNumber(value);
        return heading === null ? null : wrap(heading, 360);
    }

    function angularDelta(from, to) {
        return ((to - from + 540) % 360) - 180;
    }

    function distanceMetres(from, to) {
        const earthRadius = 6371000;
        const lat1 = from.lat * Math.PI / 180;
        const lat2 = to.lat * Math.PI / 180;
        const deltaLat = (to.lat - from.lat) * Math.PI / 180;
        const deltaLng = (to.lng - from.lng) * Math.PI / 180;
        const a = Math.sin(deltaLat / 2) ** 2
            + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
        return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function bearingBetween(from, to) {
        const lat1 = from.lat * Math.PI / 180;
        const lat2 = to.lat * Math.PI / 180;
        const deltaLng = (to.lng - from.lng) * Math.PI / 180;
        const y = Math.sin(deltaLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2)
            - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
        return normaliseHeading(Math.atan2(y, x) * 180 / Math.PI);
    }

    function worldPoint(point, zoom) {
        const n = 2 ** zoom;
        const lat = clamp(point.lat, MIN_LAT, MAX_LAT) * Math.PI / 180;
        return {
            x: ((point.lng + 180) / 360) * n * TILE_SIZE,
            y: ((1 - (Math.log(Math.tan(lat) + (1 / Math.cos(lat))) / Math.PI)) / 2) * n * TILE_SIZE,
        };
    }

    function latLngFromWorld(x, y, zoom) {
        const world = (2 ** zoom) * TILE_SIZE;
        const lng = (x / world) * 360 - 180;
        const mercator = Math.PI - (2 * Math.PI * y / world);
        const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(mercator) - Math.exp(-mercator)));
        return { lat: clamp(lat, MIN_LAT, MAX_LAT), lng };
    }

    class AvenraHaloMap extends EventTarget {
        static create(container, options = {}) {
            return new AvenraHaloMap(container, options);
        }

        static mount(container, options = {}) {
            return AvenraHaloMap.create(container, options);
        }

        constructor(container, options = {}) {
            super();
            if (typeof container === 'string') container = document.querySelector(container);
            if (!(container instanceof HTMLElement)) throw new Error('Halo map requires a valid container.');

            this.container = container;
            const mode = String(options.mode || '');
            this.options = {
                tileUrl: window.AvenraHaloV2Config?.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                attribution: window.AvenraHaloV2Config?.mapAttribution || '\u00a9 OpenStreetMap contributors',
                center: { lat: 54.5, lng: -2 },
                zoom: 6,
                minZoom: 3,
                maxZoom: 19,
                interactive: true,
                controls: true,
                routeColor: '#1683ff',
                alternativeColor: '#8a96a6',
                followMode: mode === 'ride' ? 'forward' : 'centered',
                followZoom: mode === 'ride' ? 17 : null,
                lookAheadRatio: mode === 'ride' ? 0.2 : 0,
                maxLookAheadPixels: mode === 'ride' ? 220 : 96,
                bottomOverlayClearancePixels: mode === 'ride' ? 285 : 0,
                rotateWithCourse: mode === 'ride',
                minimumCourseSpeedMph: 3,
                maximumCourseAccuracyMetres: 65,
                headingSmoothing: 0.38,
                courseHoldMilliseconds: 5000,
                onDegraded: null,
                ...options,
            };
            this.center = normalisePoint(this.options.center) || { lat: 54.5, lng: -2 };
            this.zoom = clamp(Math.round(Number(this.options.zoom) || 6), this.options.minZoom, this.options.maxZoom);
            this.routes = [];
            this.hazards = [];
            this.user = null;
            this.followEnabled = Boolean(this.options.follow);
            this.hasFollowFix = false;
            this.smoothedHeading = null;
            this.lastReliableHeadingAt = 0;
            this.previousUserFix = null;
            this.courseAnchorFix = null;
            this.destroyed = false;
            this.drag = null;
            this.renderFrame = null;
            this.lastSize = { width: 0, height: 0 };
            this.renderSize = { width: 0, height: 0 };
            this.renderBearing = 0;

            this.build();
            this.bind();
            this.invalidate();
            if (this.options.route) this.showRoute(this.options.route, { fit: true });
        }

        build() {
            const mapLabel = this.options.ariaLabel || this.container.getAttribute('aria-label') || 'Route map';
            this.container.classList.add('halo-map');
            this.container.setAttribute('role', this.options.interactive ? 'application' : 'group');
            this.container.setAttribute('aria-label', this.options.interactive ? mapLabel : `${mapLabel} and attribution`);
            if (this.options.interactive && !this.container.hasAttribute('tabindex')) {
                this.container.tabIndex = 0;
                this.container.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight + -');
            } else if (!this.options.interactive) {
                this.container.removeAttribute('tabindex');
                this.container.removeAttribute('aria-keyshortcuts');
            }
            this.container.innerHTML = '';

            this.viewport = document.createElement('div');
            this.viewport.className = 'halo-map__viewport';
            this.viewport.style.touchAction = this.options.interactive ? 'none' : 'pan-y';
            if (!this.options.interactive) {
                this.viewport.setAttribute('role', 'img');
                this.viewport.setAttribute('aria-label', mapLabel);
            }
            this.tiles = document.createElement('div');
            this.tiles.className = 'halo-map__tiles';
            this.overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            this.overlay.setAttribute('class', 'halo-map__overlay');
            this.overlay.setAttribute('aria-hidden', 'true');
            this.scene = document.createElement('div');
            this.scene.className = 'halo-map__scene';
            this.status = document.createElement('div');
            this.status.className = 'halo-map__status';
            this.status.hidden = true;
            this.status.textContent = 'Map imagery unavailable. Route guidance remains active.';
            this.attribution = document.createElement('a');
            this.attribution.className = 'halo-map__attribution';
            this.attribution.href = 'https://www.openstreetmap.org/copyright';
            this.attribution.target = '_blank';
            this.attribution.rel = 'noopener noreferrer';
            this.attribution.textContent = this.options.attribution;

            this.scene.append(this.tiles, this.overlay);
            this.viewport.append(this.scene, this.status);
            this.container.append(this.viewport, this.attribution);
        }

        bind() {
            this.onPageShow = () => this.invalidate();
            this.onVisibility = () => { if (!document.hidden) this.invalidate(); };
            this.onOrientation = () => window.setTimeout(() => this.invalidate(), 120);
            window.addEventListener('pageshow', this.onPageShow);
            document.addEventListener('visibilitychange', this.onVisibility);
            window.addEventListener('orientationchange', this.onOrientation);

            if ('ResizeObserver' in window) {
                this.resizeObserver = new ResizeObserver(() => this.invalidate());
                this.resizeObserver.observe(this.container);
            } else {
                this.onResize = () => this.invalidate();
                window.addEventListener('resize', this.onResize);
            }

            if (!this.options.interactive) return;
            this.viewport.style.touchAction = 'none';
            this.viewport.addEventListener('pointerdown', event => {
                if (event.button !== 0) return;
                this.viewport.setPointerCapture?.(event.pointerId);
                this.drag = {
                    id: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    centre: worldPoint(this.center, this.zoom),
                    bearing: this.courseUpBearing() || 0,
                    moved: false,
                };
            });
            this.viewport.addEventListener('pointermove', event => {
                if (!this.drag || this.drag.id !== event.pointerId) return;
                const deltaX = event.clientX - this.drag.x;
                const deltaY = event.clientY - this.drag.y;
                if (!this.drag.moved && Math.hypot(deltaX, deltaY) < 7) return;
                if (!this.drag.moved) {
                    this.drag.moved = true;
                    this.setFollowState(false);
                }
                const radians = Number(this.drag.bearing || 0) * Math.PI / 180;
                const worldDeltaX = Math.cos(radians) * deltaX - Math.sin(radians) * deltaY;
                const worldDeltaY = Math.sin(radians) * deltaX + Math.cos(radians) * deltaY;
                const point = latLngFromWorld(
                    this.drag.centre.x - worldDeltaX,
                    this.drag.centre.y - worldDeltaY,
                    this.zoom
                );
                this.center = point;
                this.scheduleRender();
            });
            const finishDrag = event => {
                if (this.drag?.id === event.pointerId) {
                    this.drag = null;
                    this.dispatchEvent(new CustomEvent('moveend', { detail: this.getState() }));
                }
            };
            this.viewport.addEventListener('pointerup', finishDrag);
            this.viewport.addEventListener('pointercancel', finishDrag);
            this.viewport.addEventListener('wheel', event => {
                event.preventDefault();
                this.setFollowState(false);
                this.setZoom(this.zoom + (event.deltaY < 0 ? 1 : -1));
            }, { passive: false });
            this.viewport.addEventListener('dblclick', event => {
                event.preventDefault();
                this.setFollowState(false);
                this.setZoom(this.zoom + 1);
            });
        }

        scheduleRender() {
            if (this.destroyed || this.renderFrame) return;
            this.renderFrame = requestAnimationFrame(() => {
                this.renderFrame = null;
                this.render();
            });
        }

        invalidate() {
            if (this.destroyed) return;
            const rect = this.container.getBoundingClientRect();
            this.lastSize = { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
            this.scheduleRender();
        }

        courseUpBearing() {
            if (!this.options.rotateWithCourse || !this.followEnabled) return null;
            return normaliseHeading(this.user?.heading ?? this.smoothedHeading);
        }

        resolveRenderBearing(target) {
            const normalisedTarget = target === null ? 0 : normaliseHeading(target);
            if (normalisedTarget === null) return this.renderBearing;
            this.renderBearing += angularDelta(normaliseHeading(this.renderBearing) || 0, normalisedTarget);
            return this.renderBearing;
        }

        rotationCoverage(width, height, bearing, active) {
            if (!active) return { width, height };
            const radians = normaliseHeading(bearing) * Math.PI / 180;
            const cosine = Math.abs(Math.cos(radians));
            const sine = Math.abs(Math.sin(radians));
            return {
                width: Math.ceil(width * cosine + height * sine) + 4,
                height: Math.ceil(width * sine + height * cosine) + 4,
            };
        }

        render() {
            if (this.destroyed) return;
            const { width, height } = this.lastSize;
            if (width <= 1 || height <= 1) return;
            const targetBearing = this.courseUpBearing();
            const rotationActive = targetBearing !== null;
            const bearing = this.resolveRenderBearing(targetBearing);
            const coverage = this.rotationCoverage(width, height, bearing, rotationActive);
            const renderWidth = coverage.width;
            const renderHeight = coverage.height;
            this.renderSize = { width: renderWidth, height: renderHeight };
            this.scene.style.width = `${renderWidth}px`;
            this.scene.style.height = `${renderHeight}px`;
            this.scene.style.transform = `translate(-50%, -50%) rotate(${-bearing}deg)`;
            this.overlay.setAttribute('viewBox', `0 0 ${renderWidth} ${renderHeight}`);
            this.container.classList.toggle('is-course-up', rotationActive);
            this.container.style.setProperty('--halo-map-bearing', `${normaliseHeading(bearing) || 0}deg`);
            const centreWorld = worldPoint(this.center, this.zoom);
            this.topLeft = { x: centreWorld.x - renderWidth / 2, y: centreWorld.y - renderHeight / 2 };
            this.renderTiles(renderWidth, renderHeight);
            this.renderOverlay(renderWidth, renderHeight);
        }

        tileUrl(z, x, y) {
            const subdomains = this.options.subdomains || ['a', 'b', 'c'];
            const subdomain = subdomains[Math.abs(x + y) % subdomains.length];
            return String(this.options.tileUrl)
                .replace('{s}', subdomain)
                .replace('{z}', String(z))
                .replace('{x}', String(x))
                .replace('{y}', String(y));
        }

        renderTiles(width, height) {
            const n = 2 ** this.zoom;
            const minX = Math.floor(this.topLeft.x / TILE_SIZE);
            const maxX = Math.floor((this.topLeft.x + width) / TILE_SIZE);
            const minY = Math.max(0, Math.floor(this.topLeft.y / TILE_SIZE));
            const maxY = Math.min(n - 1, Math.floor((this.topLeft.y + height) / TILE_SIZE));
            const needed = new Set();

            for (let y = minY; y <= maxY; y += 1) {
                for (let x = minX; x <= maxX; x += 1) {
                    const wrappedX = wrap(x, n);
                    const key = `${this.zoom}/${wrappedX}/${y}`;
                    needed.add(key);
                    let image = this.tiles.querySelector(`[data-tile="${key}"]`);
                    if (!image) {
                        image = new Image();
                        image.className = 'halo-map__tile';
                        image.dataset.tile = key;
                        image.alt = '';
                        image.decoding = 'async';
                        image.addEventListener('load', () => {
                            image.classList.add('is-loaded');
                            image.classList.remove('is-error');
                            this.updateTileHealth();
                        });
                        image.addEventListener('error', () => {
                            image.classList.add('is-error');
                            image.classList.remove('is-loaded');
                            this.updateTileHealth();
                        });
                        image.src = this.tileUrl(this.zoom, wrappedX, y);
                        this.tiles.append(image);
                    }
                    image.style.transform = `translate3d(${Math.round(x * TILE_SIZE - this.topLeft.x)}px,${Math.round(y * TILE_SIZE - this.topLeft.y)}px,0)`;
                }
            }

            this.tiles.querySelectorAll('.halo-map__tile').forEach(image => {
                if (!needed.has(image.dataset.tile)) image.remove();
            });
            this.updateTileHealth();
        }

        updateTileHealth() {
            if (this.destroyed || !this.tiles) return;
            const visible = Array.from(this.tiles.querySelectorAll('.halo-map__tile'));
            const loaded = visible.filter(image => image.classList.contains('is-loaded')).length;
            const failed = visible.filter(image => image.classList.contains('is-error')).length;
            if (loaded > 0) {
                this.setDegraded(false);
            } else if (failed >= Math.min(3, visible.length) && visible.length > 0) {
                this.setDegraded(true, 'tiles');
            }
        }

        screenPoint(point) {
            const world = worldPoint(point, this.zoom);
            return { x: world.x - this.topLeft.x, y: world.y - this.topLeft.y };
        }

        renderOverlay(width, height) {
            this.overlay.replaceChildren();
            const namespace = 'http://www.w3.org/2000/svg';
            const addPolyline = (points, selected, index) => {
                const valid = points.map(normalisePoint).filter(Boolean);
                if (valid.length < 2) return;
                const polyline = document.createElementNS(namespace, 'polyline');
                polyline.setAttribute('points', valid.map(point => {
                    const screen = this.screenPoint(point);
                    return `${screen.x.toFixed(1)},${screen.y.toFixed(1)}`;
                }).join(' '));
                polyline.setAttribute('class', selected
                    ? 'halo-map__route halo-map__route--selected is-selected'
                    : 'halo-map__route halo-map__route--alternative is-alternative');
                polyline.style.setProperty('--route-color', selected ? this.options.routeColor : this.options.alternativeColor);
                polyline.dataset.routeIndex = String(index);
                this.overlay.append(polyline);
            };

            this.routes.forEach((route, index) => addPolyline(route.geometry || route.points || route, route.selected !== false && (route.selected || this.routes.length === 1 || index === 0), index));

            this.hazards.forEach(hazard => {
                const point = normalisePoint(hazard);
                if (!point) return;
                const screen = this.screenPoint(point);
                if (screen.x < -20 || screen.y < -20 || screen.x > width + 20 || screen.y > height + 20) return;
                const marker = document.createElementNS(namespace, 'circle');
                marker.setAttribute('cx', screen.x.toFixed(1));
                marker.setAttribute('cy', screen.y.toFixed(1));
                marker.setAttribute('r', hazard.source === 'community' ? '7' : '6');
                marker.setAttribute('class', `halo-map__hazard ${hazard.source === 'community'
                    ? 'halo-map__hazard--community is-community'
                    : 'halo-map__hazard--focus is-focus'}`);
                this.overlay.append(marker);
            });

            if (this.user) {
                const screen = this.screenPoint(this.user);
                const accuracy = Number(this.user.accuracy);
                if (Number.isFinite(accuracy) && accuracy > 0 && accuracy < 1000) {
                    const metresPerPixel = 156543.03392 * Math.cos(this.user.lat * Math.PI / 180) / (2 ** this.zoom);
                    const ring = document.createElementNS(namespace, 'circle');
                    ring.setAttribute('cx', screen.x.toFixed(1));
                    ring.setAttribute('cy', screen.y.toFixed(1));
                    ring.setAttribute('r', clamp(accuracy / metresPerPixel, 8, 80).toFixed(1));
                    ring.setAttribute('class', 'halo-map__accuracy');
                    this.overlay.append(ring);
                }
                const heading = normaliseHeading(this.user.heading);
                const courseUp = Boolean(this.options.rotateWithCourse && this.followEnabled && heading !== null);
                const showHeading = heading !== null && (this.user.courseReliable || courseUp);
                const marker = document.createElementNS(namespace, showHeading ? 'path' : 'circle');
                if (showHeading) {
                    marker.setAttribute('d', 'M 0 -13 L 8.5 9 L 0 6 L -8.5 9 Z');
                    marker.setAttribute('transform', `translate(${screen.x.toFixed(1)} ${screen.y.toFixed(1)}) rotate(${heading.toFixed(1)})`);
                    marker.setAttribute('class', 'halo-map__user halo-map__user-heading');
                } else {
                    marker.setAttribute('cx', screen.x.toFixed(1));
                    marker.setAttribute('cy', screen.y.toFixed(1));
                    marker.setAttribute('r', '7');
                    marker.setAttribute('class', 'halo-map__user halo-map__user-marker');
                }
                this.overlay.append(marker);
            }
        }

        setDegraded(degraded, reason = null) {
            const changed = this.container.classList.contains('is-degraded') !== Boolean(degraded);
            this.container.classList.toggle('is-degraded', Boolean(degraded));
            this.status.hidden = !degraded;
            if (changed) {
                const detail = { degraded: Boolean(degraded), reason };
                this.dispatchEvent(new CustomEvent('degraded', { detail }));
                if (typeof this.options.onDegraded === 'function') this.options.onDegraded(detail);
            }
        }

        setCenter(point, zoom = this.zoom) {
            const next = normalisePoint(point);
            if (!next) return false;
            this.center = next;
            this.zoom = clamp(Math.round(Number(zoom) || this.zoom), this.options.minZoom, this.options.maxZoom);
            this.scheduleRender();
            return true;
        }

        setZoom(zoom) {
            // Zoom controls and pinch gestures supersede an in-progress
            // one-finger drag, preventing a jump when the second finger lifts.
            this.drag = null;
            const next = clamp(Math.round(Number(zoom) || this.zoom), this.options.minZoom, this.options.maxZoom);
            if (next === this.zoom) return;
            this.zoom = next;
            this.scheduleRender();
            this.dispatchEvent(new CustomEvent('zoomend', { detail: this.getState() }));
        }

        setRoutes(routes) {
            this.routes = Array.isArray(routes) ? routes : [];
            this.scheduleRender();
        }

        routePoints(route) {
            if (!route) return [];
            let source = route.geometry || route.coordinates || route.points || route.route || route.telemetry || route;
            if (typeof source === 'string') {
                try { source = JSON.parse(source); } catch (error) { return []; }
            }
            if (source && !Array.isArray(source) && typeof source === 'object') {
                source = source.geometry || source.coordinates || source.points || source.route || [];
            }
            return (Array.isArray(source) ? source : []).map(normalisePoint).filter(Boolean);
        }

        showRoutes(routes, options = {}) {
            const list = Array.isArray(routes) ? routes : [];
            const selectedIndex = Number.isInteger(options.selectedIndex) ? options.selectedIndex : 0;
            this.routes = list.map((route, index) => Array.isArray(route)
                ? { geometry: route, selected: index === selectedIndex }
                : { ...route, selected: index === selectedIndex });
            const selected = this.routes[selectedIndex] || this.routes[0];
            this.hazards = Array.isArray(selected?.hazards || selected?.focus_zones)
                ? (selected.hazards || selected.focus_zones)
                : this.hazards;
            const points = this.routes.flatMap(route => this.routePoints(route));
            if (points.length && options.fit !== false) this.fitBounds(points, { padding: options.padding || 34, maxZoom: 16 });
            else this.scheduleRender();
            return true;
        }

        renderRoutes(routes, options = {}) {
            return this.showRoutes(routes, options);
        }

        setRoute(route, alternatives = []) {
            const selected = Array.isArray(route) ? { geometry: route, selected: true } : { ...(route || {}), selected: true };
            this.routes = [selected, ...alternatives.map(item => Array.isArray(item) ? { geometry: item, selected: false } : { ...item, selected: false })];
            this.scheduleRender();
        }

        showRoute(route, options = {}) {
            if (!route) return false;
            this.setRoute(route);
            const hazards = route.hazards || route.focus_zones;
            if (Array.isArray(hazards)) this.setHazards(hazards);
            const points = this.routePoints(route);
            if (points.length && options.fit !== false) this.fitBounds(points, { padding: options.padding || 38, maxZoom: 17 });
            return true;
        }

        renderRoute(route, options = {}) {
            return this.showRoute(route, options);
        }

        selectRoute(index, route = null) {
            const selectedIndex = Number(index);
            if (!Number.isInteger(selectedIndex) || selectedIndex < 0) return false;
            if (route && !this.routes[selectedIndex]) this.routes[selectedIndex] = { ...route };
            this.routes = this.routes.map((item, itemIndex) => ({ ...item, selected: itemIndex === selectedIndex }));
            const selected = route || this.routes[selectedIndex];
            if (!selected) return false;
            if (route) this.routes[selectedIndex] = { ...route, selected: true };
            const hazards = selected.hazards || selected.focus_zones;
            if (Array.isArray(hazards)) this.hazards = hazards;
            const points = this.routePoints(selected);
            if (points.length) this.fitBounds(points, { padding: 38, maxZoom: 17 });
            else this.scheduleRender();
            return true;
        }

        highlightRoute(index, route = null) {
            return this.selectRoute(index, route);
        }

        setHazards(hazards) {
            this.hazards = Array.isArray(hazards) ? hazards : [];
            this.scheduleRender();
        }

        updateUserLocation(point, follow = false) {
            const next = normalisePoint(point);
            if (!next) return false;
            const accuracy = finiteNumber(point.accuracy);
            const speedMph = finiteNumber(point.speedMph ?? point.speed_mph ?? point.speed);
            const timestamp = finiteNumber(point.at ?? point.timestamp) || Date.now();
            const rawHeading = normaliseHeading(point.heading);
            const previous = this.previousUserFix;
            const displacement = previous ? distanceMetres(previous, next) : 0;
            const anchor = this.courseAnchorFix || previous;
            const anchorElapsedSeconds = anchor ? Math.max(0, (timestamp - anchor.at) / 1000) : 0;
            const anchorDisplacement = anchor ? distanceMetres(anchor, next) : 0;
            const accuracyLimit = Math.max(7, Math.min(20, Math.max(accuracy || 0, anchor?.accuracy || 0) * 0.5));
            const moving = speedMph === null ? anchorDisplacement >= accuracyLimit : speedMph >= Number(this.options.minimumCourseSpeedMph || 3);
            const accurate = accuracy === null || accuracy <= Number(this.options.maximumCourseAccuracyMetres || 65);
            const freshSample = !previous || timestamp > previous.at || displacement >= 1;
            let candidateHeading = freshSample && moving && accurate ? rawHeading : null;
            if (candidateHeading === null && freshSample && moving && accurate && anchor && anchorElapsedSeconds >= 0.35 && anchorElapsedSeconds <= 30 && anchorDisplacement >= accuracyLimit) {
                candidateHeading = bearingBetween(anchor, next);
            }
            if (candidateHeading !== null) {
                if (this.smoothedHeading === null) this.smoothedHeading = candidateHeading;
                else {
                    const alpha = clamp(Number(this.options.headingSmoothing) || 0.38, 0.12, 0.75);
                    this.smoothedHeading = normaliseHeading(this.smoothedHeading + angularDelta(this.smoothedHeading, candidateHeading) * alpha);
                }
                this.lastReliableHeadingAt = Date.now();
            }
            if (!anchor || candidateHeading !== null || !moving || !accurate || anchorElapsedSeconds > 30) {
                this.courseAnchorFix = { ...next, accuracy, at: timestamp };
            }
            const courseAge = Date.now() - this.lastReliableHeadingAt;
            const courseReliable = this.smoothedHeading !== null && accurate
                && ((freshSample && moving) || courseAge < Number(this.options.courseHoldMilliseconds || 5000));
            this.user = {
                ...next,
                accuracy,
                speedMph,
                heading: this.smoothedHeading,
                courseReliable,
                at: timestamp,
            };
            this.previousUserFix = { ...next, accuracy, at: timestamp };
            if (follow) {
                const followZoom = finiteNumber(this.options.followZoom);
                if (!this.hasFollowFix && followZoom !== null) {
                    this.zoom = clamp(Math.round(followZoom), this.options.minZoom, this.options.maxZoom);
                }
                this.center = this.followCenter(this.user);
                this.hasFollowFix = true;
            }
            this.scheduleRender();
            return true;
        }

        followCenter(point = this.user) {
            const next = normalisePoint(point);
            const heading = normaliseHeading(point?.heading ?? this.smoothedHeading);
            if (!next || this.options.followMode !== 'forward' || heading === null) return next || this.center;
            const ratio = clamp(Number(this.options.lookAheadRatio) || 0, 0, 0.35);
            let pixels = Math.min(Number(this.options.maxLookAheadPixels) || 96, this.lastSize.height * ratio);
            const bottomClearance = Math.max(0, Number(this.options.bottomOverlayClearancePixels) || 0);
            if (bottomClearance > 0 && this.lastSize.height >= this.lastSize.width) {
                pixels = Math.min(pixels, Math.max(0, this.lastSize.height / 2 - bottomClearance));
            }
            if (finiteNumber(point.accuracy) !== null && Number(point.accuracy) > 35) pixels *= 0.55;
            if (pixels < 1) return next;
            const world = worldPoint(next, this.zoom);
            const radians = heading * Math.PI / 180;
            return latLngFromWorld(
                world.x + Math.sin(radians) * pixels,
                world.y - Math.cos(radians) * pixels,
                this.zoom
            );
        }

        setUserLocation(point, follow = false) {
            return this.updateUserLocation(point, follow);
        }

        setCourseAvailable(available = true) {
            if (!this.user || available) return Boolean(this.user);
            this.user.courseReliable = false;
            if (this.followEnabled) this.center = this.followCenter(this.user);
            this.scheduleRender();
            return true;
        }

        updatePosition(point, follow = this.followEnabled) {
            return this.updateUserLocation(point?.position || point, follow);
        }

        flyTo(point, zoom = Math.max(this.zoom, 14)) {
            return this.setCenter(point, zoom);
        }

        setFollowState(follow) {
            const next = Boolean(follow);
            const changed = next !== this.followEnabled;
            this.followEnabled = next;
            if (changed) {
                this.scheduleRender();
                this.dispatchEvent(new CustomEvent('followchange', { detail: { follow: next } }));
            }
            return next;
        }

        setFollow(follow = true) {
            this.setFollowState(follow);
            if (this.followEnabled && this.user) {
                const followZoom = finiteNumber(this.options.followZoom);
                if (followZoom !== null) this.zoom = clamp(Math.round(followZoom), this.options.minZoom, this.options.maxZoom);
                this.center = this.followCenter(this.user);
                this.hasFollowFix = true;
                this.scheduleRender();
            }
            return this.followEnabled;
        }

        followUser(follow = true) {
            return this.setFollow(follow);
        }

        recenter() {
            if (!this.user) return false;
            this.setFollow(true);
            return true;
        }

        fitRoute(route = this.routes.find(item => item.selected) || this.routes[0]) {
            const points = this.routePoints(route);
            return points.length ? this.fitBounds(points, { padding: 38, maxZoom: 17 }) : false;
        }

        showOverview(route = this.routes.find(item => item.selected) || this.routes[0]) {
            const points = this.routePoints(route);
            if (!points.length) return false;
            this.setFollowState(false);
            return this.fitBounds(points, { padding: 38, maxZoom: 17 });
        }

        updateGuidance(guidance = {}) {
            if (!this.user && (guidance.position || normalisePoint(guidance))) {
                this.updatePosition(guidance.position || guidance, this.followEnabled);
            }
            return true;
        }

        setProgress(guidance = {}) {
            return this.updateGuidance(guidance);
        }

        fitBounds(points, options = {}) {
            const valid = (Array.isArray(points) ? points : []).map(normalisePoint).filter(Boolean);
            if (!valid.length) return false;
            const minLat = Math.min(...valid.map(point => point.lat));
            const maxLat = Math.max(...valid.map(point => point.lat));
            const minLng = Math.min(...valid.map(point => point.lng));
            const maxLng = Math.max(...valid.map(point => point.lng));
            const padding = Number(options.padding) || 36;
            const width = Math.max(40, this.lastSize.width - padding * 2);
            const height = Math.max(40, this.lastSize.height - padding * 2);
            let selectedZoom = this.options.minZoom;
            for (let zoom = this.options.maxZoom; zoom >= this.options.minZoom; zoom -= 1) {
                const northWest = worldPoint({ lat: maxLat, lng: minLng }, zoom);
                const southEast = worldPoint({ lat: minLat, lng: maxLng }, zoom);
                if (Math.abs(southEast.x - northWest.x) <= width && Math.abs(southEast.y - northWest.y) <= height) {
                    selectedZoom = zoom;
                    break;
                }
            }
            return this.setCenter({ lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 }, clamp(selectedZoom, this.options.minZoom, options.maxZoom || this.options.maxZoom));
        }

        getState() {
            return {
                center: { ...this.center },
                zoom: this.zoom,
                follow: this.followEnabled,
                heading: this.user?.courseReliable ? normaliseHeading(this.user.heading) : null,
                bearing: this.courseUpBearing(),
                courseUp: this.courseUpBearing() !== null,
                degraded: this.container.classList.contains('is-degraded'),
            };
        }

        getBounds() {
            const { width, height } = this.lastSize;
            const centre = worldPoint(this.center, this.zoom);
            const northWest = latLngFromWorld(centre.x - width / 2, centre.y - height / 2, this.zoom);
            const southEast = latLngFromWorld(centre.x + width / 2, centre.y + height / 2, this.zoom);
            return { north: northWest.lat, west: northWest.lng, south: southEast.lat, east: southEast.lng };
        }

        destroy() {
            if (this.destroyed) return;
            this.destroyed = true;
            if (this.renderFrame) cancelAnimationFrame(this.renderFrame);
            this.resizeObserver?.disconnect();
            window.removeEventListener('pageshow', this.onPageShow);
            document.removeEventListener('visibilitychange', this.onVisibility);
            window.removeEventListener('orientationchange', this.onOrientation);
            if (this.onResize) window.removeEventListener('resize', this.onResize);
            this.container.replaceChildren();
            this.container.classList.remove('halo-map', 'is-degraded', 'is-course-up');
            this.container.style.removeProperty('--halo-map-bearing');
        }
    }

    window.AvenraHaloMap = AvenraHaloMap;
}());
