# Halo V2 deployment and acceptance

Halo V2 is a parallel release. Activation creates its own WordPress page and leaves the current Halo application unchanged. Do not redirect production riders until the checks below pass on the target hosting stack.

## Before activation

1. Take a database and file backup.
2. Confirm WordPress 6.3 or later and PHP 8.0 or later.
3. Confirm the existing Avenra customer and order plugin is active and its schema is current.
4. Use HTTPS on the final hostname. Test on the same hostname riders will use; cookies and browser permissions are origin-specific.
5. Confirm WordPress can deliver transactional email. New registrations use a short-lived email code unless an external verification provider is connected.

## Cache and security rules

Bypass all page and edge caches for:

* the Halo V2 page (normally `/halo-v2/`);
* `/wp-json/avenra-halo/v2/*`;
* `/halo-v2-sw.js`;
* `/halo-v2-manifest.webmanifest`;
* `/halo-assist/`; and
* `/halo-emergency-assist/`.

Do not combine, defer or rewrite Halo's JavaScript bundles at the edge. The plugin already loads them in a controlled order. Retain normal WordPress security headers and add a restrictive Content Security Policy only after allowing the configured map-tile and API origins.

Halo V2 now declares the app page non-cacheable and supplies scoped WP Rocket exclusions automatically. After installing an update, purge any host/CDN cache that sits in front of WordPress once so an already-stored older shell cannot continue to be served. Confirm the HTML, localized config and all JavaScript bundles report the same Halo version before acceptance testing.

When authentication code changes, also restart PHP-FPM or clear the host's PHP OPcache before testing. Every backend worker must execute the same Halo release; a mixed worker pool can otherwise issue an older session row that a newer worker correctly refuses.

## Administrator customer access recovery

WordPress administrators can open **Tools → Halo Customer Access** to replace a customer's six-digit Halo PIN. Use this only after verifying the customer requesting support. The tool never reveals or reuses the existing credential: it writes a new WordPress password hash, removes any legacy plaintext PIN, clears account lock state, and ends that customer's existing Halo V2 sessions and live-location links. If the legacy V1 page remains available, connect `avenra_halo_v2_admin_pin_reset` to any external V1-session revocation your installation requires.

After a reset, ask the customer to sign in again on every device. Do not attempt to repair a dual plaintext/hash row by making Halo fall back to the plaintext value; that could restore an older PIN after the customer has changed it.

## Required integration hooks

Some business services remain installation-specific. Halo V2 exposes WordPress filters/actions for these services instead of embedding provider credentials in browser code:

* route generation/geocoding;
* PIN/account recovery delivery;
* emergency-contact test and crash-alert delivery;
* boutique checkout or order hand-off;
* optional vehicle telemetry, remote security commands and diagnostics.

If a service is not connected, its endpoint returns a controlled `503` response and the interface presents a safe fallback. It must never silently claim that a route, alert, command or checkout succeeded.

The principal integration contracts are:

