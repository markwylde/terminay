## ADDED Requirements

### Requirement: Configured hosted endpoints

Hosted access SHALL use an **App Server** (manager origin, default `https://app.terminay.com`) and a **Session Server** (origin template with `<session>` once in its leftmost label, default `https://<session>.terminay.com`). A session origin SHALL be the template filled with the session id, and an id SHALL be recovered only by matching the template. No component SHALL derive one endpoint from the other or assume `app.` or `terminay.com`.

#### Scenario: Production defaults

- **WHEN** a server uses the default endpoints
- **THEN** its hosted pairing link is on `https://app.terminay.com` and its stable session origin is `https://<session-id>.terminay.com`

#### Scenario: Preview endpoints

- **WHEN** the App Server is `https://app-pr123.dev.terminay.com` and the Session Server is `https://<session>-pr123.dev.terminay.com`
- **THEN** the hosted pairing link is on `https://app-pr123.dev.terminay.com`
- **AND** the stable session origin is `https://<session-id>-pr123.dev.terminay.com`
- **AND** a client parsing that link with the same endpoints recovers the same session id

### Requirement: Hosted endpoints preserve session isolation

Every session SHALL run at its own origin, because a Terminay Server is untrusted code. The App Server SHALL NOT match the Session Server template, and distinct session ids SHALL produce distinct origins. Both endpoints SHALL use HTTPS, except that loopback hosts MAY use HTTP, and neither SHALL carry credentials, a path, a query, or a fragment. A configuration that breaks these rules SHALL be rejected and SHALL NOT be used to advertise or accept a pairing link.

#### Scenario: Manager cannot be a session origin

- **WHEN** a session id would produce the App Server origin from the Session Server template
- **THEN** that session id is never minted or accepted

#### Scenario: Placeholder outside the leftmost label

- **WHEN** a Session Server template places `<session>` in any label but the leftmost, or contains it more than once or not at all
- **THEN** the configuration is rejected and no pairing link is advertised

#### Scenario: Insecure non-loopback endpoint

- **WHEN** either endpoint uses `http:` for a host that is not loopback
- **THEN** the configuration is rejected

### Requirement: Desktop presents the hosted endpoints

Desktop **Settings › Remote Access** SHALL present **App Server** and **Session Server** as two fields that default to the production values and SHALL show the validation message when a value is rejected. The embedded server SHALL use the saved pair for every hosted pairing link and session origin it advertises.

#### Scenario: Developer points Desktop at a preview

- **WHEN** a developer sets App Server `https://app-pr123.dev.terminay.com` and Session Server `https://<session>-pr123.dev.terminay.com` and creates a pairing link
- **THEN** the link opens the preview manager, which frames the session at `https://<session-id>-pr123.dev.terminay.com`

#### Scenario: Invalid value in Settings

- **WHEN** a developer enters a Session Server without `<session>` in its leftmost label
- **THEN** the field shows the validation message and the previous valid pair stays in effect

## MODIFIED Requirements

### Requirement: Remote access model and vocabulary

Remote access SHALL be defined by five concepts. A **stable session origin** is the permanent HTTPS origin for one Terminay Server, produced from the configured Session Server template, such as `https://<server-id>.terminay.com`. A **pairing URL** is the advertised one-time enrollment link whose fragment carries the one-time secret and whose non-secret `s` query identifies the stable session origin. A **browser device identity** is one non-extractable private key held by the browser, with the server holding the corresponding public key, device id, name, and revocation state. A **manager profile** is a non-secret bookmark stored by the configured App Server, `app.terminay.com` by default, containing a label, stable session origin, and local timestamps. A **server host key** is a long-lived key pair owned by Terminay Server for its stable session origin, whose private half never leaves the server.

Each server SHALL have exactly one stable session origin. Credentials created at one origin, or for one server, SHALL NOT authorize another.

#### Scenario: Pairing secret is not a reconnect credential

- **WHEN** a browser device has completed pairing
- **THEN** the pairing secret is spent and future connections prove possession of the browser device key instead

#### Scenario: Host key answers a different question from the device key

- **WHEN** a client reconnects to a stable session origin
- **THEN** the server host key proves the reconnect host is the same server
- **AND** the browser device key proves this is the same paired device

#### Scenario: Credentials do not cross servers

- **WHEN** a credential enrolled for one server or origin is presented to another
- **THEN** it grants no access

### Requirement: Exposure is explicit and administrator-controlled

