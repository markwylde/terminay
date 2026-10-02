## ADDED Requirements

### Requirement: Direct pairing URLs explain their Desktop destination

The direct HTTPS listener SHALL serve a small safe HTML page at `/v1/` for browser navigation. The page SHALL explain that a direct pairing link is intended to be opened or pasted into Terminay Desktop and SHALL NOT claim that pairing can be completed in a browser. The signaling WebSocket endpoint and authenticated protocol routes SHALL retain their existing behavior.

#### Scenario: Direct link opens in a browser

- **WHEN** a browser opens a direct pairing URL at `/v1/`
- **THEN** the server returns a readable page directing the user to Terminay Desktop rather than a generic not-found response

#### Scenario: Direct link remains usable by Desktop

- **WHEN** Desktop parses the same `/v1/` direct pairing URL
- **THEN** it connects to the listener's `/signal` WebSocket endpoint and the page route does not change the pairing protocol
