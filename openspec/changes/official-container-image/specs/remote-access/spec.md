## ADDED Requirements

### Requirement: Single public host setting

An administrator MAY supply one public host, the address or name at which devices reach the server, through `--public-host` or `TERMINAY_PUBLIC_HOST`. When direct exposure is enabled and no direct origin is supplied, the server SHALL derive the direct origin as `https://<public-host>:<http-port>`. When the public host is a routable literal IPv4 or IPv6 address and no advertised ICE address is supplied, the server SHALL derive the advertised ICE address as that host on the first port of its pinned ICE range. An explicitly supplied direct origin or advertised ICE address SHALL take precedence over the derived one.

A public host that is a name or a loopback address SHALL derive the direct origin only; the server SHALL NOT offer a name or a loopback address as an advertised candidate, and SHALL record at startup that no advertised candidate was derived. The public host SHALL be a routing hint with exactly the standing of the settings it derives.

#### Scenario: A literal address derives both

- **WHEN** a server starts with direct exposure, a public host of `192.168.2.218`, and no direct origin or advertised ICE address
- **THEN** its direct pairing link names `https://192.168.2.218:<http-port>`
- **AND** its offers contain a host candidate for `192.168.2.218` on the first pinned ICE port

#### Scenario: A name derives the direct origin only

- **WHEN** a server starts with a public host of `box.example.com`
- **THEN** its direct pairing link names that host
- **AND** no advertised candidate is offered and startup records that none was derived

#### Scenario: Explicit settings take precedence

- **WHEN** a server starts with a public host and an explicit advertised ICE address
- **THEN** the explicit advertised ICE address is the one offered

### Requirement: Direct-mode client offers the signaling host as a candidate

A client that reached a server through direct signaling SHALL treat the host of that direct origin as a candidate address for the server. For each UDP host candidate port the server offers, the client SHALL add a remote candidate at the direct origin's host on that port, resolving a name on the client. It SHALL do so only for a direct origin, never for a hosted session origin, and SHALL NOT add a loopback address. The added candidate SHALL be a routing hint: the client SHALL authenticate a connection over it by exactly the checks it applies to any other candidate.

#### Scenario: A forwarded server with no advertised address

- **WHEN** Desktop pairs through a direct origin whose host forwards the server's pinned UDP range, and the server offers no address Desktop can route to
- **THEN** the connection completes over the candidate Desktop derived from the direct origin's host

#### Scenario: Hosted signaling derives nothing

- **WHEN** a client reaches a server through the hosted relay
- **THEN** it adds no candidate derived from the signaling host

#### Scenario: Authentication is unchanged over a derived candidate

- **WHEN** a client connects over a candidate it derived from the direct origin
- **THEN** it verifies the server's host key signature over the transport transcript before any application data crosses

### Requirement: Desktop is reachable by a server it cannot reach

Terminay Desktop SHALL offer host candidates for its usable local addresses as literal addresses, so that a server able to route to Desktop can open the connection from its own side. A server SHALL send connectivity checks to every candidate a client offers regardless of whether any of the server's own candidates is reachable by that client. Desktop SHALL therefore connect to a server none of whose offered addresses it can route to, with no advertised address and no forwarded UDP port, whenever the server can route to Desktop.

#### Scenario: Container publishing no UDP port

- **WHEN** Desktop pairs with a server in a container on the same machine that publishes only its signaling port and has no advertised address
- **THEN** pairing and the device session both complete
- **AND** the server's selected candidate pair for the device session has a local type of `host` and a remote type of `host`

#### Scenario: Hosted signaling with no published port

- **WHEN** Desktop opens a hosted pairing link for a container that publishes no port at all
- **THEN** pairing and the device session both complete

### Requirement: No Terminay-operated media relay

Terminay SHALL NOT operate a TURN server or any other relay for peer traffic, and the default ICE configuration of every host and client SHALL contain no relay. A peer connection SHALL be made over a gathered candidate, an advertised or derived candidate, or a relay the administrator has configured for their own server. When no candidate pair succeeds, the client SHALL report that the server could not be reached directly rather than waiting on a relay.

