# Halo Community

Halo Community is an authenticated, opt-in rider space inside Halo V2. It is
not a public social profile and membership is disabled by default.

## Privacy boundary

- A rider must actively join and accept the current Community terms.
- The only public identity is the rider-chosen username and optional bio.
- Real names, email addresses, telephone numbers, motorcycles, rides, saved or
  live locations, Emergency Assist information and ride-risk indicators are
  never returned by the Community API.
- Directory visibility and direct messages can be switched off independently.
- A rider can leave Community without changing their Halo account, motorcycle,
  rides or Emergency Assist settings.

Forum posts, replies and direct-message history are retained when a rider
leaves so conversations and safety reports remain intelligible. The departed
rider is shown as `Former member` and their public profile is removed. This
retention should be reflected in the production privacy notice and data-rights
process.

Direct messages are private to their participants in the normal interface, but
they are stored by the WordPress service and are **not end-to-end encrypted**.
An authorised Community moderator may see a short excerpt when a participant
reports a message.

## Safety and moderation

- Either side of a block is removed from the other's directory and forum view,
  and new direct messages are prevented.
- Members can privately report a profile, thread, reply or message.
- WordPress users with `avenra_halo_community_moderate` can review reports under
  **Tools → Halo Community Reports**.
- The moderation queue is deliberately pseudonymous and does not expose the
  customer directory or safety data.
- Suspended profiles cannot rejoin without an authorised moderation decision.

A production launch should have published community guidelines, an abuse and
safeguarding escalation process, named moderation cover and a documented data
retention/data-rights procedure.

## Acceptance checks

1. Confirm a rider who has not joined cannot open the directory, forum or inbox.
2. Join with a unique username and confirm no real account identity appears on
   a second test rider's device.
3. Switch off directory visibility and confirm the profile disappears from a
   second rider's search.
4. Switch off direct messages and confirm an existing participant cannot send a
   new message.
5. Block a second rider and verify directory, forum interaction and messages are
   unavailable in both directions.
6. Report a profile, forum item and direct message; verify each appears in the
   WordPress moderation queue without customer identity data.
7. Suspend the reported member and verify they cannot reactivate themselves.
8. Leave Community and confirm the public profile disappears while prior
   conversation history shows `Former member`.
9. Repeat the flow on current iOS Safari and Android Chrome, including offline,
   expired-session and back-navigation behaviour.
