## ADDED Requirements

### Requirement: Trusted renderer provenance for privileged Desktop IPC

Every privileged Desktop IPC handler SHALL require a trusted top-level Terminay
renderer before it reads or acts on a payload. Subframes, foreign origins, and
unregistered windows SHALL be rejected before payload handling. Only the
registered primary and auxiliary Terminay windows SHALL be eligible. The
dedicated server-UI host SHALL be an explicit stricter bound-window and origin
exception, and the hidden WebRTC host SHALL NOT be eligible even when it loads an
application asset.

#### Scenario: Subframe or foreign origin calls a privileged handler

- **WHEN** a subframe, a foreign origin, or an unregistered window invokes a
  privileged IPC handler
- **THEN** the call is rejected before the payload is handled

#### Scenario: Hidden WebRTC host

- **WHEN** the hidden WebRTC host attempts a privileged IPC call
- **THEN** it is rejected even though it loads an application asset

#### Scenario: Registered Terminay window

- **WHEN** a registered primary or auxiliary Terminay window invokes the handler
- **THEN** the call proceeds to normal payload validation

### Requirement: Credential-free HTTPS external links

Every host path that opens an external URL SHALL use one shared normalizer. That
normalizer SHALL reject non-HTTPS schemes, URLs carrying userinfo, and malformed
or control-character URLs, and SHALL normalize default HTTPS ports before the URL
is opened. The same policy SHALL apply to both the legacy shell IPC and the
Desktop host bridge.

#### Scenario: Non-HTTPS or credentialed URL

- **WHEN** an external-link request uses a non-HTTPS scheme, carries userinfo, or
  is malformed or contains control characters
- **THEN** it is rejected and nothing is opened

#### Scenario: Either host path

- **WHEN** the request arrives through the legacy shell IPC or the host bridge
- **THEN** the same normalization and rejection rules apply

### Requirement: Contained auxiliary Desktop windows

The dedicated remote connection window SHALL use an ephemeral isolated session
with no preload, and SHALL deny webviews, new windows, downloads, and permission
requests. Frame, navigation, and redirect paths SHALL be guarded to the pairing
origin. The unprivileged project-tab drag-preview window SHALL be explicitly
sandboxed, context-isolated, Node-free, webview-free, and input-inert with no
preload. No privileged source SHALL expose a native dialog capability to a
renderer.

#### Scenario: Remote connection window attempts to escape

- **WHEN** content in the remote connection window opens a webview or new window,
  starts a download, requests a permission, or navigates or redirects away from
  the pairing origin
- **THEN** the attempt is denied

#### Scenario: Drag-preview surface

- **WHEN** the project-tab drag preview is shown
- **THEN** it runs sandboxed, context-isolated, Node-free, webview-free, and
  input-inert with no preload

#### Scenario: Native dialogs

- **WHEN** a renderer attempts to reach a native dialog
- **THEN** no such capability is exposed
