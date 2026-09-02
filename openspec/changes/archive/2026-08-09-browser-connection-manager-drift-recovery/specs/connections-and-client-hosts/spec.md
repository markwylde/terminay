## ADDED Requirements

### Requirement: One pairing transaction across every entry point

A browser connection host SHALL execute one host-level pairing transaction for
the initial disconnected modal, the Connections route, empty-state actions,
pasted links, and supported deep links. A user interface component MAY collect
input but SHALL NOT reduce pairing to profile creation. Every entry point SHALL
share the same success and failure semantics.

#### Scenario: Every entry point behaves identically

- **WHEN** a pairing URL is supplied through the modal, the empty saved-
  connections page, the connected Connections route, or a deep link
- **THEN** the same pairing transaction runs with the same failure semantics

#### Scenario: A component cannot fake pairing

- **WHEN** a route body receives a pairing value
- **THEN** it delegates to the pairing coordinator
- **AND** it does not create a profile in place of enrollment

### Requirement: Add connection is the primary manager action

Every empty or disconnected manager state SHALL present an add-connection
action as its clear primary affordance, and that action SHALL accept a complete
pairing URL directly. QR scanning and metadata import SHALL be secondary
alternatives where supported.

#### Scenario: First-time visitor can paste a link

- **WHEN** a first-time visitor opens the manager
- **THEN** an obvious add-connection control is present
- **AND** the pairing URL can be pasted without opening a hidden details panel
  or inventing server metadata

### Requirement: One-time fragment handling during enrollment

The host SHALL validate and consume the one-time pairing fragment in memory and
remove it from the visible and history URL before collecting the device name
and the configured PIN or approval, and only then complete enrollment.

#### Scenario: Fragment leaves the address bar

- **WHEN** a pairing URL is accepted
- **THEN** the one-time fragment is removed from the visible and history URL
  before enrollment details are collected

### Requirement: Saved means durably committed

A connection SHALL be reported as paired or saved only after the exact-origin
device key and reconnect material have been durably committed and sanitized
profile metadata has been upserted. Metadata-only parsing SHALL NOT report
pairing success. Persistence SHALL be reversible: a metadata persistence
failure SHALL restore the prior credential, and a credential-conditional
rollback SHALL NOT overwrite a newer concurrent pairing. A remote device record
accepted before a local storage failure remains server-owned and is removed only
through the server revoke operation.

#### Scenario: Parsing alone reports nothing

- **WHEN** a pairing URL is parsed but enrollment does not complete
- **THEN** no surface reports the connection as paired or saved

#### Scenario: Rollback restores the prior credential

- **WHEN** metadata persistence fails after a credential was written
- **THEN** the prior credential is restored
- **AND** a newer concurrent pairing is not overwritten

### Requirement: Immediate connection and idempotent re-pairing

A newly paired profile SHALL be connected immediately. Re-pairing the same
exact session origin SHALL update the existing profile and credential
atomically rather than creating a duplicate card or leaving the previous grant
active.

#### Scenario: Pairing connects

- **WHEN** device enrollment completes
- **THEN** the connection is established immediately and one remembered
  connection exists

#### Scenario: Re-pairing does not duplicate

- **WHEN** the same session origin is paired again
- **THEN** the existing profile and credential are replaced atomically
- **AND** no duplicate profile card appears

### Requirement: Return visits reconnect without the pairing link

On reload or a later visit the host SHALL present the remembered profile and
reconnect by challenge and proof without requesting or retaining the one-time
pairing URL. Expired, missing, or revoked credentials SHALL keep the non-secret
profile and request a fresh pairing link until the user explicitly forgets it.

#### Scenario: Reopening the browser reconnects

- **WHEN** the browser is closed and reopened
- **THEN** the remembered connection reconnects without the original link

#### Scenario: Revoked credential keeps the profile

- **WHEN** the stored credential is expired or revoked
- **THEN** the profile remains listed
- **AND** the host asks for a fresh pairing link

### Requirement: Advanced metadata import is labelled

Manual metadata import SHALL be presented as an explicitly advanced operation.
Raw server id and origin fields SHALL NOT be presented as equivalent to
authenticated pairing, and an imported profile without reconnect credentials
SHALL be labelled as requiring pairing.

#### Scenario: Import does not masquerade as pairing

