## Context

**What exists.** A notification is a terminal that needs attention or has finished unviewed activity. The server holds the facts (`attention`, `acknowledged`, `status`, `providerState` on each session snapshot in `packages/server-core/src/activity/types.ts`) and acknowledgement is server-owned, so a notification cleared on one client clears on all. The `server-notification-manager` change, which this one builds on, makes each notification a server-owned record that its terminal adds and removes and that a notification manager publishes after a five-second settle period (ADR-0061). Every client renders that published set. Desktop sums each window's count onto the Dock icon (`electron/appBadge.ts`).

**What the PWA is.** The top-level document is always `https://app.terminay.com` (the manager). A server's workspace runs in a cross-origin iframe at that server's own `https://<id>.terminay.com` session origin, one at a time (ADR-0012, ADR-0047). The manager keeps saved profiles in `localStorage` and a per-origin device-credential vault in IndexedDB. Only the framed session holds a WebRTC connection to the server; the manager has no channel to any server. One service-worker script is registered at each origin; neither registration handles `push`.

**What the hosted side is.** `terminay.com` runs static hosting and a signaling relay. The relay knows each server by its own session id and public host key, in rows that expire within thirty minutes. It has no record of a user, an installation, or which servers belong together.

**Constraints.**

- Web Push permits one subscription per service-worker registration, and a subscription is bound to one VAPID key.
- Notification permission cannot be requested or held by a cross-origin iframe, and iOS delivers Web Push only to the installed PWA's own origin. The subscription therefore lives at `app.terminay.com`.
- A service worker can badge only an application inside its own scope, so a registration scoped to one server's path cannot badge the app at `/`. Per-server registrations were considered and rejected for this reason.
- Hosted services are data-blind (ADR-0011, `remote-access`): no terminal output, project name, path, or agent state may pass through them as application data.
- The manager origin reads no workspace content (`connections-and-client-hosts`, ADR-0012).
- No polling (ADR-0028), and no background connection per saved server (ADR-0047).

## Goals / Non-Goals

**Goals:**

- A device not looking at a server gets a banner for each notification that server's in-app list would show.
- A server can never cause a banner, a count, or a clear attributed to another server.
- The PWA icon shows the sum of unread notifications across saved servers, and each saved server shows its own.
- A notification acknowledged anywhere clears from every device.
- The hosted service can read no notification and stores nothing that identifies an installation or links its servers.

**Non-Goals:**

- A Notifications list in the phone-width workspace chrome. Proposed separately.
- OS banners or sounds from Terminay Desktop.
- Push to a first-party session tab opened outside the PWA.
- Per-project or per-kind push preferences. Enrolment is on or off per saved server.
- Hiding from the hosted service or the browser vendors the fact that a push was sent. Web Push cannot.
- Delivering a push from a server that cannot reach `terminay.com`.

## Decisions

### D1. One subscription at the manager origin, one VAPID key held by the hosted push service

The manager's service worker holds the only push subscription. Its `applicationServerKey` is a VAPID public key built into the manager; the private key lives only in the `terminay.com` server.

*Boundary:* Server ↔ hosted services. The VAPID private key must not reach a Terminay Server: anyone can run one, and the key authorises pushing to every subscription created with it.

*Alternatives.* A VAPID key per server with a subscription per service-worker scope removes the hosted service entirely, but a scoped worker cannot badge the app icon and the route is unproven on iOS. A subscription at each session origin gives browser-enforced isolation for free, but a framed cross-origin document cannot hold notification permission.

### D2. Isolation is a per-pairing key the service worker checks, not anything the transport provides

Because all servers reach one subscription through one signing key, the transport cannot tell them apart in any way the device can trust. For each saved server the manager generates a random 256-bit **push key** and a random **routing id**, and stores them keyed by that server's session origin. The server seals every push with AES-256-GCM under that key, with the routing id and a format version as associated data. The service worker selects the key by routing id, verifies, and only then acts.

The banner's title is the profile label the user gave that server on this device. No field of a push can set or alter it.

