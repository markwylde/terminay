## ADDED Requirements

### Requirement: Application authentication is answered independently of handshake signaling

The hosted host SHALL consume a connection ticket and answer `application-auth` on the control lane without waiting on any handshake signaling task: offers, answers, and ICE candidates for this or any other peer SHALL NOT delay the reply. A valid ticket presented on the peer that earned it SHALL be answered within 5 seconds of arrival on a healthy host. Ordering between a device's previous live peer and its replacement SHALL be kept per device only.

#### Scenario: Slow ICE on another peer does not delay authentication

- **WHEN** a handshake for another peer is waiting on an ICE candidate that never settles
- **THEN** a valid `application-auth` on an authenticated peer is still answered and its workspace attaches

#### Scenario: Late candidates on the same peer do not delay authentication

- **WHEN** the client keeps trickling ICE candidates after its lanes opened and then sends `application-auth`
- **THEN** the reply does not wait for those candidates to be applied

#### Scenario: Replacement stays ordered per device

- **WHEN** two peers for the same device consume tickets in quick succession
- **THEN** the earlier one is retired and cleaned up before the later one attaches, and peers for other devices are unaffected
