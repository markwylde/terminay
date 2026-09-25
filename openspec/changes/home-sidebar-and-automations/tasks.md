## 1. Home glyph and Home sidebar

- [x] 1.1 Replace `LayoutDashboard` with lucide `House` on the project-bar Home
      control (`src/App.tsx`) and in `CompactChromeRow.tsx`, and rename its
      accessible name and title to Home. Verified by `npm run typecheck:workspaces`
      and the e2e case in 1.5 asserting the accessible name.
- [x] 1.2 Add `rememberHomeSidebarVisible` / `recallHomeSidebarVisible` (default
      open) and `rememberHomeSection` / `recallHomeSection` (default `home`) to
      `localViewState.ts`, best-effort. Verified by
      `node --test scripts/local-view-state.test.mjs` covering the round trip,
      nonsense values, and storage that throws.
- [x] 1.3 While Home is selected, route the sidebar toggle button, its shortcut,
      and the `toggle-file-explorer-sidebar` command to Home sidebar visibility,
      and stop disabling the toggle. Verified by an e2e case that toggling on Home
      leaves the previously selected project's sidebar visibility unchanged, and
      the reverse.
- [x] 1.4 Render the Home sidebar as a section menu (Home, Tabs, Automations)
      inside the existing sidebar container, resize separator, and narrow-layout
      drawer, with tab-list semantics and keyboard navigation. Mount
      `WorkspaceDashboard` under Tabs unchanged. Verified by
      `npm run typecheck:workspaces`, `npm run lint`, and 1.5.
- [x] 1.5 Add `e2e/home-sidebar.spec.ts` covering:
      - first visit shows the sidebar open on the Home section
      - hidden visibility is remembered across leaving Home
      - the chosen section is remembered
      - Tabs shows the dashboard and a panel row still activates its project
      - the narrow-layout drawer dismisses via Escape
      Verified by passing under `npm run test:e2e`.

## 2. Home overview

- [x] 2.1 Add `src/workspace/homeOverviewModel.ts` deriving:
      - project, tab, and terminal counts
      - agents by Needs you / Working / Done / Idle
      - remote connections and devices
      - active automations with the next run
      - recent runs
      All across attached connections, with unavailable connections marked
      unavailable rather than zero. Verified by a `node --test` suite over
      fixture inventories, including one empty project and an offline connection.
- [x] 2.2 Render the overview widgets with live updates and activation routing
      (project and agent widgets to Tabs, automation widgets to Automations with
      the item selected). Verified by an e2e case that an agent state change
      updates the counts without leaving Home, and that activating a recent run
      opens it in Automations.

## 3. Cron package

- [x] 3.1 Create the `packages/cron` workspace package with a five-field parser,
      next-occurrence iterator in a given zone, plain-words describer, and preset
      builders. Verified by table-driven `node --test` cases:
      - lists, ranges, and steps
      - DOM/DOW OR semantics
      - invalid fields named in the error
      - a never-matching expression refused
      - DST gap skipped and overlap fired once
- [x] 3.2 Register the package with turbo and the workspace boundary rules.
      Verified by `npm run test:boundaries` and `npm run typecheck:workspaces`.

## 4. Server: automation store and protocol

- [x] 4.1 Add `automationService/types.ts` and `repository.ts`
      (`AutomationRepository` over `AutomationBackend`, with the macro envelope:
      `commandId` idempotency, `expectedRevision` conflicts, upsert/remove) and
      trigger/action validation that refuses a subject action on a
      schedule/project/device trigger. Verified by unit tests for revision
      conflicts, idempotent replays, normalisation, and every refused
      combination.
- [x] 4.2 Add `runLog.ts`: a bounded store of 100 runs per automation with the
      16 KiB output tail, suppressed-event counters, and missed-run records.
      Verified by unit tests for eviction order, bound enforcement, and restart
      round trip.
- [x] 4.3 Add file backends `automations.v1.json` and `automation-runs.v1.json`
      (atomic tmp + rename, 0600) in `apps/terminay-server/src/cli.ts` and
      `electron/main.ts`. Verified by a server test that restarts over the data
      root and restores definitions, enabled state, and the log.
- [x] 4.4 Add `automationService/protocol.ts` operations and events (D4) with
      terminal-create scope policy on writes and "run now". Advertise
      `automations.v1` in `packages/protocol` and `capabilities.ts`, and mirror it
      in `packages/client-core/src/automations.ts`. Verified by protocol tests
      that a client without terminal-create authority is refused and that
      events reach subscribers.

## 5. Server: automation terminal space

- [x] 5.1 Add the `automations` project kind to `workspace.ts`. It is created
      lazily and refuses close, rename, reorder, and selection, and it is withheld
      from connections without `automations.v1`. Verified by workspace unit tests
      for each refused command and the withholding.
- [x] 5.2 Filter the reserved kind out of every project projection at the
      `useProjectCollection.ts` choke point and in the inventory, switcher, tab
      bar, and Tabs section. Verified by unit tests on each projection and an
      e2e assertion that no automation-space project appears in the tab bar or
      Tabs.
- [x] 5.3 Add a 50-terminal cap on the automation space, refusing further
      creation with a bounded error. Verified by a unit test at the cap.

## 6. Server: scheduler and triggers

- [x] 6.1 Add `scheduler.ts`: one timer armed to the earliest due time, re-armed
      on edit, enable, disable, remove, fire, and start, with no overlapping
      scheduled runs per automation. Verified by fake-clock tests, including
      "previous run still running" logged as skipped.
- [x] 6.2 Count missed occurrences from persisted `evaluatedThrough` at start,
      and treat timers more than 60 s late as missed. Neither runs anything.
      Verified by fake-clock tests for a 3-hour outage (three missed) and a
      simulated sleep.
