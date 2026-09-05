'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AvenraHaloWebToNativeRide } = require('../assets/js/webtonative-ride.js');

function makeDocument() {
	return {
		visibilityState: 'visible',
		addEventListener() {},
		removeEventListener() {},
		dispatchEvent() {}
	};
}

function makeWindow(overrides = {}) {
	return Object.assign({
		document: makeDocument(),
		navigator: {},
		location: { href: 'https://example.test/halo/' },
		URL,
		AbortController,
		CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
		addEventListener() {},
		removeEventListener() {},
		setTimeout
	}, overrides);
}

test('uses a late Android raw bridge instead of a stale WEBSITE SDK wrapper', async () => {
	let clock = 0;
	let directStarts = 0;
	let directStops = 0;
	let wrapperStarts = 0;
	const window = makeWindow({
		WTN: {
			platform: () => 'WEBSITE',
			isAndroidApp: () => false,
			isNativeApp: () => false,
			backgroundLocation: {
				start() { wrapperStarts += 1; },
				stop() {}
			}
		}
	});
	const adapter = new AvenraHaloWebToNativeRide({
		window,
		document: window.document,
		navigator: window.navigator,
		bridgeWaitMs: 100,
		bridgePollMs: 10,
		now: () => clock,
		sleep: async (milliseconds) => {
			clock += milliseconds;
			window.WebToNativeInterface = {
				startTrackingLocation(payload) {
					directStarts += 1;
					assert.equal(typeof payload, 'string');
				},
				stopTrackingLocation() { directStops += 1; }
			};
		}
	});

	adapter.start({
		client_ride_id: 'ride-late-bridge',
		session: {
			session_id: 'session-late-bridge',
			writer_token: 'writer-token',
			client_ride_id: 'ride-late-bridge',
			api_url: 'https://example.test/wp-json/avenra-halo/v2/location',
			expires_at: '2099-01-01T00:00:00Z'
		}
	});
	await adapter.whenSettled();
	assert.equal(directStarts, 1);
	assert.equal(wrapperStarts, 0, 'the stale SDK no-op must not be selected');
	assert.equal(adapter.getStatus().backgroundLocation, 'active');

	await adapter.stop('test-complete');
	assert.equal(directStops, 1);
	await adapter.destroy();
});

test('detects the official non-enumerable iOS handler key', async () => {
	const handlers = {};
	Object.defineProperty(handlers, 'webToNativeInterface', {
		value: { postMessage() {} },
		enumerable: false
	});
	const window = makeWindow({ webkit: { messageHandlers: handlers } });
	const adapter = new AvenraHaloWebToNativeRide({ window, document: window.document, navigator: window.navigator });
	assert.equal(adapter.nativeTransport().platform, 'ios');
	assert.equal(adapter.capabilities().environment, 'webtonative');
	await adapter.destroy();
});
