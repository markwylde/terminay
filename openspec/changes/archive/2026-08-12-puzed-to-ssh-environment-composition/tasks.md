## 1. Composition

- [x] 1.1 Finalize the versioned provider-dependency RPC for public-key
  creation, readiness and trust, runtime open, status, and credential, address,
  and root updates, verified by
  `packages/server-core/test/puzed-ssh-composition.test.mjs`
- [x] 1.2 Persist composed Puzed management and SSH runtime identities and
  revisions plus a stable machine-scoped host identity independent of the DHCP
  dial address, verified by the identity and address revision cases in the same
  suite
- [x] 1.3 Create projects atomically only after environment and root validation
  while retaining recoverable provider operations that have already created a
  VM, verified by the atomic canonical open and secret rollback cases

## 2. Independence and recovery

- [x] 2.1 Keep Puzed API outage, VM lifecycle state, address changes, and SSH
  runtime status independent and never retarget live sessions on an address
  change, verified by the independent outage state and restart recovery cases
- [x] 2.2 Implement reference-aware disable, update, and remove across both
  extensions with exact recovery when either dependency is unavailable or
  incompatible, verified by
  `packages/server-core/test/extension-installer.test.mjs` proving referenced
  extensions cannot be removed and that disable and remove never cascade
  namespaced provider data
- [x] 2.3 Prove project close and server shutdown never change VM power and that
  explicit VM deletion never silently deletes the Terminay project or
  credentials, verified by the lifecycle isolation cases

## 3. Acceptance evidence

- [x] 3.1 Prove existing tagged running and stopped VMs and newly provisioned VMs
  open identical SSH-backed terminal and filesystem projects after their distinct
  management journeys, and that arbitrary Puzed VMs never enter the flow,
  verified by the official Puzed provider tests for tagged-only inventory and
  identical stable SSH descriptors
- [x] 3.2 Prove only the SSH extension resolves private credentials while Puzed
  receives public keys and opaque dependency handles, verified by the privileged
  dependency authorization and standards-readable dedicated key cases
- [x] 3.3 Prove external deletion or a changed host key never selects or recreates
  another VM, verified by the official SSH tests for exact host-key
  mismatch/replacement and stable logical identity across dial-address changes,
  and by the Puzed external-deletion identity retention tests
- [x] 3.4 Run `packages/server-core/test/puzed-ssh-packed-composition.e2e.test.mjs`,
  which packs both official extensions and drives a real Docker OpenSSH server
  through strict explicit trust, root validation, project creation, restart, and
  idempotent replay, via `npm run test:e2e:puzed-ssh` with the two documented
  `TERMINAY_*_PLUGIN_REPO` checkout paths
