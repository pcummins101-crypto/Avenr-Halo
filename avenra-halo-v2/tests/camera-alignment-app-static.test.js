'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const app = read('assets/js/app.js');
const alignment = read('assets/js/camera-alignment.js');
const css = read('assets/css/halo-v2.css');
const shell = read('templates/app-shell.php');
const plugin = read('includes/class-halo-v2-plugin.php');

test('Ride setup exposes an explicit, independent camera alignment action', () => {
	assert.match(shell, /id="halo-camera-alignment-title">Camera alignment check</);
	assert.match(shell, /data-action="check-camera-alignment"/);
	assert.match(shell, /Live preview only[^<]*audio off[^<]*nothing is recorded, saved or uploaded/);
	assert.match(app, /case 'check-camera-alignment': await this\.openCameraAlignment\(\)/);
	assert.match(app, /Check camera alignment[\s\S]*BEFORE YOU RIDE/);
});

test('alignment requests video-only rear and front streams and has no recording path', () => {
	assert.match(alignment, /_cameraConstraints\(role, exact\)[\s\S]*?audio:\s*false/);
	assert.match(alignment, /await this\._getCamera\('rear'(?:,\s*generation)?\)/);
	assert.match(alignment, /await this\._getCamera\('front'(?:,\s*generation)?\)/);
	assert.match(alignment, /recording:\s*false/);
	assert.match(alignment, /saving:\s*false/);
	assert.match(alignment, /uploading:\s*false/);
	assert.doesNotMatch(alignment, /MediaRecorder|indexedDB|fetch\s*\(/);
	assert.match(app, /requests no microphone access, starts no recorder, stores nothing/);
});

test('the full uncropped camera frame has centre guides and truthful single-camera fallback controls', () => {
	assert.match(app, /data-camera-alignment-video="rear"/);
	assert.match(app, /data-camera-alignment-video="front"/);
	assert.match(app, /data-action="camera-alignment-switch" data-camera-role="rear"/);
	assert.match(app, /data-action="camera-alignment-switch" data-camera-role="front"/);
	assert.match(app, /This phone previews one camera at a time/);
	assert.match(css, /\.halo-camera-alignment__frame video\s*\{[^}]*object-fit:\s*contain;[^}]*transform:\s*none;/);
	assert.match(css, /\.halo-camera-alignment__guide::before/);
	assert.match(css, /\.halo-camera-alignment__guide::after/);
});

test('preview tracks are stopped at every privacy and ride boundary', () => {
	assert.match(app, /pagehide[\s\S]*?closeCameraAlignment\('page-hidden'\)/);
	assert.match(app, /resetIdentityBoundState[\s\S]*?closeCameraAlignment\('identity-changed'\)/);
	assert.match(app, /beginRide\(route, button\)[\s\S]*?closeCameraAlignment\('ride-starting'\)/);
	assert.match(app, /addEventListener\('close'[\s\S]*?closeCameraAlignment\('dialog-closed'\)/);
	assert.match(app, /addEventListener\('cancel'[\s\S]*?closeCameraAlignment\('dialog-cancelled'\)/);
	assert.match(app, /dialog-backdrop/);
	assert.match(alignment, /_documentHidden\(\) && this\._active\) this\.stop\('document-hidden'\)/);
	assert.match(alignment, /stop\(reason, options\)[\s\S]*?this\._stopAllStreams\(\)/);
});

test('Ride start fences alignment work and a preview is only counted after a rendered frame', () => {
	assert.match(app, /this\.rideStarting = true;[\s\S]*?closeCameraAlignment\('ride-starting'\)[\s\S]*?cameraAlignmentSettlement\(\)/);
	assert.match(app, /if \(this\.rideStarting \|\| this\.state\.activeRide\) throw new HaloAPIError\('Camera alignment can only be checked before a ride starts\.'/);
	assert.match(app, /trackCameraAlignmentOperation\(operation\)[\s\S]*?this\.cameraAlignmentOperations\.add\(promise\)/);
	assert.match(app, /video\.videoWidth[\s\S]*?video\.videoHeight[\s\S]*?cameraAlignmentViewed\[role\] = true/);
	assert.match(app, /addEventListener\('loadeddata', rendered\)/);
	assert.match(app, /addEventListener\('playing', rendered\)/);
	assert.match(app, /Close preview/);
	assert.doesNotMatch(app, /Done — alignment is good/);
});

test('camera alignment script is deferred, an app dependency and available offline', () => {
	assert.match(plugin, /wp_enqueue_script\( 'avenra-halo-v2-camera-alignment',[\s\S]*?assets\/js\/camera-alignment\.js/);
	assert.match(plugin, /'avenra-halo-v2-app'[\s\S]*?'avenra-halo-v2-camera-alignment'/);
	assert.ok((plugin.match(/avenra-halo-v2-camera-alignment/g) || []).length >= 3);
	assert.match(plugin, /assets\/js\/camera-alignment\.js\?ver=/);
});
