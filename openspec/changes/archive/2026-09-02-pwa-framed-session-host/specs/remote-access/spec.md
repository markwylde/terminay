## MODIFIED Requirements

### Requirement: Opening a hosted pairing link

Opening the advertised hosted pairing URL SHALL land on `app.terminay.com`. The manager SHALL consume the fragment in memory and strip query and hash from the visible URL and history, then ask whether to **Save and connect** with an optional title prefilled from `hostName` or the session id. Cancel SHALL discard the pairing material and save no profile. Confirm SHALL save or update the manager profile with that title, keep `https://app.terminay.com` as the top-level document, and load the reconstructed session pairing URL (`https://<session-id>.terminay.com/v1/#…`) in a fullscreen iframe without storing the fragment. The framed session origin SHALL perform enrollment: WebRTC, PIN or approval, device key, and workspace install, loading and saving that origin's device credential through the manager vault.

#### Scenario: Cancel saves nothing

- **WHEN** the user cancels the **Save and connect** prompt
- **THEN** the pairing material is discarded and no manager profile is written

#### Scenario: Confirm frames enrollment without leaving the manager

- **WHEN** the user confirms **Save and connect**
- **THEN** the profile is saved and the reconstructed session pairing URL is framed
- **AND** the top-level document remains `https://app.terminay.com`

#### Scenario: Fragment is stripped from the visible URL

- **WHEN** the manager consumes the pairing fragment
- **THEN** query and hash are removed from the visible URL and history and the fragment is never stored

### Requirement: First-party session-origin enrollment

A first-party visit to `https://<session-id>.terminay.com/v1/#<secret>` SHALL enroll at the session origin using session-origin IndexedDB and SHALL NOT use the manager vault. **Open in new tab** SHALL use a first-party session document that stores its device key in session-origin IndexedDB. Direct and framed credentials for the same origin SHALL be separate.

#### Scenario: Direct session URL enrolls first-party

- **WHEN** the user opens a session-origin `/v1/` pairing URL directly
- **THEN** enrollment occurs at that origin with session-origin IndexedDB

#### Scenario: New-tab credential is separate from the vault

- **WHEN** the user chooses **Open in new tab** from the manager
- **THEN** the resulting first-party document stores its own device key and does not share the manager vault

### Requirement: Returning to the manager list

**Back to connections** SHALL return to the manager list without navigating `window.top`. From a connected workspace this action SHALL be **Switch connections** and **File → Disconnect**. Desktop SHALL omit **Switch connections** because its connection menu lists every remembered profile. Returning to the manager list SHALL unload the iframe.

#### Scenario: Returning unloads the framed session

- **WHEN** the user chooses **Back to connections** or **Switch connections**
- **THEN** the manager list is shown, the iframe is unloaded, and `window.top` is not navigated

#### Scenario: Desktop has no switch action

- **WHEN** a Desktop client displays its connection menu
- **THEN** **Switch connections** is absent and every remembered profile is listed

### Requirement: Missing framed device identity

If the framed session has no valid device identity, that session page SHALL ask for a fresh pairing URL. The manager profile SHALL remain until the user chooses **Forget**, which SHALL also delete that origin's vault slot.

#### Scenario: Invalid identity requests re-pairing

- **WHEN** a framed session finds no valid device identity
- **THEN** the session page asks for a fresh pairing URL and the manager profile is retained

#### Scenario: Forget clears the vault slot

- **WHEN** the user forgets a manager profile
- **THEN** the profile and that origin's vault slot are both deleted

### Requirement: Closed framed-host message schema

The framed host SHALL use one closed, origin-checked `postMessage` schema for device credentials, clipboard, microphone, notifications, and shell control. It SHALL NOT proxy WebRTC, workspace frames, or generic storage. The manager SHALL key vault entries only by `event.origin` and SHALL clone a credential only into the iframe that matches that origin. Structured clone SHALL keep the key non-extractable. The manager SHALL never sign. The session SHALL speak to `parent` only when `parent.origin` is `https://app.terminay.com` and SHALL ignore any other embedder.

