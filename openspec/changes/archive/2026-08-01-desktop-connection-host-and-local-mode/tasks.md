## 1. Native host shell

- [x] 1.1 Build the minimal Desktop shell/header owning current connection, window/view mapping, global connection menu, and native status, verified by `apps/terminay-desktop/test/shell-header.test.mjs` proving the projection is immutable and carries only sanitized metadata, opaque ids, menu capabilities, and bounded lifecycle status.
- [x] 1.2 Render the selected server bundle in a sandboxed WebContentsView with context isolation and Node disabled, verified by `e2e/server-ui-sandbox.spec.ts` and `scripts/task20-desktop-security-audit.test.mjs`.
- [x] 1.3 Bind server-bundle loading to the authenticated current connection and verify same-origin final URLs and rejection of stale or oversized responses before rendering.
- [x] 1.4 Define a narrow versioned host bridge for window/view open/focus/close, menu commands, clipboard, approved file dialogs, external links, reveal, and update status, verified by `apps/terminay-desktop/test/host-bridge.test.mjs`.
- [x] 1.5 Validate source, target, payload, current connection, and user gesture for every bridge action, verified by the host-bridge and trusted-sender suites.
- [x] 1.6 Block arbitrary navigation, new windows, permission requests, downloads, and protocol handlers unless explicitly allowed, verified by the sandbox audit suite.

## 2. Local startup

- [x] 2.1 Start the embedded server before the default workspace and create the immutable built-in **Local** profile from its stable identity, verified by Desktop startup coverage.
- [x] 2.2 Bind the first native window to Local and show Local in the header instead of **Remote**, verified by the shell-header projection tests.
- [x] 2.3 Handle starting, ready, migrating, failed, crashed, restarting, and stopped server states without showing a false connected workspace, verified by lifecycle coverage.
- [x] 2.4 Ensure Local works without internet, hosted signaling, or WebRTC, verified by the offline Desktop launch acceptance check.

## 3. Connection profile store

- [x] 3.1 Define profile metadata separately from device and reconnect credentials, verified by the profile store tests.
- [x] 3.2 Store credentials using OS-backed secure storage when available with explicit degraded behaviour otherwise, verified by `electron-host-ownership.test.mjs` keeping credential storage behind the privileged host adapter.
- [x] 3.3 Record server fingerprint/identity and detect unexpected identity changes at a remembered origin, verified by identity-change coverage.
- [x] 3.4 Persist native window geometry and `(connection, workspaceView)` mapping without treating it as server workspace state, verified by the host-local registry tests.
- [x] 3.5 Implement add/import, rename, archive/forget, and diagnostics APIs for the shared menu, verified by connection menu coverage.

## 4. Native windows and logical views

- [x] 4.1 Bind each native window to exactly one server connection, verified by `scripts/task7-remote-connection-e2e.spec.ts`, which launches a real standalone server, pastes its pairing URL into the Desktop connection menu, proves the modal returns without an IPC/MessagePort deadlock, and requires the same native window to project `Remote · task7-remote-authority` rather than retaining Local authority.
- [x] 4.2 Focus an existing suitable window or open a new one when selecting a profile, and make current-window rebinding explicit, verified by window-binding coverage.
- [x] 4.3 Map server workspace views to native windows without making `BrowserWindow.id` canonical, verified by the host-local registry tests.
- [x] 4.4 Preserve project popout/adoption UX through server view commands, verified by `apps/terminay-desktop/test/workspace-adoption.test.mjs` proving popout preserves panel/session identity, opens exactly one native binding, and rolls back both the native binding and the empty created view when `project.move` is rejected.
- [x] 4.5 Route explicit logical-view closure through authenticated `view.close` and detach only matching host bindings after server acceptance, verified by rejected-command coverage preserving the native presentation.
- [x] 4.6 Ensure closing a window only detaches that client/view unless the user explicitly deletes the logical view or closes terminals, verified by view lifecycle coverage.

## 5. Electron reduction: renderer boundary

- [x] 5.1 Replace renderer feature calls to the broad preload API with `TerminayClient` or the narrow native bridge, verified by `apps/terminay-desktop/test/renderer-preload-boundary.test.mjs` rejecting Electron/IPC, Desktop main/preload imports, and broad `window.terminay` access.
- [x] 5.2 Move the current-server connection picker to `terminayConnectionHost.open(url)` with main-process validation of an exact `{ version: 1, url }` request from the trusted top-level frame, and remove the retired `app:open-remote-connection` handler and preload method, verified by `scripts/connection-menu-renderer.test.mjs`.
- [x] 5.3 Derive shared responsive route capabilities from the narrow `terminayHost` preload bridge instead of hardcoding Desktop-native capabilities, verified by `scripts/shared-responsive-entry.test.mjs` proving the shared boundary does not fabricate `nativeWindows`.
- [x] 5.4 Move connected FilePanel metadata and read-only content reads through the authenticated `FileViewerClient`, canonicalizing Desktop absolute paths to project-relative server paths and rejecting outside-project paths, verified by `scripts/file-viewer-shared-client.test.mjs`.
- [x] 5.5 Remove the renderer's remaining profile/window compatibility import, verified by `apps/terminay-desktop/test/profile-window-commands.test.mjs` proving the facade cannot select another profile or dispatch unsnapshotted input.

## 6. Electron reduction: application service IPC removal