| Hook | Purpose | Expected result |
| --- | --- | --- |
| `avenra_halo_v2_registration_code_delivery` | Override delivery of the built-in registration email code | `null` to use `wp_mail`, `true`, or an array with `sent`/`success` set to `true` only after the provider accepts it |
| `avenra_halo_v2_registration_verification` | Replace the built-in code check with an invitation or identity provider | `true` or an array with `verified` set to `true` only after email ownership is proven |
| `avenra_halo_v2_route_plan` | Geocode and generate route alternatives | An array containing the route-provider payload, or `null` to try the V1 compatibility bridge |
| `avenra_halo_v2_recovery_request` | Deliver a PIN-recovery message | `true` only after the provider accepts the request |
| `avenra_halo_v2_admin_pin_reset` | Revoke external legacy sessions after a successful administrator PIN reset | Action receives customer ID, WordPress administrator ID and request ID; it must not print output |
| `avenra_halo_v2_safety_alert_result` | Deliver test or crash alerts to the rider's nominated contact | An array with `sent` or `success` set to `true`; otherwise `null` to try the V1 bridge |
| `avenra_halo_v2_emergency_sms_delivery` | Replace the built-in FireText Emergency Assist responder delivery | `null` to use FireText, or an array with `accepted` set to literal `true` only after provider acceptance; return a failure/unknown result otherwise |
| `avenra_halo_v2_guardian_sms_delivery` | Replace the delayed Halo Guardian recovery SMS sent to the rider | `null` to use FireText, or an array with `accepted` set to literal `true` only after provider acceptance; failures must remain failures and must never mark tracking as restored |
| `avenra_halo_v2_emergency_consent_version` | Identify the currently displayed Emergency Assist consent wording | A short stable version string; changing it pauses older consent until the rider renews |
| `avenra_halo_v2_emergency_medical_consent_version` | Identify the separately displayed optional medical-sharing wording | A short stable version string; changing it prevents medical inclusion until renewed |
| `avenra_halo_v2_emergency_reverse_geocode` | Resolve an accepted incident coordinate without exposing it to the browser | A road/postcode/landmark string, or `null` when unresolved |
| `avenra_halo_v2_emergency_enable_nominatim` | Opt into the bounded server-side OpenStreetMap Nominatim fallback | `true` only after confirming the deployment's privacy, usage-policy and traffic position |
| `avenra_halo_v2_shop_order_handoff` | Hand a server-validated basket to checkout | An array containing `url`/`checkout_url`, or a legacy `stripe_session_id` that V2 can resolve server-side |
| `avenra_halo_v2_stripe_checkout_session_url` | Resolve a legacy Stripe session without making an API request | An HTTPS Checkout Session URL |
| `avenra_halo_v2_stripe_secret_key` | Supply a server-only Stripe key used to retrieve a legacy Checkout Session URL | A restricted or secret test/live key with Checkout Session read access |
| `avenra_halo_v2_legacy_checkout_cart` | Adapt the server-priced basket before calling the V1 `submit_boutique_order` action | A V1-compatible array of cart rows |
| `avenra_halo_v2_tile_url` | Select the raster map provider | An HTTPS template containing `{z}`, `{x}` and `{y}` |
| `avenra_halo_v2_public_links` / `avenra_halo_v2_links` | Supply public and signed-in service links | An array of HTTPS or `mailto:` links such as `support`, `book_service`, `dealer_locator`, `test_ride` and `configurator` |
| `avenra_halo_v2_logo_white` / `avenra_halo_v2_logo_black` | Override the supplied Avenrà wordmarks | An HTTPS image URL for the corresponding light or dark surface |
| `avenra_halo_v2_range_image` | Override the prospect-home motorcycle fallback | An HTTPS image URL; the packaged default is transparent Silverstone Gloss Metallic Black artwork |
| `avenra_halo_v2_vehicle_colour_catalog` | Extend or replace structured paint metadata | Keyed definitions containing `key`, `label`, optional aliases/option IDs, a safe swatch and an HTTPS `image_url` |
| `avenra_halo_v2_vehicle_colour_images` | Preserve legacy image-only paint overrides | A label-to-HTTPS-URL map layered over the structured colour catalog |

The V1 compatibility bridge is enabled by default for the supported legacy actions. Disable it with `avenra_halo_v2_enable_internal_legacy_dispatch` only after equivalent V2 providers have been connected and tested.

