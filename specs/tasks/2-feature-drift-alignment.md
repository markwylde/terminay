# Feature drift alignment

## Goal

Resolve the smaller feature gaps that predate the server/client architecture
work and keep them from becoming hidden assumptions during extraction.

## Governing specifications

- [File viewer](../features/file-viewer.md)
- [Terminal recording](../features/recording.md)
- [Terminay MCP server](../features/mcp-server.md)
- [Remote access](../features/remote-access.md)

## Why this is active

The feature-contract cleanup moved implementation status and old checklists out
of the canonical specifications. Code inspection still found several concrete
gaps in large-file interaction, recording scalability, MCP verification, and
one stale WebRTC fallback message. They need explicit implementation or a
deliberate product-contract change before the corresponding server service is
extracted.

## Dependencies

None. Complete or explicitly resolve these pre-existing gaps before the
affected service extraction task begins.

## Work slices

- [ ] Audit [file-viewer](../features/file-viewer.md),
  [recording](../features/recording.md), and
  [mcp-server](../features/mcp-server.md) against current code and tests; record
  exact implementation gaps here before changing code.
- [ ] Decide the supported large-file text/diff/hex interaction contract,
  including unified diff, virtualized diff rows, selection behaviour, and a
  performant text editor. Implement or narrow the file-viewer specification.
- [ ] Implement the recording scalability and active-recording reveal contract,
  or narrow the governing product contract before code changes.
- [ ] Run the MCP flow manually in a running multi-project app with Codex and
  Claude Code, or replace the historical unchecked manual-test statement with
  reproducible automated coverage and a documented limitation.
- [ ] Replace the obsolete WebRTC “scaffolded/peer handler unavailable” user
  messaging with an accurate recoverable-state explanation when a configured
  host cannot become ready.

## Acceptance checks

- File-viewer large-file/diff/HEX behaviour matches its feature contract and
  has focused coverage.
- Recording scalability/reveal behaviour matches its feature contract and has
  focused coverage.
- MCP has reproducible multi-project coverage for both supported agent
  integrations or one explicitly documented limitation.
- WebRTC fallback copy describes the real configured-host error state.

## Definition of done

- Each listed product contract has matching code/tests or an explicit spec
  change made before implementation.
- No unresolved gap is silently delegated to the server extraction tasks.
- Remote pairing status accurately distinguishes configuration/error states from
  the implemented WebRTC host capability.
- Relevant focused tests and `npm run smoke` pass.