A push that names an unknown routing id, fails verification, or carries a sequence number at or below the last one accepted for that server changes nothing: no count, no banner attributed to a server, no clear. Where the platform insists that every push shows something, the worker shows one fixed, unattributed line and nothing from the payload.

*Boundary:* server-to-server isolation at the manager origin. This is the property the owner asked for, and it holds against a malicious server, a malicious hosted service, and a malicious push vendor alike.

*Alternatives.* Signing with the server's pinned Ed25519 host key avoids a second secret, but reuses the transport-authentication key in a second protocol, ties push to the server rather than the pairing, and gives no confidentiality. A hosted service that tags each push with the sending server would make isolation depend on a party the trust model treats as untrusted for integrity.

### D3. The server seals; the hosted service applies Web Push encryption and the VAPID signature

A push has two layers. The inner layer is D2's seal, applied by the server. The outer layer is standard Web Push message encryption to the subscription's keys, applied by the hosted service along with the VAPID signature. The hosted service sees only the inner ciphertext.

Servers therefore never hold the subscription's endpoint or keys. That keeps Terminay Server free of a Web Push dependency, and it means a rotated subscription is repaired by the manager alone (D5) without waiting for each server to be opened.

Every inner payload is padded to one fixed length before sealing, so its size reveals neither the kind of event nor the length of a name.

*Boundary:* hosted services stay data-blind. Confidentiality rests on the inner layer; the outer layer protects against the push vendors.

*Alternative.* Having the server apply Web Push encryption itself leaves the hosted service doing nothing but signing. It hands every server the same subscription keys and makes subscription rotation a per-server repair.

### D4. Enrolment travels the authenticated channel, through the framed session

The manager cannot reach a server; the framed session can. Enrolment for a server:

1. The user enables notifications in the manager, by a gesture, which obtains permission and the subscription.
2. The manager generates the routing id, push key, and a random **push token** for that session origin, and registers the token with the hosted push service (D5).
3. When that server's session is framed and connected, it asks the manager for its enrolment over the closed framed-host notification messages. The manager answers only the origin that asked, keyed by `event.origin`, exactly as the credential vault is.
4. The session sends routing id, push key, and push token to the server on the authenticated application channel. The server stores them on that device's record.

The server posts to the connection manager beside its own hosted session origin (`app.<hosted domain>`), which it derives from where it is itself exposed. It never takes a destination from the client, and a server exposed only by direct signaling has none.

The server keeps enrolments in their own owner-only file in the data root, keyed by device id, instead of inside the device registry record. Both hosts prune it whenever the device registry is written, so an enrolment ends with its device's trust without the registry's schema changing.

*Boundary:* manager ↔ session origin. One server's key and token are cloned only into that server's iframe. This adds three messages under the existing "notifications" heading of the closed schema: enrolment request and reply, a count report (D8), and a banner target handed to the session (D9). It adds no storage proxy and no cross-origin read.

### D5. The hosted push service stores rows it cannot link or read

For each (device, server) enrolment the hosted service stores exactly: a hash of the push token, the subscription sealed under a key derived from that token, and an expiry. The manager seals the subscription before sending it, so the service never receives it in the clear at registration.

At push time a server presents its token with a sealed payload. The service finds the row by the token's hash, derives the key from the token, opens the subscription in memory, applies Web Push encryption and the VAPID signature, forwards, and retains nothing.

- A database copy contains unrelated rows. Nothing in it says two rows are the same installation, and no row can be opened without a token the service does not keep.
- The service refuses any destination that is not a known browser-vendor push host, so it cannot be used to make requests elsewhere.
- It accepts only a payload of the exact sealed length, limits rate per token hash, and never logs a body, an endpoint, or a token.
- When a vendor reports a subscription gone, the service deletes the row and tells the server, which drops the enrolment.
- The manager, which holds every token, re-seals and replaces rows itself when the subscription rotates.

*Boundary:* hosted services gain no user or installation identity. Today the relay cannot tell which servers belong together; with plain endpoint storage it could, because every server on one device shares one endpoint.