If the V1 `submit_boutique_order` action returns only a `stripe_session_id`, return its hosted URL with `avenra_halo_v2_stripe_checkout_session_url`, or provide a server-only key through `avenra_halo_v2_stripe_secret_key`/`AVENRA_HALO_STRIPE_SECRET_KEY`. Prefer a restricted key that can read Checkout Sessions. V2 retrieves the hosted URL on the server and never sends the key to the browser. Current Stripe.js no longer supports the former `redirectToCheckout` method, so V2 uses an ordinary browser redirect to the Session URL as [Stripe now recommends](https://docs.stripe.com/changelog/clover/2025-09-30/remove-redirect-to-checkout).

The six V1 Boutique products remain available as the filterable fallback catalog when WooCommerce has no published products.

## Emergency Assist staff access and drills

Activation adds the `avenra_halo_responder` WordPress role and gives administrators the same dedicated capabilities. Create one named WordPress account per on-call responder, assign only the responder role, require two-factor authentication at the identity/security layer and review access regularly. Halo customer credentials cannot open the operations console.

The console is `/halo-emergency-assist/`; `/halo-assist/` remains the expiring incident link sent to the response devices. Both are standalone no-cache/noindex surfaces outside the active theme, page builder and floating-menu plugins.

Start acceptance with the console's **Dry run** mode. It creates and encrypts the same incident record, produces primary/fallback provider outcomes, supports acknowledgement and records a timeline while making no outbound SMS request. Use the available scenarios to verify primary acceptance, immediate fallback on rejection/timeout and delayed fallback when no acknowledgement arrives.

The **Live SMS drill** control remains server-disabled by default. For one agreed and staffed test window only, add:

```php
define( 'AVENRA_HALO_ALLOW_LIVE_EMERGENCY_TESTS', true );
```

Live drill creation additionally requires the drill capability, a configured provider, rate-limit capacity and the exact typed confirmation `SEND TEST SMS`. All test messages and screens say that no accident occurred and not to call 999; test incidents block real response and next-of-kin actions in server code. Remove or set the constant to `false` as soon as the test window closes.

Emergency Assist consent version 3 includes short-lived on-call visibility while Ride mode is open and an explainable staff-only ride-risk profile derived from eligible ride history. Obtain renewed consent before using either facility; withdrawing it removes the derived profile. Complete the DPIA, retention decision, incident access review, responder SOP and 24/7 rota before representing this as a live service.

The same private console also has a distinct **Test rides** panel. Test monitoring uses its own terms version and a one-ride arm; it must not be enabled through, or treated as equivalent to, Emergency Assist consent. The internal monitor URL is still protected by WordPress login, the `avenra_halo_emergency_view` capability, REST nonce and same-origin checks. Decide whether showroom/dealer users may hold that responder capability before rollout; if they must not see incidents or the wider rider directory, deploy a narrower role/capability in a follow-up rather than sharing responder accounts. Complete the test-ride privacy notice and operational handover procedure, and label the signal as the phone's location unless a demonstrator identifier is independently verified.

Run Action Scheduler or WordPress cron from a continuously running server worker at a cadence appropriate to the advertised response target. Browser timers and traffic-driven WP-Cron are recovery layers, not a guarantee of exact 20-second candidate activation or 15-second responder fallback. Monitor overdue candidate and escalation queues as part of the on-call service.

## Halo Community

Community membership is off by default and uses a rider-chosen public username rather than the customer identity. Before launch, publish community rules and the matching privacy/retention wording, assign named moderators, test blocking/reporting and review the full checklist in `docs/COMMUNITY.md`. Direct messages are stored by Halo and are not end-to-end encrypted; authorised moderators can see a reported-message excerpt.

The bundled OpenStreetMap tile endpoint is suitable for staging and modest use. Before a broad production rollout, confirm that expected traffic complies with the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/) or configure a supported tile provider. Keep the visible attribution intact.

## Private rider-upload storage

Glovebox documents and rider-uploaded vehicle photos are written below `wp-content/uploads/avenra-halo-v2-private/` and are served only through ownership-checked REST endpoints. Vehicle photos do not enter the public WordPress Media Library or replace V1's order-image fields. The plugin creates Apache deny rules automatically. On Nginx or another server that ignores `.htaccess`, add an equivalent direct-access rule before accepting uploads. For Nginx, a suitable server-block rule is:

```nginx
location ^~ /wp-content/uploads/avenra-halo-v2-private/ {
    deny all;
    return 404;
}
```

Defaults limit each document to 10 MB, each account to 100 active documents/250 MB, and retained Halo vehicle photos to 20 per account with one current photo per vehicle. These limits are filterable, but should not be removed without an equivalent storage policy.

## Incident-video private storage

