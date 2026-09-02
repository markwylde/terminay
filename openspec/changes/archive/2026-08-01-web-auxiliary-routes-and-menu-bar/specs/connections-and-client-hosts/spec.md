## ADDED Requirements

### Requirement: Canonical auxiliary route presentation
Settings, Macros, Recordings, and tab-editing routes SHALL be requested through
one host-neutral auxiliary-route controller owned by the shared renderer.
Presentation SHALL be selected by declared host capability: a host that
declares native auxiliary windows opens its native window or modal, and a host
that does not renders the same shared route body in-page. Shared workspace
actions MUST NOT call a host-specific auxiliary bridge directly.

#### Scenario: Desktop delegates to native windows
- **WHEN** the host declares the native-windows capability and a Settings,
  Macros, Recordings, or edit-tab route is requested
- **THEN** the existing native auxiliary window or modal opens with its
  singleton and modal behaviour preserved

#### Scenario: Browser renders in-page
- **WHEN** the host does not declare the native-windows capability and the same
  route is requested
- **THEN** the shared route body is rendered in-page with close, Escape and
  backdrop dismissal where appropriate, focus return to the invoking element,
  and route-specific save and cancel

#### Scenario: Tab editing without native windows
- **WHEN** a project tab or terminal tab is double-clicked in a browser host
- **THEN** the edit route opens in-page and its result is persisted through the
  selected server's client rather than an Electron modal result channel

### Requirement: Application menu per host
A host that provides a native application menu SHALL use it. A host without one
SHALL render an in-page File, Edit, View, and Help menu bar offering equivalent
safe commands and no host-only window, update, or developer commands. Menu
keyboard interaction SHALL follow accessible menubar behaviour.

#### Scenario: Browser menu contents
- **WHEN** the connected browser workspace is rendered
- **THEN** File offers New Terminal, New Project, Save, Settings, Macros,
  Recordings, and Close Terminal where the active workspace target exists; Edit
  offers browser-safe undo, redo, cut, copy, paste, and select-all; View offers
  Set Project Root to Working Directory and Toggle File Explorer Sidebar; and
  Help offers safe external, documentation, and about actions

#### Scenario: No unsafe browser entries
- **WHEN** the browser menu is inspected
- **THEN** it contains no zoom, developer-tools, or window-management entries
  and passes no secrets, local paths, terminal output, or pairing fragments to
  another origin

#### Scenario: Accessible menubar keyboard behaviour
- **WHEN** the browser menu bar has focus
- **THEN** arrow keys move between entries, Home and End jump to the first and
  last, Escape closes the open menu, Enter or Space activates, focus returns to
  the invoking control, and no focus trap remains once closed
