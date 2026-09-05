=== Avenra Halo V2 ===
Contributors: avenra
Tags: avenra, halo, motorcycle, pwa, customer-portal
Requires at least: 6.3
Tested up to: 6.8
Requires PHP: 8.0
Stable tag: 2.7.1
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A dedicated, mobile-first Halo application for Avenra riders.

== Description ==

Avenra Halo V2 moves Halo out of a theme page template and into a self-contained WordPress plugin. It is designed to run beside the existing Halo application while the new release is checked and approved.

The plugin provides:

* A premium smartphone-first interface with five clear primary destinations.
* Email-verified registration plus durable, revocable Halo sessions with a six-digit PIN and CSRF protection.
* Existing customer and order compatibility without copying those records.
* Customer-specific transparent motorcycle artwork in the home hero, with the configured paint image and Silverstone Gloss Metallic Black as resilient fallbacks.
* Vehicle, build, unified HyperCore, security, service and ride-profile views.
* Optional, read-only HyperCore Bluetooth telemetry with the HyperCore ECU and HyperCore BMS shown together, including live charge, electrical, motor and thermal data where the phone exposes Web Bluetooth.
* Route planning, map fallback states, community hazards and live ride recording with Avenrà's fixed +15% GPS speed calibration.
* A stationary pre-ride camera alignment check with uncropped rear and front previews, centre guides, simultaneous dual-camera display where supported and an explicit one-camera-at-a-time fallback.
* Ride-scoped WebToNative background-location hand-off with short-lived writer credentials, plus safe browser wake-lock fallback when no native bridge is present.
* Private live-location links with expiry, account-wide revocation and optional rider-approved Halo Guardian recovery.
* Ride history, summaries, offline ride retention and deferred synchronisation.
* Halo Safety, emergency-contact and medical settings.
* A durable human-led Emergency Assist workflow with a 20-second rider cancellation window, primary/fallback responder SMS links and a private incident dashboard.
* Explicitly opt-in, audio-free incident video: a memory-only rolling rear-camera buffer and a capability-tested front-and-rear option, with automatic rear-only fallback and upload only after Emergency Assist activates.
* Per-ride, audio-free Ride Memories saved to private browser storage, with strict HALO ownership manifests and filenames, customer-scoped playback, synchronized speed/time/location overlays, rear/front/combined review, non-destructive clip export and explicit deletion. Ride Memories are never uploaded automatically.
* A private premium Emergency Assist operations console with the complete customer directory, signed-in/online/riding presence, incidents and an explainable ride-risk indicator.
* Explicit one-ride test monitoring that creates a staff-only Emergency Assist console link for the phone's latest location, road, calibrated speed, peak speed and signal state, then ends automatically with the ride or after four hours.
* Controlled dry-run and guarded live-SMS drills whose server-side test boundary blocks 999 and next-of-kin actions.
* An opt-in, username-only Halo Community with a rider directory, forum, direct messages, blocking, reporting and a WordPress moderation queue.
* Glovebox documents, owner's manual, boutique, profile and account security.
* Administrator-only customer PIN recovery that revokes existing Halo V2 sessions.
* A conservative PWA cache policy that never caches authenticated pages or API responses.
* A branded, user-initiated Home Screen install hand-off with native browser prompting, platform-specific fallback guidance and a richer install manifest.

Halo V2 is intentionally installed at a separate page so the current Halo application remains available during migration.

== Installation ==

1. Back up the WordPress database and files.
2. Upload the plugin ZIP in Plugins > Add New > Upload Plugin.
3. Activate Avenra Halo V2.
4. Activation creates a page containing the `[avenra_halo_v2]` shortcode. The preferred address is `/halo-v2/`; if that slug is already occupied, WordPress creates `/avenra-halo-v2/` instead.
5. Sign in with a test customer and complete the acceptance checklist before inviting riders.

The plugin does not replace, edit or redirect the existing `/halo-app/` page.

== Production checklist ==

