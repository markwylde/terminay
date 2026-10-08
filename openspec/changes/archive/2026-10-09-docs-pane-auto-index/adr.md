# ADR review

ADR review is complete for `docs-pane-auto-index`.

## In-force ADRs reviewed

Derived by walking `Supersedes:` links across `openspec/adr/`. ADR-0007
(superseded by 0008), ADR-0008 (superseded by 0018), ADR-0009 (superseded by
0017), and ADR-0014 and ADR-0024 (both superseded by 0025) are historical and
were not treated as live commitments.

In force at review time: 0001, 0002, 0003, 0004, 0005, 0006, 0010, 0011, 0012,
0013, 0015, 0016, 0017, 0018, 0019, 0020, 0021, 0022, 0023, 0025, 0026, 0027.

Three bind this change:

- **ADR-0022 (watch, do not poll)** — the design keeps the root watch
  subscription alive across a stopped index rather than tearing it down, so
  staleness is still detected by observation and nothing falls back to polling.
- **ADR-0021 (measure idle background cost in spawns)** — latched indexing holds
  one extra watch subscription per visited project and spawns no child process,
  so the idle-cost measure is unaffected.
- **ADR-0020 (per-operation canonical roots)** — unchanged: discovery still runs
  server-side per `docs.catalog` call, and the renderer gains no filesystem
  reach. The controller is still torn down when the project, root, or server
  changes.

None is revisited, so nothing supersedes them.

## New durable decision recorded

None. The change is renderer-side lifetime and presentation work behind an
existing server-owned query. It introduces no new boundary, technology, or
contract that would constrain future changes, and the rules it does establish —
when the pane auto-expands, what stop does to an in-flight build — are stated
normatively in the `documentation-sidebar-and-editor` spec delta, which is where
a future change would look for them.

## Decisions deliberately not recorded as ADRs

- Session-scoped auto-expand tracked in renderer memory rather than persisted
  project state. A deliberate choice against a schema change, but a local one:
  the spec delta carries the observable behaviour.
- Implementing stop as a request-generation bump rather than an abort signal.
  Tactical; it reuses the controller's existing stale-response rejection.
