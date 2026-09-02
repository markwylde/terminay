## 1. Canonical model

- [x] 1.1 Add a bounded, validated sidebar model to the canonical workspace
  project schema and migrate existing workspace snapshots to project-local
  defaults, verified by reducer migration and persistence tests
- [x] 1.2 Add an authenticated, project-scoped workspace command and client
  facade for sidebar patches that publishes the normal workspace change event and
  retains the project/window and terminal-session security boundaries, verified
  by protocol authorization tests

## 2. Renderer

- [x] 2.1 Hydrate renderer projects from the persisted model and commit
  visibility, pane collapse state, dimensions, order, and supported Agents and
  Documentation navigation state through that command, verified by renderer
  normalization tests
- [x] 2.2 Retain Settings sidebar values only as defaults for newly created
  projects so that interacting with one project's sidebar rewrites neither those
  defaults nor another project's persisted state, verified by a two-project
  independence test

## 3. Verification

- [x] 3.1 Cover reducer migration and persistence, protocol authorization,
  renderer normalization, and restart/hydration independence between two
  projects, verified by the focused suites
- [x] 3.2 Preserve the packaged-app smoke contract when a first renderer reload
  durably commits the one-time v4 workspace migration, verified by the packaged
  macOS smoke
- [x] 3.3 Verify a project sidebar returns exactly as it was after a Terminay
  restart or a renderer reconnect
- [x] 3.4 Verify changing Explorer, Agents, Git, or Documentation in one project
  leaves a second project's visibility, order, dimensions, collapse state, and
  supported navigation state unchanged
- [x] 3.5 Verify legacy workspace snapshots acquire valid project-local sidebar
  state without altering project identity, environment binding, panels, or layout
- [x] 3.6 Verify invalid sidebar patches and cross-project commands are rejected
  without changing the workspace revision
- [x] 3.7 Run the focused tests followed by `npm run test:e2e` in Docker, and the
  full pull-request workflow
