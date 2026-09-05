# Ride Memories

Ride Memories is a per-ride, foreground-only camera recording feature. It is separate from Emergency Assist incident video and defaults to off for every new ride.

## Storage model

- Video is stored in IndexedDB for the Halo site/app origin and current browser or WebView profile.
- A bounded telemetry sidecar is stored with each recognised clip at approximately one sample per second. It may contain GPS-estimated speed, ride time, coordinates, accuracy, heading and the current mapped road when route guidance supplies one. Speed uses the central ride-engine value: raw metres per second are converted to mph, multiplied by the fixed Avenrà factor of `1.15`, then rounded. Coordinates and route distance remain based on unmodified GPS measurements.
- No WordPress table, phpMyAdmin SQL script, upload directory or folder outside the WordPress root is required.
- Audio is never requested or stored.
- Ride Memories is never uploaded automatically and is not added to the normal ride-sync payload.
- The app requests persistent browser storage when the platform supports it, but persistence and quota are not guaranteed.
- Clearing site/app data, browser eviction, resetting the WebView or reinstalling the wrapper can permanently remove footage.

IndexedDB is origin-private rather than application-encrypted. Same-origin JavaScript and anyone with access to an unlocked browser profile may be able to read it. Treat prevention of cross-site scripting and physical device access as part of the privacy boundary.

## Recognition contract

Halo does not inspect or enumerate the device's ordinary photo/video library. Every displayed clip must have:

- the ownership marker `AVENRA_HALO_RIDE_MEMORY`;
- record schema version `1`;
- the signed-in customer's exact storage key and the ride's exact identifier;
- an allowlisted `video/mp4` or `video/webm` MIME type;
- `audio: false`;
- when present, telemetry schema version `1` with no more than 64 validated, timestamp-bounded points;
- a positive Blob size matching its manifest size; and
- the exact deterministic filename recomputed from the manifest.

Filename format:

```text
HALO_RIDE_v1_<compact-UTC>_<sanitised-ride-token>-<16-hex-id-hash>_<rear|front>_<six-digit-sequence>.<mp4|webm>
```

Example:

```text
HALO_RIDE_v1_20260824T203040123Z_ride-a1b2c3d4e5f60718_rear_000001.webm
```

A filename alone is not sufficient. Records with a plausible name but a missing or mismatched ownership manifest are ignored. Activity is customer-scoped and never displays another Halo customer's local records.

## Recording lifecycle

The rider may use **Camera alignment check** before this lifecycle begins. That preview is independent, records nothing and releases all of its streams before Ride mode reacquires the cameras selected for Ride Memories or incident capture.

1. The rider explicitly enables **Record Ride Memories** before starting the ride and optionally requests front plus rear capture.
2. Halo checks browser support and available quota, creates a customer-scoped ride manifest and starts the foreground camera without audio.
3. Halo samples the existing ride telemetry at most once per second and attaches the time-bounded samples when each approximately ten-second clip is written serially. A bounded pending-byte queue stops only Ride Memories if local storage cannot keep up.
4. Camera hiding, incident handling and camera reconfiguration create manifest gap markers. The display must remain awake and Halo visible for continuous capture.
5. Ending the ride archives the final partial clip and finalises the local manifest immediately, independently of server ride synchronisation.
6. Activity lists completed and unfinished HALO manifests. Completed or explicitly recovered footage loads one Blob at a time for playback and permits explicit permanent deletion.
7. Inline playback can show or hide speed, ride time, local time and location over the video. Where both camera streams exist, the rider can choose rear, front or a synchronized front-and-rear view in one player. If the device cannot decode two saved videos concurrently, Halo truthfully returns to rear playback and keeps the front clip available as an individual view.
8. On devices supporting canvas stream capture and local media encoding, **Export clip with telemetry** creates a new audio-free MP4 or WebM copy of the selected single-camera clip. Export runs in real time, is cancelled if Halo leaves the foreground, never replaces the private original and is disabled for the combined view. Halo hands the finished Blob to the native Android/iOS file bridge where present, Web Share where supported, or a browser download request as a fallback.