*What remains.* While a push is in flight the service holds the endpoint in memory, and a service that deliberately recorded endpoints could link servers. It can already do that from IP addresses. The requirement is that it does not record them, and that is tested.

*Alternative.* A stateless service, with a self-contained signed capability and the endpoint supplied by the server on every push, stores nothing but cannot revoke one server's access on unpair and gives every server the endpoint. The owner chose the small table.

### D6. Push reads the notification manager's published set; it does not narrate events

Push is an in-process consumer of the notification manager. It sees a notification only once the manager has published it and sees its removal when the manager publishes that. It holds no rule about what a notification is and no timer of its own, so a notification removed within the settle period never reaches it.

Each push is a complete, idempotent statement about one server for one device:

- a sequence number that only increases for that enrolment;
- the server's current notification count;
- the identifiers of the notifications currently outstanding, bounded;
- optionally one notification to show: its kind, terminal title, project title, time, the project and session identifiers, and, for a notification a process sent, its title and body.

Because every push carries the current state, a lost, reordered, or duplicated push is repaired by the next one, and the worker never needs to ask a server anything.

A push is sent to an enrolment when the set changes and the device is not watching (D7). The settle period belongs to the manager and applies to every consumer alike, so the phone, the Desktop header, and the web UI learn of a notification at the same moment. A burst of changes is coalesced so a device receives the latest state, not every intermediate one. If the hosted service cannot be reached the server retries with bounded backoff and then sends only the current state; it keeps no queue of past notifications.

*Boundary:* terminal-session and project boundaries. A paired device has full control of its server, so every project's notifications are within its authority; there is no narrower scope to enforce today. The payload is built from server-owned state, never from a client's claim.

### D7. A device that is looking at a server gets no banner from it

A device is **watching** a server while it holds a live connection to it whose window last reported itself visible. The session reports visibility on the authenticated channel when it changes. A watching device already has the in-app indicators, so the server sends it no push.

When a device stops watching, by reporting hidden or by its connection being declared dead, the server sends the current state if it differs from the last state that device was sent. A notification that arrived in the seconds before a phone was locked is therefore not lost.

The visibility report is a hint from the client that affects only that device's own pushes. It grants nothing and addresses nothing.

*Alternative.* Always push and let the service worker suppress the banner when a manager window is visible. That depends on every platform tolerating a push that shows nothing, which is exactly what is in doubt on iOS.

### D8. Counts: one slot per server, summed onto the icon

The manager keeps one count per saved server. A slot is written from two sources and nothing else: a verified push from that server, and a count report from that server's own framed session while it is open. The count report carries a number and no detail, the same shape as Desktop's `badge.count.set`.

The icon badge is the sum of the slots, set through the Badging API where the platform has one. The manager's profile list shows each slot beside its server. Forgetting a server removes its slot.

*Boundary:* the manager origin learns a number per server, not what it counts.

### D9. Opening a banner hands the target to that server's session only

A banner's data holds the session origin and the opaque project and session identifiers from the verified push. On activation the service worker opens or focuses the manager, the manager frames that origin, and once the session is connected the manager hands it the identifiers. The workspace selects that terminal as activating a list row does, which acknowledges it on the server.

The manager does not interpret the identifiers and delivers them only to the origin whose key verified the push.

### D10. Clearing is the same push, and is bounded by what the platform allows

Acknowledgement changes the set, so the server pushes the new state (D6). The worker closes any displayed banner for that server whose identifier is no longer outstanding, and updates the slot.

A state push that shows no banner is a silent push. Chrome and Firefox tolerate a bounded number; iOS may not. At enrolment the manager tells the server whether this installation accepts silent state pushes. For one that does not, the server sends state only alongside a banner, and the device catches up at the next banner or when the app is opened, whichever is first. Opening a server in the PWA always reconciles that server's banners and slot.

### D11. The manager's service worker may display names, and do nothing else with them

The seal's key lives at the manager origin, so the manager's service worker decrypts the terminal and project titles and, for a notification a process sent, its title and body. It uses them for the banner body only. It does not store them, does not send them anywhere, and does not expose them to the manager page; the banner's attached data holds identifiers, not titles.