* Serve the site over HTTPS.
* Exclude the Halo V2 page, `/wp-json/avenra-halo/v2/*`, `/halo-v2-sw.js` and `/halo-v2-manifest.webmanifest` from page caches, edge caches and HTML optimisation.
* Confirm the existing `avenra_customers` and `avenra_orders` tables are present and current.
* Confirm `wp_mail` can deliver the short-lived registration code, or connect the registration-code delivery filter.
* Connect the route-planning, account-recovery, alert-delivery and checkout integration hooks used by the installation.
* Configure the server-only FireText key, verify both Emergency Assist responder devices, test Guardian rider-notification fallback and run the documented staged acceptance exercise before enabling rider consent.
* In WebToNative, enable Background Location and JavaScript Bridge Access for the exact production Halo origin, allow camera access, then save and rebuild both app binaries. Halo does not use the Background App As Service/socket add-on.
* Test Ride Memories on each supported browser/WebView. It needs no WordPress SQL table or server media directory: IndexedDB is created inside the Halo origin on the rider's device. Confirm browser data-retention policy, available quota, synchronized front-and-rear playback, truthful single-decoder fallback, canvas/MediaRecorder encoding and native file-bridge delivery before launch.
* Test Camera alignment check on every supported mounted phone and WebView. Verify the full uncropped road-facing and rider-facing frames, dual preview or truthful sequential fallback, permission denial, immediate shutdown on close/background/account change and clean camera hand-off into Ride mode. The rider must remain stationary while checking or adjusting the mount.
* Test both HyperCore Bluetooth links on the signed app and every supported phone. The bundled WebToNative SDK does not itself expose raw BLE GATT access, so `navigator.bluetooth.requestDevice` must be present in a secure context or the wrapper must supply a separately validated raw-GATT bridge before live telemetry can work. Confirm the FFE0/FFEC ECU path and both supported BMS paths (FFE0/FFE1 and FF00/FF01/FF02), first valid frames, live/partial/stale states, radio loss, background cleanup and sign-out cleanup against the physical HyperCore units. Do not describe system-level pairing alone as live powertrain data.
* Halo bundles the official WebToNative JavaScript SDK v1.0.63 locally; do not add a second SDK copy or a runtime CDN loader. At ride start, Halo obtains a short-lived, ride-scoped endpoint and writer credential from its authenticated `/native-ride/session` API and passes them to `WTN.backgroundLocation.start`; do not hard-code either value in WebToNative settings or site JavaScript.
* Configure `AVENRA_HALO_V2_PRIVATE_STORAGE_DIR` to a dedicated writable directory, preferably outside the public web root, before enabling incident video. If the host cannot create a directory outside the WordPress root, use a dedicated path under `wp-content`, retain Halo's generated deny files and add an explicit server-level deny rule on Nginx or any server that ignores `.htaccess`. Set PHP request/upload limits above the configured per-segment limit. Local incident-video files are access-controlled but are not application-encrypted by Halo; use an encrypted volume or private encrypted object storage, including encrypted backups and snapshots, in production.
* On Nginx or another server that ignores `.htaccess`, deny direct web access to `/wp-content/uploads/avenra-halo-v2-private/` before accepting document or vehicle-photo uploads.
* Confirm scheduled WordPress cron is running so expired sessions, hazards, tracking links and archived documents are cleaned up.
* Run Action Scheduler or WP-Cron from a continuous server worker before relying on the 20-second Emergency Assist activation or 15-second fallback targets.
* Test on current iOS Safari and Android Chrome with location and motion permissions in both accepted and denied states.

== Safety notice ==

Halo route, hazard and crash features are rider aids. They are not emergency services and cannot guarantee connectivity, hazard coverage, footage or message delivery. WebToNative Background Location can continue native GPS reporting while the wrapper is backgrounded, but browser motion sensors, camera capture, mapping and crash detection still require Halo to remain visible. Ride Focus keeps the foreground display awake and reduces accidental WebView navigation; it cannot disable operating-system Home, power or emergency controls. Camera permission, storage, connectivity and device limits can prevent evidence capture or delivery, so video must never delay a 999 call or responder action. Camera alignment and mount adjustment must be completed while the bike is stationary, never while moving.

