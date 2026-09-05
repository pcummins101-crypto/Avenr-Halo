'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets', 'js', 'app.js'), 'utf8');
const camera = fs.readFileSync(path.join(root, 'assets', 'js', 'incident-camera.js'), 'utf8');
const plugin = fs.readFileSync(path.join(root, 'includes', 'class-halo-v2-plugin.php'), 'utf8');
const template = fs.readFileSync(path.join(root, 'templates', 'app-shell.php'), 'utf8');

function method(source, name, nextName) {
	const start = source.indexOf(name);
	const end = source.indexOf(nextName, start + name.length);
	assert.notEqual(start, -1, `${name} must exist`);
	assert.notEqual(end, -1, `${nextName} must follow ${name}`);
	return source.slice(start, end);
}

test('loads Ride Memories before the app and includes it in offline assets', () => {
	assert.match(plugin, /wp_enqueue_script\( 'avenra-halo-v2-ride-memories',[\s\S]*assets\/js\/ride-memories\.js/);
	assert.match(plugin, /'avenra-halo-v2-app'[\s\S]*'avenra-halo-v2-ride-memories'/);
	assert.match(plugin, /assets\/js\/ride-memories\.js\?ver=/);
	assert.match(plugin, /'avenra-halo-v2-ride-memories', 'avenra-halo-v2-app'/);
});

test('makes recording an explicit per-ride choice with audio and storage disclosure', () => {
	assert.match(template, /name="ride_memories_enabled"/);
	assert.match(template, /name="ride_memories_dual_enabled"/);
	assert.match(template, /private browser storage/);
	assert.match(template, /Audio is always off/);
	assert.match(template, /never uploaded automatically/);
	assert.match(template, /Clearing app\/site data removes it/);
	assert.match(template, /time-synchronised GPS telemetry/);
	const preferences = method(app, 'loadRideMemoryPreferences() {', 'saveRideMemoryPreferences(preferences) {');
	assert.match(preferences, /return \{ enabled: false, dual: false \}/);
	assert.doesNotMatch(preferences, /localStorage/);
});

test('starts one camera pipeline for either safety evidence or private memories', () => {
	const begin = method(app, 'async beginRide(route, button) {', 'bindHoldControl() {');
	assert.match(begin, /const cameraNeeded = cameraPreferences\.enabled \|\| memoryPreferences\.enabled/);
	assert.match(begin, /const preferDual = \(cameraPreferences\.enabled && cameraPreferences\.dual\) \|\| \(memoryPreferences\.enabled && memoryPreferences\.dual\)/);
	assert.match(begin, /incidentCamera\.startRide\(\{ rideId: clientRideId, ride_id: clientRideId, preferDual \}\)/);
	assert.match(begin, /rideMemories\.beginRide\([\s\S]*audio: false/);
	assert.match(begin, /state\.activeRide = \{[\s\S]*rideMemories: memoryRecording/);
});

test('hands Blob segments to private storage before rolling eviction', () => {
	assert.match(app, /incidentCamera\?\.on\?\.\('segmentdata',[\s\S]*archiveRideMemorySegment\(event\?\.detail\?\.segment\)/);
	const append = method(camera, '_appendSegment(segment) {', '_deleteSegment(segment, reason) {');
	const dataAt = append.indexOf("this._emit('segmentdata'");
	const evictionAt = append.indexOf('while (this._segments.length > limit)');
	assert.ok(dataAt >= 0 && evictionAt > dataAt);
	const archive = method(app, 'async archiveRideMemorySegment(segment) {', 'handleRideMemoryFailure(error) {');
	assert.match(archive, /recording\?\.blob/);
	assert.match(archive, /recording\.camera === 'rear' \|\| \(recording\.camera === 'front' && session\.dual\)/);
	assert.match(archive, /this\.rideMemories\.appendSegment/);
	assert.match(archive, /maximumPendingBytes = 64 \* 1024 \* 1024/);
	assert.match(archive, /ride_memories_write_backlog/);
	assert.doesNotMatch(archive, /this\.api\.|fetch\(/);
});

test('archives the final clip and drains local writes before finalising the manifest', () => {
	const end = method(app, 'async endRide(enginePayload) {', 'hideActiveRide() {');
	assert.match(end, /stopIncidentCameraCapture\('ride-ended', \{ archive: Boolean\(this\.rideMemorySession\) \}\)/);
	assert.match(end, /finalizeRideMemory\(active, rideMemorySnapshot, cameraShutdown\.stopPromise\)/);
	assert.ok(end.indexOf('const rideMemoryFinalizePromise') < end.indexOf('engineResult = await this.rideEngine.end('), 'local footage finalisation must start before ride/network synchronisation');
	const finalize = method(app, 'async finalizeRideMemory(activeRide, engineResult, cameraStopPromise) {', 'incidentCameraPreferences() {');
	const cameraAt = finalize.indexOf('await Promise.resolve(cameraStopPromise)');
	const queueAt = finalize.indexOf('await this.rideMemoryWriteQueue');
	const manifestAt = finalize.indexOf('this.rideMemories.finalizeRide');
	assert.ok(cameraAt >= 0 && queueAt > cameraAt && manifestAt > queueAt);
});

test('lists, plays and deletes only customer-scoped HALO records', () => {
	const render = method(app, 'async renderRideMemoryLibrary() {', 'async openRideMemory(rideId) {');
	assert.match(render, /rideMemories\.listRides\(\{ customerKey \}\)/);
	assert.match(render, /unfinished = ride\.status === 'recording'/);
	assert.match(render, /data-action="recover-ride-memory"/);
	assert.doesNotMatch(render, /showOpenFilePicker|webkitdirectory|input[^\n]*type=.file/);
	const open = method(app, 'async openRideMemory(rideId) {', 'async loadRideMemoryPlayerSegment(index, attemptPlayback) {');
	assert.match(open, /rideMemories\.getSegments\(\{ customerKey, rideId \}\)/);
	assert.match(open, /ride\.status === 'recording'/);
	const load = method(app, 'async loadRideMemoryPlayerSegment(index, attemptPlayback) {', 'async switchRideMemoryCamera(camera) {');
	assert.match(load, /rideMemories\.getSegment\(\{ customerKey: player\.customerKey, rideId: player\.rideId, camera: descriptor\.camera, sequence: descriptor\.sequence \}\)/);
	const recover = method(app, 'async recoverRideMemory(rideId, button) {', 'async deleteRideMemory(rideId, button) {');
	assert.match(recover, /rideMemories\.recoverRide\(\{ customerKey, rideId, confirmAbandoned: true \}\)/);
	const remove = method(app, 'async deleteRideMemory(rideId, button) {', 'renderMore() {');
	assert.match(remove, /rideMemories\.deleteRide\(\{ customerKey, rideId \}\)/);
});

test('adds synchronized telemetry, combined camera playback and non-destructive clip export', () => {
	const capture = method(app, 'captureRideMemoryTelemetry(payload) {', 'telemetryForRideMemorySegment(session, segment) {');
	assert.match(capture, /lastTelemetrySampleAt/);
	assert.match(capture, /< 1000/);
	assert.match(capture, /Math\.abs\(at - positionAt\) <= 5000/);
	assert.match(capture, /speedMph/);
	assert.match(capture, /currentRoadName/);
	assert.match(capture, /telemetryPoints/);

	const segmentTelemetry = method(app, 'telemetryForRideMemorySegment(session, segment) {', 'updateRideTelemetry(payload) {');
	assert.match(segmentTelemetry, /segment\?\.startedAt/);
	assert.match(segmentTelemetry, /segment\?\.endedAt/);
	assert.match(segmentTelemetry, /slice\(-64\)/);
	const archive = method(app, 'async archiveRideMemorySegment(segment) {', 'handleRideMemoryFailure(error) {');
	assert.match(archive, /telemetryForRideMemorySegment\(session, segment\)/);
	assert.match(archive, /durationMs:[\s\S]*telemetry/);

	const open = method(app, 'async openRideMemory(rideId) {', 'async loadRideMemoryPlayerSegment(index, attemptPlayback) {');
	assert.match(open, /cameras\.concat\('dual'\)/);
	assert.match(open, /Front \+ rear/);
	assert.match(open, /data-ride-memory-video-secondary/);
	assert.match(open, /data-ride-memory-telemetry-overlay/);
	assert.match(open, /controlslist="nofullscreen noremoteplayback"/);
	const load = method(app, 'async loadRideMemoryPlayerSegment(index, attemptPlayback) {', 'rideMemoryExportSupported() {');
	assert.match(load, /primaryCamera = player\.camera === 'dual' \? 'rear'/);
	assert.match(load, /secondaryDescriptor/);
	assert.match(load, /syncRideMemorySecondaryVideo/);
	assert.match(load, /secondaryDuration \/ primaryDuration/);
	assert.match(load, /video\.onwaiting/);
	assert.match(load, /degradeRideMemorySecondaryVideo/);

	const exportClip = method(app, 'async createRideMemoryTelemetryExport(job, segment, telemetry, ride) {', 'rideMemoryNativeExport(objectUrl, filename, mimeType) {');
	assert.match(exportClip, /canvas\.captureStream\(24\)/);
	assert.match(exportClip, /new window\.MediaRecorder/);
	assert.match(exportClip, /drawRideMemoryTelemetryFrame/);
	assert.match(exportClip, /prepareTimeout/);
	assert.match(exportClip, /finalizeTimeout/);
	assert.match(exportClip, /rejectStopped/);
	assert.match(app, /video\/mp4;codecs=h264/);
	assert.doesNotMatch(exportClip, /rideMemories\.(?:appendSegment|deleteRide)|this\.api\.|fetch\(/);
	const delivery = method(app, 'async deliverRideMemoryTelemetryExport(blob, filename) {', 'cancelRideMemoryExport(reason) {');
	assert.match(delivery, /navigator\.canShare/);
	assert.match(delivery, /rideMemoryNativeExport/);
	assert.match(app, /WebToNativeInterface[\s\S]*downloadFile/);
	const download = method(app, 'async exportRideMemoryClip(button) {', 'releaseRideMemoryObjectUrl() {');
	assert.match(download, /_TELEMETRY\.\$\{extension\}/);
	assert.match(download, /private original is unchanged/i);
	assert.match(app, /cancelRideMemoryExport\('backgrounded'\)/);
});

test('keeps active manifests leased and closes identity-bound drafts before storage', () => {
	const heartbeat = method(app, 'startRideMemoryLeaseHeartbeat(session) {', 'stopRideMemoryLeaseHeartbeat() {');
	assert.match(heartbeat, /window\.setInterval/);
	assert.match(heartbeat, /refreshRideMemoryLease\(session\)/);
	const refresh = method(app, 'async refreshRideMemoryLease(expectedSession) {', 'closeRideMemoryGap(reason) {');
	assert.match(refresh, /rideMemories\.refreshLease\(\{ customerKey: session\.customerKey, rideId: session\.rideId \}\)/);

	const reset = method(app, 'async resetIdentityBoundState(options) {', 'setAuthAlert(message, success) {');
	const cameraAt = reset.indexOf('const cameraShutdown = Promise.resolve(this.incidentCamera?.stopRide?.');
	const nativeAt = reset.indexOf("const nativeShutdown = Promise.resolve(this.nativeRide?.stop?.('identity_changed'))");
	const shutdownAwaitAt = reset.indexOf('await Promise.all([cameraShutdown, nativeShutdown, ecuShutdown, bmsShutdown])');
	const startAt = reset.indexOf('await Promise.resolve(memoryStart)');
	const writesAt = reset.indexOf('await this.rideMemoryWriteQueue');
	const closeAt = reset.indexOf('this.rideMemories?.close?.()');
	assert.ok(cameraAt >= 0 && nativeAt > cameraAt && shutdownAwaitAt > nativeAt, 'camera shutdown must begin before native/network cleanup is awaited');
	assert.ok(startAt >= 0 && writesAt > startAt && closeAt > writesAt);
	assert.match(reset, /rideMemories\?\.finalizeRide\?\./);
	assert.match(reset, /rideMemories\?\.deleteRide\?\./);
	assert.ok(reset.indexOf('this.stopRideMemoryLeaseHeartbeat()') > writesAt, 'the storage lease must remain refreshed through queued final writes');
});
