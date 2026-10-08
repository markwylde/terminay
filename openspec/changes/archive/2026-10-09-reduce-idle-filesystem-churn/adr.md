# ADR review

ADR review is complete for `reduce-idle-filesystem-churn`.

## In-force ADRs reviewed

Derived by walking `Supersedes:` links across `openspec/adr/`. ADR-0007
(superseded by 0008), ADR-0008 (superseded by 0018), and ADR-0009 (superseded by
0017) are historical and were not treated as live commitments.

In force at review time: 0001, 0002, 0003, 0004, 0005, 0006, 0010, 0011, 0012,
0013, 0014, 0015, 0016, 0017, 0018, 0019.

The binding one for this change is **ADR-0011 (security trust-boundary model)**,
which fixes the server filesystem/Git services → project root boundary:
canonical paths and opaque ids are revalidated at mutation time, and traversal
and symlink escape fail closed. The design preserves that revalidation rather
than amending it, so ADR-0011 is not revisited and nothing supersedes it.

## New durable decision recorded

- [ADR-0020: Canonicalize a project root once per filesystem operation, and never
  cache one across operations](../../adr/0020-per-operation-canonical-roots.md)

It meets the bar: it commits the repository to a rule that constrains future
work beyond this change — shorten path resolution *inside* an operation, never
the revalidation *between* operations — and it records why the obvious caching
approach is rejected, which is exactly the mistake a future change would
otherwise repeat. It supersedes nothing.

Supporting measurements:
[idle filesystem path-lookup cost](../../adr/evidence/idle-filesystem-path-lookup-cost.md).

## Decisions deliberately not recorded as ADRs

- Caching Desktop's device-local settings behind a change watch. It is a
  host-local file-read strategy, not an architectural boundary, and is fully
  captured by the `settings-shortcuts-and-desktop-integration` spec delta.
- Reusing the stat taken during canonicalization, and trusting the directory
  read's symlink flag. Tactical, and covered by the
  `file-explorer-and-folder-tabs` spec delta. ADR-0020 states the general
  principle they follow.
