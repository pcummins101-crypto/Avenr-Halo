# Camera alignment check

Camera alignment check is an explicit, pre-ride live preview for confirming the mounted phone's road-facing and rider-facing framing. It is independent of Ride Memories, incident-camera consent and Emergency Assist.

## Rider flow

1. Park the bike and secure the phone in its intended riding position.
2. Open **Ride** and select **Check camera alignment**.
3. Allow camera access if the phone prompts for it.
4. Use the centre and horizon guides to inspect the complete, uncropped rear road-facing frame and front rider-facing frame.
5. Where both camera streams remain live, Halo displays both previews together. Where the phone or WebView supports only one live camera, use **Rear · road** and **Front · rider** to inspect them sequentially.
6. Wait until Halo says each live image is visible, inspect the framing, then choose **Close preview** before starting the ride.

The rider must not adjust the phone or mount while the bike is moving.

## Privacy and lifecycle

- Every camera request sets `audio: false`; microphone access is never requested.
- The preview module has no `MediaRecorder`, IndexedDB, upload or fetch path.
- The preview is unmirrored and uses `object-fit: contain`, so it shows the complete camera frame rather than a cropped display approximation.
- No image, video, thumbnail, telemetry or alignment result is saved or sent to WordPress.
- A generation fence tracks provisional streams and stops them immediately if the dialog closes or the account changes, including while a second permission request or camera lookup remains pending.
- All active preview tracks stop on dialog close, backdrop or Escape dismissal, page backgrounding, page unload, account reset/sign-out and immediately before Ride mode requests its recording camera.
- Returning from the background does not silently reopen a camera. The rider must tap the retry action while stationary.

The alignment action itself is the rider's explicit request for a transient preview and remains subject to the browser or native WebView camera permission. It does not opt the rider into Ride Memories or incident video.

## Capability behaviour

Halo requests and verifies an environment-facing stream first, then a distinct user-facing stream. Two-camera mode is reported only when both tracks remain live and unmuted after a short settling period, and their track identity, device identity or labels prove they are distinct. A sustained runtime mute degrades the display rather than claiming a black or frozen view is live.

Some phones end the first stream when the second camera opens. Halo detects that condition, stops the failed front probe, reacquires the rear stream if required and presents a truthful single-camera interface. Switching views stops the current stream before requesting the other camera, so constrained devices can still check both alignments without pretending simultaneous support.

## Acceptance checks

- On a dual-capable phone, verify that both labeled views stay live together and that each frame is the correct camera.
- On a constrained phone or WebView, verify rear-only fallback, switch to front, then switch back to rear. Confirm no abandoned camera indicator remains active between switches or after closing.
- Confirm the preview is not mirrored or cropped and the vertical/horizontal centre guides remain aligned through portrait and landscape rotation.
- Deny camera permission and verify the dialog explains how to recover without enabling any recording feature.
- Open another camera app to force a busy-camera error and verify a retry is offered.
- Close with the X, Done button, backdrop and Escape. Confirm the operating-system camera indicator turns off immediately in every case.
- Background Halo while the preview is open. Confirm every track stops and returning to Halo requires a new tap to restart.
- Start Ride mode after using the check. Confirm the preview releases its tracks before Ride Memories or incident-camera capture starts and that the recording pipeline can still acquire the selected cameras.
- Sign out or switch accounts during a pending permission prompt. Confirm any late stream is stopped and no previous-account preview remains visible.
- Inspect network and local browser storage while using alignment. Confirm there is no alignment request, Blob, IndexedDB record or media file.
- Repeat on the current production iOS Safari/WebView and Android Chrome/WebView builds used by Halo.
