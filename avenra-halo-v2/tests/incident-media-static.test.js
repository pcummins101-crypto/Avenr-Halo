'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'includes', 'class-halo-v2-incident-media.php'),
  'utf8'
);
const emergencySource = fs.readFileSync(
  path.join(__dirname, '..', 'includes', 'class-halo-v2-emergency.php'),
  'utf8'
);
const uninstallSource = fs.readFileSync(
  path.join(__dirname, '..', 'uninstall.php'),
  'utf8'
);

function assertBalancedPhp(input, label) {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const opens = new Set(Object.values(pairs));
  const stack = [];
  let state = 'code';
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    const n = input[i + 1];
    if (state === 'line') {
      if (c === '\n') state = 'code';
      continue;
    }
    if (state === 'block') {
      if (c === '*' && n === '/') { state = 'code'; i += 1; }
      continue;
    }
    if (state === 'single' || state === 'double') {
      if (c === '\\') { i += 1; continue; }
      if ((state === 'single' && c === "'") || (state === 'double' && c === '"')) state = 'code';
      continue;
    }
    if ((c === '/' && n === '/') || c === '#') { state = 'line'; if (c === '/') i += 1; continue; }
    if (c === '/' && n === '*') { state = 'block'; i += 1; continue; }
    if (c === "'") { state = 'single'; continue; }
    if (c === '"') { state = 'double'; continue; }
    if (opens.has(c)) stack.push(c);
    if (Object.hasOwn(pairs, c)) assert.equal(stack.pop(), pairs[c], `${label}: unbalanced ${c} at byte ${i}`);
  }
  assert.equal(state, 'code', `${label}: unterminated PHP string/comment`);
  assert.deepEqual(stack, [], `${label}: unclosed PHP delimiter(s)`);
}

assertBalancedPhp(source, 'incident media');
assertBalancedPhp(emergencySource, 'emergency');
assertBalancedPhp(uninstallSource, 'uninstall');

const requiredSnippets = [
  "'incident_camera_enabled'",
  "'incident_camera_dual_enabled'",
  "'incident_camera_consent_version'",
  "'/safety/incident-camera'",
  'media-grant',
  'media/segments',
  'media/finalize',
  "array( 'rear', 'front' )",
  "in_array( (string) $incident->status, array( 'active', 'acknowledged' ), true )",
  "i.status IN ('cancelled','false_alarm')",
  "'_halo_private_file'",
  "'Accept-Ranges: bytes'",
  "hash_file( 'sha256'",
  "move_uploaded_file(",
  "avenra_halo_v2_incident_media_retention_days",
  "empty( $errors ) && $self->main_camera_schema_ready() && $self->schema_ready()",
  'SHOW COLUMNS FROM',
  'SHOW INDEX FROM',
  "m.retain_until <= %s",
  "verification_status IN ('container_verified','external_verified')",
  "apply_filters( 'avenra_halo_v2_incident_media_validate_segment', null",
  "'incident-media-grant-issue'",
  "'incident_media_ride_mismatch'",
  "incident->client_ride_id",
  "@chmod( $directory, 0700 )",
  "@chmod( $target, 0600 )",
  "'incident_state_changed'",
  "'/site-' . get_current_blog_id() . '-' . $this->storage_scope_hash()",
  "'provider_ready'",
  "'storage_ready'",
  "'readiness_reason'",
  "'video_verifier_unavailable'",
  "'incident_camera_provider_unavailable'",
];

for (const snippet of requiredSnippets) {
  assert.ok(source.includes(snippet), `missing incident-media contract: ${snippet}`);
}

assert.ok(
  !source.includes("base64_encode( file_get_contents"),
  'video must never be embedded as base64 in incident JSON'
);
assert.match(source, /MAX_SEGMENTS_PER_CAMERA\s*=\s*6/);
assert.match(source, /MAX_TOTAL_DURATION_MS\s*=\s*65000/);
assert.match(source, /INSTALL_RETRY_SECONDS\s*=\s*300/);
assert.match(source, /MAX_DURATION_DRIFT_MS\s*=\s*3000/);
assert.match(source, /MAX_ACCEPTED_DURATION_MS\s*=\s*self::MAX_DURATION_MS\s*\+\s*self::MAX_DURATION_DRIFT_MS/);
assert.match(source, /camera_role varchar\(8\)/);
assert.match(source, /UNIQUE KEY incident_camera_segment/);
assert.ok(!source.includes("'metadata_only'"), 'metadata-only video must never become ready evidence');

