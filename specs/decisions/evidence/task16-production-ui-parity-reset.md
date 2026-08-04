# Task 16 production UI parity reset

## Governing requirements

The completion standard is component reuse, not merely matching route names,
protocol operations, responsive overflow constraints, or renderer-neutral
models:

- `specs/tasks/16-shared-responsive-server-ui.md`, Goal: “one complete
  responsive workspace UI” driven through `TerminayClient`.
- `specs/tasks/16-shared-responsive-server-ui.md`, Acceptance checks: “There is
  one production workspace UI implementation” and “Desktop native routes use
  the same components as web routes.”
- `specs/tasks/16-shared-responsive-server-ui.md`, Definition of done:
  “Desktop and browser are hosts for the same complete responsive
  server-bundled workspace.”
- `specs/features/connections-and-client-hosts.md`, Responsive workspace
  behaviour: Desktop and web render the same projects, panels, files,
  terminals, settings, recordings, agents, and connection state; wide layouts
  resemble the Electron workspace; settings, recordings, and edit surfaces use
  shared routes/components.
- `specs/decisions/evidence/task16-feature-parity-matrix.md`, Completion rule:
  the feature body must be rendered by shared code rather than separate
  Desktop/web copies.

## Contradicting production evidence

The supplied Electron and web screenshots did not show the same workspace
composition. The Electron reference showed the established full workspace
chrome and feature layout; the web reference showed the separate browser-host
shell/connect presentation. At the reset point this was consistent with the
production source:

- `src/shared/ResponsiveWorkspaceEntry.tsx` explicitly says its feature body is
  still supplied by `legacyFallback`.
- Electron supplies the existing `src/App.tsx` workspace through that fallback.
- `src/web/main.tsx` instead renders `ServerWorkspaceSurface` after connection
  and a separate `browser-host-*` component tree while disconnected.
- The prior Task 16 evidence itself says Desktop and browser supply different
  bodies through `WorkspaceContentFrame` and calls that an “extraction seam,
  not a claim that the two bodies have full feature parity yet.”

Therefore route markers, shared shell models, isolated panel contracts,
protocol workflows, and no-overflow screenshots cannot support a 52/52
production parity claim. Task 16 remains active until Electron and web render
the same extracted production feature tree, with host capabilities limited to
native presentation/affordances. Task 19 wide-web and mobile-web cells remain
partial until that proof exists.

`scripts/task16-production-ui-parity-gate.test.mjs` enforces this state
mechanically. The authenticated web cutover now reaches the exact
`ConnectedRendererWorkspace -> App` production identity also used by Electron,
and the old `ServerWorkspaceSurface` is absent from the connected web entry.
The Task 16/19 gates nevertheless stay unchecked and every wide/mobile web
matrix cell stays `partial` until positive real-host visual/interaction
evidence proves the supplied reference parity rather than only module identity.

## Fresh post-cutover result

Fresh `build:app` and `build:web` outputs pass the canonical module-identity
gate, but the paired production acceptance run still fails. The first run
exposed an unguarded browser-absent remote-access capability and a blank,
unmounted App. After that capability was made optional, Electron and web report
the same canonical App identity, workspace revision `3`, project `project-1`,
panel kind, and terminal session `shared-app-acceptance:session:1`. The pixel
comparison then exposed a missing web height chain: Electron rendered the
Terminal 1 Dockview tab and terminal surface while web rendered an empty dark
workspace. After the height fix, both artifacts visibly align and their
semantic/layout state matches, but the strict byte comparator still fails:
1,022,374 of 1,024,000 pixels differ (99.84%). Electron 42.7.1 and Playwright
Chromium 151 rasterize/color-encode even matching flat surfaces differently,
and the isolated server labels contain different ephemeral ports (`:54220`
versus `:54222`). The strict comparator has not been relaxed, so this result is
not recorded as passing visual evidence and the completion gates remain open.
Artifacts are retained under
`test-results/shared-app-production-pari-e54a5-ntical-App-state-and-pixels/`.
This is positive evidence that the current cutover is not acceptance-complete,
so all six checklist gates and the 26 partial web cells remain unchanged.
