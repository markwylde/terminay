## Why

A terminal tab in Terminay says "Terminal 1", "Terminal 2", "Terminal 3" and
never changes, so a row of tabs running Claude, a dev server, and an SSH
session all look the same. Every other terminal lets the running program name
its tab: a CLI writes the xterm title sequence (`OSC 0` or `OSC 2`,
`ESC ] 0 ; <title> BEL`) and the tab shows it. Claude Code, Codex, vim, ssh,
and most shell prompts already emit it; Terminay discards it.

The server's terminal signal parser already reads `OSC 9`, `133`, `633`, and
`777` from PTY output. It has no case for `0` or `2`, and a panel has only one
`title` field, written once as `Terminal N` at creation and afterwards only by
a user, the AI title command, or MCP `rename_terminal`.

## What Changes

- A program running in a terminal sets that terminal's tab title by emitting
  `OSC 0` or `OSC 2`. The title appears on every connected device, like any
  other workspace fact.
- A name a person chose wins. A title set in the tab editor, by **Set tab
  title with AI**, or by MCP `rename_terminal` is a *named* title; while one
  exists the program's title is remembered but not shown.
- Clearing a named title returns the tab to its automatic title: the
  program's title if it has one, otherwise `Terminal N`. A program that sets
  an empty title likewise falls back to `Terminal N`.
- A new server setting, on by default, turns program-set titles off.
- Program titles are treated as untrusted text: control and
  direction-override characters are stripped, length is bounded, bursts are
  coalesced, and Terminay never reports a title back to the program.
- A program title change does not advance the panel's metadata revision, so
  a program animating its title cannot make an in-flight AI title or note
  generation fail revalidation.

Not in this change: the xterm title stack (`CSI 22 t` / `CSI 23 t`), `OSC 1`
icon names, and titles for file or folder panels.

## Capabilities

### New Capabilities

- `program-set-tab-titles`: how a terminal's displayed title is resolved from
  its named title, its program-set title, and its default name; which
  sequences set a program title; how that text is bounded, sanitised, and
  coalesced; and how it persists and syncs.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: adds the server setting that
  enables or disables program-set titles.
- `ai-tab-metadata`: a generated title is a named title, and generation is
  not invalidated by a program title change.
- `mcp-server`: `rename_terminal` sets a named title, and `list_terminals`
  reports the resolved display title.

## Impact

- `packages/server-core/src/activity/parser.ts` and `types.ts`: decode
  `OSC 0` and `OSC 2` into a title signal.
- `packages/server-core/src/workspace.ts`: the terminal panel gains a named
  title, a program title, and a default name; `title` becomes the
  server-resolved display value. Persisted panels are migrated.
- `packages/server-core/src/composition.ts` and `activity/service.ts`: route
  title signals into a coalesced server-side workspace mutation.
- `packages/server-core/src/settings/`: the new server setting, its default,
  and its classification.
- `src/`: the tab editor's rename field edits the named title and shows the
  automatic title as its placeholder; Settings gains the toggle.
- `apps/terminay-server/src/mcp/`: `rename_terminal` writes the named title.
- No new dependency. No protocol version change beyond the added panel
  fields, which older clients ignore.
