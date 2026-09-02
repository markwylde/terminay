## Context

See proposal.md. This change depends on the standalone and embedded server runtime work; the
embedded server must have a stable identity before Local can be an ordinary built-in profile.

## Goals / Non-Goals

Goals: Electron becomes a native host and supervisor rather than the application server; Local
is an ordinary built-in connection from the shared UI's perspective; server-provided code has
no ambient machine privilege.

Non-Goals: changing the application protocol, or moving updater, menus, app lifecycle, OS
integration, local credential storage, or server supervision out of Electron.

## Decisions

- **Narrow versioned bridges instead of one broad preload.** Every remaining native capability
  is a separate frozen versioned object (`terminayHost`, `terminayConnectionHost`,
  `terminayUpdateHost`, `terminayExternalHost`, `terminayRevealHost`, `terminayClipboardHost`,
  `terminayTerminalPresentationHost`, `terminayTerminalLifecycleHost`, `terminayProjectTabHost`,
  `terminayWorkspaceTransferHost`, `terminayAppCommandHost`, `terminayRecordingServiceHost`,
  `terminayRecordingsHost`, `terminaySettingsWindowHost`, `terminayProjectEditHost`,
  `terminayWindowLifecycleHost`, `terminayMcpInstallHost`, `terminayFileExplorerHost`). Electron
  validates the trusted sender, an exact versioned envelope, and bounded fields before acting.
- **The preload projects only the API shape, not its implementation object.** For the main-frame
  server bundle the preload copies exactly `version`, `getContext`, and `requestAction`, so a
  future preload helper cannot become ambient renderer authority. Subframes are denied.
- **The native shell, not the server bundle, is the authority for menu commands.** Native menu
  requests are restricted to the exact command ids advertised by the current host presentation
  and require both the `nativeWindows` and `osIntegration` host capabilities, so a presentation
  advertisement cannot restore OS integration after the host withdraws it.
- **The shell header model is a projection, not workspace state.** `createDesktopShellHeaderModel`
  is immutable and contains only sanitized profile metadata, opaque window/view ids, menu
  capabilities, and bounded native lifecycle status.
- **Logical views are server-owned.** Popout creates a server-owned view through `view.create`,
  moves the project through authenticated `project.move`, and stores only the native
  window/view presentation in a host-local registry. A rejected move rolls back both the native
  binding and the empty created view. Closure goes through `view.close` and detaches only
  matching host bindings after server acceptance; rejected commands preserve the native
  presentation.
- **Window ids are not canonical.** `(connection, workspaceView)` mapping and native window
  geometry are host-local presentation, never server workspace state.
- **Removal over deprecation.** Retired routes and preload methods are deleted in the same
  change as their replacement, with absence tests. The current bundle ships with its matching
  preload, so no legacy renderer needs the ambient capability. A dead route with no production
  caller (`fs:get-git-panel-status`) was deleted rather than preserved.

## Risks / Trade-offs

- Deleting broad IPC in the same change as the narrow replacement means an older renderer cannot
  run against a newer host. This is accepted because the server ships the bundle with its
  matching preload.
- A few boundaries stayed as explicit compatibility seams: `FilePanel` save, watch, and Git paths
  remain compatibility boundaries until their server operations are composed, while metadata and
  read-only content reads already go through the authenticated `FileViewerClient` with Desktop
  absolute paths canonicalized to project-relative server paths and outside-project paths rejected.
- Packaged PTY integrity tests need a terminal-creation capability the production preload must not
  have; this is handled with a separate `TERMINAY_TEST`-only harness capability.

## Migration Plan

The embedded server starts before the default workspace, so the first native window binds to
Local rather than showing **Remote**. Starting, ready, migrating, failed, crashed, restarting,
and stopped server states are all handled without showing a false connected workspace, and Local
works with no internet, hosted signaling, or WebRTC.
