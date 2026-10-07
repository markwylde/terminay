## Why

After **Set tab title with AI** gives a terminal a friendly title, the tab later
snaps back to its old "Terminal N" title — as soon as anything else changes the
workspace, such as opening another terminal. A title typed by hand does not
revert. The generated title also never reaches other connected clients or
survives a reload, and an AI note has the same weakness: it exists only in the
window that asked for it.

The cause is that generation returns text to the client without changing server
state. The server answers `ai.metadata.generate` with `{ text }`, the renderer
writes that text onto its local panel, and the next workspace reconcile restores
the server's canonical title. The `ai-tab-metadata` spec already requires a
canonical server mutation with a revision check; neither the embedded nor the
standalone server performs one. On the standalone server the request fails
outright with "terminal metadata mutation is unavailable".

`e2e/ai-tab-metadata.spec.ts` — "keeps a generated title after the workspace
reconciles with the server" — reproduces the revert and currently fails.

## What Changes

- The server applies a generated title or note to the canonical terminal panel
  itself, as part of the generation request. Clients learn the result from
  server workspace state, exactly as they learn a manual rename.
- The terminal note becomes a server-owned panel field. Manual note edits are
  server mutations too, so a note reaches every authorized client and survives
  a reload.
- Each terminal panel carries a metadata revision that advances whenever its
  title or note changes. A generation captures that revision when it starts; if
  the title or note was edited by hand in the meantime, the generated result is
  rejected with a revision conflict and the manual edit is kept.
- The "Generating..." indication stops being a title write. It is a transient,
  client-local pending state on the tab, so it is never mistaken for, or
  overwritten by, the canonical title.
- Embedded and standalone servers resolve the target, check the revision, and
  apply the mutation through one shared server-core path, so the two cannot
  drift. The embedded server stops answering generation with a bespoke
  text-only handler.
- Notes that exist only in a client's local workspace are adopted by the server
  the first time that client presents the panel, so no existing note is lost.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ai-tab-metadata`: generated titles and notes are applied by the server and
  observed by clients from workspace state; the revision check is defined
  against a per-terminal metadata revision; generation progress is a transient
  client indication rather than a title change; embedded and standalone servers
  behave identically.
- `terminal-workspace`: a terminal's note is server-owned, and editing it is a
  canonical server mutation shared by every authorized client.

## Impact

- `packages/server-core`: terminal panel gains `note` and `metadataRevision`;
  the `panel.update` reducer advances the revision on title or note changes; a
  shared workspace-backed AI target authority provides `getTarget` and
  `applyMetadata`; workspace protocol validation accepts a bounded `note`.
- `packages/client-core`: `updatePanel` accepts `note`; the workspace snapshot
  exposes the panel note.
- `electron/serverTerminalAuthority.ts`: generation runs through the server-core
  `AiService` with the host provider (including the test mock seam) as its
  adapter, instead of `generateAiMetadata` returning text.
- `apps/terminay-server/src/cli.ts`: its `AiService` authority gains
  `applyMetadata` from the shared path.
- `src/` renderer: `runAiTabMetadata` stops writing title and note locally;
  reconcile applies the canonical note; note edits go through the workspace
  store; the tab renders a pending-generation state.
- Tests: the failing e2e reproduction passes; new coverage for conflict, note
  persistence, and standalone parity. No new dependencies.