Incident video is deliberately separate from Glovebox storage. Before enabling the rider setting, define a dedicated writable parent in `wp-config.php`; a path outside the public web root is preferred:

```php
define( 'AVENRA_HALO_V2_PRIVATE_STORAGE_DIR', '/absolute/non-web-readable/path/avenra-halo' );
```

If the host cannot create a directory outside the WordPress root, use a dedicated path and enforce the web-server deny rule shown above:

```php
define( 'AVENRA_HALO_V2_PRIVATE_STORAGE_DIR', __DIR__ . '/wp-content/uploads/avenra-halo-v2-private' );
```

Halo creates an `incident-media` child with deny files and no public URL. The packaged fallback tries `avenra-halo-private/incident-media` beside the WordPress installation; it does not enable an automatic web-root fallback unless an installation explicitly opts in through `avenra_halo_v2_incident_media_allow_webroot_storage`. An explicit `AVENRA_HALO_V2_PRIVATE_STORAGE_DIR` is honoured, including the constrained-hosting path above. On Nginx or any server that ignores `.htaccess`, add an exact server-level deny rule before recording a real ride. Confirm the PHP/web-server service account can create and read the directory, and that a different customer, anonymous browser and direct URL cannot retrieve a segment.

These local media files are access-controlled, validated and checksummed, but Halo does **not** application-encrypt them at rest. Put the private storage root on an encrypted volume or replace it with private object storage that supplies server-side encryption and tightly scoped credentials. Backups, replicas and snapshots must inherit the same encryption, access and retention controls. The encrypted incident snapshot in the database is a separate protection and does not encrypt the video files.

The default limit is 15 MB per approximately ten-second segment, 180 MB per incident and 30 days' retention. Set `upload_max_filesize` and `post_max_size` above the configured segment limit (20 MB or higher for the defaults), and set the reverse proxy request-body limit consistently. Capacity-plan for up to six rear plus six front segments. Change retention only after the DPIA and operational policy are approved.

## Camera alignment check

Camera alignment is a transient pre-ride browser/WebView preview and needs no WordPress table, server storage or consent migration. It requests `audio: false`, does not construct a recorder and makes no upload request. Validate it on the exact mounted phone models used for customer and test rides: simultaneous rear/front preview is device-dependent, while the explicit rear/front switch must remain available when only one camera can stay live. Every track must stop on close, backgrounding, account change, page unload and before Ride mode acquires its recording cameras. See `docs/CAMERA-ALIGNMENT.md` for the full lifecycle and acceptance checks.

## Ride Memories private browser storage

Ride Memories does not use the incident-video server directory or a WordPress table. It creates customer-scoped manifests and video Blobs in the Halo origin's IndexedDB on the rider's browser/WebView profile. Do not create an SQL table or phpMyAdmin migration for this feature. The app lists only records that pass the exact HALO ownership, customer, filename, MIME, audio and size contract; it never scans the device's ordinary media library.

Browser-private storage is not application-encrypted or guaranteed permanent. Validate quota, eviction and clear-site-data behaviour in the exact production wrapper, and make the loss boundary clear to riders. See `docs/RIDE-MEMORIES.md` for the filename contract, lifecycle, incident-consent interaction and acceptance tests.

## WebToNative Ride mode

This release targets the WebToNative wrapper. In the WebToNative project used for each platform:

1. Enable **Background Location**, then save and rebuild both Android and iOS binaries. Halo supplies the HTTPS callback endpoint and credential at ride runtime; do not hard-code either value in the WebToNative project.
2. Permit location **while in use** and the platform's background/always location mode required by the add-on. Verify the store privacy strings and declarations match actual use.
3. Permit camera access for the alignment check, Ride Memories and incident video. Halo always requests `audio: false`; microphone access is neither required nor expected.
4. Enable **JavaScript Bridge Access** for the exact production Halo HTTPS origin/path, and keep that origin plus `/wp-json/avenra-halo/v2/*` available to the wrapper. Do not copy the short-lived native writer token into analytics, logs, localStorage or a static WebToNative setting.
5. Do not buy or enable **Background App As Service** for this integration solely to keep a socket alive: Halo's native location hand-off uses bounded HTTP updates and has no background socket requirement.