#### Scenario: Default configuration has no relay

- **WHEN** a host or client builds its peer configuration with no administrator-supplied ICE servers
- **THEN** the configuration contains no TURN server

#### Scenario: No route exists

- **WHEN** no candidate pair between a client and a server succeeds
- **THEN** the client reports a distinct unreachable-server failure within its bounded handshake time

## MODIFIED Requirements

### Requirement: Administrator-supplied advertised ICE address

An administrator MAY supply one advertised ICE address, as a host and UDP port, for a server whose reachable address it cannot observe about itself — a server behind a port forward, or inside a container whose network the client cannot route to. When supplied, the server SHALL offer that address as a host candidate on that UDP port in every peer offer and answer.

An administrator MAY separately pin the server's ICE ports to a small published range of consecutive ports by naming its first port, with or without an advertised address. A server with a pinned range SHALL confine every candidate it offers to that range, so that forwarding the range forwards all of them. An advertised address SHALL pin the range beginning at the advertised port.

The range is a budget. Each candidate takes one port from it, so a host with more local addresses than the range has ports SHALL offer fewer of its own addresses than it would unpinned. The advertised address SHALL keep its port regardless: it is the candidate the client can reach, and the reason the option was set. The budget is shared by every live peer of the server, because each peer's candidates take their own ports from it; the length of the range SHALL therefore be configurable, and a server SHALL record a distinct diagnostic when a peer gathers no candidate because the range is spent. A server given neither an advertised address nor a pinned range SHALL gather and offer candidates on ephemeral ports, with no such bound.

The advertised address SHALL be a literal IPv4 or IPv6 address and a port, never a hostname: a candidate is a destination for a peer's connectivity checks, and a name resolved on the client's machine is not the address the administrator forwarded. A server SHALL refuse to start when the advertised address cannot be parsed, when its port or the pinned range is outside the range a UDP socket can bind, or when the first pinned port is already in use, rather than starting with an exposure whose candidates are unreachable.

#### Scenario: The advertised candidate is offered on the advertised port

- **WHEN** a server is exposed with an advertised ICE address
- **THEN** its offer contains a host candidate for that address on that UDP port

#### Scenario: Every offered candidate is inside the published range

- **WHEN** a server is exposed with an advertised ICE address or a pinned ICE range
- **THEN** every candidate it offers uses a port within the published range
- **AND** an administrator who forwarded that range has forwarded all of them

#### Scenario: A pinned range without an advertised address

- **WHEN** a server is exposed with a pinned ICE range and no advertised address
- **THEN** its candidates are its gathered addresses on ports within that range
- **AND** no additional candidate is offered

#### Scenario: The advertised candidate keeps its port when the budget is tight

- **WHEN** a host has more local addresses than the range has ports
- **THEN** the advertised candidate is still offered on the advertised port
- **AND** the addresses given up are the server's own, which the client was not reaching

#### Scenario: A longer range serves more devices

- **WHEN** a server's pinned range is configured to be longer
- **THEN** every candidate it offers is still inside that range
- **AND** proportionally more peers can hold candidates at the same time

#### Scenario: The range is spent

- **WHEN** a peer starts while every port of the pinned range is held by other live peers
- **THEN** the server records that the pinned ICE range is exhausted
- **AND** peers already connected stay connected

#### Scenario: Reachable from a client that cannot route the server's own address

- **WHEN** a client can reach the advertised address and port but none of the server's gathered addresses
- **THEN** the peer connection completes over the advertised candidate

#### Scenario: No advertised address is unchanged behaviour

- **WHEN** no advertised ICE address and no pinned range is supplied
- **THEN** the server gathers and offers candidates exactly as it does on any host
- **AND** its ICE socket uses an ephemeral port

#### Scenario: An unusable advertised address fails at startup

- **WHEN** the advertised address is not a literal address and port, or its port cannot be bound
- **THEN** the server refuses to start and names the advertised address in the failure
