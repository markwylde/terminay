Unit tests in this repository run under `node --test`, not Vitest; the
verifications below name the suites that exist.

## 1. Parse the title sequences

- [x] 1.1 Add a `title` variant to `TerminalActivitySignal` in `packages/server-core/src/activity/types.ts` and decode `OSC 0` and `OSC 2` in `decodeOsc` (`parser.ts`), leaving `OSC 1` undecoded. Verified by `packages/server-core/test/program-titles.test.mjs`: BEL- and ST-terminated, empty text, a sequence split across two `push` calls, `OSC 1` yielding nothing, and a payload over `maxPayloadBytes` yielding nothing.
- [x] 1.2 Add a pure `sanitiseProgramTitle` function (strip C0/C1 and U+202A–U+202E / U+2066–U+2069, collapse whitespace, trim, truncate to the `boundedName` bound, empty means clear). Verified by the "reduced to bounded display text" case in the same suite, covering each scenario in "Program titles are untrusted display text".

## 2. Panel title model

- [x] 2.1 Add `defaultTitle`, `namedTitle`, and `programTitle` to the terminal panel in `packages/server-core/src/workspace.ts`, with `title` resolved by the server as named, then program, then default. Verified by the resolution cases in `program-titles.test.mjs`.
- [x] 2.2 Make `panel.update` treat a `title` patch as the named title (empty or `null` removes it, non-empty is bounded by `boundedName`), reject patches naming a title source, and advance `metadataRevision` only for a named-title or note change. Verified in the same suite: rename, clear with and without a program title, rejected server-assigned fields, and an unchanged revision after a program title change.
- [x] 2.3 Add the host-owned `panel.programTitle.set` and `panel.programTitles.clear` commands, refused from a client, and assign title sources in the reducer for both creation commands (`terminal.createPanel`, `panel.create`): a `Terminal N` or absent title is the default name, any other is the named title. Every creation path goes through those two commands, so none needed its own change. Verified by the creation cases and the composed-server case, which asserts a client's attempt at either command is `forbidden`.
- [x] 2.4 Migrate persisted terminal panels that lack `defaultTitle` as described in the design's Migration Plan. Verified by the "stored before title sources" case: one `Terminal 2` panel and one renamed panel, asserting the migrated fields, an unchanged `title`, and idempotence.
- [x] 2.5 Carry the three fields through `panel.move`. Verified by the "travel with a terminal moved to another project" case.
- [x] 2.6 Bound the store's command-outcome cache to its history length. Each outcome holds a whole state and nothing released them, which a title-animating program would have turned into steady growth. Verified by the "lets go of command outcomes" case.

## 3. Wire output to state

- [x] 3.1 Route `title` signals from `activity.ingestPtyOutput` to a per-terminal coalescer that commits immediately, then at most once per 250 ms with the latest value, and commits nothing for an unchanged value. Verified with fake timers by the coalescer and binding cases, covering both "Title bursts are coalesced" scenarios, forgetting, and disposal.
- [x] 3.2 Confirm title-report queries stay unanswered. Verified by `scripts/terminal-title-report.test.mjs` (no emulator is granted `windowOptions`; a headless xterm answers `CSI 21 t` with nothing) and by the composed-server case, which asserts nothing is written to the PTY.

## 4. Setting

- [x] 4.1 Add `programSetTabTitles: true` to `DEFAULT_SERVER_SETTINGS` and classify it `server` in `settings/classification.ts`. Verified by the settings case in `program-titles.test.mjs`.
- [x] 4.2 When the setting is off, discard title signals; when it turns off, clear every stored `programTitle` in one mutation. Verified by the "with the setting off" case: a signal while off changes nothing, and turning off drops existing program titles while named titles stay.
- [x] 4.3 Add the **Let programs set tab titles** toggle to the terminal settings in `src/`. Verified by `src/terminalSettings.programTitles.test.ts`.

## 5. Client and MCP

- [x] 5.1 Make the tab editor's name field hold the named title only, show the otherwise-displayed title as its placeholder, and send an empty title to clear. Verified by `src/workspace/terminalTitleEdit.test.ts` and by the end-to-end spec.
- [x] 5.2 Confirm `rename_terminal` and **Set tab title with AI** set the named title through the existing `panel.update` path, and that `list_terminals` reports the resolved title. Both issue a `panel.update` title patch and read `panel.title`, so neither needed a change; verified by the existing MCP and AI suites passing, and by the revision case showing a program title change leaves the revision an in-flight generation checks.

## 6. End to end and specs

- [x] 6.1 Add `e2e/program-set-tab-titles.spec.ts`: a program names its tab; a rename wins over a later sequence; clearing the name returns the program title; a program clearing its title returns `Terminal N`; the title survives a reload; turning the setting off drops and ignores program titles. Verified by `npm run test:e2e` passing.
- [x] 6.2 Run `openspec validate --all`, `npm run lint`, and the unit suites. Verified by all three exiting zero.
- [x] 6.3 Open the pull request on `origin` with `tea` and read back the commit statuses. Verified by every status being `success` or `skipped`.
