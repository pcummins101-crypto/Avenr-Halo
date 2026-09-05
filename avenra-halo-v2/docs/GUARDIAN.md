# Halo Guardian recovery

Halo Guardian is a recovery aid for an existing rider-created live-location share. It is not continuous monitoring, Emergency Assist, an accident alert or permission to start an unrelated ride.

## Permission model

Guardian access is disabled by default. At link creation the rider may name one intended trusted contact and explicitly enable recovery. The resulting URL contains the ordinary view capability and a separate recovery capability. Both are random, stored only as hashes and expire with the live share.

Anyone who receives a Guardian URL can exercise its capability, so the interface warns the rider not to forward it. A standard live link never gains recovery authority. Ending the link, ending all links, signing out, resetting the device session or changing the rider PIN invalidates Guardian access with the underlying share.

## Recovery states

1. **Fresh** — the viewer receives recent writer-authenticated positions; no recovery action is offered.
2. **Delayed** — no accepted position has arrived within the server threshold; an authorised Guardian may request recovery.
3. **Requested** — the request is stored and rate-limited. This does not mean the rider device was reached.
4. **Rider app acknowledged** — an open Halo client has received the request and attempts to restart its high-accuracy GPS watcher.
5. **Resumed** — only a newer position accepted with the link writer credential completes recovery.
6. **Unreachable** — no new position arrives. The viewer continues to see the last-known position and a clear warning rather than a false live state.

The public response never exposes the rider's telephone number, account, motorcycle, route history, medical information or detailed device state.

## Rider SMS fallback

If an open Halo client does not resume the share within the fallback delay, the server schedules one rider notification. `AVENRA_FIRETEXT_API_KEY` enables the built-in FireText adapter; deployments can replace it with `avenra_halo_v2_guardian_sms_delivery`.

The message states that a trusted contact requested a fresh location, tells the rider to stop somewhere safe before using the phone and links back to Halo. The link identifies the live-share record but does not contain a writer credential. Halo requires the rider's authenticated customer session before rotating and issuing a new writer credential.

Provider acceptance means only that the SMS provider accepted the request. It never marks the Guardian request as delivered, read or resumed.

## Browser limitations

An open Halo client can restart its geolocation watcher automatically. A closed or suspended browser cannot be guaranteed to restart continuous GPS silently. After following the SMS link, the rider must explicitly resume sharing and keep Halo open. Reliable always-on remote recovery requires a future native application or motorcycle telematics connection.

## Acceptance test

Use test rider and Guardian devices:

1. Start Ride mode and create a normal link. Confirm there is no recovery button.
2. Create a Guardian link, leave its switch off first, then repeat with it on and an intended-contact label.
3. Confirm the button stays unavailable while positions are current.
4. Stop position updates without ending the share. After the stale threshold, request a fresh position.
5. With Halo open, confirm the app acknowledges, restarts GPS and the viewer changes to refreshed only after a new position reaches the server.
6. Repeat with Halo closed. Confirm one fallback SMS is attempted after the delay, the deep link requires the rider's Halo session and the old viewer link receives new positions only after the rider resumes.
7. Exercise wrong capability, repeated request, forwarded ordinary link, expired link, sign-out, PIN change and offline cases.
8. Confirm server/API/cache logs contain no plaintext viewer, writer or Guardian capability and no rider phone number in public responses.
