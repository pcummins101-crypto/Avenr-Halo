# Halo Emergency Assist

Halo Emergency Assist is a human-response workflow for a possible motorcycle collision. It does **not** place a 999 call, diagnose injury, or replace a rider's ability to call the emergency services. A trained Avenra responder must review the evidence, attempt to contact the rider and decide whether to call 999.

The private staff console is served at `/halo-emergency-assist/`. The separate `/halo-assist/` path remains the one-incident, expiring responder link carried by an SMS. Do not publish either path in customer navigation.

## Operations console

The operations console uses a WordPress staff account and the dedicated `avenra_halo_responder` role (or equivalent capabilities). It is not available to a Halo customer login. Administrators receive the capabilities on upgrade, but day-to-day responders should use named staff accounts with two-factor authentication rather than shared administrator credentials.

The console shows every source customer record, including a customer who has never opened Halo V2, together with deliberately separate states:

- **Signed in** means at least one unexpired, non-revoked Halo session exists. It does not prove the app is open.
- **Online** means an authenticated app heartbeat was received recently.
- **Riding** means a consented Ride-mode heartbeat was received in the live window.
- **Signal lost** means a ride heartbeat is stale but still within the short recovery window.
- **Offline** means no recent heartbeat exists.

Normal-ride speed and coordinates are accepted and shown only under the current Emergency Assist monitoring consent. Rows without that consent remain in the directory but their state is labelled **Monitoring off / unknown**, never **Not riding**. Presence expires automatically; closing a browser or losing mobile service cannot leave an indefinite live marker.

The console's **ride-risk indicator** is an operational history summary, not an accident prediction, medical assessment, insurance rating or rider ranking. It is calculated only while the rider has current Emergency Assist terms that explicitly include this staff-only processing. Version 1 uses the latest 20 road rides within 90 days, excludes track rides and test incidents, and explains its speed, dynamics, incident and phone-estimated lean factors. It displays **Insufficient data** below three eligible rides or 50 miles and shows confidence separately. Age, medical information, address and postcode are never factors. Withdrawing Emergency Assist consent removes the derived profile and prevents further calculation.

### One-ride test monitoring

**Avenrà test ride monitoring** is a separate purpose from Emergency Assist. A rider can arm it for the next Halo Ride only from Halo Safety. Starting that ride consumes the arm and creates an internal, staff-only session which shows the phone's latest location, mapped road, calibrated GPS speed, peak speed and signal freshness in the operations console. It does not enable incident response, medical sharing, camera or audio capture, and it does not expose earlier rides.

An unused arm expires after two hours. An active session ends when Ride mode ends and has a fixed four-hour server expiry as a backstop. The console URL identifies the session but does not authorise access: staff must still sign in to WordPress and hold the Emergency Assist viewing capability. No public live-tracking bearer token is returned or placed in the console. The first release displays the latest accepted position rather than retaining a breadcrumb trail.

GPS locates the rider's phone. A linked customer motorcycle must not be presented as the physical demonstrator unless the operational handover process has independently verified that bike. Test rides are stored with a test ride mode so they do not affect the rider's persistent ride-risk indicator.

## Live sequence

1. Ride mode detects a possible high-energy impact and opens a full-screen 20-second cancellation state.
2. When separately enabled, the foreground incident camera freezes its audio-free, memory-only rolling buffer. No footage is uploaded during the cancellation window. Camera capture is unavailable while Halo is hidden.
3. Halo records an encrypted candidate incident with a durable server deadline. Candidate rows are not actionable or shown as live incidents to responders.
4. A cancellation that wins the activation race closes the candidate, immediately redacts its rich snapshot, destroys the frozen camera buffer and contacts nobody. At the deadline, or when the rider chooses **Send alert now**, the server atomically activates one incident and submits a short SMS to the primary responder.
5. Once activation is durably confirmed, Halo may upload the frozen rear segments and, on genuinely compatible devices, separately consented front segments through an incident-scoped grant. Upload failure never delays or reverses responder dispatch.
6. The SMS contains no rider, medical, vehicle or precise-location data. It contains a private, expiring link to the incident briefing.
7. If the primary submission is rejected, the fallback responder is alerted immediately. If nobody acknowledges, Halo schedules the fallback for 15 seconds after the primary attempt.
8. The first responder to acknowledge is assigned the incident, records the rider-call outcome, and calls 999 when the evidence and response justify it.
9. For a credible emergency, the responder records that 999 was contacted before Halo permits a next-of-kin notification.
10. Detection, submission, evidence storage/access, acknowledgement, call outcome, 999 escalation, next-of-kin notification and handover are timestamped in the incident timeline.

“Provider accepted” means the SMS gateway accepted the submission. It is not proof that the handset received or displayed the message. The responder dashboard keeps accepted, failed and acknowledged states separate.

## SMS transport

The built-in adapter uses the existing server-only `AVENRA_FIRETEXT_API_KEY` constant. The key must never be placed in localized JavaScript, a page builder, the WordPress database or a browser request.

```php
define( 'AVENRA_FIRETEXT_API_KEY', 'replace-with-the-live-server-key' );
```