Titles are server-resolved display text (ADR-0058) and are shown as plain text within bounds. For a notification from terminal activity the headline is chosen from a fixed table by kind code, so a server cannot supply headline wording. Text a process sent is already bounded plain text when the notification manager stores it. An OSC notification's message body is never part of a push.

*Boundary:* ADR-0012's manager surface. This is the one place the manager origin handles workspace content, and it is the narrowest form that still gives the owner what a banner is for.

### D12. Foreground notifications get the same attribution

The framed session can already ask the manager to show a notification with a title and body of its own choosing, with no server named. The manager now titles any such notification with its own label for that origin and puts the session's text in the body. This closes the same forgery by a different door.

### D13. Permission is a state the manager always shows, with a way out of every state

A browser asks for notification permission once. If the user blocks it, no web page can show the prompt again; only the device's settings can reverse it. Chrome also blocks on its own after a few dismissals. The design cannot change that, so it is built around it:

- **The first "no" is ours.** The manager shows its own explanation before the browser's prompt. Declining there costs nothing and can be reversed from the control at any time. The browser's prompt appears only after the user has already said yes once, which is when an accidental "no" is least likely.
- **Blocked is a named state with instructions.** The control says notifications are blocked and gives the steps for the platform in use: the installed app's notification settings on iOS and Android, the site's permission in a desktop browser.
- **Recovery is automatic.** The manager re-reads the permission on start, on returning to the foreground, and on the browser's change event where one exists. When it finds blocked has become allowed it subscribes and enrols without being asked, since the user has just expressed that intent in settings. When it finds allowed has become blocked it ends the enrolments.
- **Allowed is not the same as working.** A subscription that fails to create or register is shown as a failure with a retry, never as on. A test notification, shown locally by the service worker, lets the user see whether the operating system is silencing the app, which a web page cannot detect.

The manager's states are: not yet asked, on, blocked, needs the installed app, not supported, and could not be set up.

*Boundary:* none crossed; this is manager-origin presentation over the browser's own permission.

*Alternative.* Requesting the browser's prompt directly from the control is one tap fewer, and makes an accidental block the user's first and only chance.

## Wire Contract

This section is the contract between the two repositories. `terminay` owns the sealed payload, the server's calls to the hosted push service, and the session authority the workspace reads. `terminay.com` owns the hosted push service, the manager, its service worker, and the framed-host messages.

All binary values in JSON are base64url without padding.

### Enrolment

The manager generates, per saved server (keyed by session origin):

| Field | Form |
| --- | --- |
| `routingId` | 16 random bytes |
| `key` | 32 random bytes, used as an AES-256-GCM key |
| `token` | 32 random bytes |
| `silent` | boolean: whether this installation accepts a push that shows nothing |

The workspace receives exactly `{ routingId, key, token, silent }` and passes it to its server unchanged.

### Sealed payload

One push body is exactly **3072 bytes**:

| Bytes | Content |
| --- | --- |
| 0 | format version, `1` |
| 1–16 | `routingId` |
| 17–28 | nonce, 12 random bytes |
| 29–3071 | AES-256-GCM ciphertext followed by its 16-byte tag |

The associated data is bytes 0–16 (version and routing id). The plaintext is 3027 bytes: a 2-byte big-endian length `L`, then `L` bytes of UTF-8 JSON, then zero padding.

The JSON is:

```json
{
  "s": 1791720599123,
  "c": 2,
  "o": ["n-…", "n-…"],
  "m": false,
  "n": {
    "i": "n-…",
    "k": "agent-finished",
    "t": "Terminal 1",
    "p": "Project 2",
    "a": 1791720594000,
    "pi": "project id",
    "si": "session id",
    "mt": "Review ready",
    "mb": "Three files changed"
  }
}
```

