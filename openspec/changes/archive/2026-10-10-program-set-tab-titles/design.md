## Context

A terminal panel in server workspace state has one `title` string. The server
writes `Terminal N` into it at creation (`nextTerminalPanelTitle`,
`composition.ts`, the MCP terminal adapter) and afterwards it changes only
through a `panel.update` patch issued for a person: the tab editor, **Set tab
title with AI**, or MCP `rename_terminal`. Any change to it advances
`metadataRevision`, which the AI metadata commands use to revalidate their
target.

PTY output already passes through `IncrementalTerminalSignalParser`
(`packages/server-core/src/activity/parser.ts`) on the server, fed by
`activity.ingestPtyOutput` in `composition.ts`. It observes bytes without
rewriting them, bounds each OSC payload at 16 KiB, and decodes `OSC 9`, `133`,
`633`, and `777`. `OSC 0` and `OSC 2` fall through `decodeOsc` and are dropped.
The client's xterm also parses them and fires `onTitleChange`, which nothing
listens to.

In-force ADRs that constrain this design:

- ADR-0011: terminal output is untrusted; titles, labels, and focus never
  define authority.
- ADR-0017 / ADR-0018: the server that owns a project owns its workspace
  state; clients present it.
- ADR-0028: no polling without owner approval.
- ADR-0035: PTYs live in a detached holder; the server sees their output as a
  stream and may restart underneath them.
- ADR-0044: work on the output path is proportional to the output event.
- ADR-0043: a terminal changes project by retiring its identity; panel
  metadata travels with the panel.

## Goals / Non-Goals

**Goals:**

- A program's `OSC 0` / `OSC 2` title shows on its tab, on every device.
- A person's name for a tab (editor, AI, MCP) always wins and survives.
- Clearing a name, or a program clearing its title, falls back predictably.
- A title-animating program costs a bounded number of workspace commits.
- One server setting turns it off.

**Non-Goals:**

- The xterm title stack (`CSI 22 t` push / `CSI 23 t` pop). See Open
  Questions.
- `OSC 1` icon names, and titles for file or folder panels.
- Inferring anything from a title: agent state, attention, or identity.
- Clearing a title when the program that set it exits.

## Decisions

### 1. The server reads the title from PTY output; the client's xterm does not

The existing server parser gains a `title` signal for `OSC 0` and `OSC 2`.
Alternative: listen to xterm's `onTitleChange` in the renderer and send a
`panel.update`. Rejected: it makes the title depend on a client being
attached and on which client wins, a background terminal with no viewer would
never update, and it would let untrusted renderer code be the path by which
terminal output becomes workspace state. The server already sees every byte.

Boundary crossed: **PTY output → server workspace state.** This is the first
place untrusted terminal output writes a persisted, synced workspace field.
Decision 3 is what makes that acceptable, and ADR-0056 records it.

### 2. Three stored values, one resolved `title`

A terminal panel stores `defaultTitle` (always), `namedTitle` (optional), and
`programTitle` (optional). The server computes `title` as
`namedTitle ?? programTitle ?? defaultTitle` whenever any of them changes and
publishes it. Every existing reader of `panel.title` (tabs, the compact
switcher and its filter, the breadcrumb, MCP `list_terminals`, notifications)
keeps working unchanged.

Alternative: a single `title` plus a `pinned` flag. Rejected: it cannot answer
"clear my rename" correctly, because the program title the rename was hiding
has been overwritten, and the default name is lost the first time anything
sets a title.

A `panel.update` patch that carries `title` from a client, the AI command, or
MCP is interpreted as setting `namedTitle`; an empty string or `null` removes
it. Clients therefore need no new command, and an older client's rename still
does the right thing. `programTitle` and `defaultTitle` are server-assigned
and a patch naming them is rejected, like `metadataRevision`.

`metadataRevision` advances on a `namedTitle` or note change only. A program
that animates its title (Claude Code rewrites it with a spinner glyph) would
otherwise invalidate every in-flight AI title or note generation.

### 3. Program titles are sanitised, bounded, display-only text

Before storing, the server strips C0/C1 controls and bidi override/isolate
characters (U+202A–U+202E, U+2066–U+2069), collapses whitespace, trims, and
truncates to the `boundedName` bound, which `panel.update` also applies to a
named title from now on. Empty
after that means "clear". Nothing reads a title to choose, authorize, or
scope an operation; that is already the contract (ADR-0011) and this design
adds no reader. Terminay does not answer title-report queries (`CSI 21 t`),
which would otherwise let output inject keystrokes; xterm.js leaves that
window option off and this design keeps it off.

A program can still set a misleading title, including one that copies another
tab's. That is accepted: every terminal does this, the title is the program's
own tab, and a named title always overrides it.

### 4. Coalescing: at most one commit per terminal per 250 ms

A title signal updates an in-memory pending value for the terminal. If no
commit is scheduled, the server commits immediately and starts a 250 ms
window; a signal inside the window replaces the pending value and one
trailing commit carries the latest at the end. An unchanged value commits
nothing. This is a one-shot timer armed by an event, not polling (ADR-0028),
and the per-event work on the output path stays a string compare and an
assignment (ADR-0044).

Alternative: commit every change. Rejected: a spinner at 10 Hz would persist
and broadcast workspace state ten times a second per terminal, for hours.

### 5. The setting is a server setting, default on

`programSetTabTitles` (boolean, default `true`, classified `server`), a flat
key like its neighbours in `packages/server-core/src/settings/defaults.ts`. Turning it off clears every stored
`programTitle` in one mutation and makes the server discard title signals.
The parser still consumes the sequences, and the client's xterm never draws
them, so nothing appears as text. A device-level override was considered and
rejected: the title is a synced workspace fact, so two devices disagreeing
about whether it exists would break "the same on every device".

### 6. Lifetime

`programTitle` is ordinary panel state: persisted, restored after a server
restart (the holder kept the PTY alive, ADR-0035, and the program will not
re-emit), carried through `panel.move`, and kept after the session exits so
an exited tab still says what it was running.

## Risks / Trade-offs

- [A program that exits without resetting its title leaves it behind, e.g.
  vim's title after `:q`] → The shell's own prompt title replaces it where the
  prompt sets one; otherwise the user renames or clears. The title stack
  (Open Questions) is the full fix.
- [Shell prompts that emit `user@host:dir` rename every tab to something
  noisy] → The setting turns it off; a named title overrides it per tab.
- [A misleading or spoofed title] → Decision 3; titles carry no authority.
- [`WorkspaceStore` kept every command's outcome, each holding a whole state,
  for the life of the process; steady title commits would grow it without
  bound] → The outcome cache is bounded to the store's history length, the
  span over which a repeated command id can still be replayed.
- [Persisted panels have only `title`] → Migration below.
- [An older client patches `title` expecting a plain overwrite] → Decision 2
  treats that patch as a named title, which is what the older client meant.

## Migration Plan

On load, a terminal panel without `defaultTitle` is migrated once: if its
`title` matches `Terminal <n>` it becomes `defaultTitle` with no named title;
otherwise `title` becomes `namedTitle` and `defaultTitle` is assigned by the
usual `Terminal N` rule. Rollback is safe: an older server reads `title`,
which is still present and correct, and ignores the extra fields.

## Open Questions

- Should the title stack (`CSI 22;0 t` / `CSI 23;0 t`) follow? It needs CSI
  parsing the signal parser does not have today. Recommendation: a separate
  change, once this one shows how often stale titles occur in practice.
