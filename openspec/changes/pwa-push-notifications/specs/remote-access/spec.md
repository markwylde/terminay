## MODIFIED Requirements

### Requirement: Persistence boundaries

The stable session origin, as a first-party document, MAY store the device id and name, the non-extractable browser private key, and non-secret server identity metadata; when the session is framed by the PWA that credential SHALL live in the manager vault instead. The manager origin MAY store manager profiles (label, origin, timestamps) and per-origin framed-session device credentials in IndexedDB, and, for each saved server, that server's push enrolment (routing id, push key, push token, and last accepted sequence number) and its notification count. The server MAY store the device id and name, the public device key, the private host key for its session origin, creation, last-seen, and revocation metadata, security audit events, and each device's push enrolment. The signaling service MAY store the public host key or fingerprint for a session and SHALL never store the private host key. The hosted push service MAY store, per enrolment, a hash of the push token, the push subscription sealed under a key derived from that token, and an expiry, and SHALL store nothing else.

#### Scenario: Signaling never holds the private host key

- **WHEN** signaling records host identity for a session
- **THEN** it stores only the public host key or fingerprint

#### Scenario: One durable key per credential store

- **WHEN** a browser is enrolled
- **THEN** it stores one durable private device key per session origin as a first-party document, or per manager-vault slot when framed
- **AND** the server stores the corresponding public key and revocation state

#### Scenario: Push enrolment is stored per server

- **WHEN** a device is enrolled for push with two servers
- **THEN** the manager origin holds two enrolments keyed by their session origins, and each server holds only its own

#### Scenario: The hosted push service holds no readable subscription

- **WHEN** the hosted push service records an enrolment
- **THEN** it stores only the token hash, the sealed subscription, and the expiry