The adapter submits to FireText's HTTPS `sendsms` endpoint and treats only status `0` as accepted. The default sender is `Avenra`. An installation can replace the adapter with the `avenra_halo_v2_emergency_sms_delivery` filter, but it must return success only after a provider has accepted the message.

The packaged responder destinations are the requested primary ending **7559** and fallback ending **2606**. Keep both devices on a tested, documented 24/7 rota. The software cannot establish staffing coverage by itself.

## Fifteen-second fallback

Halo claims the fallback atomically so duplicate queue/browser/cron attempts cannot intentionally send it more than once. An ambiguous timeout is stored as terminal **unconfirmed**, not left in a fictitious retry state. It uses the best available combination of:

- an inline fallback after any primary result other than explicit provider acceptance;
- Action Scheduler when present;
- a WordPress single event;
- a rider-app due check while the incident screen remains online; and
- request-time recovery when the responder page or another Halo request runs.

Traffic-driven WP-Cron and an ordinary Action Scheduler runner cannot guarantee execution at an exact 15-second deadline. A production 15-second service-level objective requires a continuously running external worker or monitoring provider that polls due incidents every few seconds. Until that exists, the 15-second fallback is best effort and must not be represented as guaranteed.

The same durability rule applies to the rider's cancellation deadline. The app normally sends activation at zero, but Halo also persists `activation_due_at`, schedules a server activation and sweeps overdue candidates on later requests. This prevents a committed candidate from being silently abandoned when the browser closes after detection. Exact activation at 20 seconds still requires a continuously running Action Scheduler/WP-CLI worker; traffic-driven WP-Cron alone is not an exact timer.

## Private responder briefing

The SMS bearer is placed in the URL fragment so it is not sent in the initial HTTP request, access log or referrer. A first-party exchange page removes the fragment and uses an atomic session-null compare-and-swap to bind that incident-and-role credential to the first responder device. It issues an expiring Secure, HttpOnly, SameSite cookie scoped by incident and role. The original link can reopen that same briefing on the bound device, but cannot establish a session on another device. Separate scoped cookies let one on-call handset retain several simultaneous incident briefings. Merely opening the generic page, including an SMS link-preview request, never acknowledges an incident.

The briefing is rendered outside the WordPress theme, contains no analytics or embedded third-party map, and sends private/no-store/noindex/no-referrer headers. The two responders receive independent credentials and the server derives the role from the credential. A requested responder name or initials improves the audit trail; it does not make a shared handset equivalent to an individually authenticated staff account.

The briefing can contain, when available and permitted:

- rider name and callback number;
- explicitly consented medical notes;
- model, registration, colour, VIN and electric/high-voltage guidance;
- impact and latest coordinates, accuracy, road/postcode/landmark enrichment and heading;
- estimated impact speed, phone-derived acceleration magnitude and axes;
- clearly labelled phone-orientation and movement estimates;
- device, network and battery state; and
- a bounded recent route and telemetry trace; and
- up to the final approximately 60 seconds of audio-free rear-view footage and, only where explicitly enabled and technically supported, a separate front-view recording.

Phone-derived acceleration, orientation and speed are evidence, not calibrated vehicle telemetry or a medical severity assessment. Motorcycle orientation must remain **unknown** unless a dedicated vehicle sensor supplies it.

## Privacy and retention

Emergency Assist has its own explicit, versioned consent. Terms version 3 covers operational visibility of signed-in/riding state, live Ride-mode location/speed and the persistent, explainable staff-only ride-risk indicator. An older consent is paused until the rider reviews and renews it. One-ride test monitoring has its own versioned, short-lived choice and never inherits authority from Emergency Assist. Medical sharing and incident-camera recording each have their own versioned choices; enabling Emergency Assist never silently enables a camera. Front-and-rear capture is a further separate choice, audio is always off, and the rider sees the operating-system camera indicator while recording. An old consent version pauses capture until renewed.

The rolling buffer exists only in volatile browser/WebView memory while Ride mode is visible. It is not continuously sent to Avenra, written to the media library or preserved across an app termination. A confirmed cancellation or false alarm revokes grants and purges candidate footage. Withdrawing camera consent stops future capture, revokes active upload grants and purges uncommitted candidate material. It does not automatically erase evidence already stored for a durably activated incident; that evidence remains governed by the approved retention, legal-hold and data-rights policy. Only a non-test, durably activated incident accepts segment bytes. Stored files use private storage outside the public web root, have no public URL, are validated and checksummed, and require an incident-bound responder session or authorised staff capability for audited stream/download access. The files are access-controlled but are not application-encrypted by Halo, so production media, backups and snapshots should live on an encrypted volume or in private encrypted object storage. The default evidence retention is 30 days and must be aligned with the approved DPIA and retention policy. Simultaneous front/rear availability varies by handset, OS and WebView; the app verifies distinct streams and recorders and falls back to rear-only rather than claiming two views.

The incident snapshot is assembled server-side so the browser cannot choose a different rider or vehicle, and sensitive snapshot data is encrypted before database storage. During the cancellation window that snapshot remains non-actionable and is not presented as a live operator incident; a successful cancellation immediately removes it. The impact location remains immutable while later live coordinates are stored separately and re-enriched so a new coordinate can never inherit an old road/postcode. Activated-incident rich data is redacted after the configured retention period while the non-medical audit timeline remains.