- **WHEN** the manager offers manual metadata import
- **THEN** it is labelled as an advanced operation distinct from pairing
- **AND** a profile it creates without credentials is marked as needing pairing

### Requirement: Distinct rename, disconnect, forget, and revoke

The manager SHALL keep rename, disconnect, forget, and server-side revoke as
distinct operations. Forgetting SHALL remove only the browser-local profile and
the exact-origin reconnect material, and only after confirmation.

#### Scenario: Forget is confirmed and local

- **WHEN** the user forgets a connection and confirms
- **THEN** the browser-local profile and its exact-origin reconnect material are
  removed
- **AND** no server-side state is changed

### Requirement: Canonical manager origin contract

The canonical browser connection manager origin SHALL be defined once in a
browser-safe contract shared by transport classification, web-host composition,
server allowlists, tests, and release tooling. Ad hoc manager-domain literals
SHALL NOT be used, and session subdomains SHALL NOT be classified as a manager
origin.

#### Scenario: One contract, no literals

- **WHEN** a component needs to know whether an origin is the manager
- **THEN** it consults the shared origin contract

#### Scenario: Session subdomain is not a manager

- **WHEN** a session origin subdomain is classified
- **THEN** it is not treated as a manager origin

### Requirement: Bounded metadata-only legacy migration

A retired manager origin SHALL serve only a bounded migration page. It SHALL
read only the documented legacy non-secret profile record at that origin,
validate and bound every entry, and transfer only sanitized metadata to the
canonical manager through a one-time handoff. The handoff SHALL NOT contain a
pairing fragment, URL credential, reconnect grant, device key, PIN, terminal or
workspace data, or an arbitrary storage field, and SHALL NOT be placed in a
query string, referrer, analytics event, or server log. The canonical manager
SHALL consume the handoff once, upsert profiles by stable identity and exact
origin, clear it from visible and history state, and report profiles without
origin-bound credentials as needing fresh pairing. A failed import SHALL leave
the legacy record available for retry, and cleanup SHALL run only after
acknowledgement. Session-origin reconnect credentials SHALL NOT be moved or
deleted, and the host SHALL NOT claim that cross-origin browser credentials
were migrated.

#### Scenario: Only metadata crosses

- **WHEN** the legacy origin hands off saved profiles
- **THEN** the handoff carries sanitized non-secret metadata only

#### Scenario: Handoff is consumed once

- **WHEN** the canonical manager imports the handoff
- **THEN** profiles are upserted by stable identity and exact origin
- **AND** the handoff is cleared from visible and history state

#### Scenario: Failed import can be retried

- **WHEN** the import fails
- **THEN** the legacy record remains available for a retry
- **AND** legacy cleanup has not run

#### Scenario: Unusable storage recovers understandably

- **WHEN** storage is unavailable, malformed, oversized, or blocked
- **THEN** the user is redirected with an understandable recovery path
- **AND** no claim of migrated credentials is made

### Requirement: Public origin routing fails closed

Public hostname routing for the browser connection host SHALL fail closed. The
canonical manager hostname SHALL serve only the canonical static manager, a
retired manager hostname SHALL serve only the bounded migration or redirect,
session and signaling hosts SHALL retain their separate authority, and an
unknown Host SHALL be refused.

#### Scenario: Unknown host is refused

- **WHEN** a request arrives with a Host the image does not serve
- **THEN** it is refused rather than served the manager document

#### Scenario: Canonical host serves the manager

- **WHEN** the canonical manager hostname is requested
- **THEN** the verified canonical manager and its hashed assets are served with
  the required security headers

### Requirement: Deployment evidence identifies the released artifact

The web host deployment verifier SHALL assert one exact health media type and
body, the required security headers, and a non-secret release marker
identifying the expected source revision or image digest. Health alone SHALL
NOT be accepted as deployment evidence. The verifier SHALL reject a legacy
manager document, a signaling-service fallback, missing or stale hashed assets,
unexpected redirects, host-routing failures, and an otherwise healthy wrong
origin. The same verifier SHALL be runnable against a locally started image.

#### Scenario: Healthy but wrong origin fails

- **WHEN** the origin answers health checks but serves the legacy document or a
  signaling-service response
- **THEN** the verifier rejects it

#### Scenario: Local image passes the production verifier

- **WHEN** the production image is started locally
- **THEN** the same verifier used against production passes against it