- [x] 6.3 Emit typed `project.opened` / `project.closed` journal events from
      `project.create` / `project.close`, and add `onConnectionAdmitted` to
      `remote/transport.ts`, wired in both hosts. Verified by unit tests that each
      fires exactly once per command or admission.
- [x] 6.4 Add `triggers.ts`, which subscribes to agent, activity, attention,
      project, and device sources and fires only on transitions into the named
      state. The first report after start only seeds state, and run terminals are
      dropped. Verified by unit tests for repeated-state suppression,
      restart seeding, run-terminal exclusion, and MCP-spawned automation-space
      terminals still firing.

## 7. Server: execution

- [x] 7.1 Add `executor.ts` run-command:
      - non-interactive shell launch in the automation space
      - configured cwd defaulting to home
      - validated `TERMINAY_*` context variables with no tokens, secrets,
        output, or journal content
      - exit-code outcome and max-duration timeout
      - output tail captured at exit
      - close-on-exit unless "keep terminal after run" is on
      Verified by server tests that run a real command and assert the
      environment, exit code, timeout, tail, and the close/keep behaviour.
- [x] 7.2 Add subject actions: Run Macro through `MacroRunner` with an exact
      target and the automation principal, and write text through
      `terminal.input` with the Eta subset. Revalidate the subject incarnation
      immediately before acting. Verified by tests that a closed or replaced
      subject logs "skipped: subject gone" and writes nothing anywhere.
- [x] 7.3 Add the loop guard (default 60 s, minimum 5 s for subject actions,
      suppressed events counted) and the server-wide limit of 8 runs in progress.
      Verified by unit tests for same-terminal suppression, a different terminal
      firing, and over-limit runs logged as skipped.
- [x] 7.4 Add optional recording via `RecordingService.start` on the run
      terminal, with the recording id linked from the run entry and a failure
      that does not fail the run. Verified by a server test with recording on
      and a forced recording failure.
- [x] 7.5 Add audit entries for every definition change (editing actor) and
      every run (automation principal). Verified by a test reading the audit
      trail after a save and a run.

## 8. MCP workspace scope

- [x] 8.1 Add a `workspace` scope to `ControlCapabilityStore.mint`, chosen at
      the minting site only from the terminal's canonical project kind. Revoke or
      replace the token when a terminal enters or leaves the space. Verified by
      tests that project terminals never receive it and that no caller-supplied
      value changes it.
- [x] 8.2 In `terminalAdapter.ts`, let workspace scope address any session on
      the same server. With workspace scope, `list_terminals` returns a project
      handle and title, and `open_terminal` accepts an optional project handle,
      defaulting to the automation space. Project-scope output is unchanged.
      Verified by adapter tests for both scopes, a cross-server refusal, and
      unchanged project-scope responses.
- [x] 8.3 Confirm no automation operation is reachable through MCP. Verified by
      a capability-listing test asserting the tool surface.

## 9. Automations section UI

- [x] 9.1 Build the Automations list with a server selector when several
      connections are attached. Each row shows name, enabled state, trigger in
      plain words, next run, and last outcome. Verified by an e2e case with one
      server, and a unit test for the multi-server selector model.
- [x] 9.2 Build the editor:
      - name and enabled state
      - trigger picker with schedule presets, a raw cron field with preview of
        the next five runs, and the event list
      - action picker that offers subject actions only for terminal-subject
        events
      - command, profile, cwd, and max duration
      - macro and field values, or text and submit
      - keep terminal, record session, and cooldown
      Verified by e2e cases creating a scheduled and an event automation, and
      the refused-combination message.
- [x] 9.3 Build run history and run detail (outcome, exit code, duration, tail,
      recording link), the automation space's live terminals grouped by run,
      and "run now" with subject selection for subject actions. Verified by an
      e2e case that runs `echo` now and sees the tail after the terminal closes.
- [x] 9.4 Build the missed-run notice on attach: a short explanation, the listed
      automations, run-now and dismiss buttons, cleared across clients. Verified
      by an e2e case that seeds a missed record, runs one entry from the notice,
      and sees it cleared.

## 11. Home band and search

- [x] 11.1 Draw the selected Home control as a tab that opens into a band in
      the neutral Home chrome colour, and add `homeSearchModel.ts` with the
      `HomeSearch` box in that band. Verified by
      `node --test --experimental-strip-types scripts/home-search-model.test.mjs`
      and the Home band case in `e2e/home-sidebar.spec.ts` under
      `npm run test:e2e`.

- [x] 11.2 Keep the main window open on Home when its last project closes, and
      create a project from an empty window in the server's default folder.
      Verified by `packages/server-core/test/workspace-empty-view.test.mjs` and
      the "closing the only project" case in `e2e/project-tabs.spec.ts`.

## 10. End-to-end scenarios and checks

- [x] 10.1 Add `e2e/automations.spec.ts` covering the user's scenarios with
      stubbed commands:
      - Terminal needs attention runs a command that receives the subject
        context
      - Agent finished appends to a temp file
      - a schedule opens a terminal through MCP that lands in the Automations
        section and survives the run
      - Agent needs input writes text to the subject once within the cooldown
      Verified by passing under `npm run test:e2e`.
- [x] 10.2 Run `openspec validate --all`, `npm run lint`,
      `npm run typecheck:workspaces`, `npm run test:workspaces`, and
      `npm run test:boundaries`. Verified by all reporting clean.
- [ ] 10.3 Open the pull request on Gitea with `tea`, then read back every
      commit status on the head SHA and confirm each is `success` or `skipped`
      before calling it green. Verified by the status listing itself.