- [x] 6.1 Remove the renderer MessagePort/IPC compatibility client, verified by `compatibility-lifecycle.test.mjs` and `ipc-compatibility-removal.test.mjs`.
- [x] 6.2 Project only `version`, `getContext`, and `requestAction` into a main-frame server bundle, verified by `host-bridge.test.mjs` proving the exact exposed shape, delegated calls, and subframe denial.
- [x] 6.3 Remove the legacy `agent-status:*` handlers, preload methods, and snapshot event in favour of the authenticated `AgentStatusClient`, verified by `ipc-compatibility-removal.test.mjs`, `packages/client-core/test/agent-status.test.mjs`, and `e2e/agent-status-sidebar.spec.ts`.
- [x] 6.4 Remove renderer project-root registration IPC so the server validates and registers each project root before its first server-owned terminal, verified by `ipc-compatibility-removal.test.mjs` and `scripts/folder-tasks-server-client.test.mjs`.
- [x] 6.5 Remove the production `terminal:create` IPC handler and preload capability, keeping packaged PTY integrity tests on a `TERMINAY_TEST`-only harness capability, verified by `ipc-compatibility-removal.test.mjs`.
- [x] 6.6 Move native update-status reads to `terminayUpdateHost.getStatus(force)`, verified by `scripts/update-host-bridge.test.mjs`.
- [x] 6.7 Remove the unused `app:quit` handler and preload method, verified by `ipc-compatibility-removal.test.mjs`.
- [x] 6.8 Move terminal presentation metadata publication and zoom reads to `terminayTerminalPresentationHost`, verified by `scripts/terminal-presentation-host-bridge.test.mjs`.
- [x] 6.9 Move local MCP installation to `terminayMcpInstallHost.{getStatus,install,uninstall}`, verified by `scripts/mcp-install-host-bridge.test.mjs` and `scripts/trusted-ipc-sender.test.mjs`.
- [x] 6.10 Move Desktop home-path bootstrap to `terminayFileExplorerHost.getHomePath()`, verified by `scripts/file-explorer-host-bridge.test.mjs`.
- [x] 6.11 Move native project-edit window opening to `terminayProjectEditHost.open(draft)`, verified by `scripts/project-edit-host-bridge.test.mjs`.
- [x] 6.12 Move terminal inactivity waiting to `terminayTerminalLifecycleHost.waitForInactivity(sessionId, durationMs)`, verified by `scripts/terminal-lifecycle-host-bridge.test.mjs`.
- [x] 6.13 Move final-project window closing to `terminayWindowLifecycleHost.closeCurrent()`, verified by `scripts/window-lifecycle-host-bridge.test.mjs`.
- [x] 6.14 Move project-tab bar geometry publication and drag lifecycle commands to `terminayProjectTabHost`, verified by `scripts/project-tab-host-bridge.test.mjs`.
- [x] 6.15 Remove the unused broad Git-panel status compatibility IPC, verified by `scripts/git-panel-status-ipc-removal.test.mjs`.
- [x] 6.16 Move project adoption, popout, and merge to the frozen versioned `terminayWorkspaceTransferHost`, verified by `scripts/workspace-transfer-host-bridge.test.mjs`.
- [x] 6.17 Move native app-command subscription to `terminayAppCommandHost.subscribe(listener)` forwarding only the closed native command union, verified by `scripts/app-command-host-bridge.test.mjs`.
- [x] 6.18 Move legacy terminal-recording lifecycle/data compatibility to the frozen `terminayRecordingServiceHost`, verified by `scripts/recording-service-host-bridge.test.mjs`.

## 7. Retained Electron ownership

- [x] 7.1 Keep updater, menus, app lifecycle, OS integration, local credential storage, and server supervision in Electron, verified by `electron-host-ownership.test.mjs` keeping Local supervision independent of renderer lifetime and credential storage behind the privileged host adapter.
- [x] 7.2 Restrict server-bundle native menu requests to the exact command ids advertised by the current host presentation and require both `nativeWindows` and `osIntegration` capabilities, verified by `host-bridge.test.mjs` covering allowed, unadvertised, and unavailable menu states.
- [x] 7.3 Move update-link and terminal hyperlink activation to `terminayExternalHost.open(url)` behind the existing modifier-click/duplicate-suppression gate, and remove the `shell:open-external` route and `window.terminay.openExternal`, verified by `scripts/external-host-bridge.test.mjs`.
- [x] 7.4 Move terminal copy/paste and all remaining workspace, Git, and folder copy actions to `terminayClipboardHost.readText/writeText` and remove `clipboard:smart-paste` and `clipboard:write-text`, verified by `scripts/terminal-clipboard-host-bridge.test.mjs`.
- [x] 7.5 Move production **Reveal in OS** actions to `terminayRevealHost.reveal(filePath)` with Electron retaining sole `shell.showItemInFolder` authority, verified by `scripts/reveal-host-bridge.test.mjs`.
- [x] 7.6 Move opening the native recordings window to `terminayRecordingsHost.open()`, verified by `scripts/recordings-host-bridge.test.mjs`.
- [x] 7.7 Move native settings-window opening to `terminaySettingsWindowHost.open(sectionId?)`, verified by `scripts/settings-window-host-bridge.test.mjs`.

## 8. Boundary enforcement

- [x] 8.1 Add an import-boundary test preventing application services from drifting back into the Desktop host, verified by the package-wide renderer and host ownership boundary suites.
