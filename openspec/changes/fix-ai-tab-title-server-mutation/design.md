## Context

`ai.metadata.generate` is supposed to end in a canonical server mutation. It
does not on either server:

- **Embedded** (`electron/serverTerminalAuthority.ts`): `generateAiMetadata`
  calls the host provider service directly and returns `{ text }`. It bypasses
  the server-core `AiService`, whose `generate` already does the
  authorize → capture revision → run provider → re-check → `applyMetadata`
  sequence. `aiTargetState` reports `metadataRevision: 0` and `note: ''`.
- **Standalone** (`apps/terminay-server/src/cli.ts`): the request does reach
  `AiService.generate`, but the authority has no `applyMetadata`, so it throws
  `target_unavailable`. `standaloneAiTarget` has the same hardcoded revision
  and empty note.

The renderer compensates by writing the returned text onto its own Dockview
panel (`src/App.tsx`, `runAiTabMetadata`). `reconcileServerPanels` then restores
`canonical.title` on the next workspace snapshot, which is the reported revert.
A manual rename survives only because it calls `workspaceStore.updatePanel`
first.

The note is worse placed: `TerminalPanel` in server-core has no note field, and
the renderer keeps `terminalNote` purely as a Dockview panel parameter. The
`server-owned-workspace-state` inventory already lists panel notes as
server-persisted, so the code is behind the contract.

Scope was settled with the owner in `questionnaires/scope.yaml`: fix title and
note, reject a generated result on concurrent manual edit, and fix both
servers through one path.

In-force ADRs that constrain this: ADR-0017 (one server type; every project
executes on its server) and ADR-0018 (one workspace bundle, protocol-blind
hosts) both require that embedded and standalone servers be the same
implementation behind the same protocol, and that the renderer hold no
authority. ADR-0002 governs how the new fields persist. None needs revisiting.

## Goals / Non-Goals

**Goals:**

- A generated title or note is server state, visible to every authorized
  client and durable across reconcile, reload, and restart.
- A manual title or note edit made during generation wins; the generated
  result is rejected with `revision_conflict`.
- One server-core code path resolves the target and applies the mutation for
  both servers.
- Terminal notes become server-owned, including manual edits.
- Existing client-local notes are not lost.

**Non-Goals:**

- Changing providers, prompts, context bounds, output normalization, or
  settings.
- Automatic or background renaming.
- An automatic client retry on conflict. The spec requires that a retry be
  possible; the user re-invokes the command.
- Cross-client visibility of the "generating" state.

## Decisions

### 1. The server applies the result; the client applies nothing

`AiService.generate` keeps its existing shape and gains a working
`applyMetadata`. The renderer deletes its `setTitle(text)` and
`updateParameters({ terminalNote: text })` calls and waits for the workspace
snapshot, where `reconcileServerPanels` already applies `canonical.title`.

*Alternative considered:* keep the server returning text and have the client
call `workspaceStore.updatePanel`, as the manual rename does. This is a
five-line fix, but it leaves the renderer as the authority for an AI-originated
write, cannot check the revision atomically with the apply, and does nothing
for the standalone server. It crosses the client/server trust boundary in the
wrong direction: the client would be vouching for provider output the server
produced.

### 2. One workspace-backed AI target authority in server-core

Add a factory in `packages/server-core/src/aiService/` that builds
`getTarget`, `authorize`, and `applyMetadata` from a `WorkspaceStore` and a
terminal-session lookup. Both `serverTerminalAuthority.ts` and `cli.ts` use it,
replacing `aiTargetState` and `standaloneAiTarget`. `writeInput` and replay
stay host-supplied because they differ legitimately.

`applyMetadata` issues an ordinary `panel.update` workspace command through
`WorkspaceStore.apply`, so the mutation is persisted, evented, and fanned out
by the machinery that already carries manual renames. No second write path
into workspace state is introduced.

*Alternative considered:* add `applyMetadata` separately in each host. That
reproduces today's drift, which is how two different failures arose.

### 3. The embedded server routes generation through `AiService`

The embedded server registers the server-core `ai.metadata.generate` operation
instead of its bespoke handler. The host provider service passed as
`options.aiMetadata` (which also carries the `TERMINAY_TEST` mock seam) is
wrapped as the `AiProviderAdapter` for `codex` and `claude-code`. Model listing
keeps working through the same adapter.

