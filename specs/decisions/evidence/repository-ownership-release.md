# Release repository ownership decision

Date: 2026-07-27

This record closes the repository-ownership question in
[Task 20](../../tasks_completed/20-security-release-and-operations.md).

## Decision

Keep Terminay Desktop, the embedded/standalone Terminay Server, the bundled
workspace UI, protocol packages, and shared client/server packages in this
workspace. Do not split those release units into separate repositories at
this stage.

The hosted bootstrap/signaling service remains an independently owned
repository because it is a separate deployment and trust boundary. That
existing split does not justify separating the matched Desktop/server
workspace.

## Release evidence

- `package.json` declares one workspace containing `apps/*` and `packages/*`.
- The server runtime specification requires the server-bundled UI, protocol,
  and client/server implementations to be released as a matched topology.
- `scripts/release-readiness.mjs` records the workspace packages, lockfile
  version, native package inventory, SBOM hash, and source correspondence in
  one release manifest.
- `.github/workflows/ci.yml` builds the shared packages and standalone server
  from the same checkout, and its production WebRTC job checks out only the
  separately deployed hosted-service repository as an explicit external
  dependency.
- `.github/workflows/trigger-release.yml` sequences one release version and
  matched Desktop artifacts from that source revision.

Splitting the matched workspace would add version-coordination and source
correspondence machinery without improving ownership or release cadence. The
decision should be revisited only if independent release evidence shows that
the matched server/UI/protocol contract can be versioned, tested, and
published without weakening those boundaries.

## Scope and non-claims

This is an ownership and cadence decision, not evidence that all release
artifacts are signed, notarized, or published. Those platform gates remain
separate Task 20 checklist items.