const installStart = source.indexOf('public static function install()');
const installEnd = source.indexOf('public function maybe_install()', installStart);
const installMethod = source.slice(installStart, installEnd);
assert.ok(installMethod.includes('$self->main_camera_schema_ready()'), 'install must validate its main-schema dependencies');
assert.ok(installMethod.includes('delete_transient( self::INSTALL_RETRY_TRANSIENT )'), 'successful install must clear its retry cooldown');
assert.ok(installMethod.includes('set_transient( self::INSTALL_RETRY_TRANSIENT'), 'failed install must retain a retry cooldown');

const maybeInstallStart = source.indexOf('public function maybe_install()');
const maybeInstallEnd = source.indexOf('public function register_routes()', maybeInstallStart);
const maybeInstallMethod = source.slice(maybeInstallStart, maybeInstallEnd);
assert.ok(maybeInstallMethod.includes('$this->main_camera_schema_ready()'), 'self-repair must inspect main camera schema');
assert.ok(maybeInstallMethod.includes('$this->schema_ready()'), 'self-repair must inspect full incident-media contracts');
assert.ok(maybeInstallMethod.includes('Avenra_Halo_V2_Database::install()'), 'main schema gaps must invoke the owning installer');
assert.ok(maybeInstallMethod.includes('self::install()'), 'incident-media gaps must invoke the component installer');
assert.ok(maybeInstallMethod.includes('get_transient( self::INSTALL_RETRY_TRANSIENT )'), 'self-repair must respect its retry cooldown');
assert.ok(maybeInstallMethod.indexOf('set_transient( self::INSTALL_RETRY_TRANSIENT') < maybeInstallMethod.indexOf('Avenra_Halo_V2_Database::install()'), 'self-repair must set its concurrency cooldown before migrations');
assert.doesNotMatch(maybeInstallMethod, /!\s*\$this->storage_ready\(\)/, 'table presence alone must not determine migration readiness');

const uploadStart = source.indexOf('public function upload_segment');
const uploadEnd = source.indexOf('public function finalize_upload', uploadStart);
const uploadMethod = source.slice(uploadStart, uploadEnd);
assert.ok(uploadMethod.includes('$duration_ms > self::MAX_DURATION_MS'), 'declared duration must remain inside the advertised twelve-second contract');
assert.ok(uploadMethod.includes("$duration_ms = (int) ( $validation['duration_ms'] ?? $duration_ms )"), 'verified duration must drive quotas and persistence');

const verifyStart = source.indexOf('private function verify_video_segment');
const verifyEnd = source.indexOf('private function read_actual_video_metadata', verifyStart);
const verifyMethod = source.slice(verifyStart, verifyEnd);
assert.ok(verifyMethod.includes('$verified_duration > self::MAX_ACCEPTED_DURATION_MS'), 'verified media must remain within the hard duration ceiling');
assert.ok(verifyMethod.includes("'duration_ms'         => null !== $verified_duration ? $verified_duration : $declared_duration_ms"), 'verification must return the authoritative bounded duration');

const settingsStart = source.indexOf('public function set_camera_settings');
const settingsEnd = source.indexOf('public function camera_settings', settingsStart);
const settingsMethod = source.slice(settingsStart, settingsEnd);
const assistLock = settingsMethod.indexOf("acquire_advisory_lock( 'emergency-consent'");
const cameraLock = settingsMethod.indexOf("acquire_advisory_lock( 'incident-camera-consent'");
assert.ok(assistLock >= 0 && cameraLock > assistLock, 'camera settings must lock Assist consent first');
assert.ok(
  settingsMethod.indexOf('assist_consent( $customer_id )', cameraLock) > cameraLock,
  'Assist consent must be rechecked while both locks are held'
);
assert.ok(
  settingsMethod.indexOf('if ( ! $settings_changed )') < settingsMethod.indexOf("incident_camera_consented_at']    = $now"),
  'idempotent camera saves must return before consent timestamps and audit events'
);
assert.ok(settingsMethod.includes('$revocation &&'), 'grant revocation must only follow enabled-to-disabled transition');

assert.match(
  emergencySource,
  /case 'false_alarm':[\s\S]{0,500}acquire_advisory_lock\( 'incident-media-upload'/,
  'false alarm must serialize against evidence insertion'
);
assert.ok(
  (emergencySource.match(/acquire_advisory_lock\( 'incident-media-upload'/g) || []).length >= 3,
  'candidate cancellation paths and false alarm must all share the media upload lock'
);

assert.ok(uninstallSource.includes('$incident_scope_hash'), 'uninstall must reproduce install storage scope');
assert.ok(uninstallSource.includes('$required_basename'), 'uninstall must refuse another install scope directory');
assert.ok(uninstallSource.includes('$required_incident_marker'), 'uninstall must verify install-specific ownership marker');
assert.ok(
  !uninstallSource.includes("$purge_directory( (string) $incident_directory, true )"),
  'generic incident marker cleanup is unsafe for shared storage'
);

console.log('incident-media static contracts: ok');
