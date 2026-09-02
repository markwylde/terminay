## ADDED Requirements

### Requirement: Bounded validating signaling boundary

Inbound relay JSON and outbound renderer-to-relay serialization SHALL pass a
bounded validating boundary before any interpretation. That boundary SHALL cap
the payload at 128 KiB and limit nesting depth and field count, and SHALL reject
unsafe prototype keys, cyclic structures, invalid UTF-8, and malformed message
types.

#### Scenario: Oversized or malformed signaling payload

- **WHEN** a relay message exceeds 128 KiB, exceeds the depth or field limits, or
  is not a valid message type
- **THEN** it is rejected at the boundary without being interpreted

#### Scenario: Hostile structure

- **WHEN** a relay message contains an unsafe prototype key, a cycle, or invalid
  UTF-8
- **THEN** it is rejected at the boundary

### Requirement: Revocation, lockout, expiry, and replay under concurrent failure

Device revocation, authentication lockout, credential expiry, rate limits, and
replay protection SHALL hold under concurrent failure across local control,
pairing, reconnect, remote transport, and vault paths. Rejections SHALL be
redacted: they SHALL NOT disclose credentials, device identifiers, or payload
content.

#### Scenario: Concurrent revocation and reconnect

- **WHEN** a device is revoked while it is concurrently pairing, reconnecting, or
  issuing local control requests
- **THEN** every path refuses it and no partial authority remains

#### Scenario: Replayed transport transcript

- **WHEN** a previously accepted authentication transcript is replayed
- **THEN** it is refused

#### Scenario: Rejection detail

- **WHEN** any of these rejections is reported or logged
- **THEN** it discloses no credential, device identifier, or payload content
