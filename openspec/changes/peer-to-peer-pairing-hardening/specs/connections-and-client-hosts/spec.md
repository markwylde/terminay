## ADDED Requirements

### Requirement: Pending approval surface

While a device awaits approval, the exposure surface in Remote Control, the Pair Device dialog, and the standalone CLI SHALL show the requested device name and the five-character match code with **Approve** and **Deny**. Desktop SHALL also raise a native notification naming the device so the administrator notices a request made while the dialog is closed. Approve and Deny SHALL act only on the exact pending request they were rendered for; a request that expired or was replaced SHALL show as such rather than approving a different one.

#### Scenario: Approval from the notification

- **WHEN** the administrator activates the pending-approval notification
- **THEN** Remote Control opens on the pending request with its match code and controls

#### Scenario: Stale approval is inert

- **WHEN** the administrator approves a request that has already expired
- **THEN** nothing is enrolled and the surface reports the request expired

## MODIFIED Requirements

### Requirement: Remote Control management surface

**Remote Control** SHALL open the shared connections route as a first-class management window in the same presentation family as Settings, Macros, Recordings, and Project Environments, using that family's sidebar-and-content chrome. Title, subtitle, and **Add connection…** SHALL live in the left sidebar with **This server → Exposure** first, then the saved-server list. Title, action, group labels, rows, and empty sidebar copy SHALL share one inset, matching Settings. The main pane SHALL show only the selected sidebar item: Exposure SHALL use the Settings remote-access cards for status header, WebRTC summary, pending approvals, trusted browsers, and live connections, while saved-server details and pairing SHALL appear there when those items are selected. Desktop SHALL open or focus a native auxiliary window; the browser host SHALL present the same route in-page. The window SHALL NOT be an Edit Tab sheet. Remote Control SHALL be the single management surface for pairing, approvals, trusted devices, live connections, and server identity reset, while Settings keeps signaling configuration.

#### Scenario: Both entry points open the same surface

- **WHEN** the user chooses File → Remote Control or the header connection-menu manage control
- **THEN** the same Remote Control management window opens with the Settings-family sidebar-and-content chrome

#### Scenario: Empty saved-server list lands on Exposure

- **WHEN** there are no saved servers
- **THEN** the window lands on Exposure with a quiet sidebar note, and empty-server copy is hidden while Exposure is selected or the pairing form is open

#### Scenario: Settings retains policy configuration

- **WHEN** the user needs signaling configuration
- **THEN** it remains in Settings rather than Remote Control

### Requirement: Pair Device dialog

**Create pairing link** from the connection menu and from Remote Control SHALL open the same Pair Device dialog. Remote Control's Exposure header SHALL show that action next to **Stop exposure** while the server is exposed. The dialog SHALL show the one-time pairing link and a copy control, and SHALL NOT show the session-origin hostname. When a device requests enrollment, the dialog SHALL replace the QR with that device's name and match code and **Approve** and **Deny**, and SHALL restore a fresh QR after the decision. The pairing URL field SHALL stack at full width above continue and cancel actions.

#### Scenario: Dialog hides the session hostname

- **WHEN** the Pair Device dialog is open
- **THEN** it shows the one-time pairing link and copy control and not the session-origin hostname

#### Scenario: Same dialog from both entry points

- **WHEN** **Create pairing link** is chosen from the connection menu or from Remote Control
- **THEN** the same Pair Device dialog opens

#### Scenario: Request appears in place of the QR

- **WHEN** a device submits an enrollment request while the dialog shows the QR
- **THEN** the QR is replaced by the device name, match code, and Approve and Deny controls

### Requirement: Browser connection journeys

Terminay SHALL support two browser entry journeys — opening the hosted pairing link and the `app.terminay.com` PWA add flow — and both SHALL use the same session-origin pairing, credential, server-bundle, and reconnect contracts. Opening the advertised hosted URL SHALL land on the manager, which consumes the fragment in memory, strips query and hash from the visible URL, and asks **Save and connect** with an optional title prefilled from `hostName` or the session id; Cancel SHALL discard the material and Confirm SHALL write the bookmark and frame `https://<session-id>.terminay.com/v1/#<secret>` without storing the fragment. The framed session origin SHALL establish WebRTC, verify and launch the selected server bundle, create the device key, submit enrollment, display the match code while awaiting host approval, and complete enrollment, storing that key in the manager vault for `event.origin` when framed. A later visit to the saved profile or the stable session origin SHALL reconnect without reuse of the pairing URL. A first-party visit to a session-origin `/v1/` pairing URL SHALL enrol at the session origin with session-origin IndexedDB.

#### Scenario: Both journeys share one prompt

