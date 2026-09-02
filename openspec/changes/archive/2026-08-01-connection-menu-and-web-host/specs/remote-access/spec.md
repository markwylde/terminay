## ADDED Requirements

### Requirement: Manager is not part of the credential path
A connection manager origin SHALL never receive, store, or forward pairing
fragments, device keys, or reconnect grants. Pairing URL fragments SHALL be
consumed in memory at the origin that enrolls them.

#### Scenario: Fragment never persisted
- **WHEN** a pairing URL is consumed
- **THEN** the fragment appears in no profile record, session URL, or log

### Requirement: Framed-session credential vault
The session origin SHALL hold a non-extractable origin-keyed proof key. The
vault SHALL sign only canonical v1 reconnect challenges bound to its exact
session origin and reconnect handle, and SHALL refuse to release a proof whose
enrollment has been replaced by a newer pairing for that origin.

#### Scenario: Not a signing oracle
- **WHEN** an arbitrary, cross-origin, cross-handle, or appended payload is
  submitted for signing
- **THEN** the vault rejects the request

#### Scenario: Stale in-flight proof
- **WHEN** a newer pairing replaces the origin's credential while an earlier
  proof request is still signing
- **THEN** the vault re-checks the durable current record and rejects the stale
  request
