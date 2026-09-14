# ADR-0020: Canonicalize a project root once per filesystem operation, and never cache one across operations

Status: accepted
Date: 2026-09-14

## Context

ADR-0011 fixes the server filesystem/Git services → project root boundary:
canonical paths and opaque ids are revalidated at mutation time, and traversal,
symlink escape, and stale revisions fail closed. `CanonicalProjectPathResolver`
implements that by realpathing and stat'ing the configured project root at the
start of every `resolve()` call, then containment-checking the resolved path
against it.

That per-call revalidation is correct, but the catalog calls `resolve()` once —
in practice three times — per directory entry, so a listing re-canonicalized the
root roughly a hundred times. Each canonicalization is a full ancestor walk in
the kernel. On a managed Mac every one of those lookups is authorised through
the Endpoint Security subsystem, so an idle Terminay window kept Microsoft
Defender's scanning daemon busy indefinitely while Terminay's own CPU read ~2%.
The cost was entirely externalised, which is why no in-app measurement surfaced
it. See [idle filesystem path-lookup cost](./evidence/idle-filesystem-path-lookup-cost.md).

The obvious remedy — cache the canonical root on the resolver, as the bug report
requested — is unsafe. It was implemented first and rejected by
`packages/server-core/test/file-adapter.test.mjs`, which replaces a project's
canonical root between two operations and requires the second to fail closed. A
resolver that remembers the root answers from a stale value and the replacement
goes undetected. A TTL narrows that window without closing it.

The distinction that matters is between repetition *within* one operation, which
is pure waste, and revalidation *between* operations, which is the boundary.

## Decision

1. **A filesystem operation canonicalizes the project root once.** The operation
   resolves the root at its start and threads that canonical value through every
   path it resolves. `CanonicalProjectPathOptions.canonicalRoot` carries it, and
   accepts only a value returned by `root()`.
2. **No canonical root is cached across operations.** Every new operation
   canonicalizes the root again, so a root moved, replaced, or made non-canonical
   between two operations is detected by the next one and fails closed. This
   holds regardless of how cheap caching would be; the revalidation cadence is
   the ADR-0011 boundary, not a performance knob.
3. **Containment is checked per path, not per operation.** A supplied canonical
   root shortens how the root is obtained; it never substitutes for checking that
   a resolved path lies within it. Symlink escape continues to fail closed.
4. **Facts a lower layer has already established are not re-derived.** A
   directory read that reports whether an entry is a symbolic link is believed,
   and a stat taken as part of canonicalization is reused rather than repeated. A
   layer that does not report a fact is still probed for it.
5. **Externalised filesystem cost counts as cost.** Work that leaves Terminay's
   own CPU flat while loading an endpoint-security agent, a filesystem watcher,
   or a battery is a defect, and per-operation syscall budgets are asserted in
   tests rather than left to profiling.

## Consequences

- Listing a directory costs path lookups proportional to its entry count. On the
  measured 40-entry listing, 362 adapter path calls become 122, and the kernel
  ancestor walks behind them fall by the same ratio.
- A root replacement is still caught at exactly the granularity ADR-0011
  requires, and the existing adapter suite continues to prove it.
- `canonicalRoot` is an internal server-side option with no protocol surface. A
  caller able to supply a forged root already holds the resolver, so it adds no
  authority. Reviewers must still confirm any new caller obtained it from
  `root()` within the same operation.
- Future work that wants to make path resolution cheaper has a stated rule to
  design against: shorten the work inside an operation, never the revalidation
  between them.
- Desktop's device-local settings reads follow the same principle by a different
  mechanism — a cache invalidated by change notification, serving nothing when no
  watch is live — but that is a host-local file, not the project-root boundary,
  and this ADR does not govern it.

## Open items

- The cadence at which an idle window repeats a listing is unidentified and
  untouched by this decision. It lives in the client refresh path and needs its
  own capture; the evidence file records what would settle it.