== Data and privacy ==

Authenticated application HTML and API responses must not be cached. Session credentials remain in secure cookies; PINs and CSRF credentials are never stored in localStorage. Rider documents and rider-uploaded vehicle photos are validated and placed in plugin-managed private storage, then served only after an ownership check. V1-owned vehicle-image fields remain available as a display fallback and are not overwritten by V2 uploads.

Registration codes are stored only as short-lived password hashes. The verified sign-in email is not editable through ordinary self-service; address changes require Avenrà's support verification process.

Expired session rows retain only their hashed token binding for at least seven days so an explicit device reset can safely end any live-location link that outlasted the sign-in session. Revoked tokens cannot use that recovery path to change account data or terminate later links.

Live ride sharing is rider-initiated and time-limited. Anyone holding the private link can see the latest shared location, mapped road and Avenrà-calibrated (+15%) GPS-derived current/peak speeds until it is revoked or expires. The public surface does not expose the rider's Halo account, motorcycle or route history, and delayed data is visibly identified rather than presented as current. The calibration changes speed only; shared positions and journey distance remain based on unmodified GPS measurements.

Test-ride monitoring is separately versioned and off by default. Enabling it arms only the next Halo Ride for two hours; starting the ride consumes that arm and gives authorised Avenrà operators an internal, authenticated console link to the phone's latest location, road, calibrated current/peak speed and signal state. It never returns a public viewer token, does not enable Emergency Assist, medical sharing, camera or audio capture, and ends at Ride-mode completion or a fixed four-hour expiry. It records no breadcrumb trail in this release and test rides are excluded from the staff-only ride-risk indicator.

Halo Guardian is a separate, explicit permission on an individual live link and is off by default. When enabled, the rider names the intended trusted contact and the generated link carries a second unguessable, hashed-at-rest recovery capability. A valid holder can request a fresh location only after the existing share becomes delayed; the request cannot create a ride, extend the link, expose account details or trigger Emergency Assist. The rider is told that a Guardian link must not be forwarded, can end it at any time and receives an SMS fallback only when the active Halo client does not restore a fresh position promptly. Requests, app acknowledgements, resumptions and notification outcomes are time-stamped and rate-limited.

Unsynchronised rides are retained locally so a lost connection does not lose the journey. Once the server accepts a ride, its high-resolution local GPS trace is removed and the server record becomes the source of truth.

Camera alignment is an explicit, transient pre-ride action. It uses the phone's ordinary camera permission, always requests `audio: false`, creates no recorder, stores no image or video and makes no alignment network request. Halo first attempts distinct simultaneous road-facing and rider-facing previews. Where a phone or WebView permits only one live source, Halo keeps the rear view available and provides clear buttons to inspect rear and front sequentially. Every preview track is stopped when the dialog closes, Halo leaves the foreground, Ride mode starts, the account changes or the page unloads. Alignment is independent of Emergency Assist camera consent and does not enable Ride Memories or incident recording.

HyperCore Bluetooth consists of two local, separately rider-initiated, read-only connections. HyperCore BMS is authoritative for state of charge, pack voltage/current, power, cell balance and battery temperature. HyperCore ECU supplies RPM, phase current, motor and ECU temperature, throttle, modulation, gear and diagnostic faults. Halo sends only the established telemetry requests and exposes no configuration, firmware, shutdown, remote-drive or arbitrary-write control. Raw Bluetooth device names and detailed readings are not persisted or uploaded. Live BMS charge can populate Halo's existing starting-charge field and may therefore be included with an ordinary ride record or Emergency Assist alert, just as a manually entered value can be. ECU-derived speed is diagnostic only and never replaces Halo's GPS ride, distance, 0–60 or incident telemetry. Pairing is never started automatically; stale readings stop acting as current data. Halo disconnects both sessions on backgrounding, sign-out, account or linked-vehicle change. Browser and WebView support varies, so partial and unavailable states are stated plainly instead of being labelled connected.