An expiring, cross-tab lease prevents another Halo window from automatically recovering or deleting an actively recorded manifest. A heartbeat keeps the lease current through the final queued Blob and manifest commit. Because mobile browsers can suspend timers for long periods, the default stale window is seven days; after an abnormal close, a genuinely stale recording is recovered as incomplete rather than presented as a completed ride. Activity also exposes an explicit **Recover footage** action for a terminated or crashed app: the rider must confirm the ride has ended and any other recording Halo window is closed before the live lease is overridden. The current recording window cannot recover its own active manifest.

## Incident-video interaction

Ride Memories and incident video share one foreground camera pipeline but retain separate choices and storage policies.

- A crash candidate temporarily pauses Ride Memories and freezes the incident rolling buffer.
- A confirmed cancellation destroys incident evidence and resumes Ride Memories.
- Durably activated incident evidence keeps its delivery context until upload succeeds or remains retained for retry; Ride Memories resumes only after that outcome is complete.
- Withdrawing incident-camera consent immediately gates future incident capture. Uncommitted candidate footage is purged. If Ride Memories remains enabled, the final partial clip is archived and capture restarts using only the views selected for Ride Memories.
- Incident evidence remains pristine. Ride Memories telemetry is not inserted into the incident recorder or its upload payload.

## Acceptance checks

- Start a ride with Ride Memories off and confirm no local manifest or camera request is created unless incident video independently requires it.
- Enable rear-only recording, ride for more than one segment, end during a partial segment and confirm every clip plus the final partial clip plays in Activity.
- Enable front and rear on a capable device; verify separate view controls. Repeat on a constrained device and verify truthful rear-only fallback.
- With front and rear footage available, select **Front + rear** and verify the inset stays within 250 ms of the main video through play, buffering, pause, seek, automatic clip advance and view changes. On a device with only one working playback decoder, verify Halo hides the failed inset, explains the fallback and still plays Front individually.
- Verify the overlay follows seeks and clip transitions, labels speed as a GPS estimate, shows coordinates when no mapped road exists and changes to unavailable rather than carrying stale telemetry through a GPS gap. With an injected raw speed of `20 m/s` (approximately `44.7 mph`), confirm the overlay and ride telemetry show the calibrated, rounded value of `51 mph`, while the same GPS positions produce unchanged route distance.
- Hide and show the overlay. Export a supported single-camera clip, verify the saved/shared copy contains the overlay, contains no audio and has a distinct `_TELEMETRY` filename, then confirm the original Blob and manifest are unchanged. Exercise the native wrapper file bridge and browser fallback separately. Verify backgrounding cancels an active encode cleanly, and export is disabled gracefully where canvas recording is unsupported and while the combined view is selected.
- Hide and restore Halo; verify camera tracks stop while hidden, resume when visible and the ride shows an appropriate gap.
- Withdraw incident-camera consent during rear-only Ride Memories and during a front/rear incident configuration; verify the memory recording continues using only its selected views.
- Exercise an activated incident upload failure/retry while recording a memory and verify the incident context remains recoverable and memory capture resumes only after completion.
- Sign out or switch customer during a recording; verify the old manifest is finalised as incomplete (or an empty draft is deleted) and never appears for the new customer.
- Open the same account in another tab and verify an active recording is listed only as unfinished and cannot be played or deleted. Open the recovery warning and cancel while the first tab is live, then close the first tab and explicitly recover the footage as incomplete. Also verify automatic recovery only after the conservative lease expiry.
- Seed a lookalike filename with a wrong ownership marker, customer key, hash, MIME type, audio flag or Blob size and verify it never appears.
- Fill or throttle IndexedDB and verify Ride Memories stops with a clear warning while ride detection and Emergency Assist remain operational.

The telemetry sidecar contains sensitive journey location. It is customer-scoped, never included in the normal Ride Memories network flow, and is permanently deleted with its associated Ride Memory. Free rides normally have no mapped road label, so playback falls back to coordinates rather than making background reverse-geocoding requests.
