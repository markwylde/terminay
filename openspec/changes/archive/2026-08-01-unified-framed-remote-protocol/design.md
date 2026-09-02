## Context

See proposal.md. The audit found the remote path differed from local in five
ways at once: commands and queries were JSON over HTTP and re-encoded into
protocol frames client-side; events were SSE JSON filtered and re-encoded
client-side while `ServerConnection` filters subscriptions server-side; terminal
output was JSON/base64 including retained replay during attach; and UI creation
flows observed command effects through the asynchronous event/SSE path, so
event-stream retry and backoff became visible UI latency.

This is architectural duplication, not a bug. Fixing symptoms inside
`HttpByteTransport` would have kept the divergent path alive, so the change was
deliberately deletion-heavy: the acceptance bar included that the net
implementation removes substantially more duplicated protocol code than it adds.

## Goals / Non-Goals

Goals: one protocol execution path for workspace, terminal, settings, macros,
recordings, files, git, activity, and AI operations, with only the byte
transport differing between Desktop-local, Desktop-remote, and web-remote.

Non-Goals, recorded explicitly by the change:
- Do not add another remote-only protocol layer.
- Do not make project or terminal creation depend on polling or arbitrary
  sleeps.
- Do not preserve `/protocol/query`, `/protocol/command`, or SSE app events as
  alternate application-protocol paths.
- Do not broaden browser access to Desktop-only capabilities.
- Do not change pairing or reconnect semantics except as needed to bootstrap the
  unified stream securely.

## Decisions

- **The stream endpoint adapts directly into `ServerConnection`.** Authorization
  and subscription filtering stay server-side, on the same code path local
  already used. This is the trust boundary the split path had duplicated.
- **HTTP is demoted to bootstrap.** Static assets, health/readiness, pairing,
  reconnect enrollment, and stream authentication remain; everything else is
  either deleted or reclassified as bootstrap-only, with obsolete tests removed
  rather than skipped.
- **Command results, not event timing, confirm mutations.** Creation flows read
  the canonical command result and then apply the unified event stream, so a
  retry/backoff schedule can no longer surface as latency.
- **Retained replay stays only as a general protocol safety property**, if still
  needed once the unified stream is in place — not as a remote-specific
  mechanism.

## Risks / Trade-offs

Deleting the alternate path removes the fallback that had masked stream
failures, so stream bootstrap and reconnect had to gain their own regression
coverage, including browser-manager reconnect for HTTPS and loopback saved
profiles after reload and restart.

## Migration Plan

A clean cutover. Remote clients use the framed stream immediately; no
compatibility shim for the removed JSON/SSE routes is retained.

## Open Questions

_None; the acceptance checks below were all met before archiving._
