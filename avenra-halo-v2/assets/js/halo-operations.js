(() => {
	'use strict';

	const root = document.querySelector('[data-halo-operations]');
	const configNode = document.getElementById('avenra-halo-operations-config');
	if (!root || !configNode) return;

	let config = {};
	try { config = JSON.parse(configNode.textContent || '{}'); } catch (error) { return; }

	const state = {
		page: 1,
		search: '',
		status: 'all',
		loading: false,
		data: null,
		activeIncident: '',
		lastFocused: null,
		refreshTimer: null,
		requestedTestRide: (() => {
			try {
				const value = new URLSearchParams(window.location.search).get('test_ride') || '';
				return /^[a-fA-F0-9-]{36}$/.test(value) ? value.toLowerCase() : '';
			} catch (error) { return ''; }
		})(),
		requestedTestRideHandled: false,
	};

	const q = (selector, context = document) => context.querySelector(selector);
	const qa = (selector, context = document) => Array.from(context.querySelectorAll(selector));
	const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[character]);
	const escapeAttr = escapeHtml;
	const title = (value) => String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
	const isFiniteValue = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
	const number = (value, digits = 0) => isFiniteValue(value) ? Number(value).toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
	const safeHttpUrl = (value) => {
		try {
			const url = new URL(String(value || ''), window.location.origin);
			return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
		} catch (error) { return ''; }
	};
	const safeSameOriginUrl = (value) => {
		try {
			const url = new URL(String(value || ''), window.location.origin);
			return url.protocol === window.location.protocol && url.origin === window.location.origin ? url.href : '';
		} catch (error) { return ''; }
	};
	const safeOsmUrl = (value) => {
		try {
			const url = new URL(String(value || ''));
			return url.protocol === 'https:' && url.hostname === 'www.openstreetmap.org' ? url.href : '';
		} catch (error) { return ''; }
	};

	function initials(name) {
		const parts = String(name || 'R').trim().split(/\s+/).filter(Boolean);
		return ((parts[0]?.[0] || 'R') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
	}

	function dateTime(value) {
		if (!value) return 'Not recorded';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return 'Not recorded';
		return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(date);
	}

	function relativeTime(value) {
		if (!value) return 'No recent signal';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return 'No recent signal';
		const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
		if (seconds < 10) return 'Just now';
		if (seconds < 60) return `${seconds}s ago`;
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
		if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
		return `${Math.floor(seconds / 86400)}d ago`;
	}

	function chip(label, kind = 'muted') {
		return `<span class="halo-ops-chip is-${escapeAttr(kind)}">${escapeHtml(label)}</span>`;
	}

	function endpoint(path = '') {
		return `${String(config.restBase || '').replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
	}

	async function api(path, options = {}) {
		const response = await fetch(endpoint(path), {
			method: options.method || 'GET',
			credentials: 'same-origin',
			cache: 'no-store',
			headers: {
				'Accept': 'application/json',
				'X-WP-Nonce': String(config.nonce || ''),
				...(options.body ? { 'Content-Type': 'application/json' } : {}),
			},
			body: options.body ? JSON.stringify(options.body) : undefined,
		});
		let payload = null;
		try { payload = await response.json(); } catch (error) { payload = null; }
		if (!response.ok) {
			const problem = new Error(payload?.error?.message || payload?.message || `Emergency Assist returned ${response.status}.`);
			problem.status = response.status;
			problem.code = payload?.error?.code || payload?.code || 'request_failed';
			throw problem;
		}
		// Halo's namespace-wide response normaliser wraps successful REST data in
		// { ok, data, meta, request_id }. Keep this client tolerant of both that
		// production envelope and an already-unwrapped response used by a test
		// adapter, so the console never renders an empty shell after a valid fetch.
		return payload?.ok === true && Object.prototype.hasOwnProperty.call(payload, 'data')
			? (payload.data || {})
			: (payload || {});
	}

	function setSystem(mode, label) {
		const node = q('[data-system-state]');
		if (!node) return;
		node.classList.toggle('is-ready', mode === 'ready');
		node.classList.toggle('is-error', mode === 'error');
		node.lastChild.textContent = label;
	}

	let noticeTimer = null;
	function notify(message, mode = 'success') {
		const node = q('[data-alert]');
		if (!node) return;
		node.textContent = message;
		node.classList.toggle('is-error', mode === 'error');
		node.hidden = false;
		window.clearTimeout(noticeTimer);
		noticeTimer = window.setTimeout(() => { node.hidden = true; }, mode === 'error' ? 9000 : 5000);
	}

	async function loadDashboard({ quiet = false } = {}) {
		if (state.loading) return;
		state.loading = true;
		if (!quiet) setSystem('loading', 'Refreshing');
		const params = new URLSearchParams({ page: String(state.page), per_page: '24', status: state.status });
		if (state.search) params.set('search', state.search);
		try {
			const payload = await api(`dashboard?${params.toString()}`);
			state.data = payload;
			renderDashboard(payload);
			setSystem('ready', 'Systems live');
		} catch (error) {
			setSystem('error', 'Attention needed');
			if (!quiet) notify(error.message, 'error');
			if (error.status === 401 || error.status === 403) window.location.reload();
		} finally {
			state.loading = false;
		}
	}

	function renderDashboard(data) {
		const summary = data.summary || {};
		qa('[data-metric]').forEach((node) => { node.textContent = number(summary[node.dataset.metric]); });
		qa('[data-metric-inline]').forEach((node) => { node.textContent = number(summary[node.dataset.metricInline]); });
		renderIncidents(data.incidents || []);
		renderTestRides(data.test_rides || []);
		renderRiders(data.customers || []);
		renderPagination(data.pagination || {});
		renderTestLab(data);
	}

	function incidentPriority(incident) {
		if (!incident.is_test && ['active', 'acknowledged'].includes(incident.status)) return 0;
		if (incident.is_test && ['active', 'acknowledged'].includes(incident.status)) return 1;
		if (incident.status === 'candidate') return 2;
		return 3;
	}

	function renderIncidents(incidents) {
		const list = q('[data-incident-list]');
		if (!list) return;
		const visible = [...incidents].sort((a, b) => incidentPriority(a) - incidentPriority(b) || new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0)).slice(0, 12);
		if (!visible.length) {
			list.innerHTML = '<div class="halo-ops-empty">No Emergency Assist incidents have been recorded.</div>';
			return;
		}
		list.innerHTML = visible.map((incident) => {
			const active = ['active', 'acknowledged'].includes(incident.status);
			const statusKind = incident.is_test ? 'test' : (active ? 'critical' : 'muted');
			const typeLabel = incident.status === 'candidate'
				? 'Rider cancellation countdown'
				: (incident.status === 'cancelled' ? 'Cancelled before activation' : (incident.is_test ? `Exercise · ${title(incident.test_dispatch_mode || 'test')}` : 'Emergency event'));
			return `<button type="button" class="halo-ops-incident${incident.is_test ? ' is-test' : ''}" data-open-incident="${escapeAttr(incident.id)}">
				<span class="halo-ops-incident__mark" aria-hidden="true">${incident.is_test ? 'T' : '!'}</span>
				<span class="halo-ops-incident__copy"><strong>${escapeHtml(incident.rider_name || 'Halo rider')}</strong><span>${escapeHtml(typeLabel)} · ${escapeHtml(title(incident.source || 'automatic'))}</span></span>
				<span class="halo-ops-incident__meta">${chip(title(incident.display_status || incident.status || 'unknown'), statusKind)}<time datetime="${escapeAttr(incident.occurred_at || '')}">${escapeHtml(relativeTime(incident.occurred_at))}</time></span>
			</button>`;
		}).join('');
	}

	function testRideStatus(row) {
		switch (String(row?.status || '').toLowerCase()) {
			case 'active': return { label: 'Live', kind: 'riding', copy: 'Live location is updating' };
			case 'signal_lost': return { label: 'Signal lost', kind: 'warning', copy: 'Showing the last accepted update' };
			case 'stale': return { label: 'Stale', kind: 'critical', copy: 'No recent location signal' };
			default: return { label: 'Waiting for GPS', kind: 'online', copy: 'No location received yet' };
		}
	}

	function renderTestRides(rides) {
		const list = q('[data-test-ride-list]');
		if (!list) return;
		if (!rides.length) {
			list.innerHTML = '<div class="halo-ops-empty">No active Avenrà test rides are currently being monitored.</div>';
			focusRequestedTestRide();
			return;
		}

		list.innerHTML = rides.map((row) => {
			const id = String(row.id || row.session_id || '').toLowerCase();
			const rider = row.rider && typeof row.rider === 'object' ? row.rider : {};
			const bike = row.bike && typeof row.bike === 'object' ? row.bike : {};
			const status = testRideStatus(row);
			const model = String(bike.model || '').trim();
			const registration = String(bike.registration || '').trim();
			const bikeIdentified = bike.identified === true && Boolean(model || registration);
			const bikeLinked = bike.linked === true && Boolean(model || registration);
			const bikeTitle = bikeIdentified ? (model || 'Avenrà motorcycle') : bikeLinked ? (model || 'Halo-linked motorcycle') : 'Bike not identified';
			const bikeDetail = bikeIdentified
				? (registration || 'Registration not recorded')
				: bikeLinked ? `${registration ? `${registration} · ` : ''}Not verified for this test ride` : 'No verified bike is attached to this session';
			const hasLocation = isFiniteValue(row.latitude) && isFiniteValue(row.longitude);
			const road = String(row.road_name || '').trim();
			const locationTitle = road || (hasLocation ? `${number(row.latitude, 5)}, ${number(row.longitude, 5)}` : 'Waiting for location');
			const locationDetail = hasLocation
				? `${number(row.latitude, 5)}, ${number(row.longitude, 5)}${isFiniteValue(row.accuracy_m) ? ` · ±${number(row.accuracy_m, 0)} m` : ''}`
				: 'No coordinates received yet';
			const monitorUrl = safeSameOriginUrl(row.monitor_url);
			const mapUrl = safeOsmUrl(row.map_url);
			const focused = Boolean(state.requestedTestRide && id === state.requestedTestRide);
			const latest = row.last_update_at || row.last_ping_at;
			const speed = isFiniteValue(row.speed_mph) ? number(row.speed_mph, 0) : '—';
			const topSpeed = isFiniteValue(row.top_speed_mph) ? number(row.top_speed_mph, 0) : '—';
			const heading = isFiniteValue(row.heading) ? `${number(row.heading, 0)}°` : '—';
			return `<article class="halo-ops-test-ride${focused ? ' is-focused' : ''}" data-test-ride-card="${escapeAttr(id)}" tabindex="-1" aria-label="Test ride for ${escapeAttr(rider.name || 'Halo rider')}">
				<div class="halo-ops-test-ride__head"><div class="halo-ops-person"><span class="halo-ops-person__avatar">${escapeHtml(initials(rider.name))}</span><span class="halo-ops-person__copy"><strong>${escapeHtml(rider.name || 'Halo rider')}</strong><small>${escapeHtml(rider.email || 'Email not recorded')}</small></span></div><div class="halo-ops-test-ride__state">${chip(status.label, status.kind)}<small>${escapeHtml(status.copy)}</small></div></div>
				<div class="halo-ops-test-ride__bike"><span>${escapeHtml(bikeTitle)}</span><small>${escapeHtml(bikeDetail)}</small></div>
				<div class="halo-ops-test-ride__telemetry" aria-label="Latest test ride telemetry"><div><span>Speed</span><strong>${escapeHtml(speed)} <small>mph</small></strong></div><div><span>Ride peak</span><strong>${escapeHtml(topSpeed)} <small>mph</small></strong></div><div><span>Heading</span><strong>${escapeHtml(heading)}</strong></div></div>
				<div class="halo-ops-test-ride__location"><strong>${escapeHtml(locationTitle)}</strong><small>${escapeHtml(locationDetail)}</small></div>
				<dl class="halo-ops-test-ride__times"><div><dt>Started</dt><dd>${escapeHtml(dateTime(row.started_at))}</dd></div><div><dt>Last update</dt><dd>${escapeHtml(latest ? relativeTime(latest) : 'Waiting for signal')}</dd></div><div><dt>Expires</dt><dd>${escapeHtml(dateTime(row.expires_at))}</dd></div></dl>
				<div class="halo-ops-test-ride__actions">${mapUrl ? `<a class="halo-ops-button halo-ops-button--dark" href="${escapeAttr(mapUrl)}" target="_blank" rel="noopener noreferrer">Open live map ↗</a>` : '<span class="halo-ops-button halo-ops-button--quiet is-disabled" aria-disabled="true">Location pending</span>'}<button type="button" class="halo-ops-button halo-ops-button--quiet" data-copy-test-ride-link="${escapeAttr(monitorUrl)}"${monitorUrl ? '' : ' disabled'}>Copy staff link</button></div>
			</article>`;
		}).join('');
		focusRequestedTestRide();
	}

	function focusRequestedTestRide() {
		if (!state.requestedTestRide || state.requestedTestRideHandled) return;
		const card = qa('[data-test-ride-card]').find((item) => String(item.dataset.testRideCard || '').toLowerCase() === state.requestedTestRide);
		state.requestedTestRideHandled = true;
		if (!card) {
			notify('That staff test-ride link is no longer active or has expired.', 'error');
			return;
		}
		window.requestAnimationFrame(() => {
			card.focus({ preventScroll: true });
			card.scrollIntoView({ behavior: 'smooth', block: 'center' });
		});
	}

	async function copyTestRideLink(button) {
		const value = safeSameOriginUrl(button?.dataset.copyTestRideLink);
		if (!value) throw new Error('The private staff link is unavailable.');
		if (navigator.clipboard?.writeText && window.isSecureContext) {
			await navigator.clipboard.writeText(value);
		} else {
			const field = document.createElement('textarea');
			field.value = value;
			field.setAttribute('readonly', '');
			field.style.position = 'fixed';
			field.style.opacity = '0';
			document.body.append(field);
			field.select();
			const copied = document.execCommand('copy');
			field.remove();
			if (!copied) throw new Error('The private staff link could not be copied.');
		}
		notify('Private staff monitor link copied.');
	}

	function riderStatus(row) {
		const status = row.status || {};
		if (status.riding) return { label: 'Riding now', kind: 'riding' };
		if (status.signal_lost) return { label: 'Ride signal lost', kind: 'warning' };
		if (status.online) return { label: 'Online', kind: 'online' };
		if (status.signed_in) return { label: 'Signed in', kind: 'muted' };
		return { label: 'Offline', kind: 'muted' };
	}

	function topRiskFactor(factors) {
		if (!factors || typeof factors !== 'object') return '';
		const rows = Object.values(factors).filter((factor) => factor && typeof factor === 'object');
		rows.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
		return String(rows[0]?.label || rows[0]?.explanation || '');
	}

	function renderRiders(riders) {
		const list = q('[data-rider-list]');
		if (!list) return;
		if (!riders.length) {
			list.innerHTML = '<tr><td colspan="5"><div class="halo-ops-empty">No riders match this view.</div></td></tr>';
			return;
		}
		list.innerHTML = riders.map((row) => {
			const status = riderStatus(row);
			const assist = row.assist || {};
			const vehicle = row.vehicle || null;
			const presence = row.presence || null;
			const risk = row.risk || {};
			const score = isFiniteValue(risk.score) ? number(risk.score, 0) : '—';
			const riskLevel = String(risk.risk_level || 'insufficient');
			const factor = topRiskFactor(risk.factors);
			const riskCell = assist.enrolled
				? `<div class="halo-ops-risk" title="${escapeAttr(factor || risk.disclaimer || '')}"><span class="halo-ops-risk__score is-${escapeAttr(riskLevel)}">${escapeHtml(score)}</span><span class="halo-ops-risk__copy"><strong>${escapeHtml(title(riskLevel))}</strong><small>${escapeHtml(risk.confidence === 'insufficient' ? 'Not enough ride data' : `${number(risk.ride_count)} rides · ${number(risk.total_miles, 0)} mi`)}</small>${factor ? `<small>${escapeHtml(factor)}</small>` : ''}</span></div>`
				: '<span class="halo-ops-cell-title">Not calculated</span><span class="halo-ops-cell-sub">Emergency Assist consent is not current</span>';
			const liveCell = assist.enrolled
				? (row.status?.riding
					? `<strong class="halo-ops-speed">${number(presence?.speed_mph, 0)} <small>mph</small></strong><span class="halo-ops-cell-sub">Top ${number(presence?.top_speed_mph, 0)} mph · ${escapeHtml(relativeTime(row.status?.last_ping_at))}</span>`
					: `<span class="halo-ops-cell-title">${row.status?.signal_lost ? 'Signal interrupted' : 'Not currently riding'}</span><span class="halo-ops-cell-sub">${escapeHtml(relativeTime(row.status?.last_ping_at))}</span>`)
				: '<span class="halo-ops-cell-title">Visibility not enabled</span><span class="halo-ops-cell-sub">Riding state remains unknown</span>';
			return `<tr>
				<td data-label="Rider"><div class="halo-ops-person"><span class="halo-ops-person__avatar">${escapeHtml(initials(row.name))}</span><span class="halo-ops-person__copy"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.email || `Rider #${row.id}`)}</small></span></div></td>
				<td data-label="Halo status"><div class="halo-ops-cell-chips">${chip(status.label, status.kind)}${assist.enrolled ? chip('Assist on', 'ready') : chip('No consent', 'muted')}</div><span class="halo-ops-cell-sub">${escapeHtml(relativeTime(row.status?.last_seen_at || row.last_login_at))}</span></td>
				<td data-label="Motorcycle">${vehicle ? `<span class="halo-ops-cell-title">${escapeHtml(vehicle.model || 'Avenrà motorcycle')}</span><span class="halo-ops-cell-sub">${escapeHtml([vehicle.registration, vehicle.colour].filter(Boolean).join(' · ') || 'Details pending')}</span>` : '<span class="halo-ops-cell-title">No linked motorcycle</span><span class="halo-ops-cell-sub">Customer directory record</span>'}</td>
				<td data-label="Live ride">${liveCell}</td>
				<td data-label="Ride-risk indicator">${riskCell}</td>
			</tr>`;
		}).join('');
	}

	function renderPagination(pagination) {
		const node = q('[data-pagination]');
		if (!node) return;
		const page = Number(pagination.page || 1);
		const pages = Number(pagination.total_pages || 1);
		const total = Number(pagination.total || 0);
		node.innerHTML = `<span>${number(total)} rider${total === 1 ? '' : 's'} · Page ${page} of ${pages}</span><button type="button" data-page="${page - 1}"${page <= 1 ? ' disabled' : ''} aria-label="Previous page">←</button><button type="button" data-page="${page + 1}"${page >= pages ? ' disabled' : ''} aria-label="Next page">→</button>`;
	}

	function renderTestLab(data) {
		const select = q('[data-test-customer]');
		if (!select) return;
		const current = select.value;
		select.innerHTML = '<option value="">Choose a consented rider</option>' + (data.test_candidates || []).map((customer) => `<option value="${Number(customer.id)}">${escapeHtml(customer.name)} · ${escapeHtml(customer.email)}</option>`).join('');
		if (current && qa('option', select).some((option) => option.value === current)) select.value = current;
		const testing = data.testing || {};
		const provider = data.provider || {};
		const liveOption = q('[data-test-mode] option[value="live_sms"]');
		if (liveOption) liveOption.disabled = !testing.live_sms_enabled;
		const readiness = q('[data-test-readiness]');
		if (readiness) {
			readiness.className = `halo-ops-test-readiness ${testing.live_sms_enabled ? 'is-ready' : 'is-warning'}`;
			readiness.textContent = testing.live_sms_enabled
				? `Live drill ready · primary …${provider.primary_last_four || '—'} · backup …${provider.backup_last_four || '—'}`
				: 'Dry run ready. Live SMS remains locked until the server guard and responder provider are both enabled.';
		}
		updateTestMode();
	}

	function updateTestMode() {
		const mode = q('[data-test-mode]')?.value || 'dry_run';
		const confirm = q('[data-live-confirm]');
		const submit = q('[data-test-submit]');
		if (confirm) confirm.hidden = mode !== 'live_sms';
		if (submit) submit.textContent = mode === 'live_sms' ? 'Send marked test SMS' : 'Create dry-run incident';
		qa('[data-test-form] select[name="scenario"] option').forEach((option) => {
			const dryOnly = ['primary_rejected', 'primary_timeout'].includes(option.value);
			option.disabled = mode === 'live_sms' && dryOnly;
		});
		const scenario = q('[data-test-form] select[name="scenario"]');
		if (scenario?.selectedOptions[0]?.disabled) scenario.value = 'happy_path';
	}

	async function submitTest(form) {
		const submit = q('[data-test-submit]', form);
		const values = Object.fromEntries(new FormData(form).entries());
		if (!values.customer_id) { notify('Choose a consented test rider.', 'error'); return; }
		if (values.mode === 'live_sms' && values.confirmation !== 'SEND TEST SMS') { notify('Type SEND TEST SMS exactly before starting a live drill.', 'error'); return; }
		if (submit) submit.disabled = true;
		try {
			const result = await api('tests', {
				method: 'POST',
				body: {
					customer_id: Number(values.customer_id), mode: values.mode, scenario: values.scenario,
					speed_mph: Number(values.speed_mph), peak_g_force: Number(values.peak_g_force),
					lat: Number(values.lat), lng: Number(values.lng), confirmation: values.confirmation || '',
				},
			});
			notify(result.message || 'Emergency Assist exercise created.');
			form.elements.confirmation.value = '';
			await loadDashboard({ quiet: true });
			const incidentId = result.incident?.incident_id || result.incident?.id || '';
			if (incidentId) openIncident(incidentId);
		} catch (error) {
			notify(error.message, 'error');
		} finally {
			if (submit) submit.disabled = false;
		}
	}

	function openDrawer() {
		const drawer = q('[data-incident-drawer]');
		if (!drawer) return;
		state.lastFocused = document.activeElement;
		drawer.classList.add('is-open');
		drawer.setAttribute('aria-hidden', 'false');
		document.body.style.overflow = 'hidden';
		q('[data-close-drawer]', drawer)?.focus();
	}

	function closeDrawer() {
		const drawer = q('[data-incident-drawer]');
		if (!drawer) return;
		drawer.classList.remove('is-open');
		drawer.setAttribute('aria-hidden', 'true');
		document.body.style.overflow = '';
		state.activeIncident = '';
		if (state.lastFocused instanceof HTMLElement) state.lastFocused.focus();
	}

	async function openIncident(id) {
		if (!id) return;
		state.activeIncident = id;
		openDrawer();
		const heading = q('#halo-drawer-title');
		const body = q('[data-drawer-body]');
		if (heading) heading.textContent = 'Loading incident…';
		if (body) body.innerHTML = '<div class="halo-ops-skeleton halo-ops-skeleton--detail"></div>';
		try {
			const briefing = await api(`incidents/${encodeURIComponent(id)}`);
			if (state.activeIncident !== id) return;
			renderIncident(briefing);
		} catch (error) {
			if (body) body.innerHTML = `<div class="halo-ops-empty">${escapeHtml(error.message)}</div>`;
		}
	}

	function field(label, value, options = {}) {
		if (value === null || value === undefined || value === '') return '';
		const safeValue = options.html ? String(value) : escapeHtml(value);
		return `<dt>${escapeHtml(label)}</dt><dd>${safeValue}</dd>`;
	}

	function section(name, fields, wide = false) {
		const content = fields.filter(Boolean).join('');
		if (!content) return '';
		return `<section class="halo-ops-brief-card${wide ? ' is-wide' : ''}"><h3>${escapeHtml(name)}</h3><dl>${content}</dl></section>`;
	}

	function renderIncident(payload) {
		const incident = payload.incident || payload;
		const snapshot = payload.snapshot || incident.snapshot || {};
		const rider = snapshot.rider || payload.rider || {};
		const bike = snapshot.bike || payload.bike || {};
		const location = snapshot.location || payload.location || {};
		const impact = snapshot.impact || payload.impact || {};
		const medical = snapshot.medical || payload.medical || {};
		const nextOfKin = snapshot.next_of_kin || payload.next_of_kin || {};
		const events = payload.events || incident.events || [];
		const isTest = incident.is_test === true || Number(incident.is_test) === 1 || ['test', 'simulation'].includes(incident.source);
		const incidentId = incident.public_id || incident.incident_id || incident.id || state.activeIncident;
		const acknowledged = Boolean(incident.first_acknowledged_at || incident.acknowledged_at || incident.acknowledged);
		const authoritativeRole = `wp_${Number(config.operator?.id || 0)}`;
		const authoritative = !acknowledged || String(incident.first_acknowledged_by || '') === authoritativeRole;
		const emergencyCalled = incident.emergency_services_called_at || incident.emergency_called_at;
		const heading = q('#halo-drawer-title');
		if (heading) heading.textContent = isTest ? 'Emergency Assist exercise' : (rider.name || incident.rider_name || 'Emergency incident');

		const mapUrl = safeHttpUrl(payload.map_url || (isFiniteValue(location.lat) && isFiniteValue(location.lng) ? `https://www.openstreetmap.org/?mlat=${encodeURIComponent(location.lat)}&mlon=${encodeURIComponent(location.lng)}#map=17/${encodeURIComponent(location.lat)}/${encodeURIComponent(location.lng)}` : ''));
		const riderPhone = isTest ? '' : String(rider.mobile || '');
		const riderPhoneLink = isTest ? 'Hidden during exercise' : (riderPhone ? `<a href="tel:${escapeAttr(riderPhone.replace(/[^+\d]/g, ''))}">${escapeHtml(riderPhone)}</a>` : '');
		const mapLink = mapUrl ? `<a href="${escapeAttr(mapUrl)}" target="_blank" rel="noopener noreferrer">Open live map ↗</a>` : '';
		const occurred = incident.occurred_at || impact.occurred_at;
		const banner = incident.status === 'candidate'
			? '<div class="halo-ops-test-banner">PENDING RIDER COUNTDOWN · This event is not yet in the responder queue. No briefing or operator actions are available unless the rider does not cancel and the incident activates.</div>'
			: (incident.status === 'cancelled'
				? '<div class="halo-ops-test-banner">CANCELLED BY RIDER · This event never entered the responder queue. Its private evidence has been redacted and no operator action is available.</div>'
				: (isTest
			? `<div class="halo-ops-test-banner">TEST EXERCISE · NO ACCIDENT · DO NOT CALL 999. Dispatch: ${escapeHtml(title(incident.test_dispatch_mode || incident.source || 'simulation'))}; scenario: ${escapeHtml(title(incident.test_scenario || 'happy path'))}.</div>`
			: '<div class="halo-ops-live-banner">LIVE SAFETY INCIDENT · Validate the evidence, attempt to contact the rider, and call 999 without delay when the event is credible and the rider is unresponsive.</div>'));
		const consents = snapshot.consents || {};
		const device = snapshot.device || snapshot.device_state || {};
		const network = snapshot.network || device.network || {};

		let html = banner + '<div class="halo-ops-brief-grid">';
		html += section('Incident', [
			field('Status', title(incident.status || 'active')),
			field('Detected', dateTime(occurred)),
			field('Source', title(incident.source || 'automatic')),
			field('Acknowledged', acknowledged ? dateTime(incident.first_acknowledged_at || incident.acknowledged_at) : 'Awaiting operator'),
		]);
		html += section('Rider', [
			field('Name', rider.name || incident.rider_name),
			field('Mobile', riderPhoneLink, { html: true }),
			field('Email', rider.email),
			field('Assist consent', consents.assist === false ? 'Not current' : 'Current'),
		]);
		html += section('Location', [
			field('Coordinates', isFiniteValue(location.lat) && isFiniteValue(location.lng) ? `${number(location.lat, 6)}, ${number(location.lng, 6)}` : ''),
			field('Address', location.address),
			field('Accuracy', isFiniteValue(location.accuracy_m) ? `${number(location.accuracy_m, 0)} m` : ''),
			field('Heading', isFiniteValue(location.heading) ? `${number(location.heading, 0)}°` : ''),
			field('Map', mapLink, { html: true }),
		]);
		html += section('Impact evidence', [
			field('Last speed', isFiniteValue(impact.speed_mph) ? `${number(impact.speed_mph, 1)} mph` : ''),
			field('Prior speed', isFiniteValue(impact.prior_speed_mph) ? `${number(impact.prior_speed_mph, 1)} mph` : ''),
			field('Top speed', isFiniteValue(impact.top_speed_mph) ? `${number(impact.top_speed_mph, 1)} mph` : ''),
			field('Peak force', isFiniteValue(impact.peak_g_force) ? `${number(impact.peak_g_force, 2)} g` : ''),
			field('Movement', location.movement || snapshot.movement),
		]);
		html += section('Motorcycle', [
			field('Model', bike.model),
			field('Registration', bike.registration),
			field('Colour', bike.colour),
			field('VIN', bike.vin),
		], true);
		if ( medical && Object.values(medical).some(Boolean) ) {
			html += section('Consented medical information', [field('Date of birth', medical.date_of_birth), field('Blood type', medical.blood_type), field('Weight', medical.weight_kg ? `${number(medical.weight_kg, 1)} kg` : ''), field('Notes', medical.notes)], true);
		}
		if ( !isTest && nextOfKin && Object.values(nextOfKin).some(Boolean) ) {
			html += section('Next of kin', [field('Name', nextOfKin.name), field('Relationship', nextOfKin.relationship), field('Mobile', nextOfKin.mobile)], true);
		}
		html += section('Device and signal', [
			field('Network', network.effective_type || network.type),
			field('Online', network.online === true ? 'Yes' : (network.online === false ? 'No' : 'Unknown')),
			field('Battery', device.battery?.level !== undefined ? `${number(Number(device.battery.level) * (Number(device.battery.level) <= 1 ? 100 : 1), 0)}%` : ''),
			field('Orientation', device.screen_orientation || device.orientation),
		], true);
		if (events.length) {
			html += `<section class="halo-ops-brief-card is-wide"><h3>Audit timeline</h3><ol class="halo-ops-timeline">${events.map((event) => `<li><strong>${escapeHtml(title(event.event_type || event.type || 'update'))}</strong>${event.actor_role ? ` · ${escapeHtml(title(event.actor_role))}` : ''}<time>${escapeHtml(dateTime(event.created_at || event.at))}</time></li>`).join('')}</ol></section>`;
		}
		html += '</div>';
		if (acknowledged && !authoritative && !isTest) {
			html += '<div class="halo-ops-authority-note">This incident is assigned to the responder who acknowledged first. Other operators have read-only access.</div>';
		}
		html += renderActions({ id: incidentId, isTest, acknowledged, authoritative, emergencyCalled, riderPhone, status: incident.status });
		const body = q('[data-drawer-body]');
		if (body) body.innerHTML = html;
	}

	function renderActions({ id, isTest, acknowledged, authoritative, emergencyCalled, riderPhone, status }) {
		if (!config.capabilities?.operate || !['active', 'acknowledged'].includes(status)) return '';
		const action = (value, label, kind = 'quiet', wide = false) => `<button type="button" class="halo-ops-button halo-ops-button--${escapeAttr(kind)}${wide ? ' is-wide' : ''}" data-incident-action="${escapeAttr(value)}" data-incident-id="${escapeAttr(id)}">${escapeHtml(label)}</button>`;
		let controls = '';
		if (!acknowledged) controls += action('acknowledge', isTest ? 'Acknowledge exercise' : 'Acknowledge incident', isTest ? 'dark' : 'red', true);
		if (acknowledged && authoritative && isTest) controls += action('test_complete', 'Complete test exercise', 'dark', true);
		if (acknowledged && authoritative && !isTest) {
			if (riderPhone) controls += `<a class="halo-ops-button halo-ops-button--dark" href="tel:${escapeAttr(riderPhone.replace(/[^+\d]/g, ''))}">Call rider</a>`;
			controls += action('rider_no_answer', 'Rider did not answer');
			controls += action('rider_confirmed', 'Rider confirms accident');
			controls += action('false_alarm', 'Resolve false alarm');
			controls += '<a class="halo-ops-button halo-ops-999" href="tel:999">Call 999</a>';
			controls += action('emergency_services_called', 'Record 999 call', 'red');
			if (emergencyCalled) controls += action('alert_next_of_kin', 'Alert next of kin');
			if (emergencyCalled) controls += action('handover_complete', 'Complete handover', 'dark', true);
		}
		return controls ? `<div class="halo-ops-brief-actions">${controls}</div>` : '';
	}

	const confirmations = {
		false_alarm: 'Resolve this live incident as a false alarm?',
		emergency_services_called: 'Confirm that a human operator has completed the 999 call. Halo does not make this call automatically.',
		alert_next_of_kin: 'Send the configured next-of-kin notification now?',
		handover_complete: 'Confirm the incident has been handed over and may be closed.',
		test_complete: 'Complete and close this test exercise?',
	};

	async function performAction(button) {
		const action = button.dataset.incidentAction;
		const id = button.dataset.incidentId;
		if (!action || !id) return;
		if (confirmations[action] && !window.confirm(confirmations[action])) return;
		button.disabled = true;
		try {
			const result = await api(`incidents/${encodeURIComponent(id)}/actions`, { method: 'POST', body: { action } });
			notify(result.message || 'Incident updated.');
			await Promise.all([loadDashboard({ quiet: true }), openIncident(id)]);
		} catch (error) {
			notify(error.message, 'error');
			button.disabled = false;
		}
	}

	function bind() {
		q('[data-rider-filter]')?.addEventListener('submit', (event) => {
			event.preventDefault();
			const values = new FormData(event.currentTarget);
			state.search = String(values.get('search') || '').trim();
			state.status = String(values.get('status') || 'all');
			state.page = 1;
			loadDashboard();
		});
		q('[data-test-mode]')?.addEventListener('change', updateTestMode);
		q('[data-test-form]')?.addEventListener('submit', (event) => { event.preventDefault(); submitTest(event.currentTarget); });
		document.addEventListener('click', (event) => {
			const copyTestRide = event.target.closest('[data-copy-test-ride-link]');
			if (copyTestRide) {
				copyTestRideLink(copyTestRide).catch((error) => notify(error.message || 'The staff link could not be copied.', 'error'));
				return;
			}
			const incident = event.target.closest('[data-open-incident]');
			if (incident) openIncident(incident.dataset.openIncident);
			const close = event.target.closest('[data-close-drawer]');
			if (close) closeDrawer();
			const page = event.target.closest('[data-page]');
			if (page && !page.disabled) { state.page = Number(page.dataset.page || 1); loadDashboard(); q('#halo-riders-title')?.scrollIntoView({ behavior: 'smooth' }); }
			const action = event.target.closest('[data-incident-action]');
			if (action) performAction(action);
		});
		document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && q('[data-incident-drawer]')?.classList.contains('is-open')) closeDrawer(); });
	}

	function startClock() {
		const update = () => {
			const node = q('[data-clock]');
			if (node) node.textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Europe/London' }).format(new Date());
		};
		update();
		window.setInterval(update, 1000);
	}

	bind();
	startClock();
	loadDashboard();
	state.refreshTimer = window.setInterval(() => {
		if (document.visibilityState === 'visible' && !q('[data-incident-drawer]')?.classList.contains('is-open')) loadDashboard({ quiet: true });
	}, Math.max(10000, Number(config.refreshMs || 15000)));
})();
