## Why

Users cannot hand a local folder to Terminay from macOS or a launcher and reliably get a terminal in that folder. Terminay currently advertises no folder-opening document handler, ignores startup folder arguments, and only focuses a window on a second launch.

## What Changes

- Advertise native macOS folder opening through Launch Services without taking over the user's default associations.
- Accept folder opens from macOS, positional launch arguments, and an explicit `--working-directory` option, including cold and already-running launches.
- Open a fresh terminal in the requested local folder, select its project, and bring the local workspace forward without changing running terminals or routing local paths to remote servers.
- Preserve spaces and special characters literally; resolve relative arguments against the launching process's working directory; report invalid requests.
- Document the supported launch contract and verify packaged metadata and end-to-end folder handling.
- Third-party app lists, automatic default-association changes, arbitrary command execution, SSH/telnet handlers, and native Services are outside this folder-opening change.

## Capabilities

### New Capabilities

- `macos-terminal-integration`: macOS folder association and local folder-launch contract, argument parsing, lifecycle delivery, and failure behavior.

### Modified Capabilities

None. Existing project and shell-profile authority applies unchanged.

## Impact

`electron-builder.json5`, Electron startup and single-instance handling, local server project/terminal creation, focused local workspace presentation, launch documentation, unit and Docker-isolated E2E tests. No CodexBar changes or new remote authority.
