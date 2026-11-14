## ADDED Requirements

### Requirement: Standalone servers serve the remote-access operations

Standalone `terminay-server` SHALL serve the same remote-access application operations as the embedded server, with the same payloads and status shape: the `remote-access.status` query; the `remote-access.toggle-server`, `remote-access.create-pairing-link`, `remote-access.approve-device`, `remote-access.deny-device`, `remote-access.revoke-device`, `remote-access.close-connection` and `remote-access.reset-identity` commands; and the `remote-access.changed` event. Every one of these operations SHALL require the `admin` authorization scope and SHALL be refused for any other scope.

#### Scenario: Status reflects startup exposure

- **WHEN** an admin client connected to a standalone server started with `--expose hosted,direct` reads remote-access status
- **THEN** it reports exposure as running, with its pairing link, trusted devices and live connections

#### Scenario: Non-admin scope is refused

- **WHEN** a client whose authorization scope is not `admin` calls any remote-access operation
- **THEN** the server refuses it and exposure, devices and approvals are unchanged

### Requirement: Standalone exposure state and status

Standalone status SHALL report exposure as running from the moment exposure starts until it is stopped, independent of whether a pairing room is currently registered: pairing-room expiry, rotation, or a signaling reconnect SHALL NOT report exposure as stopped. Status SHALL report the current pairing link and its expiry when a room is registered, the trusted devices, the live remote connections across every exposure mode, the pending approvals, and the last exposure error. The server SHALL publish `remote-access.changed` whenever any of those change, including changes the client did not cause: a device requesting approval, an approval resolving or expiring, a device enrolling, a connection opening or closing, a room rotating, and an operator command on the approval socket.

#### Scenario: Pairing room expiry keeps exposure running

- **WHEN** an exposed standalone server's pairing room expires and is replaced
- **THEN** status still reports exposure as running and a `remote-access.changed` event carries the replacement link

#### Scenario: Unsolicited changes are published

- **WHEN** a device requests approval, or a remote connection closes, on an exposed standalone server
- **THEN** connected admin clients receive `remote-access.changed` and the next status reflects it

### Requirement: Standalone exposure starts and stops while the server runs

`remote-access.toggle-server` on a standalone server that is not exposed SHALL start the exposure modes named by `--expose`, or hosted exposure when `--expose` names none, registering each mode before the pairing link is reported. Direct exposure SHALL be startable at runtime only on a server started with direct exposure, whose listener was prepared at startup. A mode that fails to register SHALL leave exposure stopped, close any mode already started, and report the error. `remote-access.toggle-server` on an exposed server SHALL stop every exposure mode, close live remote connections, and resolve pending approvals as closed, while the local endpoint, terminals and server-owned work keep running. A stop or identity reset requested over a remote connection that it will close SHALL answer that request before the connection closes. Starting or stopping exposure at runtime SHALL NOT change the `--expose` standing decision, so the next start applies `--expose` again.

#### Scenario: Exposing an unexposed standalone server from a client

- **WHEN** an admin client selects **Expose this server…** on a standalone server started without `--expose`
- **THEN** the server registers hosted exposure under its stable session origin and reports a pairing link without restarting
- **AND** terminals and connected clients are unaffected

#### Scenario: Direct-only server re-exposes without hosted signaling

- **WHEN** a standalone server started with `--expose direct` is stopped and then exposed again from a client while hosted signaling is unreachable
- **THEN** direct exposure registers and is reported as running, and no hosted registration is attempted

#### Scenario: Stopping standalone exposure from a client

- **WHEN** an admin client stops exposure on an exposed standalone server
- **THEN** every exposure mode stops accepting pairing and reconnect and live remote connections close
- **AND** the client that asked receives the resulting status before its own remote connection closes
- **AND** the local endpoint, terminals and server-owned work keep running

#### Scenario: Runtime control is not a standing decision

- **WHEN** a standalone server that a client exposed or stopped at runtime restarts
- **THEN** it applies its `--expose` configuration, not the runtime change

### Requirement: Standalone pairing and approvals are shared across surfaces

Client operations and operator commands on the approval socket (`approvals`, `approve`, `deny`, `pairing`) SHALL act on one pairing room, one device registry and one approval queue for every exposure mode. `remote-access.create-pairing-link` SHALL mint one replacement room and report it only after every running mode has registered it, and SHALL report an error when a mode fails to register it.

#### Scenario: Pairing link from a client

- **WHEN** an admin client selects **Create pairing link** on a standalone server exposed in hosted and direct modes
- **THEN** one replacement room is minted, both modes register it, and status reports its link

#### Scenario: Approvals are shared with the operator socket

- **WHEN** a device waits for approval on a standalone server
- **THEN** both remote-access status and `terminay-server approvals` list it, and approving it through either one enrolls the device once

### Requirement: Standalone servers keep a stable hosted session origin

A standalone server started with no `--expose` mode and no explicit `--remote-origin` SHALL provision its stable hosted session origin under the configured hosted domain at startup, the same origin `--expose hosted` provisions and persists in the data root, so that exposure started at runtime and exposure started by `--expose hosted` advertise the same origin and saved devices reconnect without pairing again. A standalone server started with `--expose` or an explicit `--remote-origin` SHALL keep the session origin those options select.

#### Scenario: Same origin whichever way exposure starts

- **WHEN** a standalone server is exposed once by `--expose hosted` and, after a restart without `--expose`, again from a client
- **THEN** both exposures advertise the same session origin and the devices paired the first time reconnect

#### Scenario: Direct-only origin is unchanged

- **WHEN** a standalone server starts with `--expose direct` and no `--expose hosted`
- **THEN** it keeps the session origin it used before, and devices it paired reconnect

### Requirement: Identity reset on a running standalone server

`remote-access.reset-identity` on a running standalone server SHALL rotate the host key in the data root first, and SHALL change nothing else if that rotation fails. It SHALL then revoke every registered device, persist the registry, resolve pending approvals as closed, close every live remote connection, and register every running exposure mode again under the new key. When re-registration fails, exposure SHALL be left stopped with the error reported, and the new key and revocations SHALL stand.

#### Scenario: Reset while exposed

- **WHEN** an admin client confirms **Reset server identity** on an exposed standalone server
- **THEN** the server registers under a new host key, no device is trusted, and the status still reports a pairing link

#### Scenario: Reset while stopped

- **WHEN** an admin client confirms **Reset server identity** on a standalone server that is not exposed
- **THEN** the host key is rotated and every device is revoked, and exposure stays stopped

#### Scenario: Key rotation failure changes nothing

- **WHEN** the host key cannot be written during **Reset server identity**
- **THEN** the reset reports the error and devices, approvals and exposure are unchanged
