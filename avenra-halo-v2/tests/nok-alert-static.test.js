'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const between = (source, start, end) => {
	const from = source.indexOf(start);
	assert.notEqual(from, -1, `missing ${start}`);
	const to = source.indexOf(end, from + start.length);
	assert.notEqual(to, -1, `missing ${end}`);
	return source.slice(from, to);
};

const emergency = read('includes/class-halo-v2-emergency.php');
const rest = read('includes/class-halo-v2-rest.php');

test('the Emergency service can send next-of-kin SMS through the shared transport', () => {
	assert.match(emergency, /public function send_next_of_kin_sms\( string \$kind, array \$payload, object \$customer \): array\|WP_Error/);
	assert.match(emergency, /public function sms_configured\(\): bool/);
	assert.match(emergency, /public function use_built_in_nok_sms\(\): bool/);
	const sender = between(emergency, 'public function send_next_of_kin_sms(', 'private function send_sms(');
	assert.match(sender, /normalise_mobile\( \(string\) \( \$customer->nok_mobile/);
	assert.match(sender, /TEST alert/);
	assert.match(sender, /'accepted' === \$result\['state'\]/, 'success is reported only after provider acceptance');
	assert.match(sender, /alert_provider_not_configured/);
	assert.doesNotMatch(sender, /wp_ajax|Legacy_Bridge/, 'the built-in sender must not depend on V1 admin-ajax');
	const responder = between(emergency, 'private function deliver_responder_sms(', 'public function sms_configured()');
	assert.match(responder, /return \$this->send_sms\( \$destination, \$message, \$context \);/, 'responder SMS uses the same transport');
	const transport = between(emergency, 'private function send_sms(', 'private function normalise_delivery_override(');
	assert.match(transport, /avenra_halo_v2_emergency_sms_delivery/);
	assert.match(transport, /self::FIRETEXT_ENDPOINT/);
});

test('rider test and crash alerts prefer the built-in sender before the V1 bridge', () => {
	const perform = between(rest, 'private function perform_safety_alert(', 'private function safety_alert_error(');
	const filterAt = perform.indexOf("apply_filters( 'avenra_halo_v2_safety_alert_result'");
	const builtInAt = perform.indexOf('send_next_of_kin_sms( $kind, $payload, $customer )');
	const legacyAt = perform.indexOf('Legacy_Bridge::instance()->dispatch( $legacy_action');
	assert.ok(filterAt !== -1 && builtInAt !== -1 && legacyAt !== -1);
	assert.ok(filterAt < builtInAt && builtInAt < legacyAt, 'filter, then built-in SMS, then legacy bridge');
	assert.match(perform, /use_built_in_nok_sms\(\)/);
	assert.match(perform, /legacy_action_missing[\s\S]*alert_provider_not_configured/, 'a missing V1 handler is a configuration error, not an outage');
	const testAlert = between(rest, 'public function test_safety_alert(', 'public function record_incident_candidate(');
	assert.match(testAlert, /perform_nok_safety_alert\(\s*'test'/);
	assert.match(testAlert, /safety_alert_error\( \$result \)/);
});

test('responder-triggered next-of-kin notifications use the built-in sender first', () => {
	const notify = between(emergency, 'private function notify_next_of_kin(', 'private function record_nok_result(');
	const builtInAt = notify.indexOf("send_next_of_kin_sms( 'crash', $payload, $customer )");
	const legacyAt = notify.indexOf("dispatch( 'send_nok_crash_alert_v2'");
	assert.ok(builtInAt !== -1 && legacyAt !== -1 && builtInAt < legacyAt);
	assert.match(notify, /test_action_blocked/, 'test exercises still never contact a next of kin');
	assert.match(notify, /emergency_call_required/, 'a recorded 999 call is still required first');
});
