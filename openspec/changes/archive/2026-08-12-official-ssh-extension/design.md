## Context

See proposal.md. This was Phase 3 of the environments programme, run in parallel
with the Puzed VM provisioning experience once the public provider and UI
contracts were stable, and it depended on the extension API, manifest, and host
and on environment-routed project services already being in place.

## Goals / Non-Goals

Goals: a reliable SSH terminal and filesystem project on every server mode,
installed through the public platform like any third-party extension.

Non-Goals for SSH v1: filesystem observation, an automatic replacement shell,
and remote cwd, foreground-process, agent, and MCP support — these are explicitly
unsupported and must behave explicitly rather than silently degrading.

## Decisions

- **A separate published package, not a bundled special case.** The extension is
  scaffolded from the public SDK with precompiled ESM and no install or build
  scripts or native dependencies, and it is verified as a packed tarball with
  provenance. If the official provider needed anything the public API does not
  offer, that would be a defect in the API.
- **Credentials resolve only inside the server.** Client hosts receive no SSH
  credentials and no SSH transport; a remote Terminay Server uses its own
  network, vault, and agent. This is the trust boundary the whole environments
  model rests on.
- **Strict host verification by default**, with exact host-key persistence and an
  explicit mismatch and replacement flow. The per-profile unsafe bypass exists
  but is separately confirmed and audited, so it cannot become the quiet default.
- **Structured connection with no shell interpolation.** Commands are generated
  with strict POSIX quoting and a filtered, provider-safe environment, so a
  profile field can never become shell syntax.
- **Local fallback is impossible.** Local Git, process, agent, MCP, and
  filesystem services must not be reachable from an SSH project; a missing or
  failed provider never falls back to the Terminay Server machine.

## Risks / Trade-offs

SFTP is a chattier protocol than a local filesystem, so the adapter bounds each
operation, reuses sessions efficiently, and handles ambiguous outcomes and large
files explicitly. Without filesystem observation in v1, refresh is manual, which
is stated as a capability limit rather than hidden.