For the Android release artifact, inspect the merged manifest rather than relying only on the project dashboard. A modern target must contain `ACCESS_FINE_LOCATION`; if tracking may continue without a visible activity, it also needs the wrapper's correctly declared location foreground service and the permissions appropriate to the target, including `FOREGROUND_SERVICE_LOCATION` on Android 14+ and `ACCESS_BACKGROUND_LOCATION` where the wrapper requests true background/always access. Confirm the location service declares `android:foregroundServiceType="location"`, then test the user-visible ongoing notification and **Allow all the time** flow on a real current Android device.

The plugin bundles the official WebToNative JavaScript SDK v1.0.63 at `assets/vendor/webtonative/webtonative-1.0.63.min.js`. WordPress serves that local copy before the Halo adapter and includes it in the scoped service-worker asset list; no runtime `unpkg.com` or other SDK CDN is required. Remove any second SDK loader from the theme, tag manager or page builder so one documented version owns `window.WTN`.

When a ride starts, the authenticated app posts the client ride ID to `/wp-json/avenra-halo/v2/native-ride/session`. The response provides a short-lived `api_url`, writer token and session ID for that ride. The adapter passes the runtime `apiUrl` and ride-scoped data to `window.WTN.backgroundLocation.start(...)`; the URL and token are not build-time WebToNative configuration. Ending the ride stops native tracking and deletes the session so the old writer credential can no longer post. The wrapper's native screen control is used where exposed, with the browser Screen Wake Lock as fallback. Android/WebView Back is guarded inside the document during a live ride, but Halo does not claim OS kiosk mode and cannot disable Home, app-switcher, power or emergency controls.

Halo applies Avenrà's fixed `1.15` GPS speed calibration after converting each raw metres-per-second speed to mph. Foreground rides use one shared converter at the central ride-engine boundary; safety/Guardian fallbacks use that same converter, and the native background endpoint applies the same fixed factor server-side. The calibrated value feeds the live HUD, ride peak, tracking, incident telemetry and Ride Memories. Latitude/longitude, route distance and GPS plausibility checks continue to use the unmodified GPS measurements.

Camera and motion processing remain foreground-only. When Halo becomes hidden, it closes both camera streams and pauses browser camera capture; on a visible return it requests the selected cameras again. Background Location does not make camera, accelerometer, JavaScript timers or crash detection reliable in the background. Simultaneous front-and-rear capture is attempted only after separate rider consent and only on a device/WebView that keeps two distinct live streams and recorders active; otherwise Halo records the rear view alone. The platform camera indicator remains visible whenever capture is active.

An ordinary browser/PWA continues to work without the bridge, but only foreground browser GPS/motion/camera and the Screen Wake Lock are available. Do not present the PWA fallback as native background tracking.

## Acceptance checklist

Test each state with a normal Halo customer account, not a WordPress administrator account.