- **WHEN** the user opens a hosted pairing link in a browser or scans or pastes it inside the PWA
- **THEN** the same **Save and connect** prompt appears and enrollment is framed at the session origin

#### Scenario: Returning to the manager restores the profile

- **WHEN** the user returns to the manager after a framed session
- **THEN** the iframe unloads and the saved profile is restored from local browser storage

#### Scenario: Saved connection reconnects from the vault

- **WHEN** the user selects the saved connection later
- **THEN** its stable session origin is framed, receives its device credential from the manager vault, and reconnects without a pairing URL

### Requirement: Manager is not part of the credential path

The manager SHALL NOT participate in approval or match-code display and SHALL never receive the connection ticket, terminal data, or workspace data. A missing or revoked device identity SHALL request a newly generated pairing URL. The saved manager profile SHALL remain until the user chooses **Forget**.

#### Scenario: Manager never sees the PIN or ticket

- **WHEN** enrollment or reconnect runs in a framed session
- **THEN** the manager receives no match code, approval decision, connection ticket, terminal data, or workspace data

#### Scenario: Revoked identity requests re-pairing

- **WHEN** the device identity is missing or revoked
- **THEN** a newly generated pairing URL is requested and the saved profile is retained

### Requirement: Browser enrollment prompt behaviour

Browser connection and device-enrollment prompts SHALL use the same centered, responsive modal surface and form controls as the rest of the disconnected browser host. Enrollment SHALL require a non-empty device name before enabling its primary action, SHALL then show the five-character match code with the instruction to confirm it on the exposing computer, and SHALL remain fully inset from the viewport at narrow sizes. Starting a fresh pairing flow SHALL NOT show a missing-saved-credential warning; enrollment errors SHALL appear only after an enrollment attempt fails or is denied.

#### Scenario: Primary action gated on valid input

- **WHEN** the device name is empty
- **THEN** the primary enrollment action stays disabled

#### Scenario: Match code shown while awaiting approval

- **WHEN** the enrollment request has been sent
- **THEN** the prompt shows the match code and waits for the host decision

#### Scenario: Fresh pairing shows no credential warning

- **WHEN** the user starts a fresh pairing flow
- **THEN** no missing-saved-credential warning is shown and errors appear only after a failed or denied enrollment attempt

### Requirement: Desktop add-connection parity

Desktop **Add connection** SHALL accept the same pairing URL, including hosted `app.terminay.com` links, even when that URL would otherwise open a browser. It SHALL never pair against the manager origin. Browser and Desktop flows SHALL produce the same server-side device and audit semantics and SHALL use the same transport-authenticated data-channel enrollment. The Desktop connection host SHALL consume the pairing fragment in memory; hosted links MAY carry non-secret `s`, `hostName`, and `pairingExpiresAt` query fields while pairing secrets stay in the fragment. Desktop SHALL show the match code in its Add connection dialog while awaiting host approval. It SHALL persist only the exact session origin plus sanitized profile metadata with a default label from `hostName`. The fragment and complete pairing URL SHALL never be returned by the host profile API or serialized into the connection menu store. Enrollment SHALL run against the reconstructed session origin.

#### Scenario: Desktop enrols against the session origin

- **WHEN** Desktop accepts a hosted pairing URL
- **THEN** enrollment runs against the reconstructed session origin and never against `app.terminay.com`

#### Scenario: Fragment is not exposed by the profile API

- **WHEN** the host profile API returns a profile
- **THEN** it contains neither the pairing fragment nor the complete pairing URL

#### Scenario: Same server-side semantics from either host

- **WHEN** a device is enrolled from a browser or from Desktop
- **THEN** the server-side device and audit semantics are the same

### Requirement: Exposing a server from a client host

Embedded Local servers SHALL accept only the private Desktop transport and SHALL NOT be advertised by default. **Expose this server…** SHALL be available only with server administrative capability. The flow SHALL start WebRTC availability and show a short-lived pairing URL and QR, expiry, relay state, pending approvals, paired devices, live connections, and approve, deny, revoke, reset-identity, and stop controls. **Expose this server** SHALL NOT change which server the current window renders. The current Local MessagePort SHALL remain connected throughout exposure and SHALL never be presented as a selectable exposure route. Standalone server CLI and UI SHALL use the same exposure and trust model.

#### Scenario: No silent exposure

- **WHEN** an embedded Local server runs without an explicit exposure action
- **THEN** it accepts only the private Desktop transport and is not advertised

#### Scenario: Exposure does not switch the rendered server

- **WHEN** the user exposes the current server
- **THEN** the window continues rendering the same server

#### Scenario: Local transport is not an exposure route

- **WHEN** the exposure surface lists routes
- **THEN** the Local MessagePort is not offered as a selectable route and remains connected
