## Why

Users who always pair from a phone or another machine have to open the connections menu and select **Expose this server…** every time Terminay Desktop starts. The standalone server already has a standing decision for this (`--expose`); Desktop does not.

## What Changes

- Add a server setting, `remoteAccess.exposeOnStartup`, shown in Settings → Remote exposure as **Automatically expose server on startup**. It defaults to off.
- When it is on, Desktop exposes the embedded server once startup has handed off to the workspace UI, through the same path as **Expose this server…**.
- Stopping exposure from the connections menu still works and lasts for the session; the setting only decides what happens at the next launch.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `remote-access`: the embedded server's startup setting joins **Expose this server…** and `--expose` as a way the administrator enables exposure.

## Impact

- `src/types/settings.ts`, `src/terminalSettings.ts`, `packages/server-core/src/settings/defaults.ts`: new boolean in `remoteAccess`, normalized and shown as a Settings field.
- `electron/remote/exposeOnStartup.ts` (new) and `electron/main.ts`: after the UI handoff, call `DesktopServerOwnedExposure.toggle()` when the setting is on and exposure is not already running.
- `scripts/expose-on-startup.test.mjs` (new) and `package.json`: unit test, added to `smoke`.
- No protocol, security-boundary or pairing changes. Exposure still requires host approval for new devices.
