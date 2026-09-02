## Context

See proposal.md for the motivation. The fixed architecture this change works
within is that Terminay owns terminal and project authorization, environment
selection, observation admission, canonical event ordering, snapshots,
acknowledgement, UI, and fallback activity, while an agent extension owns only
provider-specific detection, binding, bounded parsing, and canonical lifecycle
projection. Extensions import only `@terminay/extension-api`; no compatibility
shim may hand them Server Core services, Electron IPC, renderer stores, or raw
client protocol handlers.

## Goals / Non-Goals

Goals:

- A public SDK sufficient to implement all four official agent integrations and
  both environment providers with no private import.
- Verified packed artifacts for every built-in in every server distribution,
  materialized offline, enabled by default, with durable user disablement.
- No provider-specific agent code left in Server Core, Electron, client core, or
  renderer code.
- Documentation complete enough for a third party to build, test, package, and
  diagnose an agent extension without reading Terminay source.

Non-Goals:

- Operating-system sandboxing of extensions. `built-in` is an installation
  origin, not a privileged code path, and extensions remain trusted Node
  programs running with the server account's authority.
- Inferring waiting, completion, or child identity where a provider's durable
  format gives no authoritative evidence.
- Retaining a second hard-coded provider registry after cutover.

## Decisions

- **Boundary: the public SDK is the only interface.** Agent behaviour crosses
  from trusted core code into separately hosted extension processes. Import-graph
  rules run in both directions: `extensions/*` may not reach private Terminay
  packages or source paths, and provider executable names, journal roots, record
  schemas, and mapping versions may not return to generic core or renderer code.
- **Boundary: the terminal incarnation is the security fence.** The host issues a
  context bound to the exact server, project, terminal session, and process
  incarnation. Publication, acknowledgement, replay, observation resolution, and
  cancellation all revalidate it. Equal project names or reused terminal ids are
  never a substitute for a server-instance match, which is why every implicit
  server also needs a durable data-root-scoped identity.
- **Boundary: environment routing, never local substitution.** A **This server**
  extension may combine its host-issued terminal context with Node APIs. A remote
  environment must be observed through the environment-routed broker; a missing or
  stale binding fails explicitly rather than falling back to local PIDs, cwd, home
  directories, or paths. Provider-declared observation requirements are
  intersected with the exact environment's capabilities before admission, and an
  absent operation yields a safe unavailable diagnostic.
- **Host-side flow control.** The host, not the child, owns retry budgets,
  concurrency, byte limits, backpressure, deadlines, and observer lifetime.
  Batches validate before store mutation, per-context publication is serialized
  and bounded, retries coalesce to one acknowledgement, and retirement causes are
  exact-once.
- **Boundary: secrets stay with their owner.** A dependency call such as Puzed to
  SSH returns an opaque, installation- and provider-scoped reference; the target
  extension holds the material in the Server vault under its own scope, transient
  callback copies are zeroized, and the caller never receives key bytes or an
  enumerable vault id.
- **Bundled slot as a rollback floor.** Release artifacts contain packed, verified
  packages with deterministic digests; the runtime never executes extension source
  from the application repository, and the shipped slot cannot be physically
  removed. A compatible npm override may be selected and removed, returning to the
  floor with the user's enablement choice intact.
- **Cutover only after parity.** Provider behaviour moves package by package, and
  the hard-coded drivers, legacy PTY bridge, and private SSH/Puzed composition are
  deleted only once fixture, packed, Docker, and packaged parity gates pass.
- **Honest per-provider limits.** Cursor projects no subagents and no waiting
  state, and its remote observation fails closed rather than reading a local or
  newest-session store; omp declares its unsupported waits; Codex children are
  attached only on a native nested parent id match.

## Risks / Trade-offs

- Moving parsing out of core widens the public API surface permanently; every DTO
  therefore has a closed runtime validator with size, count, and depth limits.
- Per-extension processes contain crashes and reduce accidental secret sharing but
  are not a hostile-code sandbox, and the installation warning must say so.
- Bundling seven packed closures grows every distribution and adds release
  failure modes — missing, stale, divergent, or non-conformant artifacts — which
  is why release assembly fails closed on each of them.
- Architecture evidence is expensive: emulated builds are not accepted, so native
  runners are required for the Linux x64 and arm64 lanes.
- A merged branch or a released tag is not evidence for an open acceptance gate;
  release reconciliation bookkeeping is kept separate from the product gates.

## Migration Plan

1. Land the additive Extension API v1 surface, host protocol, and conformance
   tooling with a fixture extension proving no private dependency is needed.
2. Replace the internal provider registry with the extension-backed registry while
   the canonical store, client protocol, and Agents UI stay provider-neutral.
3. Relocate SSH and Puzed into `extensions/` without importing their Git
   histories, preserving npm names, extension ids, provider ids, profile ids, and
   persisted environment compatibility so no identity migration is needed.
4. Create the four agent packages and prove per-provider parity with fixtures,
   compatibility suites, packed-package tests, and opt-in real-CLI smoke tests.
5. Add deterministic staging, inventory, and installer semantics; reconcile
   release slots without network access, re-enabling, hot swap, or override loss.
6. Delete the hard-coded implementations and the private composition, then
   complete the documentation and the reverse boundary rules.

Persisted state migrates in place: disablement is keyed by immutable extension
id and survives upgrades; a legacy fixed local server identity record migrates
atomically to a data-root-scoped one; stale installed or failed extension records
migrate so they cannot mask a newly materialized bundled floor.

## Open Questions

_None. The two-instance real-app acceptance is recorded from
`e2e/extension-agent-runtime.spec.ts`: a second isolated Electron profile
with its own `TERMINAY_USER_DATA_DIR` stays empty in the Agents tree while
the owning instance admits the Codex root, late child, and live title
update. Every other gate is checked in `tasks.md` rather than inferred
from a merged branch or a released tag._