- [ ] New registration requires the emailed code, then login, logout and a return visit all preserve the correct identity.
- [ ] A successful login emits both `__Host-avenra_halo_v2_session` and `__Host-avenra_halo_v2_csrf`, and the immediately following bootstrap returns the same customer without a second sign-in.
- [ ] That authenticated bootstrap remains a Halo V2 `{ok,data,meta,request_id}` envelope while historical V1 rides are included; a raw `{status,rides}` compatibility response must never replace it.
- [ ] A forced exception in the registration mail/provider integration returns a structured Halo error and request reference; no WordPress critical-error HTML appears in the app and no partial account is silently created.
- [ ] A private/anonymous visit shows Sign in/Create account and cannot open a guest version of the product shell.
- [ ] The Halo page source and frontend assets all report the same release version after every deployment/cache purge.
- [ ] Wrong-PIN throttling affects the intended account/device and returns a helpful wait state.
- [ ] Tools → Halo Customer Access resets a test customer's PIN, removes the legacy plaintext value and invalidates every earlier Halo session.
- [ ] Expired sessions return to the unlock screen without revealing another customer's data.
- [ ] With Halo open in two tabs, signing in to a different customer in one tab immediately clears the other tab; its stale forms, loaders and queued requests cannot read or modify the new customer.
- [ ] Switching customers ends the prior customer's active live-location links before the new browser session is issued.
- [ ] A deliberately expired, obsolete-revision or revoked device cookie offers the explicit reset control; reset ends links once for an expired/obsolete session, while replaying a revoked token cannot end newer links.
- [ ] Existing pre-delivery customers see the correct build stage and allocation.
- [ ] Owners see only their own motorcycle, documents, rides and safety settings.
- [ ] Next-of-kin alerts, optional medical details, proxy authority, law/court release and road-safety research each survive an ON save, full reload and new sign-in; repeating with OFF preserves every withdrawal.
- [ ] Approved-used claims remain pending until Avenra HQ verifies ownership.
- [ ] Route results render after first load, tab changes, rotation and returning from the background.
- [ ] Find routes and the keyboard Enter key never reload the document or return the rider to Home.
- [ ] A failed map-tile request leaves written route guidance visible.
- [ ] Location and motion denial produce clear, recoverable states.
- [ ] On iPhone, starting a first ride requests both motion and orientation access from the Start-button gesture.
- [ ] In a WebToNative iOS build, Start Ride applies the available native keep-screen-on control and Hold to end restores normal screen timing.
- [ ] In a WebToNative Android build, Start Ride calls the direct screen/location bridge exposed by the wrapper and Hold to end stops native tracking and restores normal screen timing.
- [ ] The final signed Android APK/AAB—not a preview build—contains the expected camera and location permissions plus a `location` foreground-service declaration; the device grants the intended background/always access.
- [ ] Page source and network inspection show the locally bundled WebToNative SDK v1.0.63 loading before the Halo adapter, with no runtime request to `unpkg.com` or another SDK CDN.
- [ ] On both wrapper platforms, native Background Location receives the ride-specific `apiUrl` and writer data returned by `/native-ride/session`; neither value is copied into static WebToNative project settings.
- [ ] Inject a known GPS speed of `20 m/s` (approximately `44.7 mph` raw) and confirm the live HUD, ride peak, tracking, incident telemetry and Ride Memories report the calibrated, rounded value of `51 mph`; replay the same coordinates and confirm route distance is unchanged.
- [ ] Android/WebView Back during an active ride remains on the live ride and shows the throttled Ride Focus explanation; after Hold to end, ordinary Back navigation works normally.
- [ ] Returning visibly from a permitted system interruption reapplies Ride Focus, while Home, power and emergency controls remain under the operating system rather than being presented as disabled.
- [ ] Backgrounding a WebToNative ride stops browser camera capture but accepted native GPS posts continue with increasing sequence numbers; ending the ride makes the old native writer token unusable.
- [ ] In an ordinary browser/PWA without the WebToNative bridge, a ride still starts and ends without JavaScript errors and uses the existing Screen Wake Lock when supported.
- [ ] Camera alignment opens from Ride setup only after an explicit tap, displays the complete unmirrored rear and front frames with centre guides and never requests microphone access or starts a recorder.
- [ ] A dual-capable mounted phone keeps both alignment previews live; a constrained phone provides a truthful one-camera-at-a-time rear/front switch so both views can still be checked.
- [ ] Closing, backgrounding, signing out and starting Ride mode immediately turn off every alignment camera track; a pending permission response cannot reopen a closed or previous-account preview.
- [ ] Incident camera is off by default; enabling it requires current Emergency Assist consent plus the separate current camera wording.
- [ ] With rear capture enabled, Ride mode shows the audio-off camera status, keeps no more than the newest approximately 60 seconds in memory and stops every video track when Halo is hidden or the ride ends.
- [ ] With dual capture enabled, a capable test device records distinct front and rear segments; a single-camera or constrained WebView falls back to rear-only without ending the ride.
- [ ] Denied camera permission, recorder failure and dual-camera failure produce a truthful degraded status and never block ride recording, crash cancellation or Emergency Assist activation.
- [ ] Test-ride monitoring is off by default, requires its separate current wording, arms one ride for no more than two hours and automatically returns to off after the ride starts.
- [ ] Starting an armed ride creates exactly one staff-only test session; the customer receives no public viewer/writer token and ordinary live-link management remains independent.
- [ ] The operations Test rides panel shows the latest phone location, road, calibrated current/peak speed and truthful waiting/live/signal-lost/stale state only to authorised staff; its internal link fails closed for anonymous or ordinary customer accounts.
- [ ] Ride end, explicit withdrawal, logout, PIN/device reset and the fixed four-hour expiry all stop further test-session updates. An offline end stops local updates immediately and the queued revocation or hard expiry closes the server row.
- [ ] Test rides are saved with a test ride mode and remain excluded from the persistent ride-risk indicator. A known raw `20 m/s` GPS sample still displays approximately `51 mph`, while coordinates and distance remain unmodified.
- [ ] Ride Memories is off at the start of every ride; enabling it records audio-free HALO clips to IndexedDB only, archives the final partial clip and never sends those clips in API/network requests.
- [ ] Activity labels an active cross-tab recording as unfinished, prevents playback/deletion until explicit rider-confirmed recovery, and excludes every lookalike record whose ownership marker, customer/ride key, deterministic filename, MIME type, audio flag or Blob size does not exactly match the HALO manifest.
- [ ] A completed or recovered Ride Memory plays rear/front clips sequentially for the same signed-in customer, deletion removes only that ride, and clearing app/site data is presented as permanent loss.
- [ ] Cancelling the crash countdown or closing an incident as a false alarm destroys the frozen buffer and leaves no retrievable server media.
- [ ] Only an activated, non-test incident can accept video. A responder can play/download its authorised segments (including seek/byte-range requests), while anonymous, cross-incident and direct-storage requests fail.
- [ ] Default 30-day cleanup removes expired video bytes, and purge-on-uninstall removes only marked Halo incident-media directories.
- [ ] An interrupted ride remains on the device and syncs after connectivity returns.
- [ ] A successfully synchronised ride no longer leaves a duplicate high-resolution GPS trace in browser storage.
- [ ] If Halo opens from its saved account snapshot during an API outage, account-changing controls remain read-only and a full secure bootstrap restores them after reconnection.
- [ ] If a session expires during an active ride, recording can finish safely before Halo presents the sign-in screen.
- [ ] Crash countdown cancellation works; an alert is never shown as delivered until accepted server-side.
- [ ] A committed candidate still activates once when the rider browser is terminated before zero and the external scheduler reaches its due time; a successful cancellation instead redacts the candidate snapshot immediately.
- [ ] `/halo-emergency-assist/` redirects a signed-out staff visitor to WordPress sign-in and returns 403 to a signed-in user without the dedicated capability.
- [ ] The customer directory includes never-signed-in customers and distinguishes signed-in, online, riding, signal-lost and monitoring-off states without inferring that a non-consented rider is safe/not riding.
- [ ] App heartbeats expire into the correct offline/stale state after the browser closes or connectivity is lost.
- [ ] The ride-risk indicator is absent without current terms version 3, says **Insufficient data** below three road rides/50 miles, explains its factors/confidence, excludes track rides/test incidents and is deleted when consent is withdrawn.
- [ ] Community is inaccessible until explicit opt-in; username-only profiles, directory visibility, direct-message choice, blocking, reporting, moderator suspension and leaving/anonymisation pass `docs/COMMUNITY.md` without exposing customer, vehicle, ride, location, risk or Emergency Assist data.
- [ ] A dry-run incident exercises encrypted briefing, primary/fallback state, acknowledgement and completion while packet/provider logs confirm that no SMS was requested.
- [ ] Racing a next-of-kin test/direct/responder dispatch against withdrawal produces one ordered result; once the OFF save succeeds, no later provider request can use the withdrawn choice.
- [ ] A crafted test-incident request cannot call/record 999, contact the rider or trigger next-of-kin delivery.
- [ ] During an agreed live drill, both SMS destinations receive the unmistakable test wording and private incident link; disable `AVENRA_HALO_ALLOW_LIVE_EMERGENCY_TESTS` immediately afterwards.
- [ ] Live-sharing links expire and cannot update or reveal a different rider's session.
- [ ] A new live link shows waiting placeholders until its first accepted position; it then displays the latest reported speed, a monotonically increasing ride peak and the current routed-road label without exposing rider, account or vehicle identity.
- [ ] A stale live link retains its last values but relabels them as last reported, while a free/off-route ride with no trustworthy road label says **Road unavailable** rather than guessing.
- [ ] An ordinary live link remains view-only; only a link created with the explicit, initially-off Guardian permission displays a recovery action.
- [ ] A Guardian recovery request is rejected while the location is fresh, after link expiry/revocation, with the wrong recovery capability and during its cooldown; responses do not disclose rider identity, phone state or account data.
- [ ] When an authorised link becomes delayed, one request is time-stamped and shown as pending; the rider client restarts its GPS watcher and the viewer says **Location refreshed** only after a newer writer-authenticated position is accepted.
- [ ] Closing or suspending the rider client leaves the request pending. After the configured fallback delay, the rider receives at most one recovery SMS with a Halo deep link; opening it requires the rider's Halo account before a new writer credential is issued.
- [ ] Ending the ride/share, signing out or changing the PIN immediately prevents all later Guardian requests and resumed writes for that link.
- [ ] Public tracking responses remain `no-store`; the tracking page sends no referrer and is marked noindex/nofollow/noarchive/nosnippet.
- [ ] Signing out immediately revokes every active live-location link before clearing the device session.
- [ ] After reloading during a shared ride, the Share control lists earlier active links and can end all of them or replace them with one new private link.
- [ ] Document upload rejects oversized and unsupported files and enforces ownership on download/delete.
- [ ] A rider-uploaded vehicle photo renders after upload, but its storage path and authenticated photo endpoint cannot be opened directly or by another customer.
- [ ] Profile, PIN, safety and ride-profile updates survive a reload.
- [ ] Changing the PIN closes older sessions and every current live-sharing link before the new credential is committed.
- [ ] The verified sign-in email is read-only in self-service; support follows its identity process for an address change.
- [ ] Boutique totals are recalculated server-side before checkout.
- [ ] The six legacy Boutique products appear without WooCommerce, and a V1 Stripe session resolves to its hosted HTTPS checkout URL.
- [ ] Installed-PWA and ordinary-browser sessions behave the same way.
- [ ] **Install Halo App** is visible before sign-in and under More whenever Halo is not installed; Android uses the captured native prompt, iOS/unsupported browsers receive accurate manual instructions, dismissal is handled and installed/standalone mode hides the control.
- [ ] Every public website **Install HALO** action points to the plugin-owned `/halo-v2/?install=1` hand-off. The hand-off opens Halo's branded install sheet after bootstrap, never launches the browser prompt automatically, and consumes only the `install` query parameter.
- [ ] On compatible Android Chrome, the hand-off button opens the native install prompt and the installed Home Screen app can request both HyperCore device choosers through Web Bluetooth. Embedded wrappers and unsupported browsers show truthful external-browser/manual guidance instead.
- [ ] iPhone portrait/landscape and a representative Android device have no clipped controls or inaccessible dialogs.

## Rollback

Deactivate Halo V2 and remove any navigation link that points to it. The original Halo page and the existing customer/order records remain in place. Plugin-owned operational tables and uploads are retained on ordinary deactivation and uninstall. Tables, private Glovebox files, Halo-managed vehicle photos and marked incident-video storage are deleted only when `AVENRA_HALO_V2_PURGE_ON_UNINSTALL` is explicitly defined as `true` before uninstalling the plugin.