Before launch, complete and approve a data protection impact assessment, the emergency-response operating procedure, responder training, access review, retention policy, breach process and round-the-clock rota. Document the circumstances in which explicit consent or vital interests is relied upon. Do not use vital interests as a general substitute when a capable rider has refused medical-data consent.

## Acceptance exercise

Use the console's two deliberately separate drill modes. Never test by placing an unnecessary 999 call.

### Dry run (start here)

1. Sign in to `/halo-emergency-assist/` with a named responder account.
2. Select a consented test customer and choose **Dry run**.
3. Run the happy-path, primary-rejection, provider-timeout and no-acknowledgement scenarios.
4. Open the generated incident, acknowledge it, verify the encrypted briefing/timeline and complete the exercise.
5. Confirm no FireText request, SMS, rider call, 999 link or next-of-kin action is possible.

### Guarded live rota drill

Live mode is unavailable unless FireText is ready, the operator has drill permission, the server temporarily defines `AVENRA_HALO_ALLOW_LIVE_EMERGENCY_TESTS` as literal `true`, rate limits permit the request and the operator types `SEND TEST SMS`. The resulting SMS and every incident view state **TEST EXERCISE — NO ACCIDENT — DO NOT CALL 999**. Disable the server constant immediately after the agreed test window.

The primary test goes to the configured primary ending **7559** and the fallback to **2606**. A live drill proves only that the provider accepted a submission and that a responder could open/acknowledge it; verify actual handset receipt and timestamps separately.

- Confirm an enabled rider sees exactly 20 seconds and can cancel before activation.
- Confirm cancelling a candidate immediately redacts its protected snapshot and the operations console never presents it as an actionable incident.
- Confirm rear-camera consent is separate and initially off; enabling it requests no microphone track and shows the platform camera indicator only during visible Ride mode.
- Confirm dual mode records distinct front/rear files on a specifically supported device and safely reports rear-only on an unsupported or single-camera-concurrency device.
- Confirm backgrounding, locking or switching away closes all camera tracks. Native background location may continue, but no camera or browser-motion coverage is claimed while hidden.
- Confirm no media request occurs during the 20-second candidate countdown; cancellation/false alarm destroys the frozen local buffer and leaves no responder media.
- Confirm durable activation and responder SMS proceed even if every video upload fails, is offline, oversized or rejected.
- Confirm uploaded media has no direct URL; responder and named operator access, download and byte-range playback are authorised and audited, and another incident/session cannot reuse the URL.
- After a candidate is committed, interrupt the cancellation request. Confirm Halo never claims success, preserves the event reference and the **Cancellation not confirmed — Emergency Assist may still activate** warning survives a reload; reconnect, retry and verify the authoritative outcome.
- Commit a candidate, terminate the browser before zero and confirm the continuously running worker activates the same incident once at/after its server deadline.
- Simulate a transient lock or database failure at the activation deadline and confirm the worker makes only the bounded 5-, 15- and 45-second retry attempts while the row remains a consented candidate, without duplicating dispatch.
- Confirm a cancellation racing the deadline produces one authoritative outcome and never says “cancelled” after dispatch began.
- Confirm **Send alert now** cannot race the timer into a duplicate incident or duplicate primary submission.
- Confirm the primary receives only the private link and generic incident wording.
- Confirm every drill is immutable as a test and excluded from live incident and risk statistics.
- Confirm test incidents cannot expose a `tel:999` link or execute rider/NOK/real-response actions even with a crafted POST/REST request.
- Confirm the fallback sends immediately on a simulated primary rejection.
- Confirm the scheduled fallback does not send when the primary acknowledges first.
- Confirm the fallback sends when no acknowledgement exists and the due worker runs.
- Confirm link-preview GET requests create no acknowledgement.
- Open incident A and then incident B on the same responder handset; confirm both scoped dashboard URLs remain accessible and actions stay bound to the correct incident.
- After binding incident A, try its original SMS link on a different browser/device and confirm it cannot establish a responder session.
- Confirm the first responder acknowledgement wins atomically and a later responder sees the assignment.
- Confirm medical data is absent when medical sharing is off.
- Confirm a next-of-kin test, direct crash alert and responder alert each recheck the current owned choice while holding the safety-consent boundary; after a successful withdrawal returns, no pending provider call begins.
- Confirm no ride-risk profile is calculated or shown without current terms version 3, and that withdrawing consent deletes the derived profile.
- Confirm the location, impact speed, G-force source/axes, route and vehicle shown match the test payload.
- Confirm **Alert next of kin** is rejected until **999 contacted** has been recorded.
- Confirm a false alarm closes without notifying next of kin.
- Confirm resolved and expired credentials no longer expose the briefing after the configured window.
- Confirm all dashboard responses bypass WordPress, host and CDN caches.

Repeat the exercise on current Android Chrome and iOS Safari. Also test denied motion/location permission, background timer throttling, no network at impact, provider timeout and a depleted SMS account.