Incident-camera recording is separate from Emergency Assist consent and is off until the rider expressly enables it under the current camera wording. Audio is never requested or recorded. While Ride mode is visible, Halo keeps only the newest six approximately ten-second segments in volatile memory. A crash candidate freezes that buffer; a confirmed cancellation or false alarm destroys it, and no footage is sent during the countdown. Withdrawing camera consent immediately prevents future incident-video capture and purges uncommitted candidate footage; an active Ride Memories recording can continue under its separate per-ride choice. Withdrawal does not silently erase or strand evidence already secured for a durably activated incident; that evidence finishes the approved delivery/retention flow before Ride Memories resumes. Only a durably activated incident can accept upload. Uploaded files have no public URL, are served through authorised responder/operator endpoints and audited, but local media files are not application-encrypted by Halo. Production storage, backups and snapshots should therefore use an encrypted volume or private encrypted object storage. Simultaneous front-and-rear capture is optional and device-dependent; Halo verifies two distinct live streams and recorders and otherwise continues rear-only.

Ride Memories is an independent, explicit choice made before each ride and automatically returns to off for the next ride. It stores audio-free ten-second video clips, a bounded time-synchronised GPS telemetry sidecar and a HALO-owned manifest in the current Halo origin's IndexedDB; it does not scan a device media folder. A clip is recognised only when its ownership marker, customer and ride keys, MIME type, audio flag, Blob size and deterministic filename all match; optional telemetry is separately schema-validated and timestamp-bounded. The filename contract is `HALO_RIDE_v1_<UTC>_<sanitised-ride-token-and-hash>_<rear-or-front>_<six-digit-sequence>.<mp4-or-webm>`. Activity lists only current-customer HALO manifests, identifies recordings left unfinished by a terminated app, and requires an explicit rider confirmation before recovering those clips as incomplete. Playback fetches one clip at a time, can show Avenrà-calibrated (+15%) GPS-estimated speed, ride/local time and mapped road or coordinates, and offers rear, front or synchronized combined viewing when both streams exist, with a truthful individual-view fallback when a device has only one playback decoder. Supported devices can render the selected single-camera clip plus telemetry to a new `_TELEMETRY` MP4 or WebM copy in real time and hand it to the native file bridge, Web Share or a browser download request; backgrounding cancels an active encode and the original Blob is never replaced. Neither footage nor its telemetry is uploaded automatically or included in ride synchronisation.

Browser-private storage is origin/profile scoped, not application-encrypted storage. The telemetry sidecar contains sensitive journey location and is retained and deleted with its clip. Other same-origin code and anyone with access to an unlocked browser profile may be able to access both. The browser or operating system can evict them, and clearing site data, removing the PWA/WebView data or reinstalling the wrapper can permanently erase them. Riders should keep Halo visible and the screen awake; camera capture pauses while hidden, and device camera, battery, heat, quota or recorder limits can create gaps or stop recording. Ride Memories requires no WordPress database table, phpMyAdmin script or server-side folder.

Halo Community is disabled until a rider explicitly joins. Its public identity is limited to a rider-chosen username and optional bio; customer identity, motorcycles, rides, locations, Emergency Assist information and ride-risk indicators are not exposed through Community. Direct messages are stored by Halo and are not end-to-end encrypted. See `docs/COMMUNITY.md` before launch.

== Changelog ==

= 2.7.1 =
* Added a polished `?install=1` website hand-off that opens Halo's own installer and keeps the browser installation prompt behind an explicit rider tap.
* Added accurate Chrome, Safari and embedded-wrapper guidance, including the compatible Android Chrome requirement for live HyperCore ECU and HyperCore BMS pairing.
* Enriched the web app manifest with locale, categories and a labelled Halo screenshot for a more professional browser installation experience.
* Made each order's confirmed expected-delivery date take priority over the historical site-wide estimate, including legacy order-column and configuration-data compatibility.
* Replaced the raw order-configuration response and generic Vehicle renderer with strict server- and browser-side customer specification allowlists, preventing finance, eligibility, referral and audit data from appearing in Halo.

