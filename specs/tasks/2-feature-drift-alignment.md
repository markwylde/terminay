# Feature drift alignment

## Goal

Resolve the remaining gaps between the canonical feature specifications and the
shipped product, or explicitly narrow the feature contract where the behaviour
is deliberately deferred.

## Why this is active

The specs refresh found historical unchecked implementation items embedded in
otherwise shipped feature docs, plus a stale WebRTC fallback message that calls
the host flow “scaffolded” even though the production peer flow is implemented.
Those items should not silently look like completed product behaviour.

## Work slices

- [ ] Audit unchecked items in [file-viewer](../features/file-viewer.md),
  [recording](../features/recording.md), and [mcp-server](../features/mcp-server.md)
  against current code and tests. Move genuinely deferred work into explicit
  scoped tasks; otherwise document the shipped behaviour and remove obsolete
  checklist claims.
- [ ] Decide the supported large-file text/diff/hex interaction contract,
  including unified diff, virtualized diff rows, selection behaviour, and a
  performant text editor. Implement or narrow the file-viewer specification.
- [ ] Decide recording scalability and active-recording reveal scope. Add the
  missing tests or record these as intentionally deferred feature work.
- [ ] Run the MCP flow manually in a running multi-project app with Codex and
  Claude Code, or replace the historical unchecked manual-test statement with
  reproducible automated coverage and a documented limitation.
- [ ] Replace the obsolete WebRTC “scaffolded/peer handler unavailable” user
  messaging with an accurate recoverable-state explanation when a configured
  host cannot become ready.

## Definition of done

- No feature spec presents an unchecked historical implementation item as an
  implied shipped promise.
- Every remaining deferred capability has a clear product decision and, if it
  is planned, its own active task.
- Remote pairing status accurately distinguishes configuration/error states from
  the implemented WebRTC host capability.
- Relevant focused tests and `npm run smoke` pass.