#### Scenario: Vault entry is origin-keyed

- **WHEN** a session iframe requests a device credential
- **THEN** the manager resolves the vault slot only from `event.origin` and clones only into the matching iframe
- **AND** an iframe cannot name another origin's slot

#### Scenario: Session ignores foreign embedders

- **WHEN** a session document is embedded by an origin other than `https://app.terminay.com`
- **THEN** it posts nothing to `parent` and ignores that embedder

#### Scenario: Manager never signs

- **WHEN** a challenge must be signed
- **THEN** the session iframe signs it and the manager does not

### Requirement: Framed session presentation and permissions

The PWA SHALL show at most one framed session; opening another connection SHALL replace that iframe. Clipboard and microphone messages SHALL require a user gesture in the manager or in the iframe surface that requested them. The iframe `allow` list MAY include clipboard and microphone and SHALL NOT include camera; camera SHALL stay on the manager for QR scan. The manager SHALL pin the titlebar and session iframe to the visual viewport, including when the iOS keyboard is visible, with the iframe below the titlebar and the workspace inside it not adding `env(safe-area-inset-top)` again. Session and workspace script SHALL NOT assign `window.top` or use `target="_top"`; `target="_blank"` MAY open a first-party tab.

#### Scenario: One framed session at a time

- **WHEN** the user opens another connection while a session is framed
- **THEN** the existing iframe is replaced

#### Scenario: Camera stays on the manager

- **WHEN** a framed session requests camera access
- **THEN** it is not granted through the iframe `allow` list, and QR scanning happens on the manager

#### Scenario: Viewport pinning with the iOS keyboard

- **WHEN** the iOS software keyboard is visible over a framed session
- **THEN** the titlebar and session iframe stay pinned to the visual viewport

### Requirement: Manager profile store contents

The manager profile store SHALL contain only a label, the canonical stable session origin, and created and last-opened timestamps. The manager SHALL accept hosted pairing URLs on `app.terminay.com` and session-origin `/v1/` URLs and SHALL store only the reconstructed stable session origin as the bookmark. A non-secret `hostName` query MAY supply the default local label. Opening or pasting a pairing URL SHALL ask **Save and connect** before that bookmark is written, and the user MAY set a title there. The manager SHALL reject URL credentials, unsupported schemes, and any query other than `s`, `hostName`, and `pairingExpiresAt`. It SHALL never store the pairing fragment or complete pairing URL.

#### Scenario: Unsupported query is rejected

- **WHEN** a pairing URL carries a query field other than `s`, `hostName`, or `pairingExpiresAt`
- **THEN** the manager rejects it

#### Scenario: URL credentials are rejected

- **WHEN** a pasted URL contains userinfo credentials or an unsupported scheme
- **THEN** the manager rejects it

#### Scenario: Fragment never enters storage

- **WHEN** a bookmark is written from a pairing URL
- **THEN** only the reconstructed stable session origin, label, and timestamps are stored

### Requirement: Framed-session credential vault

The framed-session vault SHALL be separate from the bookmark list. It SHALL store only that origin's non-extractable device private key plus the non-secret device id and name needed to reconnect. It SHALL live in manager-origin IndexedDB rather than `localStorage`. The manager SHALL never sign with those keys; the session iframe SHALL. Pairing fragments, PINs, tickets, terminal data, and workspace data SHALL never enter the vault.

#### Scenario: Vault contents are limited

- **WHEN** a framed session enrolls a device
- **THEN** the vault holds only the non-extractable private key, device id, and device name for that origin

#### Scenario: Vault is not localStorage

- **WHEN** the manager persists a framed-session credential
- **THEN** it uses manager-origin IndexedDB

### Requirement: iOS PWA storage isolation

An iOS Home Screen PWA SHALL have storage isolated from Safari. Pairing in Safari SHALL NOT populate the PWA vault, and pairing in the PWA SHALL NOT populate Safari.

#### Scenario: Safari pairing does not reach the PWA

- **WHEN** a device pairs in Safari and the user then opens the installed PWA
- **THEN** the PWA vault holds no credential for that origin