= 2.7.0 =
* Replaced the separate battery destination with one unified HyperCore view that shows HyperCore ECU and HyperCore BMS status and telemetry together.
* Added a read-only FFEC HyperCore ECU driver with validated packet CRCs, register polling, fragmented-notification handling and decoded RPM, electrical, phase-current, throttle, gear, temperature and fault data.
* Corrected HyperCore BMS pack-voltage, high-current and state-of-charge scaling, strengthened variable-length frame validation, and added read-only compatibility for both FFE0/FFE1 and FF00/FF01/FF02 telemetry transports.
* Kept BMS charge and cell health authoritative, kept ECU speed isolated from Halo's calibrated GPS ride/safety pipeline, and added truthful live, partial, delayed and unavailable states.
* Preserved deliberate two-step pairing for the two physical units and added joint cleanup on backgrounding, sign-out, identity or linked-vehicle changes.

= 2.6.7 =
* Restored the established Avenrà BMS Bluetooth reader with FFE0/FFE1 discovery, the exact validated wake request and robust fragmented-frame telemetry decoding.
* Added a dedicated Vehicle Battery view, top-bar connection journey and live Ride-mode battery status for charge, pack voltage, current, power and maximum temperature.
* Hardened Bluetooth lifecycle handling with explicit user pairing, valid-frame gating, stale-data fallback, GATT disconnect handling and immediate cleanup on background, sign-out, account or vehicle change.
* Kept the integration read-only with no new database table or detailed telemetry upload, automatic pairing, BMS setting write or power command. State of charge can populate the existing ride and safety charge fields, and unsupported WebViews are labelled truthfully.

= 2.6.6 =
* Added a stationary pre-ride Camera alignment check with unmirrored, uncropped rear road-facing and front rider-facing previews plus centre guides.
* Added simultaneous dual-camera preview when the phone proves both streams remain live, with a truthful one-camera-at-a-time rear/front switch on constrained devices.
* Kept alignment preview separate from recording and consent: audio is never requested, no recorder/storage/upload path is created and every track stops on close, backgrounding, Ride start, identity change or page unload.

= 2.6.5 =
* Added an explicit, versioned one-ride test-monitoring toggle that expires if unused, is consumed when Ride mode starts and cannot silently carry into a later private ride.
* Added staff-only live test-ride cards and authenticated internal monitor links to the Emergency Assist operations console, with calibrated current/peak speed, latest phone location, road and truthful signal freshness.
* Kept test monitoring separate from Emergency Assist, medical, camera and public live-link authority; no viewer/writer bearer token is exposed, sessions stop with the ride and expire after four hours.

= 2.6.4 =
* Restored Avenrà's fixed +15% calibration across foreground, safety/Guardian and native background GPS speed paths so the live HUD, ride peak, tracking links, incident telemetry and Ride Memories overlay/export use one consistent speed.
* Kept route distance, coordinates and GPS plausibility checks based on the unmodified GPS measurements.

= 2.6.3 =
* Added a bounded one-second telemetry sidecar to new Ride Memories, containing time-synchronised GPS-estimated speed, ride time, position, heading, accuracy and mapped road where available.
* Added a polished playback overlay for speed, ride/local time and road or coordinate location, with an explicit show/hide control and stale-GPS handling.
* Added synchronized Front + rear playback in one window, using rear footage as the main view with a front-camera inset, duration-corrected playback and a truthful individual-view fallback when two saved streams cannot decode together.
* Added feature-gated, MP4-first real-time export of the current single-camera clip with telemetry burned into a new `_TELEMETRY` file, using native Android/iOS save, Web Share and browser download fallbacks; the private original and incident evidence remain unchanged.
* Retained full playback compatibility for existing Ride Memories that do not contain telemetry and kept every telemetry record customer-scoped and locally deleted with its clip.

= 2.6.2 =
* Replaced the generic top-right H icon with the supplied Avenrà profile artwork.
* The profile mark now switches automatically to EVO red or ONE blue from the currently selected vehicle model, with the neutral Avenrà artwork used when no supported model is selected.
* Added the three model marks to Halo's offline static cache and retained a safe neutral fallback if a model-specific image cannot load.

