## MODIFIED Requirements

### Requirement: ICE candidate policy

The exposing host SHALL use the same STUN/TURN configuration advertised to browsers. It SHALL advertise ICE host candidates for every usable local address, including loopback, LAN, and VPN overlay addresses, and SHALL NOT bind ICE to a single interface except when signaling itself is loopback. Link-local addresses SHALL be omitted. Diagnostics SHALL never include those candidate addresses.

#### Scenario: VPN overlay connects without TURN

- **WHEN** a phone is on the same VPN overlay as the exposing Desktop
- **THEN** it connects using host ICE candidates without TURN

#### Scenario: LAN peer connects without TURN

- **WHEN** a peer is on the same local network as the exposing host
- **THEN** the host candidate for that local address is advertised and used

#### Scenario: Loopback signaling restricts candidates

- **WHEN** signaling itself is loopback
- **THEN** only 127.0.0.1 is used

#### Scenario: Candidate addresses stay out of logs

- **WHEN** the host gathers and advertises its local addresses
- **THEN** no candidate address is written to logs or diagnostics
