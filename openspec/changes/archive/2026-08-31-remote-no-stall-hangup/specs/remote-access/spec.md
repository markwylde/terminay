## MODIFIED Requirements

### Requirement: Explicit generation liveness signals

Generation liveness SHALL use explicit signals only. A generation SHALL fail, exactly once, when the peer or ICE connection reports `failed` or `closed`; the ICE `disconnected` grace period expires, where grace starts only when the peer is also not `connected`; a required lane (`control`, `application`, `terminal`, `assets`) leaves `open` after the handshake; the application-protocol reader ends; or the heartbeat bound is exceeded. Traffic patterns SHALL NOT be a liveness signal: quiet PTY output, hydration bursts, and outbound pauses SHALL never be classified, inferred from, or acted on. A hosted stall observation MAY be recorded as a diagnostic, but SHALL NOT retire a generation or close the peer.

#### Scenario: ICE blip while the peer stays connected is ignored

- **WHEN** ICE reports `disconnected` while `connectionState` remains `connected`
- **THEN** the generation is kept and live terminal output continues

#### Scenario: Grace expiry replaces the generation once

- **WHEN** the peer reports `disconnected`, or ICE reports `disconnected` while the peer is also not `connected`
- **THEN** the generation either recovers inside grace or is replaced once without a page reload

#### Scenario: Quiet output is not a failure

- **WHEN** a terminal produces no output for minutes
- **THEN** no traffic-pattern inference is made and the generation stays live

#### Scenario: Outbound silence does not hang up the peer

- **WHEN** a hydrated hosted session sends no outbound application bytes for five seconds
- **THEN** the stall is recorded as a diagnostic only
- **AND** the WebRTC peer stays open and the generation stays live
