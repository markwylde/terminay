## 1. Implementation

- [x] 1.1 Add an end-to-end regression that performs the real pointer-driven
  project tear-off and waits for server reconciliation
- [x] 1.2 Specify one canonical workspace-view binding per native project-host
  window and identity-preserving cross-view movement
- [x] 1.3 Carry the bound canonical view id through Desktop window creation and
  the preload boundary, and verify no generic workspace authority is exposed
- [x] 1.4 Render only the bound view's ordered projects in each native window
- [x] 1.5 Create a destination view and commit `project.move` for a tear-off,
  verifying project, panel, and terminal session ids are preserved
- [x] 1.6 Remove renderer-local project copying, synthetic project ids, and the
  post-transfer `project.close` call from the canonical path
- [x] 1.7 Verify a failed destination creation or move leaves the source project
  usable and strands no empty view
- [x] 1.8 Activate the ready destination window so its first terminal-control
  click is not consumed by window activation
- [x] 1.9 Verify tear-off, cross-window merge, terminal continuity, refresh
  convergence, and existing project-tab workflows through Docker end-to-end
  coverage

## 2. Acceptance

- [x] 2.1 Verify the source native window contains only the source view's
  remaining projects after tear-off
- [x] 2.2 Verify the destination native window contains only the moved project's
  view and never momentarily commits an unrelated project as destination state
- [x] 2.3 Verify the moved project retains its project id, panel ids, terminal
  session ids, and active panel
- [x] 2.4 Verify moving is not reported or executed as project closure and never
  prompts a foreground-process close warning
- [x] 2.5 Verify refreshing either renderer reproduces the same project and view
  split from the server snapshot
- [x] 2.6 Verify the first terminal-tab `+` click in the destination creates the
  next terminal without a second click
- [x] 2.7 Verify a failed move leaves the project in its original view and cleans
  up any unusable destination window or view
