## Context

Desktop exposure is driven by `DesktopServerOwnedExposure.toggle()` in `electron/main.ts`, reached today only from **Expose this server…**. The non-secret remote-access configuration (`remoteAccess`) is server-classified and read in main through `readEmbeddedRemoteAccessSettings()`.

## Goals / Non-Goals

**Goals:**
- One opt-in setting that exposes the embedded server when Desktop starts.
- Startup never waits on hosted signaling.

**Non-Goals:**
- Remembering the last manual exposure state across launches.
- Changing standalone `--expose` behaviour.

## Decisions

- **Store it in `remoteAccess`.** It sits beside the other exposure configuration, is server-classified like them, and appears in the existing Remote exposure settings section.
- **Expose after `ui-handoff`, fire-and-forget.** Registering with hosted signaling is a network round-trip; running it after the workspace window is live keeps startup time unchanged. Errors land in remote-access status, the same place a manual toggle reports them.
- **Reuse `toggle()` guarded by `isRunning`.** No second code path to expose, so approval policy, host-key checks and runtime-availability checks are identical to the manual action.

## Risks / Trade-offs

- An exposed server is reachable for pairing without a fresh click each launch → mitigated by default off, and new devices still need host approval with a match code.
