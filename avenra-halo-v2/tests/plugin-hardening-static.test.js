'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rest = fs.readFileSync(
	path.join(__dirname, '..', 'includes', 'class-halo-v2-rest.php'),
	'utf8'
);
const plugin = fs.readFileSync(
	path.join(__dirname, '..', 'includes', 'class-halo-v2-plugin.php'),
	'utf8'
);

function phpMethod(source, signature, nextSignature) {
	const start = source.indexOf(signature);
	const end = source.indexOf(nextSignature, start + signature.length);
	assert.notEqual(start, -1, `${signature} must exist`);
	assert.notEqual(end, -1, `${nextSignature} must follow ${signature}`);
	return source.slice(start, end);
}

test('post-insert reads are guarded before strict serializers', () => {
	const contracts = [
		['public function save_ride(', 'public function hazards(', 'serialise_ride', 'ride_read_failed'],
		['public function save_hazard(', 'public function create_live_tracking(', 'serialise_hazard', 'hazard_read_failed'],
		['public function upload_document(', 'public function download_document(', 'serialise_document', 'document_read_failed'],
	];

	for (const [start, end, serializer, errorCode] of contracts) {
		const method = phpMethod(rest, start, end);
		const readAt = method.lastIndexOf('$wpdb->get_row(');
		const guardAt = method.indexOf('if ( ! is_object( $row ) )', readAt);
		const serializerAt = method.indexOf(`$this->${serializer}( $row )`, guardAt);
		assert.ok(readAt >= 0, `${start} must read the inserted row`);
		assert.ok(guardAt > readAt, `${start} must guard a null post-insert read`);
		assert.ok(serializerAt > guardAt, `${start} must guard before ${serializer}`);
		assert.ok(method.includes(`'${errorCode}'`), `${start} must return ${errorCode}`);
	}
});

test('upgrade retries are cooled down and activation resets the gate', () => {
	const activate = phpMethod(plugin, 'public static function activate(', 'public static function deactivate(');
	const upgrade = phpMethod(plugin, 'public function maybe_upgrade(', '/** Restore the retention job');
	assert.match(plugin, /UPGRADE_RETRY_SECONDS\s*=\s*300/);
	assert.match(activate, /delete_transient\( self::UPGRADE_RETRY_TRANSIENT \)/);
	assert.ok(upgrade.indexOf('get_transient( self::UPGRADE_RETRY_TRANSIENT )') < upgrade.indexOf('Avenra_Halo_V2_Database::install()'));
	assert.ok(upgrade.indexOf('set_transient( self::UPGRADE_RETRY_TRANSIENT') < upgrade.indexOf('Avenra_Halo_V2_Database::install()'));
	assert.match(upgrade, /get_option\( 'avenra_halo_v2_db_version', '' \)[\s\S]*delete_transient\( self::UPGRADE_RETRY_TRANSIENT \)/);
});

test('cleanup schedule repairs itself and deactivation clears every occurrence', () => {
	const boot = phpMethod(plugin, 'public function boot(', 'public static function activate(');
	const deactivate = phpMethod(plugin, 'public static function deactivate(', 'public function maybe_upgrade(');
	const schedule = phpMethod(plugin, 'public function ensure_cleanup_schedule(', 'private static function create_app_page(');
	assert.match(boot, /add_action\( 'init', array\( \$this, 'ensure_cleanup_schedule' \) \)/);
	assert.match(schedule, /! wp_next_scheduled\( 'avenra_halo_v2_cleanup' \)/);
	assert.match(schedule, /wp_schedule_event\( time\(\) \+ HOUR_IN_SECONDS, 'daily', 'avenra_halo_v2_cleanup' \)/);
	assert.match(deactivate, /wp_clear_scheduled_hook\( 'avenra_halo_v2_cleanup' \)/);
});
