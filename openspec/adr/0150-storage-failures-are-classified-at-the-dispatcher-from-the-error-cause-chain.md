# ADR-0150: Storage failures are classified at the dispatcher from the error cause chain

Status: accepted
Date: 2026-11-28

## Context

Many server-core stores write to disk, and several wrap the system error in a
domain error. The dispatcher knew only domain errors, so a full disk reached
clients as `internal` / `command failed`. Protocol error codes are a closed set
that clients validate, and clients rewrite some codes, `unavailable` among them,
into connection wording.

## Decision

1. The command dispatcher is the one place that classifies a refused filesystem
   operation. It finds the system error by walking the thrown error's `cause`
   chain.
2. A server-core error that wraps a failed filesystem operation keeps the
   original error as `cause`. An adapter that would convert or serialize such a
   failure before the dispatcher rethrows it instead. A refusal an operation
   defines deliberately as a protocol error is not reclassified, and surfaces
   that do not go through the dispatcher keep their own error vocabulary.
3. A storage failure uses existing protocol codes and is identified by
   `details.reason`, exported from `@terminay/protocol`. Clients test the reason
   before rewriting a code.

## Consequences

- A new store is covered without its own mapping, provided it keeps `cause`.
- A wrapper that drops `cause` silently falls back to its generic message.
- Client code that rewrites `unavailable` or `resource` must exempt storage
  failures.