= 2.6.1 =
* Restored the white foreground on dark circular controls so chevrons, map controls, camera actions and other button icons no longer appear as empty black dots.
* Replaced the top-right profile placeholder with the packaged Halo H mark.
* Made dialog and bottom-sheet dismiss controls render a dedicated white close glyph for consistent Android WebView display.

= 2.6.0 =
* Added per-ride Ride Memories using private browser IndexedDB storage, with audio permanently disabled and no automatic upload.
* Added deterministic HALO-only filenames and ownership manifests so Activity never scans or displays unrelated device videos.
* Added customer-scoped Ride Footage activity, sequential front/rear playback, storage reporting, interrupted-ride recovery and explicit deletion.
* Shared the foreground camera pipeline safely with incident video, including final partial-clip archiving, rear-only consent transitions, evidence-preserving incident handling and camera-gap reporting.
* Added cross-tab recording leases, identity-change cleanup, bounded pending Blob writes and metadata-only library/estimate/delete paths for long rides.
* Added explicit recovery for footage left unfinished by a terminated app, plus immediate camera and private-UI fencing on sign-out or account change.

= 2.5.1 =
* Repaired incomplete incident-camera database schemas automatically with bounded retries, restored missing cleanup schedules and prevented failed upgrades from repeating heavy migration work on every request.
* Fixed rear/front camera consent controls so backend-readiness failures are explained accurately and disabling consent stops capture immediately even if a later settings request fails.
* Serialised background/foreground camera transitions, bounded delayed segment metadata to the server contract and stopped camera/native ride capture promptly when a ride ends.
* Corrected late-injected Android background-location bridge selection and detection of the official non-enumerable iOS bridge handler.
* Added guarded post-insert reads for rides, hazards and Glovebox documents so an unexpected database read failure returns a safe API error instead of a PHP TypeError.

= 2.5.0 =
* Added ride-scoped WebToNative Background Location integration with short-lived, revocable writer tokens, native screen-awake control and browser wake-lock fallback.
* Added explicit incident-camera consent with an audio-free, memory-only rolling 60-second rear-camera buffer that stops whenever Halo is hidden.
* Added optional simultaneous front-and-rear recording when the device and WebView prove that both distinct streams and recorders can remain active, with automatic rear-only fallback.
* Frozen footage is discarded after a confirmed cancellation/false alarm and uploaded only for a durably activated Emergency Assist incident, without delaying the emergency workflow.
* Added private, incident-scoped evidence storage, validation, retention, responder/operator playback and audited byte-range delivery with no public media URL.

= 2.4.4 =
* Rebuilt active Ride mode around a true edge-to-edge map, with floating high-contrast guidance, performance, status and ride-control overlays that respect mobile safe areas and isolate the covered app UI from focus.
* Added active-ride course-up rendering so the last reliable direction of travel stays at the top, while route overview and every non-ride map remain north-up.
* Increased the active follow-camera zoom from 15 to 17, expanded forward look-ahead while keeping the rider above compact-screen overlays, retained the last trustworthy bearing during stops or weak GPS, and overscanned rotated tiles to prevent blank map corners.
* Made the riding map non-interactive to reduce accidental camera changes, while retaining dedicated route-overview and recenter controls and forcing a correctly sized redraw when Ride mode opens.

= 2.4.3 =
* Prevented Android and iOS WebViews from exposing the accessibility skip link when they assign startup focus, while retaining the link for genuine keyboard navigation.

= 2.4.2 =
* Added foreground Ride Focus for active rides, using available wrapper bridges to keep the display awake, request Android full screen and reduce accidental swipe navigation until the ride ends. Legacy Median/GoNative bridge compatibility remains available for existing wrapper builds.
* Added an idempotent same-document Back guard, visible Ride Focus status, resume-time native reapplication and safe restoration on ride end, failed start, sign-out or page unload.
* Retained the browser Screen Wake Lock fallback and documented that Ride Focus is not OS kiosk mode or background sensor execution.

= 2.4.1 =
* Fixed the Halo Guardian session authorisation return type so PHP can compile and activate the plugin successfully.

