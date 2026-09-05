'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const pluginSource = read('avenra-halo-v2.php');
const databaseSource = read('includes/class-halo-v2-database.php');
const emergencySource = read('includes/class-halo-v2-emergency.php');
const restSource = read('includes/class-halo-v2-rest.php');
const nativeRideSource = read('includes/class-halo-v2-native-ride.php');
const operationsSource = read('includes/class-halo-v2-operations.php');
const operationsTemplate = read('templates/emergency-operations.php');
const operationsAppSource = read('assets/js/halo-operations.js');
const appSource = read('assets/js/app.js');
const rideEngineSource = read('assets/js/ride-engine.js');

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phpMethod(source, name) {
	const signature = new RegExp(`\\n\\t(?:public|private|protected) function ${escapeRegExp(name)}\\s*\\(`);
	const match = signature.exec(source);
	assert.ok(match, `Expected PHP method ${name}`);
	const next = /\n\t(?:public|private|protected) function [A-Za-z0-9_]+\s*\(/g;
	next.lastIndex = match.index + match[0].length;
	const following = next.exec(source);
	return source.slice(match.index, following ? following.index : source.length);
}

function between(source, start, end) {
	const startIndex = source.indexOf(start);
	assert.notEqual(startIndex, -1, `Expected start marker: ${start}`);
	const endIndex = source.indexOf(end, startIndex + start.length);
	assert.notEqual(endIndex, -1, `Expected end marker: ${end}`);
	return source.slice(startIndex, endIndex);
}

test('ships the current schema required for one-ride monitoring', () => {
	assert.match(pluginSource, /\* Version:\s+2\.7\.1/);
	assert.match(pluginSource, /AVENRA_HALO_V2_VERSION',\s*'2\.7\.1'/);

	const liveSchema = between(databaseSource, "$self->table( 'live_tracking' )", "$self->table( 'native_ride_sessions' )");
	for (const column of [
		'tracking_mode', 'auth_session_id', 'client_ride_id', 'arm_id', 'consent_version', 'consented_at',
		'ended_reason', 'latitude', 'longitude', 'speed_mph', 'top_speed_mph', 'road_name',
		'heading', 'accuracy_m', 'last_ping_at'
	]) {
		assert.match(liveSchema, new RegExp(`\\b${column}\\b`), `live_tracking must include ${column}`);
	}
	assert.match(liveSchema, /tracking_mode varchar\(24\) NOT NULL DEFAULT 'rider_share'/);
	assert.match(liveSchema, /UNIQUE KEY customer_client_mode \(customer_id,client_ride_id,tracking_mode\)/);
	assert.match(liveSchema, /KEY mode_active \(tracking_mode,ended_at,expires_at\)/);
	assert.match(liveSchema, /KEY customer_mode_arm \(customer_id,tracking_mode,arm_id\)/);

	const settingsSchema = between(databaseSource, "$self->table( 'emergency_settings' )", "$self->table( 'consent_events' )");
	for (const column of [
		'test_ride_monitoring_armed', 'test_ride_monitoring_arm_id', 'test_ride_monitoring_consent_version',
		'test_ride_monitoring_consented_at', 'test_ride_monitoring_revoked_at',
		'test_ride_monitoring_armed_until'
	]) {
		assert.match(settingsSchema, new RegExp(`\\b${column}\\b`), `emergency_settings must include ${column}`);
	}
	assert.match(settingsSchema, /KEY test_ride_armed_until \(test_ride_monitoring_armed,test_ride_monitoring_armed_until\)/);

	const migrationContract = between(databaseSource, '$required = array(', '$missing = array();');
	assert.match(migrationContract, /'live_tracking'\s*=>\s*array\([^\n]*'tracking_mode'[^\n]*'auth_session_id'[^\n]*'client_ride_id'[^\n]*'arm_id'[^\n]*'consent_version'/);
	assert.match(migrationContract, /'emergency_settings'\s*=>\s*array\([^\n]*'test_ride_monitoring_armed'[^\n]*'test_ride_monitoring_arm_id'[^\n]*'test_ride_monitoring_consent_version'[^\n]*'test_ride_monitoring_armed_until'/);
});

test('requires current, versioned consent and arms only the next two-hour window', () => {
	const requiredVersion = phpMethod(emergencySource, 'required_test_ride_monitoring_consent_version');
	assert.match(requiredVersion, /avenra_halo_v2_test_ride_monitoring_consent_version',\s*'1'/);
	assert.match(requiredVersion, /return '' !== \$version \? \$version : '1'/);

	const settings = phpMethod(emergencySource, 'get_assist_settings');
	assert.match(settings, /\$test_ride_current = \$test_ride_stored_armed/);
	assert.match(settings, /hash_equals\( \$required_test_ride, \$test_ride_version \)/);
	assert.match(settings, /\$test_ride_until_timestamp > time\(\)/);
	assert.match(settings, /tracking_mode = %s AND ended_at IS NULL AND expires_at > %s/);
	assert.match(settings, /'test_ride_monitoring_active' => \$test_ride_active/);

	const arm = phpMethod(emergencySource, 'set_test_ride_monitoring_arm');
	assert.match(arm, /\$enabled && \( '' === \$supplied \|\| ! hash_equals\( \$required, \$supplied \) \)/);
	assert.match(arm, /test_ride_monitoring_consent_version_required/);
	assert.match(arm, /time\(\) \+ 2 \* HOUR_IN_SECONDS/);
	assert.match(arm, /'test_ride_monitoring_armed' : 'test_ride_monitoring_revoked'/);
	assert.match(arm, /end_test_ride_monitoring_rows\( \$customer_id, \$tracking_table, \$now, \$expected_arm, \$expected_consent \)/);
	const cleanup = phpMethod(emergencySource, 'end_test_ride_monitoring_rows');
	assert.match(cleanup, /tracking_mode = %s AND ended_at IS NULL/);
	assert.match(cleanup, /'consent_revoked'/);
	assert.match(cleanup, /'test_ride'/);

	const safetyUpdate = phpMethod(restSource, 'update_safety');
	assert.match(safetyUpdate, /test_ride_monitoring_consent_version/);
	assert.match(safetyUpdate, /test_ride_monitoring_expected_arm_id/);
	assert.match(safetyUpdate, /test_ride_monitoring_expected_consented_at/);
	assert.match(safetyUpdate, /set_test_ride_monitoring_arm\( \(int\) \$customer->id, \$test_ride_monitoring_requested, \$test_ride_consent_version, \$test_ride_expected_arm_id, \$test_ride_expected_consented_at \)/);
	assert.match(arm, /\$expected_time !== \$current_consent_time/);
});

test('uses a fresh opaque arm id as the primary cleanup compare-and-swap', () => {
	const settingsSchema = between(databaseSource, "$self->table( 'emergency_settings' )", "$self->table( 'consent_events' )");
	assert.match(settingsSchema, /test_ride_monitoring_arm_id varchar\(64\) DEFAULT NULL/);

	const settings = phpMethod(emergencySource, 'get_assist_settings');
	assert.match(settings, /'test_ride_monitoring_arm_id' => \$test_ride_arm_id/);

	const arm = phpMethod(emergencySource, 'set_test_ride_monitoring_arm');
	assert.match(arm, /test_ride_monitoring_arm_id'\] = Avenra_Halo_V2_Auth::random_token\( 24 \)/);
	assert.match(arm, /if \( ! \$enabled && '' !== \$expected_arm \)/);
	assert.match(arm, /! hash_equals\( \$current_arm_id, \$expected_arm \)/);
	assert.match(arm, /\} elseif \( ! \$enabled && '' !== \$expected_consent \) \{/);
	assert.match(arm, /if \( '' !== \$current_arm_id \)/);
	const cleanup = phpMethod(emergencySource, 'end_test_ride_monitoring_rows');
	assert.match(cleanup, /tracking_mode = %s AND arm_id = %s AND ended_at IS NULL/);
	assert.match(cleanup, /'conditional_cleanup'/);
	assert.match(cleanup, /arm_id IS NULL AND consented_at = %s AND ended_at IS NULL/);

	const safety = phpMethod(restSource, 'safety_data');
	assert.match(safety, /'arm_id'\s*=>\s*\$flat\['test_ride_monitoring_arm_id'\]/);

	const start = phpMethod(restSource, 'start_test_ride_monitoring');
	assert.match(start, /test_ride_monitoring_armed = 0, test_ride_monitoring_armed_until = NULL/);
	assert.doesNotMatch(start, /test_ride_monitoring_arm_id\s*=\s*NULL/);
	assert.match(start, /'arm_id'\s*=>\s*'' !== \(string\) \$settings->test_ride_monitoring_arm_id/);

	const lifecycle = between(appSource, 'testRideMonitoringSettings() {', 'async beginRide(');
	assert.match(lifecycle, /const armId = text\(settings\.arm_id\)/);
	assert.match(lifecycle, /payload\.test_ride_monitoring_expected_arm_id = armId/);
	assert.match(lifecycle, /else if \(consentedAt\) payload\.test_ride_monitoring_expected_consented_at = consentedAt/);
});

test('keeps both matching and mismatching conditional cleanup scoped to one arm', () => {
	const arm = phpMethod(emergencySource, 'set_test_ride_monitoring_arm');
	const mismatch = between(arm, "if ( ! $enabled && '' !== $expected_arm )", "} elseif ( ! $enabled && '' !== $expected_consent )");
	assert.match(mismatch, /! hash_equals\( \$current_arm_id, \$expected_arm \)/);
	assert.match(mismatch, /end_test_ride_monitoring_rows\( \$customer_id, \$tracking_table, \$now, \$expected_arm \)/);
	assert.match(mismatch, /return \$this->get_assist_settings/);

	// A matching CAS proceeds through settings/audit, but the final end call must
	// still carry the expected scope instead of broadening to every test row.
	assert.match(arm, /if \( ! \$enabled \) \{\s*if \( ! \$this->end_test_ride_monitoring_rows\( \$customer_id, \$tracking_table, \$now, \$expected_arm, \$expected_consent \) \)/);

	const cleanup = phpMethod(emergencySource, 'end_test_ride_monitoring_rows');
	const armBranch = between(cleanup, "if ( '' !== $arm_id )", "$consented_timestamp =");
	assert.match(armBranch, /arm_id = %s AND ended_at IS NULL/);
	assert.match(armBranch, /return false !== \$result/);
	const legacyStart = cleanup.indexOf("if ( '' !== $consented_at )");
	const broadStart = cleanup.lastIndexOf("\n\t\t$result = $wpdb->query(");
	assert.notEqual(legacyStart, -1);
	assert.ok(broadStart > legacyStart);
	const legacyBranch = cleanup.slice(legacyStart, broadStart);
	assert.match(legacyBranch, /arm_id IS NULL AND consented_at = %s AND ended_at IS NULL/);
	assert.match(legacyBranch, /if \( false === \$consented_timestamp \) \{[\s\S]*return true/);
	assert.match(legacyBranch, /return false !== \$result/);
	assert.match(cleanup, /WHERE customer_id = %d AND tracking_mode = %s AND ended_at IS NULL/);
});

test('registers authenticated start, position and end endpoints', () => {
	const routes = phpMethod(restSource, 'register_routes');
	assert.match(routes, /route\( '\/test-ride-monitoring', 'POST', 'start_test_ride_monitoring' \)/);
	assert.match(routes, /route\( '\/test-ride-monitoring\/\(\?P<session_id>\[a-fA-F0-9-\]\{36\}\)\/position', 'POST', 'update_test_ride_monitoring' \)/);
	assert.match(routes, /route\( '\/test-ride-monitoring\/\(\?P<session_id>\[a-fA-F0-9-\]\{36\}\)', 'DELETE', 'end_test_ride_monitoring' \)/);
	for (const line of routes.split('\n').filter((line) => line.includes("route( '/test-ride-monitoring"))) {
		assert.doesNotMatch(line, /__return_true|permission_public/);
	}

	const routeHelper = phpMethod(restSource, 'route');
	assert.match(routeHelper, /empty\( \$permission \)/);
	assert.match(routeHelper, /array\( \$this->auth, 'permission_authenticated' \)/);

	for (const methodName of ['start_test_ride_monitoring', 'update_test_ride_monitoring', 'end_test_ride_monitoring']) {
		const method = phpMethod(restSource, methodName);
		assert.match(method, /\$this->auth->session\(\)/, `${methodName} must bind the current device session`);
		assert.match(method, /current_session_is_active\(\)/, `${methodName} must revalidate authentication inside the handler`);
	}
});

test('atomically consumes one arm and creates one fixed four-hour idempotent session', () => {
	const start = phpMethod(restSource, 'start_test_ride_monitoring');
	assert.match(start, /acquire_advisory_lock\( 'test-ride-monitoring', \(string\) \$customer_id, 2 \)/);
	assert.match(start, /START TRANSACTION/);
	assert.match(start, /customer_id = %d AND client_ride_id = %s AND tracking_mode = %s LIMIT 1 FOR UPDATE/);
	assert.match(start, /\$same_session = \(int\) \$existing->auth_session_id === \(int\) \$auth_session->id/);
	assert.match(start, /if \( \$same_session && \$active \)/);
	assert.match(start, /test_ride_monitoring_payload\( \$existing \)/);
	assert.match(start, /test_ride_monitoring_ride_already_used/);
	assert.match(start, /test_ride_monitoring_armed = 0, test_ride_monitoring_armed_until = NULL/);
	assert.match(start, /1 !== \(int\) \$consumed/);
	assert.match(start, /hash_equals\( \$required_version, \(string\) \$settings->test_ride_monitoring_consent_version \)/);
	assert.match(start, /'tracking_mode'\s*=>\s*'test_ride'/);
	assert.match(start, /'auth_session_id'\s*=>\s*\(int\) \$auth_session->id/);
	assert.match(start, /'client_ride_id'\s*=>\s*\$client_ride_id/);
	assert.match(start, /time\(\) \+ 4 \* HOUR_IN_SECONDS/);
	assert.equal((start.match(/time\(\) \+ 4 \* HOUR_IN_SECONDS/g) || []).length, 1, 'the server creates one fixed four-hour expiry');
	assert.doesNotMatch(start, /avenra_halo_v2_test_ride[^\n]*lifetime|lifetime_seconds/);
	assert.match(start, /COMMIT/);
	assert.match(start, /finally \{[\s\S]*release_advisory_lock\( \$lock \)/);
});

test('keeps monitoring session APIs device-bound, ordered and idempotently endable', () => {
	const update = phpMethod(restSource, 'update_test_ride_monitoring');
	assert.match(update, /public_id = %s AND customer_id = %d AND auth_session_id = %d AND tracking_mode = %s/);
	assert.match(update, /ended_at IS NULL AND expires_at > %s AND last_sequence < %d/);
	assert.match(update, /'test_ride'/);
	assert.match(update, /test_ride_monitoring_position_stale/);

	const end = phpMethod(restSource, 'end_test_ride_monitoring');
	assert.match(end, /acquire_advisory_lock\( 'test-ride-monitoring', \(string\) \$customer_id, 2 \)/);
	assert.match(end, /public_id = %s AND customer_id = %d AND auth_session_id = %d AND tracking_mode = %s/);
	assert.match(end, /if \( ! empty\( \$row->ended_at \) \)/);
	assert.match(end, /'already_ended' => true/);
	assert.match(end, /\$expired \? 'expired' : 'rider_ended'/);
	assert.match(end, /ended_at = %s, ended_reason = %s WHERE id = %d AND ended_at IS NULL/);
});

test('does not expose public tracking bearer credentials for staff monitoring', () => {
	const start = phpMethod(restSource, 'start_test_ride_monitoring');
	assert.match(start, /hash\( 'sha256', \$viewer_secret \)/);
	assert.match(start, /hash\( 'sha256', \$writer_secret \)/);
	assert.match(start, /unset\( \$viewer_secret, \$writer_secret \)/);

	const payload = phpMethod(restSource, 'test_ride_monitoring_payload');
	for (const key of ['session_id', 'status', 'expires_at', 'staff_url']) {
		assert.match(payload, new RegExp(`'${key}'\\s*=>`));
	}
	assert.doesNotMatch(payload, /viewer|writer|guardian|token|hash/i);
	assert.match(payload, /home_url\( '\/halo-emergency-assist\/' \)/);

	const operationsList = phpMethod(operationsSource, 'test_ride_list');
	assert.match(operationsList, /SELECT public_id, customer_id, client_ride_id, started_at, expires_at, latitude, longitude, speed_mph, top_speed_mph, road_name, heading, accuracy_m, last_ping_at/);
	assert.doesNotMatch(operationsList, /SELECT \*/);
	assert.doesNotMatch(operationsList, /viewer_token|writer_token|guardian_token|token_hash/);
});

test('isolates manual rider-share links from test-ride monitoring rows', () => {
	const create = phpMethod(restSource, 'create_live_tracking');
	assert.match(create, /'tracking_mode'\s*=>\s*'rider_share'/);
	assert.match(create, /tracking_mode = %s/);

	for (const methodName of [
		'list_live_tracking', 'end_all_live_tracking', 'view_live_tracking',
		'update_live_tracking', 'end_live_tracking'
	]) {
		const method = phpMethod(restSource, methodName);
		assert.match(method, /tracking_mode = %s/, `${methodName} must scope by tracking mode`);
		assert.match(method, /'rider_share'/, `${methodName} must use only rider_share rows`);
		assert.doesNotMatch(method, /'test_ride'/, `${methodName} must not operate on staff test rides`);
	}
});

test('propagates native telemetry only to the matching test ride and ends that exact session', () => {
	const updateShares = phpMethod(nativeRideSource, 'update_live_shares');
	assert.match(updateShares, /tracking_mode = %s OR \(tracking_mode = %s AND auth_session_id = %d AND client_ride_id = %s\)/);
	assert.match(updateShares, /\$args\[\] = 'rider_share'/);
	assert.match(updateShares, /\$args\[\] = 'test_ride'/);
	assert.match(updateShares, /\$args\[\] = \(int\) \$session->auth_session_id/);
	assert.match(updateShares, /\$args\[\] = \(string\) \$session->client_ride_id/);
	assert.match(updateShares, /ended_at IS NULL AND expires_at > %s/);
	assert.match(updateShares, /last_sequence = IF\(tracking_mode = %s,GREATEST\(last_sequence,%d\),last_sequence\)/);

	const endNative = phpMethod(nativeRideSource, 'end_session');
	assert.match(endNative, /SELECT auth_session_id, client_ride_id/);
	assert.match(endNative, /customer_id = %d AND auth_session_id = %d AND client_ride_id = %s AND tracking_mode = %s AND ended_at IS NULL/);
	assert.match(endNative, /'native_ride_ended'/);
	assert.match(endNative, /'test_ride'/);
	assert.match(endNative, /acquire_advisory_lock\( 'test-ride-monitoring'/);
});

test('keeps the Operations monitor staff-only, bounded and token-free', () => {
	const routes = phpMethod(operationsSource, 'register_routes');
	assert.match(routes, /'\/operations\/dashboard'[\s\S]*'permission_callback' => array\( \$this, 'permission_view' \)/);

	const permission = phpMethod(operationsSource, 'permission');
	assert.match(permission, /is_user_logged_in\(\)/);
	assert.match(permission, /current_user_can\( \$capability \)/);
	assert.match(permission, /get_header\( 'X-WP-Nonce' \)/);
	assert.match(permission, /wp_verify_nonce\( \$nonce, 'wp_rest' \)/);
	assert.match(permission, /same_origin_request\( \$request \)/);

	const consoleMethod = phpMethod(operationsSource, 'serve_console');
	assert.match(consoleMethod, /current_user_can\( self::CAP_VIEW \)/);
	assert.match(consoleMethod, /Cache-Control: private, no-store, no-cache/);
	assert.match(consoleMethod, /connect-src 'self'/);
	assert.match(consoleMethod, /img-src 'self' data:/);
	assert.match(consoleMethod, /refreshMs'[\s\S]*15000/);

	const dashboard = phpMethod(operationsSource, 'dashboard');
	assert.match(dashboard, /'test_rides' => count\( \$test_rides \)/);
	assert.match(dashboard, /'test_rides'\s*=>\s*\$test_rides/);

	const operationsList = phpMethod(operationsSource, 'test_ride_list');
	assert.match(operationsList, /WHERE tracking_mode = %s AND ended_at IS NULL AND expires_at > %s/);
	assert.match(operationsList, /ORDER BY COALESCE\(last_ping_at, started_at\) DESC, id DESC LIMIT 100/);
	assert.match(operationsList, /\$ping_age <= 45/);
	assert.match(operationsList, /\$ping_age <= 300/);
	for (const state of ['waiting', 'active', 'signal_lost', 'stale']) {
		assert.match(operationsList, new RegExp(`'${state}'`));
	}
	assert.match(operationsList, /https:\/\/www\.openstreetmap\.org/);
	assert.match(operationsList, /home_url\( '\/halo-emergency-assist\/' \)/);

	assert.match(operationsTemplate, /data-metric="test_rides"/);
	assert.match(operationsTemplate, /data-test-ride-list/);
	assert.ok(operationsTemplate.indexOf('data-test-ride-list') < operationsTemplate.indexOf('data-rider-list'), 'test rides must render above the rider directory');

	assert.match(operationsAppSource, /credentials: 'same-origin'/);
	assert.match(operationsAppSource, /cache: 'no-store'/);
	assert.match(operationsAppSource, /'X-WP-Nonce': String\(config\.nonce \|\| ''\)/);
	assert.match(operationsAppSource, /renderTestRides\(data\.test_rides \|\| \[\]\)/);
	assert.match(operationsAppSource, /URLSearchParams\(window\.location\.search\)\.get\('test_ride'\)/);
	assert.match(operationsAppSource, /safeSameOriginUrl\(row\.monitor_url\)/);
	assert.match(operationsAppSource, /url\.hostname === 'www\.openstreetmap\.org'/);
	assert.match(operationsAppSource, /data-copy-test-ride-link/);
	assert.match(operationsAppSource, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/);
});

test('wires the one-ride toggle through start, telemetry, end and test ride persistence', () => {
	const safetyUi = between(appSource, 'renderSafety() {', 'async saveSafety(');
	assert.match(safetyUi, /ONE RIDE ONLY/);
	assert.match(safetyUi, /name="test_ride_monitoring_armed"/);
	assert.match(safetyUi, /name="test_ride_monitoring_consent_version"/);
	assert.match(safetyUi, /next Halo ride only/);
	assert.match(safetyUi, /ends when the ride ends or after four hours/);
	assert.match(safetyUi, /does not enable Emergency Assist, share medical information, use the camera or audio, or share previous rides/);
	assert.match(appSource, /data-initial-enabled="\$\{testRideEnabled \? 'true' : 'false'\}"/);
	assert.match(appSource, /if \(testRideRequested !== testRideInitiallyEnabled\)/);
	assert.match(appSource, /payload\.test_ride_monitoring_armed = testRideRequested/);
	assert.match(appSource, /payload\.test_ride_monitoring_consent_version = values\.test_ride_monitoring_consent_version/);

	const lifecycle = between(appSource, 'testRideMonitoringSettings() {', 'async beginRide(');
	assert.match(lifecycle, /settings\.armed === true && settings\.consent_current !== false/);
	assert.match(lifecycle, /this\.api\.post\('\/test-ride-monitoring', \{ client_ride_id: clientRideId \}\)/);
	assert.match(lifecycle, /activeClientRideId/);
	assert.match(lifecycle, /this\.state\.activeRide\.testRideMonitoring = true/);
	assert.match(lifecycle, /armed: false/);
	assert.match(lifecycle, /\/position`, \{/);
	assert.match(lifecycle, /speed_mph: position\.speedMph/);
	assert.match(lifecycle, /this\.api\.delete\(`\/test-ride-monitoring\/\$\{encodeURIComponent\(tracking\.session_id\)\}`/);
	assert.match(lifecycle, /kind: 'test-ride-monitoring-revoke'/);
	assert.match(lifecycle, /if \(!armClaimed\) this\.consumeTestRideMonitoringArm\(\)/);
	assert.match(lifecycle, /revokeTestRideMonitoringArm\(\)/);
	assert.match(lifecycle, /kind: 'test-ride-monitoring-disarm'/);
	assert.match(lifecycle, /test_ride_monitoring_expected_consented_at/);
	assert.match(lifecycle, /expiresAt: Date\.now\(\) \+ \(4 \* 60 \* 60 \* 1000\)/);

	const beginRide = between(appSource, 'async beginRide(', 'updateRideTelemetry(');
	assert.match(beginRide, /const testRideMonitoring = this\.testRideMonitoringArmed\(\)/);
	assert.match(beginRide, /rideMode: testRideMonitoring \? 'test' : setup\.mode, testRideMonitoring/);
	assert.match(beginRide, /this\.state\.activeRide = \{[^\n]*testRideMonitoring \}/);
	assert.match(beginRide, /if \(testRideMonitoring\) void this\.startTestRideMonitoring\(clientRideId\)/);
	assert.match(rideEngineSource, /rideMode: context\.testRideMonitoring \? 'test'/);
	assert.match(rideEngineSource, /testRideMonitoring: Boolean\(context\.testRideMonitoring\)/);
	const pendingFlush = between(appSource, 'async flushRideEnginePending() {', 'openHazardSheet() {');
	assert.match(pendingFlush, /testRideMonitoring: Boolean\(record\.context\?\.testRideMonitoring \|\| record\.context\?\.rideMode === 'test'\)/);

	const syncPayload = between(appSource, 'rideSyncPayload(engineResult, activeRide) {', 'isRetryableRideSave(error) {');
	assert.match(syncPayload, /ride_mode: active\.testRideMonitoring \? 'test'/);

	const endRide = between(appSource, 'async endRide(enginePayload) {', 'hideActiveRide() {');
	assert.match(endRide, /const testRideShutdown = this\.stopTestRideMonitoring\(false\)\.catch\(\(\) => null\)/);
	assert.match(endRide, /await testRideShutdown/);
});

test('withdraws ambiguous starts durably and clears the local active state immediately', () => {
	const lifecycle = between(appSource, 'testRideMonitoringSettings() {', 'async beginRide(');
	assert.match(lifecycle, /markTestRideMonitoringInactive\(response\)/);
	assert.match(lifecycle, /this\.markTestRideMonitoringInactive\(\)/);
	assert.match(lifecycle, /const ambiguousFailure = this\.isRetryableRideSave\(error\)/);
	assert.match(lifecycle, /tracking\.status = retryable \? 'degraded' : ambiguousFailure \? 'unconfirmed' : 'failed'/);
	assert.match(lifecycle, /const revoked = await this\.revokeTestRideMonitoringArm\(\)/);

	const revoke = between(appSource, 'async revokeTestRideMonitoringArm() {', 'async updateTestRideMonitoringPosition(');
	const queueIndex = revoke.indexOf('queued = await this.queue.add({');
	const requestIndex = revoke.indexOf("const response = await this.api.put('/safety'");
	assert.ok(queueIndex >= 0 && requestIndex > queueIndex, 'the privacy cleanup must be durable before its network request');
	assert.match(revoke, /test_ride_monitoring_expected_arm_id = armId/);
	assert.match(revoke, /if \(queued\) await this\.queue\.remove\(queued\.queue_id\)/);

	const safetySave = between(appSource, 'async saveSafety(form) {', 'async withdrawSafetyConsent(');
	assert.match(safetySave, /testRideInitiallyEnabled && !testRideRequested && this\.state\.testRideTracking/);
	assert.match(safetySave, /await this\.stopTestRideMonitoring\(false\)/);

	const queueFlush = between(appSource, 'async flushRideQueue() {', 'async flushRideEnginePending() {');
	assert.match(queueFlush, /test-ride-monitoring-disarm'\) this\.markTestRideMonitoringInactive\(queuedResponse\)/);
});

test('applies the +15% GPS calibration exactly once on each monitoring producer path', () => {
	assert.match(rideEngineSource, /GPS_SPEED_CALIBRATION_FACTOR\s*=\s*1\.15/);
	assert.match(rideEngineSource, /currentSpeed\s*=\s*Math\.max\(0, Math\.round\(calibrateGpsMph\(rawMph\)\)\)/);

	const browserUpdate = between(appSource, 'async updateTestRideMonitoringPosition(', 'renderTestRideMonitoringStatus() {');
	assert.match(browserUpdate, /speed_mph: position\.speedMph/);
	assert.doesNotMatch(browserUpdate, /1\.15|GPS_SPEED_CALIBRATION_FACTOR|gpsMetresPerSecondToMph|calibrateGpsMph/);

	const restUpdate = phpMethod(restSource, 'update_test_ride_monitoring');
	assert.match(restUpdate, /already apply Halo's \+15% GPS calibration/);
	assert.match(restUpdate, /\$speed = \(float\) \$this->number\( \$location\['speed_mph'\]/);
	assert.doesNotMatch(restUpdate, /1\.15|GPS_SPEED_CALIBRATION_FACTOR|METRES_PER_SECOND_TO_MPH/);

	const nativeReceive = phpMethod(nativeRideSource, 'receive_location');
	assert.match(nativeReceive, /\$speed_mps \* self::METRES_PER_SECOND_TO_MPH \* self::GPS_SPEED_CALIBRATION_FACTOR/);
	assert.equal((nativeReceive.match(/GPS_SPEED_CALIBRATION_FACTOR/g) || []).length, 1, 'native ingestion applies the factor once');

	const nativePropagation = phpMethod(nativeRideSource, 'update_live_shares');
	assert.doesNotMatch(nativePropagation, /1\.15|GPS_SPEED_CALIBRATION_FACTOR|METRES_PER_SECOND_TO_MPH/);
});