Servers SHALL NOT be remotely reachable until an administrator enables exposure, either through **Expose this server…** on a client host, through the embedded server's **Automatically expose server on startup** setting, or through the standalone server's explicit `--expose` configuration. The setting and `--expose` each count as the administrator's standing decision for that data root. The setting SHALL default to off. Exposure SHALL connect the server to an authenticated WebRTC signaling endpoint before advertising a pairing URL, apply the explicit approval policy, generate a short-lived pairing URL and QR code, display exposure expiry, signaling and relay health, paired devices, and live connections, and allow the administrator to generate another pairing URL, revoke a device, or stop exposure. Hosted pairing links SHALL take the form `<app-server>/?s=<session-id>&hostName=<optional>#<secret>`. `<app-server>` is the configured App Server origin, `https://app.terminay.com` by default. The session origin produced from the configured Session Server template remains the WebRTC peer, and `hostName` is a non-secret default label from the exposing machine. Direct pairing links SHALL take the form `https://<direct-origin>/v1/?hostName=<optional>#<secret>`, where the direct origin is the server's own signaling listener.

#### Scenario: Server is unreachable before exposure

- **WHEN** neither an administrator nor the standalone configuration has enabled exposure
- **THEN** the server is not remotely reachable

#### Scenario: Standalone exposure at startup

- **WHEN** a standalone server starts with `--expose` naming one or more modes
- **THEN** it registers each mode's pairing room and reconnect host before readiness reports a pairing URL

#### Scenario: Desktop exposure at startup

- **WHEN** Terminay Desktop starts with **Automatically expose server on startup** enabled
- **THEN** after the workspace window is shown, the embedded server is exposed exactly as if the administrator had selected **Expose this server…**
- **AND** a failure to expose is reported through remote-access status and does not block startup
- **AND** the administrator can stop exposure from the connections menu for that session without changing the setting

#### Scenario: Desktop startup with the setting off

- **WHEN** Terminay Desktop starts with **Automatically expose server on startup** off, which is the default
- **THEN** the embedded server is not exposed until the administrator selects **Expose this server…**

#### Scenario: Host registers before pairing is advertised

- **WHEN** a server is exposed
- **THEN** it registers the fragment-derived pairing room (`host-ready`) and its server host key before it is reachable for pairing or reconnect

#### Scenario: Create pairing link while exposed

- **WHEN** the administrator selects **Create pairing link** while the server is already exposed
- **THEN** a new one-time fragment is minted and that room is registered
- **AND** a pairing room a client has already joined is not re-shown

#### Scenario: Stopping exposure preserves local work

- **WHEN** the administrator stops exposure
- **THEN** pairing and reconnect are blocked
- **AND** Local Desktop use and server-owned work continue running

#### Scenario: Pairing link names the configured manager

- **WHEN** a server whose App Server is `https://app-pr123.dev.terminay.com` creates a hosted pairing link
- **THEN** the link is on `https://app-pr123.dev.terminay.com` and not on `https://app.terminay.com`

### Requirement: Uniform exposure for embedded and standalone servers

The same exposure model SHALL apply to an embedded Local server and to standalone `terminay-server`. Both SHALL provision a stable hosted session origin from the configured Session Server template through one shared server-owned implementation, persist it in the data root, and reuse it across restarts while it still matches the configured template. A persisted origin that does not match the configured template SHALL be replaced by a newly minted one. Desktop and the CLI SHALL both start the server-owned hosted pairing host, registering the fragment-derived pairing room and the signed reconnect host before a pairing URL is advertised, and SHALL accept authenticated application transports on the `application` data channel. Desktop SHALL always serve the built server UI archive; the standalone server SHALL serve the UI archive that its distribution bundles.

#### Scenario: Standalone server exposes identically

- **WHEN** standalone `terminay-server` is exposed
- **THEN** it registers the pairing room and signed reconnect host in the same way Desktop does

#### Scenario: Session origin survives restart

- **WHEN** a standalone server restarts against the same data root
- **THEN** it advertises the same session origin and saved devices reconnect without pairing again

#### Scenario: Changing the Session Server mints a new origin

- **WHEN** a server restarts with a Session Server template that its persisted session origin does not match
- **THEN** it mints and persists a new session origin from the configured template and advertises only that origin

#### Scenario: CLI serves the UI archive when configured

- **WHEN** a client pairs with a standalone server whose distribution bundles the UI archive
- **THEN** the CLI serves that archive to the client
