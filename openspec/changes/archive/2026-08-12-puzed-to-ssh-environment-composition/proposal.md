## Why

The official SSH provider and the Puzed VM provisioning journey had been
accepted separately, so an existing, newly created, or stopped
`system:Terminay` Puzed VM and an SSH profile were two unrelated things. They
had to converge into one durable project without leaking credentials between the
two extensions and without coupling project lifecycle to VM lifecycle.

## What Changes

- Finalize the versioned provider-dependency RPC for public-key creation,
  readiness and trust, runtime open, status, and credential, address, and root
  updates.
- Persist the composed Puzed management plus SSH runtime identities and
  revisions, with a stable machine-scoped host identity independent of the DHCP
  dial address.
- Create projects atomically only after environment and root validation, while
  retaining recoverable provider operations that have already created a VM.
- Keep Puzed API outage, VM lifecycle state, address changes, and SSH runtime
  status independent, and never retarget live sessions on an address change.
- Implement reference-aware disable, update, and remove across both extensions,
  with exact recovery when either dependency is unavailable or incompatible.
- Prove project close and server shutdown never change VM power, and explicit VM
  deletion never silently deletes the Terminay project or its credentials.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `puzed-project-environments`: extension composition and boundaries, composed
  retained state, project close and VM lifecycle independence, external
  deletion, address changes, independent outage semantics, the dedicated SSH
  keypair, and recovery actions.
- `extension-platform`: disable, uninstall, and retention under references, and
  the separation of extension dependencies from npm dependencies.

## Impact

Both official extensions, the server-side provider dependency broker and its
authorization, the namespaced provider data stores, and the composition and
extension-installer test suites.