- `s`: sequence, an integer that only increases for one enrolment. The receiver ignores a push whose `s` is not greater than the last it accepted for that routing id.
- `c`: the server's current notification count, `0..9999`.
- `o`: ids of the notifications currently outstanding on that server, newest first, as many as fit. `m` is `true` when the list was cut short, in which case the receiver closes nothing on the strength of an id being absent.
- `n`: optional. The one notification to show. `k` is one of `agent-finished`, `agent-waiting`, `agent-blocked`, `command-finished`, `attention`, `message`. `t` and `p` are the terminal and project titles, each at most 80 characters. `a` is when it arose, in epoch milliseconds. `mt` and `mb` are present only for `message`: title at most 80 characters, body at most 280.

A push without `n` is a state push. A server sends one only to an enrolment whose `silent` is `true`.

### Hosted push service

Served on the manager origin (`https://app.terminay.com`). `tokenHash` is the SHA-256 of the raw token bytes.

| Request | Meaning | Responses |
| --- | --- | --- |
| `GET /v1/push/key` | The Web Push application server key | `200 {"publicKey": "…"}`; `404` when push is not configured |
| `PUT /v1/push/enrolments/{tokenHash}` with `{"sealed": "…"}` | Create or replace one enrolment's sealed subscription; renews its expiry | `204`; `400` malformed; `429` |
| `DELETE /v1/push/enrolments/{tokenHash}` with `Authorization: Bearer {token}` | Remove one enrolment | `204` whether or not it existed; `401` when the token does not hash to the path |
| `POST /v1/push` with `Authorization: Bearer {token}`, `Content-Type: application/octet-stream`, and a 3072-byte body | Forward one sealed payload | `202` forwarded; `400` wrong length or type; `401` no token; `404` no such enrolment; `410` the browser vendor reports the subscription gone, and the row is deleted; `429` rate-limited, with `Retry-After`; `502` the vendor could not be reached; `503` push is not configured |

A server treats `404` and `410` as the end of that enrolment and drops it. It retries `429`, `502`, `503`, and network failure with bounded backoff, and then sends only its current state.

`sealed` is `nonce (12 bytes) || AES-256-GCM ciphertext || tag (16 bytes)` of the UTF-8 JSON `{"endpoint": "…", "p256dh": "…", "auth": "…"}`, under the key `HKDF-SHA256(ikm = token, salt = empty, info = "terminay push subscription v1", length = 32)`. The manager seals it; the service can open it only while handling a request that presents the token.

The service stores `token_hash`, `sealed_subscription`, and `expires_at` and nothing else. It forwards only to `https` endpoints whose host is `fcm.googleapis.com`, `updates.push.services.mozilla.com`, or ends in `.push.apple.com` or `.notify.windows.com`. It sends with a twelve-hour time to live, high urgency, and a `Topic` derived from the token, so a newer push to one enrolment replaces an undelivered older one.

### Session authority

The hosted session bootstrap installs `window.__TERMINAY_HOSTED_SESSION_AUTHORITY__` before the workspace bundle runs. When it is framed by a manager that supports push it adds one member:

```ts
notifications: {
  /** The enrolment the manager holds for this origin; undefined when notifications are off or unavailable. */
  getPushEnrolment(): Promise<{ routingId: string; key: string; token: string; silent: boolean } | undefined>;
  /** Called when that answer may have changed. Returns an unsubscribe. */
  subscribePushEnrolment(listener: () => void): () => void;
  /** This server's notification count, and nothing else. An integer 0..9999. */
  setNotificationCount(count: number): void;
  /** The terminal a banner the user opened names. A target that arrived before anyone listened is delivered to the first listener. Returns an unsubscribe. */
  subscribeNotificationTarget(listener: (target: { projectId: string; sessionId: string }) => void): () => void;
}
```

A first-party session tab, and a manager that does not support push, leave `notifications` undefined.

### Framed-host messages

Added to protocol version 1 of the closed `postMessage` schema, under its existing notifications heading:

| Direction | Type | Fields |
| --- | --- | --- |
| session → manager | `push.enrolment.get` | `id` |
| session → manager | `notification.count` | `count` |
| manager → session | `push.enrolment` | `id`, and `routingId`, `key`, `token`, `silent` when an enrolment exists |
| manager → session | `push.enrolment.changed` | none |
| manager → session | `notification.target` | `projectId`, `sessionId` |

The manager resolves an enrolment only from `event.origin`. `notification.count` is accepted only as an integer `0..9999` and changes only the count of the origin that sent it.

## Risks / Trade-offs

- [A user blocks notifications by accident and cannot be re-prompted] → D13: the manager's own explanation takes the first refusal, a block is shown with platform steps, and unblocking in settings resumes without further action. The browser's rule itself cannot be removed.
- [Notifications are allowed but the operating system silences the app, which the page cannot see] → The test notification makes it visible to the user.

- [iOS revokes a subscription that receives pushes showing nothing] → D10 withholds silent state pushes from such installations; the spike in tasks group 1 measures the real behaviour before the spec promise is relied on.
- [An iPhone's badge and banners lag behind an acknowledgement made elsewhere] → Accepted and stated in the spec; reconciled at the next banner and on opening the app.
- [The hosted service logs endpoints in flight and links a user's servers] → Forbidden by requirement and covered by a test over its logs; the exposure is the same class as the IP addresses it already sees.
- [The VAPID key is abused as a free push relay by another site that subscribes with the public key] → Registration and push are rate-limited per token hash, payloads are a fixed small size, and destinations are restricted to vendor push hosts. Reputation abuse remains possible in principle and is monitored.
- [The hosted service is asked to request an arbitrary URL] → Destination allowlist, checked after the subscription is opened and before any request.
- [A compromised manager origin can read banner names and every push key] → ADR-0012 already accepts that manager XSS exposes every vaulted device key, which is strictly worse. Push keys only verify and decrypt banners.
- [A server floods a device with its own banners] → It can only do so under its own label; the user disables that server's notifications or forgets it. The hosted rate limit bounds the volume.
- [Push and the in-app list disagree] → Both read the notification manager's published set; a test asserts the pushed state equals a client's snapshot.
- [A server that cannot reach `terminay.com` sends nothing] → Stated as a non-goal. A direct-signaling server without hosted reachability has no push.
- [Padding and the outstanding-identifier list do not fit one Web Push message] → The identifier list and both titles are bounded so the padded payload fits well inside the 4 KiB limit; a set larger than the bound is sent as a count with the newest identifiers.
- [Timing metadata reaches Google, Apple, Mozilla, and Microsoft] → Inherent in Web Push; recorded in the trust model.

## Migration Plan

1. Run the iOS and Android spike and record its evidence.
2. Ship the hosted push service and its table on `terminay.com` with no client using it.
3. Ship the server and workspace support behind protocol capability negotiation: a server advertises push enrolment, and a manager enrols only with a server that does.
4. Ship the manager's permission UI, service-worker handlers, counts, and badge.

Each step is inert without the next. Rollback is the reverse: remove the manager UI, and enrolments stop being created; a server with no enrolments sends nothing; the hosted table can be emptied without affecting pairing or signaling. A paired device needs no re-pairing in either direction.

## Open Questions

- **Do the Show indicator for active tabs and Show indicator for finished tabs settings govern push?** They govern the in-app list. This design assumes push follows the same set the list shows on that server, so a finished-tab indicator turned off also turns off its banners. To confirm against `server-notification-manager`, since those settings' scope decides whether the server can read them.
- **How many silent pushes does iOS tolerate, if any?** Decides whether D10's catch-up path is the only path on iOS. Answered by the spike.
- **Does the Badging API update from a push handler on an installed iOS PWA when the app is not running?** Assumed yes on iOS 16.4 and later. Answered by the spike.
- **How long may an enrolment row live without use?** Proposed: ninety days, renewed whenever the manager is opened or a push is sent.
- **ADRs this design touches.** It adds a boundary to ADR-0011's model, widens ADR-0012's fixed manager surface by a bounded amount, and closes ADR-0047's open item. None is contradicted; the adr step records one new ADR that extends them without superseding any.