= 2.4.0 =
* Added rider-approved Halo Guardian links that let a named trusted contact request recovery only after an already-active live ride share becomes delayed.
* Added separate recovery capability hashing, request cooldowns and rate limits, explicit request/acknowledgement/resumption states, authenticated writer rotation and automatic revocation with the underlying share.
* Added foreground GPS-watcher recovery, queued reconnection handling and a delayed, rate-limited FireText SMS fallback that prompts the rider to reopen Halo without claiming that tracking has resumed.
* Restored an always-discoverable Install Halo App control on both the sign-in and More screens, using the native install prompt when available and premium platform-specific instructions otherwise.
* Added installed-mode detection and installation outcome handling so the control disappears after Halo is installed and does not promise unsupported offline navigation.

= 2.3.7 =
* Changed active Ride maps from whole-route regional framing to a close follow camera as soon as the first reliable GPS fix arrives.
* Added course-aware forward look and a smoothed directional rider marker while keeping OpenStreetMap road labels upright and readable.
* Made the real GPS position event the sole owner of map movement, so telemetry and guidance no longer force duplicate redraws or cancel route overview.
* Kept shared tracking maps close, stable and north-up, and now honours passive-map and hidden-control settings for the public viewer.

= 2.3.6 =
* Added a premium public live-ride telemetry panel showing the latest reported speed, ride peak and current mapped road alongside the shared location.
* Persisted the ride peak monotonically so it cannot fall as the rider slows, including when sharing begins part-way through a ride.
* Added explicit waiting and delayed-signal states, exact update time, clearer sharing disclosure and stronger no-referrer/no-index protection for private tracking links.

= 2.3.5 =
* Stopped the high-frequency telemetry stream from overwriting the route-guidance ETA and dedicated GPS state between location fixes.
* Kept the rider-facing GPS indicator steadily on Active while retaining accuracy detail for assistive technology and long-press/hover information.
* Reset Arrival and GPS cleanly at the beginning of every ride so values from a previous journey cannot carry over.

= 2.3.4 =
* Replaced separate Avenrà wordmark and Halo text treatments with the supplied combined Avenrà Halo lock-up across the rider app, authentication, live tracking, Emergency Assist and operations console.
* Bundled a transparently trimmed display derivative for reliable mobile sizing and offline use while preserving the supplied original artwork.
* Retained textual product names in document titles, messages, metadata and accessibility labels where an image would be inappropriate.

= 2.3.3 =
* Fixed next-of-kin alerts, proxy authority, law/court release and road-safety research switches resetting after save on customer tables without optional legacy consent columns.
* Moved those four explicit choices into Halo-owned safety storage, with nullable legacy migration and verified read-back before reporting success.
* Made the plugin-owned next-of-kin choice authoritative throughout incident eligibility, protected snapshot creation and render-time redaction.
* Serialized next-of-kin test, direct-crash and responder delivery against consent withdrawal, with a final recheck before the provider is called.

= 2.3.2 =
* Replaced all nine photographic paint images with the supplied transparent-background Avenrà motorcycle artwork and retained legacy paint-name aliases.
* Made the transparent configured-colour artwork authoritative while preserving rider-uploaded private vehicle photos.
* Replaced the circular crop with a wide illuminated product stage that keeps the complete motorcycle visible and separates it from the copy and CTA.
* Strengthened the Explore motorcycles control against theme overrides and stacks it full-width on ordinary smartphone viewports.

= 2.3.1 =
* Presented the discovery motorcycle artwork inside a contained circular product portrait so photographic paint images cannot overlap the hero copy or controls.
* Increased hero-copy contrast, removed the unexplained prospect paint dot and isolated the card footer from the motorcycle image.
* Made the Explore motorcycles button explicitly high-contrast against theme-level WordPress button styles and responsive on narrow phones.

