## Why

Terminay Desktop tells you when a terminal needs you: the header lists the notification and the Dock icon carries the count. The installed PWA at `app.terminay.com` tells you nothing unless it is open on the right server. An agent that finishes or stops to ask a question on a server at home is invisible on the phone in your pocket, and with several saved servers there is no way to see which of them wants you.

The PWA has no channel to a server it is not showing, and a browser will not wake a web app without Web Push. Nothing in either repository implements push today: there is no subscription, no service-worker push handler, and no hosted endpoint that could deliver one. ADR-0047 left "a host-readable activity summary for servers no window is showing" as an open item; this change closes it for the PWA.

## What Changes

This change builds on `server-notification-manager`, which makes a notification a server-owned record published after a settle period. Push is one more reader of that published set and adds no notification logic of its own.

- **Push banners on the installed PWA.** When a notification arises on a paired server, a device that is not looking at that server gets a banner. Its title is the name the user gave that server on the device; its body says what happened, or carries the text an agent sent, and names the terminal and its project.
- **One server cannot speak for another.** Every push is sealed with a key shared only by one server and one device at pairing time. The service worker verifies it before showing anything, and takes the server's name from the device, never from the push. A push that fails verification is never attributed to a server.
- **A badge on the PWA icon, and a count on every saved server.** The icon shows the sum of unread notifications across saved servers. The manager's server list shows each server's own count. A server can only ever change its own number.
- **Clearing follows the server.** A notification acknowledged on any client is cleared from the other devices' banners and counts, as it already is from their in-app lists.
- **Opening a banner takes you to the terminal.** The PWA opens that server and selects that terminal, which acknowledges it.
- **A hosted push service that cannot read anything.** `terminay.com` gains a small service that holds the single Web Push signing key and forwards sealed pushes to the browser vendors. It receives ciphertext of one fixed size, stores no notification, and keeps no record that links one user's servers together.
- **The manager may show names in a banner.** The manager origin is otherwise forbidden from reading workspace content. Its service worker is permitted to decrypt a banner's text, its terminal and project names and anything an agent sent, in order to display it, and nothing else.
- **Notifications the framed session raises carry the same attribution.** A foreground notification raised through the manager is titled with the device's name for that server, with the session's text as the body.

Decisions taken with the owner: banners name the terminal and project; the PWA icon badge is part of this change; a push is sent for exactly the notifications the in-app list shows; a device that is looking at a server gets no banner from it; a clear on one device clears everywhere; the hosted service may keep a small table as long as it can never read content or identify an installation.

Not in this change: a Notifications list in the phone-width workspace chrome. The header control that lists notifications is not drawn at 640px and below, so on a phone a banner is the way in and the project dots are the only in-app indicator. That list is useful without push and touches only this repository, so it is proposed separately.

## Capabilities

### New Capabilities

- `remote-push-notifications`: push enrolment per device and server, what a server pushes and when, end-to-end sealing and device-held attribution, banner content and activation, clearing across devices, the PWA icon badge and per-server counts, and the content-blind hosted push service.

### Modified Capabilities

- `connections-and-client-hosts`: the web host's "reads no workspace data" rule gains one bounded exception, for the manager's service worker displaying the terminal and project names of a verified push banner.
- `remote-access`: the persistence boundaries name the push enrolment state each party may hold: the manager origin, the server, and the hosted push service.
- `settings-shortcuts-and-desktop-integration`: the application icon badge requirement stops forbidding a count on installed web clients, and points at where the PWA's badge is specified.

## Impact

- **`packages/protocol`, `packages/server-core`**: new device-scoped operations to enrol, withdraw, and report whether a window is being looked at; a push sender that reads the notification manager's published set, seals it, and posts to the hosted service; enrolment state on the device record.
- **`src/` workspace UI**: asks the framed host for an enrolment and forwards it; reports its notification count to the framed host; selects a terminal when the host hands it a banner target.
- **`terminay.com` (sibling repository)**: a new hosted push endpoint and its table; the VAPID key pair; the manager's permission and enrolment UI, per-server counts, and icon badge; `push`, `notificationclick`, and `pushsubscriptionchange` handlers in the manager service worker; three additions to the framed-host notification messages.
- **Third parties**: the browser vendors' push services (Google, Apple, Mozilla, Microsoft) join the delivery path. They and the hosted push service observe when a push is sent and to which subscription; none can read one.
- **Security model**: a new boundary, recorded in a new ADR that extends ADR-0011's table, narrows ADR-0012's manager surface, and closes ADR-0047's open item.
- **Dependencies**: a Web Push library in the `terminay.com` server. None in Terminay Server, which only performs AES-GCM and an HTTPS request.
- **Platform limits**: iOS delivers Web Push only to a PWA installed to the Home Screen, and may not permit a push that shows nothing, which bounds how promptly a clear reaches an iPhone. A spike on real hardware precedes implementation.
