## ADDED Requirements

### Requirement: Administrator-supplied advertised ICE address

An administrator MAY supply one advertised ICE address, as a host and UDP port, for a server whose reachable address it cannot observe about itself — a server behind a port forward, or inside a container whose network the client cannot route to. When supplied, the server SHALL offer that address and port as an additional host candidate in every peer offer and answer, SHALL bind its ICE socket to that UDP port so the advertised candidate is the port an administrator forwarded, and SHALL continue to gather and offer the candidates it would otherwise have offered. The advertised address SHALL NOT replace, suppress, or reorder gathered candidates.

The advertised address SHALL be a literal IPv4 or IPv6 address and a port, never a hostname: a candidate is a destination for a peer's connectivity checks, and a name resolved on the client's machine is not the address the administrator forwarded. A server SHALL refuse to start when the advertised address cannot be parsed, when its port is outside the range a UDP socket can bind, or when that port is already in use, rather than starting with an exposure whose advertised candidate is unreachable.

#### Scenario: Advertised candidate is offered alongside gathered ones

- **WHEN** a server is exposed with an advertised ICE address
- **THEN** its offer contains a host candidate for that address and port
- **AND** it still contains every candidate the server would have offered without it

#### Scenario: The ICE socket uses the advertised port

- **WHEN** a server is exposed with an advertised ICE address
- **THEN** its ICE socket is bound to that UDP port
- **AND** connectivity checks for the advertised candidate arrive on that port

#### Scenario: Reachable from a client that cannot route the server's own address

- **WHEN** a client can reach the advertised address and port but none of the server's gathered addresses
- **THEN** the peer connection completes over the advertised candidate

#### Scenario: No advertised address is unchanged behaviour

- **WHEN** no advertised ICE address is supplied
- **THEN** the server gathers and offers candidates exactly as before
- **AND** its ICE socket uses an ephemeral port

#### Scenario: An unusable advertised address fails at startup

- **WHEN** the advertised address is not a literal address and port, or its port cannot be bound
- **THEN** the server refuses to start and names the advertised address in the failure

### Requirement: An advertised ICE address grants no authority

The advertised ICE address SHALL be a routing hint only. It SHALL NOT affect which host key a peer pins, what a peer accepts as proof of the registered host key, the transport transcript a server signs, the pairing URL, the session origin, or which peers a room admits. A peer SHALL authenticate a connection reached over an advertised candidate by exactly the checks it applies to one reached over a gathered candidate.

#### Scenario: Authentication is unchanged over an advertised candidate

- **WHEN** a peer connects over the advertised candidate
- **THEN** it verifies the server's host key signature over the transport transcript as it does for any other candidate
- **AND** no application data crosses before that verification succeeds

#### Scenario: The advertised address does not appear in pairing material

- **WHEN** a server with an advertised ICE address mints a pairing URL
- **THEN** the URL is the same one it would mint without the advertised address