= 2.3.0 =
* Added the opt-in, pseudonymous Halo Community with separate directory visibility, forums, direct messages, blocking, reporting, leaving/anonymisation and an administrator moderation queue.
* Restored real motorcycle artwork to the prospect home hero using the linked vehicle, configured paint and exact Silverstone fallback chain.
* Made the 20-second crash-candidate deadline durable on the server, including cancellation snapshot redaction and request-time recovery for overdue candidates.
* Added incident-and-role-scoped responder sessions so one on-call handset can safely retain access to multiple active incident briefings.
* Updated Emergency Assist consent to version 3 for on-call Ride-mode visibility and the explainable staff-only ride-risk indicator.

= 2.2.0 =
* Added the private `/halo-emergency-assist/` staff console with capability-based access, complete rider directory, open incidents, responder readiness and premium mobile/desktop presentation.
* Added consent-aware, expiring app heartbeats that distinguish signed-in, online, riding, signal-lost and monitoring-off states.
* Added an explainable versioned ride-risk indicator with minimum-data/confidence labels, speed exposure and new phone-derived ride dynamics; track rides, tests and personal demographics are excluded.
* Added no-SMS dry-run scenarios and an explicitly enabled, typed-confirmation live rota drill. Every test is immutable, prominently labelled and prevented from calling 999 or alerting next of kin.
* Updated Emergency Assist consent to version 2 for on-call Ride-mode visibility and added staff/audit/deployment guidance.

= 2.1.0 =
* Added durable Emergency Assist incidents with protected rider, motorcycle, impact, location, route, device and telemetry snapshots.
* Added a 20-second cancellation state, primary responder submission, 15-second best-effort fallback escalation and first-responder acknowledgement workflow.
* Added private one-time responder links, encrypted rich incident data, strict no-cache dashboard delivery and timestamped human-response actions.
* Added separate versioned consent and audit records for Emergency Assist and optional medical-information sharing.
* Added recovery for ambiguous activation responses, reconnects and browser restarts without claiming SMS handset delivery or automated 999 contact.

= 2.0.6 =
* Added an administrator-only Tools screen for securely resetting a customer's six-digit Halo PIN.
* A support reset removes legacy plaintext credentials, clears account lock state, and ends existing Halo V2 sessions and live-location links.
* Clarified failed sign-in wording without revealing whether an email address exists.

= 2.0.5 =
* Updated Explore motorcycles to open the Avenrà configurator at `/configurator/` for public and signed-in riders.
* Applied the Avenrà red accent to the HALO brand label on the sign-in and app-header lockups.

= 2.0.4 =
* Prevented legacy AJAX callbacks from terminating authenticated V2 REST responses.
* Removed persistent V1 customer identity mirroring from the V2 browser session.
* Contained registration mail and integration failures behind structured Halo errors.
* Replaced raw WordPress fatal-error HTML with a safe support message and request reference.

= 2.0.3 =

* Confirms both secure cookies and the new session metadata before reporting a successful sign-in.
* Verifies the session on the next request without clearing the form or silently redrawing login when retention fails.
* Allows Reset this device session to recover an active session created under an older authentication revision.
* Keeps WordPress administrator nonces out of Halo customer authentication so an expired admin session cannot block sign-in.

= 2.0.2 =

* Restores a fail-closed login gate, rejects anonymous or malformed account snapshots and requires one fresh sign-in after updating.
* Prevents Find routes from falling through to a native page submission and returning to Home.
* Excludes the dedicated Halo page and scripts from WP Rocket page caching, optimisation and delayed execution, with explicit edge-cache no-store headers.
* Removes the site's separate floating menu, modal panels and chat widget from the plugin-owned Halo page only.

= 2.0.1 =

* Uses the supplied white and graphite Avenrà wordmarks throughout Halo and caches them for resilient app chrome.
* Adds the nine canonical Avenrà paint definitions, correct motorcycle images, option-ID compatibility and safe unknown-colour behaviour.
* Connects Book a test ride to the official Avenrà Test Ride page in guest and signed-in sessions.
* Refines the smartphone interface with a cinematic vehicle stage, paint swatches, graphite controls, floating navigation and stronger mobile hierarchy.
* Improves loading, destructive-action and connectivity contrast states.

= 2.0.0 =

* Initial parallel-release build of the dedicated Halo V2 plugin.
