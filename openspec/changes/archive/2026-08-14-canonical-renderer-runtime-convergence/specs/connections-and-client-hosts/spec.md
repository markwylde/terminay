## ADDED Requirements

### Requirement: Development and packaged Desktop parity
Development Local, packaged Local, signed Local, Desktop remote, direct
browser, and browser-manager sessions SHALL launch the same generated server
workspace entry and its matching application client. Environment and build-mode
values MAY select asset locations and diagnostics only; they MUST NOT select a
different renderer entry, preload, connection facade, state owner, or route
tree. The production graph SHALL contain exactly one full workspace entry, no
broad workspace preload, no renderer-owned workspace seed, and no feature-aware
Desktop application transport adapter.

#### Scenario: Same bundle in development and packaged builds
- **WHEN** a development run and the packaged application start from equivalent
  canonical server repositories
- **THEN** both report the same generated Local bundle id and the same
  workspace entry, host bridge, byte endpoint, repository hydration, and
  feature tree

#### Scenario: Second workspace entry is rejected
- **WHEN** a second full workspace entry, broad preload, renderer-owned
  workspace seed, or feature-aware Desktop transport adapter is introduced
- **THEN** the production-graph gate fails the build

### Requirement: Application menu per host
Menu presentation SHALL be driven solely by the negotiated native-menu host
capability. A Desktop host SHALL use the native application menu, and the
server bundle SHALL render no browser menu bar inside it in any mode. A browser
host SHALL render the in-page File, Edit, View, and Help menu with equivalent
commands and no Desktop-only window, update, or developer-tools commands. The
native macOS title-bar and traffic-light inset SHALL be reserved before project
tabs and controls are placed.

#### Scenario: One menu on Desktop
- **WHEN** the workspace is open on macOS Desktop in development, packaged,
  Local, remote, reloaded, or an auxiliary route
- **THEN** there is one native File/Edit/View/Help menu and no in-page
  application menu

#### Scenario: No chrome overlap
- **WHEN** the macOS window renders project tabs and controls
- **THEN** no shared control overlaps the traffic lights or title bar

### Requirement: Startup failure recovery
Bootstrap and teardown failures SHALL be converted into bounded diagnostics and
recovery UI. A direct-browser bootstrap failure SHALL be typed and visible and
SHALL identify each missing required capability or failed bootstrap step. An
incompatible, reduced, or spoofed user agent MUST NOT produce a blank document,
an uncaught main-process dialog, or a top-level uncaught throw.

#### Scenario: Missing browser capability
- **WHEN** a browser genuinely lacks a required capability
- **THEN** a typed visible failure names the missing capability and the page
  does not render blank

#### Scenario: Failed bundle launch
- **WHEN** a bundle launch fails on Desktop
- **THEN** bounded diagnostics and recovery UI are shown instead of an uncaught
  main-process dialog or blank window

### Requirement: Native window reload preserves binding
Window close, reload, server switch, application quit, failed bundle launch,
and superseded transport teardown SHALL be idempotent and exception-free. Every
required host handle SHALL be captured before destruction callbacks are
registered, and no destroyed host object may be dereferenced. Server, project,
and session lifetime SHALL be independent of a renderer document, while
document-scoped ports, subscriptions, downloads, and host bindings SHALL be
released exactly once.

#### Scenario: Clean close
- **WHEN** a window is closed, reloaded, switched to another server, or the
  application quits
- **THEN** no main-process exception, destroyed-object dereference, unexpected
  dialog, renderer crash, or unresolved listener occurs

#### Scenario: Reload does not kill a live PTY
- **WHEN** a client document reloads
- **THEN** the live PTY continues with the same identity and the document's
  scoped resources are released once