The embedded server currently builds an `AiService` only when a vault is
present, for dictation. Metadata generation must not depend on the vault, so
the embedded server builds a second `AiService` for metadata whenever a
metadata provider is configured. Both use the same shared target authority.

The service reports provider failures through a fixed public vocabulary. The
host provider has already reduced its failure to a bounded user-facing
message, so the embedded server carries that one message past the vocabulary
for the request that produced it, as the handler it replaces did.

The client keeps sending `provider` and `model`. `AiService` rejects a provider
that disagrees with server settings only when a settings source is injected;
the embedded server injects none today, and this change keeps that so behaviour
with respect to settings is unchanged.

### 4. A per-panel metadata revision, advanced in the reducer

`TerminalPanel` gains `metadataRevision` (non-negative integer, absent means
0). The `panel.update` reducer increments it when the patch changes `title` or
`note` to a different value, and only then. Clients cannot set it: a patch
containing `metadataRevision` is rejected alongside `id`, `projectId`, and
`type`.

`applyMetadata(target, type, value, expectedRevision)` compares
`expectedRevision` with the panel's current revision and applies the patch
inside one synchronous `WorkspaceStore.apply` call, so no manual edit can land
between check and write.

*Alternatives considered:* (a) the workspace-wide `revision` — rejected because
any unrelated change (another tab opening, a colour change) would conflict,
which is the common case while a provider takes seconds to answer.
(b) Comparing the title text captured at start — rejected because an
edit-and-revert would go undetected and it gives the client nothing to retry
against.

### 5. The note is a `TerminalPanel` field edited through `panel.update`

`TerminalPanel` gains `note?: string`. Absent means the terminal has no note;
an empty string is a present, empty note, matching the renderer's existing
`typeof terminalNote === 'string'` rule for showing the note editor. A patch
value of `null` removes the note. The server bounds it to the existing note
limit (1200 characters) and rejects NUL, in both the reducer validation and
`workspaceProtocol`.

In the renderer, `onUpdateNote` updates the local parameter immediately for
typing responsiveness and sends a debounced `updatePanel({ note })`.
`reconcileServerPanels` applies `canonical.note` to `terminalNote`, except
while this client has an edit to that note the server has not yet accepted,
so an echo of an older keystroke cannot rewind what was typed. This is tracked
per pending edit rather than by focus, because an echo can also arrive after
the editor has lost focus. The debounce is cut short when the note editor
loses focus and when the page unloads, so an edit made just before a reload
is not lost.

*Alternative considered:* a dedicated `panel.note.set` command. Rejected:
`panel.update` already carries presentation metadata with the right
authorization, and a second command would need its own protocol entry for no
gain.

### 6. "Generating..." is a panel parameter, not a title

`runAiTabMetadata` sets a transient `aiTitlePending` panel parameter and clears
it in `finally`. `TerminalTab` renders "Generating..." in place of the title
while it is set. The panel's real title is never touched locally, so there is
no `previousTitle` to restore on failure and a reconcile during generation
cannot fight the placeholder.

## Risks / Trade-offs

- [A debounced note edit races a generated note] → The manual edit advances the
  revision when it lands; a generation that started earlier is rejected. An
  edit still inside the debounce window when the generated note arrives is
  flushed first on the note command, so the revision check sees it.
- [Reconcile overwrites a note being typed] → Skip applying the canonical note
  to a note editor that currently has focus in this client; apply on blur.
- [Embedded generation errors change shape] → Today the embedded handler maps
  every provider failure to a 256-character `unavailable` message. Routing
  through `AiService` yields its typed codes instead. The existing e2e
  assertion on the "Codex test failure" banner text is the regression guard;
  the adapter wrapper must preserve the bounded provider message.
- [Two clients, same server] → The second client now sees the generated title
  arrive without having asked. This is the specified behaviour, not a
  regression.
- [Persisted workspace schema gains fields] → Both are optional and default to
  absent/0, so stored state reads unchanged and no schema version bump is
  needed.

## Migration Plan

- Stored workspace state needs no migration; the new panel fields are optional.
- Client-local notes: when a client presents a terminal panel whose canonical
  `note` is absent and whose local `terminalNote` is a string, it sends one
  `updatePanel({ note })` to adopt it, then treats the server as canonical. If
  the canonical note is present, the server wins. This runs in the existing
  adoption path and needs no flag.
- Rollback is a code revert. Notes written to server state are ignored by the
  earlier client, which falls back to its local parameter.

## Open Questions

None.
