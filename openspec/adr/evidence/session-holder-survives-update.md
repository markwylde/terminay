# Session holder in a packaged application: what has been observed

Evidence for ADR-0035's open item and for task group 1 of
`openspec/changes/terminals-survive-restart`. This file records what was run
and what happened. It is incomplete: the in-place update itself has not been
observed, and nothing here ran on Linux.

## Environment

- macOS 27.0.1, arm64.
- `terminay-desktop-main-mac.zip` from the rolling `main-latest` prerelease,
  version `5.13.0-beta.34`, signed (`TeamIdentifier=P3J23J5CWT`), unpacked with
  `ditto` to a scratch directory. No quarantine attribute.
- Launched as `Terminay.app/Contents/MacOS/Terminay` with
  `TERMINAY_SESSION_HOLDER=1` and `TERMINAY_USER_DATA_DIR` pointing at a fresh
  directory, beside an installed `/Applications/Terminay.app` (`5.13.0-beta.32`)
  that was left running and untouched.

## Observed

1. **The packaged holder starts.** The application launched a second process of
   its own binary running
   `…/Contents/Resources/app.asar.unpacked/dist-electron/sessionHolderEntry.js`,
   with a record and socket in `<userData>/session-holder/`. The socket path was
   91 bytes under `~/Library/Application Support/Terminay Spike`.

2. **Every spawn in it failed.** The holder had no shell child. The application
   logged `[terminay-terminal-spawn] Error: posix_spawnp failed.` followed by
   `Desktop bootstrap failed … spawn_failed`, and the seeded session was
   persisted as `interrupted`. With the switch on, `5.13.0-beta.34` does not
   start a usable workspace.

3. **Cause.** `node-pty` computes its spawn helper as
   `helperPath.replace('app.asar', 'app.asar.unpacked')`
   (`lib/unixTerminal.js`). The holder entry was addressed in
   `app.asar.unpacked`, so `node-pty` was resolved from the unpacked tree, its
   path already contained the replacement, and the helper path became
   `app.asar.unpacked.unpacked/…/spawn-helper`. The helper itself was present
   and executable.

4. **Fix, checked against the same signed build.** Running the beta's binary
   with `ELECTRON_RUN_AS_NODE=1` and the holder environment by hand:

   | Holder entry addressed as | Result |
   | --- | --- |
   | `app.asar.unpacked/dist-electron/sessionHolderEntry.js` | `spawn failed: posix_spawnp failed.` |
   | `app.asar/dist-electron/sessionHolderEntry.js` | shell started and answered `echo holder-$((6*7))` |

   The application now addresses the entry through `app.asar`.

5. **Guard.** `scripts/packaged-session-holder-macos.test.mjs` launches the
   packaged application with the switch on and asserts a shell exists under the
   holder, then that both outlive a quit. It fails against the signed
   `5.13.0-beta.34` (about 7 s, on the spawn error) and passes against an
   unsigned `electron-builder --dir` build that includes the fix. In that build
   the holder and its shell were still running after the application received
   `SIGTERM` and exited.

## Not observed

- **An in-place update.** Whether Squirrel.Mac's installer waits on or kills a
  holder, and whether a shell held from the replaced bundle stays interactive,
  is still unknown. It was not attempted here because a second copy of the
  application shares its bundle identifier, and therefore
  `~/Library/Caches/com.terminay.app.ShipIt`, with the installed one, which had
  a downloaded update pending. The scratch copy ran only on the stable channel
  of a fresh profile, where `5.12.0 < 5.13.0-beta.34` and downgrades are
  disabled, so it downloaded nothing.
- **A signed build with the fix.** The passing run was an unsigned local build.
- **macOS privacy permissions** for a shell whose launching application has
  exited.
- **Linux:** an AppImage whose mount is released when the main process exits,
  and a standalone archive under a real systemd.
