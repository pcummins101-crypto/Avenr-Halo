'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appPath = path.join(__dirname, '..', 'assets', 'js', 'app.js');
const source = fs.readFileSync(appPath, 'utf8');

function method(name, nextName) {
	const start = source.indexOf(name);
	const end = source.indexOf(nextName, start + name.length);
	assert.notEqual(start, -1, `${name} must exist`);
	assert.notEqual(end, -1, `${nextName} must follow ${name}`);
	return source.slice(start, end);
}

test('a real crash binds the frozen ring buffer to an event and ride before freezing', () => {
	const body = method('showCrashState(payload) {', 'updateCrashCountdownDisplay(remaining) {');
	const contextAt = body.indexOf('this.incidentCameraPendingContext = {');
	const freezeAt = body.indexOf('this.incidentCamera?.freezeCandidate?.(incoming)');
	assert.ok(contextAt >= 0 && freezeAt > contextAt);
	assert.match(body, /event_id:\s*String\(incoming\.event_id/);
	assert.match(body, /ride_id:\s*String\(this\.state\.activeRide\?\.id/);
});

test('durable incident activation secures video independently of SMS acceptance', () => {
	const reconcile = method('async reconcileEmergencyIncident(eventId, payload) {', 'async pollEmergencyIncident(eventId, payload, attempts = 5) {');
	assert.match(reconcile, /const durableActive = Boolean\(response\?\.incident_id\)/);
	assert.match(reconcile, /this\.confirmIncidentCamera\(response, incidentPayload\);/);
	assert.match(reconcile, /if \(response\?\.accepted === true\) this\.showEmergencyAssistActive/);

	const send = method('async performCrashAlert(reason, button) {', 'showEmergencyAssistActive(response, payload) {');
	assert.match(send, /const durableActive = assistEnabled && Boolean\(assistResponse\.incident_id\)/);
	assert.match(send, /if \(durableActive\)[\s\S]*this\.confirmIncidentCamera\(assistResponse, payload\);/);
	assert.doesNotMatch(send, /discardIncidentCameraCandidate\('incident-(?:not-activated|activation-failed)'\)/);
});

test('explicit closure destroys candidate video while ambiguous activation does not', () => {
	const reconcile = method('async reconcileEmergencyIncident(eventId, payload) {', 'async pollEmergencyIncident(eventId, payload, attempts = 5) {');
	assert.match(reconcile, /\['cancelled', 'false_alarm', 'resolved'\][\s\S]*discardIncidentCameraCandidate/);
	const send = method('async performCrashAlert(reason, button) {', 'showEmergencyAssistActive(response, payload) {');
	const catchBody = send.slice(send.lastIndexOf('} catch (error) {'));
	assert.doesNotMatch(catchBody, /discardIncidentCameraCandidate/);
});

test('capture shutdown retains only frozen or confirmed evidence that still needs delivery', () => {
	const pending = method('incidentCameraEvidencePending() {', 'incidentCameraCanBindEvent(eventId) {');
	assert.match(pending, /'frozen', 'uploading', 'upload-failed', 'pending-upload', 'retained'/);
	assert.match(pending, /durableContext = Boolean\(this\.incidentCameraPendingContext\?\.event_id && this\.incidentCameraPendingContext\?\.incident_id\)/);
	assert.match(pending, /durableContext &&[\s\S]*phase === 'freezing'/);
	const stop = method('stopIncidentCameraCapture(reason, options) {', 'async stopIncidentCameraForConsentWithdrawal(reason) {');
	assert.match(stop, /const retainCameraEvidence = this\.incidentCameraEvidencePending\(\)/);
	assert.match(stop, /stopRide\?\.\(\{[\s\S]*discard: !retainCameraEvidence/);
	assert.match(stop, /archive: settings\.archive/);
	assert.match(stop, /if \(retainCameraEvidence\) this\.scheduleIncidentCameraRetry\(\);[\s\S]*else \{[\s\S]*incidentCameraPendingContext = null/);
});

test('ride startup and local storage failures use evidence-aware camera shutdown', () => {
	const begin = method('async beginRide(route, button) {', 'bindHoldControl() {');
	assert.match(begin, /stopIncidentCameraCapture\('ride-memory-start-failed', \{ archive: false, preserveMemory: false \}\)/);
	assert.match(begin, /stopIncidentCameraCapture\('ride-start-failed', \{ archive: false, preserveMemory: false \}\)/);
	assert.doesNotMatch(begin, /stopRide\?\.\(\{ discard: true, reason: 'ride-(?:memory-start|start)-failed'/);
	const failure = method('handleRideMemoryFailure(error) {', 'renderRideMemoryStatus() {');
	assert.match(failure, /stopIncidentCameraCapture\('ride-memory-storage-failed', \{ archive: false, preserveMemory: false \}\)/);
	assert.doesNotMatch(failure, /stopRide\?\.\(\{ discard: true/);
});

test('ending a ride starts native GPS and camera shutdown before persistence or tracking waits', () => {
	const body = method('async endRide(enginePayload) {', 'hideActiveRide() {');
	const nativeStopAt = body.indexOf("this.nativeRide?.stop?.('ride_ended')");
	const cameraStopAt = body.indexOf("this.stopIncidentCameraCapture('ride-ended'");
	assert.ok(nativeStopAt >= 0 && cameraStopAt > nativeStopAt);
	for (const later of ['await this.flushRideEnginePending()', 'engineResult = await this.rideEngine.end(', "await this.api.post('/rides'", 'await this.stopLiveTracking(false)']) {
		const laterAt = body.indexOf(later);
		assert.ok(laterAt > cameraStopAt, `${later} must follow device capture shutdown`);
	}
});

test('identity changes hide private UI immediately and sign-out does not wait on the network to stop capture', () => {
	const reset = method('async resetIdentityBoundState(options) {', 'setAuthAlert(message, success) {');
	const generationAt = reset.indexOf('const resetGeneration = ++this.identityResetGeneration');
	const playerAt = reset.indexOf('this.closeRideMemoryPlayer()');
	const hideAt = reset.indexOf('this.dom.product.hidden = true');
	const cameraAt = reset.indexOf('const cameraShutdown = Promise.resolve(this.incidentCamera?.stopRide?.');
	const firstAwaitAt = reset.indexOf('await Promise.all([cameraShutdown, nativeShutdown, ecuShutdown, bmsShutdown])');
	const staleGuardAt = reset.indexOf('if (resetGeneration !== this.identityResetGeneration)');
	assert.ok(generationAt >= 0 && playerAt > generationAt && hideAt > playerAt && cameraAt > hideAt && firstAwaitAt > cameraAt);
	assert.ok(staleGuardAt > firstAwaitAt, 'a superseded cleanup must not clear a newer identity');
	assert.match(reset, /this\.dom\.activeRide\.hidden = true/);
	assert.match(reset, /this\.revokePrivateVehicleObjectUrls\(\)/);

	const logout = method('async logout(button) {', 'openDialog(title, content, eyebrow) {');
	const localAt = logout.indexOf('const resetPromise = this.resetIdentityBoundState');
	const networkAt = logout.indexOf("this.api.post('/auth/logout'");
	assert.ok(localAt >= 0 && networkAt > localAt, 'local capture shutdown must start before logout HTTP');
	assert.match(logout, /identityBound: false, keepalive: true, csrfRetry: false/);
	assert.match(logout, /Promise\.allSettled\(\[resetPromise, logoutPromise\]\)/);
	assert.match(source, /endSession:[\s\S]*identityBound: reason !== 'identity_changed'[\s\S]*csrfRetry: reason !== 'identity_changed'/);
});

test('ordinary safety save commits assist response and stops capture before the camera request', () => {
	const body = method('async saveSafety(form) {', 'async withdrawSafetyConsent(kind, button) {');
	const localFenceAt = body.indexOf('if (cameraOffIntent) this.incidentCameraLocallyDisabled = true');
	const cameraOffAt = body.indexOf("this.stopIncidentCameraCapture('camera-disabled-from-safety')");
	const safetyRequestAt = body.indexOf("this.api.put('/safety', payload)");
	const committedStateAt = body.indexOf('this.state.boot.safety = response.safety || response');
	const assistStopAt = body.indexOf("this.stopIncidentCameraCapture('assist-disabled-from-safety')");
	const cameraRequestAt = body.indexOf("this.api.put('/safety/incident-camera'");
	assert.ok(localFenceAt >= 0 && cameraOffAt > localFenceAt && cameraOffAt < safetyRequestAt, 'camera-off intent must fence and stop local capture before network work');
	assert.ok(safetyRequestAt < committedStateAt && committedStateAt < assistStopAt);
	assert.ok(assistStopAt < cameraRequestAt, 'durable assist revocation must stop capture before the fallible camera request');
	assert.match(body, /if \(cameraShutdown\) \{[\s\S]*await cameraShutdown\.stopPromise;[\s\S]*api\.put\('\/safety\/incident-camera'/);
});

test('camera consent is readiness-gated, separate, renewable and dual capture remains optional', () => {
	const render = method('renderSafety() {', 'getDocuments() {');
	assert.match(render, /camera\.provider_ready !== false && camera\.storage_ready !== false/);
	assert.match(render, /secure_schema_unavailable:[\s\S]*Incident-camera database setup incomplete/);
	assert.match(render, /private_storage_unavailable:[\s\S]*Incident-camera storage unavailable/);
	assert.match(render, /video_verifier_unavailable:[\s\S]*Incident-camera verification unavailable/);
	assert.match(render, /data-action="withdraw-camera-consent"/);
	assert.match(render, /name="incident_camera_dual_enabled"/);
	assert.match(render, /automatically uses rear-only/);
	const withdraw = method('async withdrawSafetyConsent(kind, button) {', 'async saveProfile(form) {');
	assert.match(withdraw, /api\.put\('\/safety\/incident-camera'/);
	assert.match(withdraw, /enabled: false, dual_enabled: false/);
	assert.match(withdraw, /incidentCameraLocallyDisabled = true[\s\S]*stopIncidentCameraForConsentWithdrawal\(isCamera \? 'camera-consent-withdrawn' : 'assist-consent-withdrawn'\)/);
	const preferences = method('incidentCameraPreferences() {', 'incidentCameraEvidencePending() {');
	assert.match(preferences, /!this\.incidentCameraLocallyDisabled/);
});

test('cancellation and consent withdrawal fence retries, resumption and in-flight HTTP', () => {
	const discard = method('discardIncidentCameraCandidate(reason) {', 'stopIncidentCameraCapture(reason, options) {');
	assert.match(discard, /resume: Boolean\(this\.state\.activeRide && \(this\.incidentCameraPreferences\(\)\.enabled \|\| this\.rideMemorySession\)\)/);
	const stop = method('async stopIncidentCameraForConsentWithdrawal(reason) {', 'async uploadIncidentCameraSegment(item) {');
	assert.match(stop, /stopIncidentCameraCapture\(reason \|\| 'camera-consent-withdrawn',[\s\S]*preserveMemory: true/);
	assert.doesNotMatch(stop, /incidentCameraPendingContext = null|incidentMediaUploads\.clear\(\)/, 'the withdrawal wrapper must not erase durable upload context before capture decides retention');
	const captureStop = method('stopIncidentCameraCapture(reason, options) {', 'async stopIncidentCameraForConsentWithdrawal(reason) {');
	assert.match(captureStop, /stopRide\?\.\(\{[\s\S]*discard: !retainCameraEvidence/);
	assert.match(captureStop, /continueForRideMemory[\s\S]*preferDual: Boolean\(this\.rideMemorySession\?\.dual\)/);
	assert.match(captureStop, /incidentMediaUploads\.clear\(\)/);
	const upload = method('async uploadIncidentCameraSegment(item) {', 'retryIncidentCameraUpload() {');
	assert.equal((upload.match(/signal: item\.signal \|\| null/g) || []).length, 3);
});

test('ambiguous incident state stays reconcilable and cannot steal earlier camera evidence', () => {
	const reconcile = method('async reconcileEmergencyIncident(eventId, payload) {', 'async pollEmergencyIncident(eventId, payload, attempts = 5) {');
	assert.match(reconcile, /catch \(error\) \{[\s\S]*scheduleEmergencyReconciliation\(eventId, payload\)/);
	assert.doesNotMatch(reconcile, /404[\s\S]*clearPendingEmergency/);
	const bind = method('incidentCameraCanBindEvent(eventId) {', 'updateIncidentCameraStatus(status) {');
	assert.match(bind, /boundEventId === String\(eventId/);
	const confirm = method('confirmIncidentCamera(response, payload) {', 'handleRideError(payload) {');
	assert.match(confirm, /incidentCameraLocallyDisabled && !this\.incidentCameraEvidencePending\(\)/);
	assert.match(confirm, /!this\.incidentCameraCanBindEvent\(eventId\)/);
});
