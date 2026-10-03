# Session holder in a packaged application: what has been observed

Evidence for ADR-0035's open item and for task group 1 of
`openspec/changes/terminals-survive-restart`. This file records what was run
and what happened. The macOS in-place update has been observed; nothing here
ran on Linux.

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

6. **The fix in a signed build.** `scripts/packaged-session-holder-macos.test.mjs`
   passes against the signed `5.13.0-beta.36`, the first beta with the fix: a
   shell exists under the holder, and both are still running after the
   application quits.

## An in-place update with a holder running

Run on the same machine against the signed betas. A scratch copy of
`5.13.0-beta.36` was started with `TERMINAY_SESSION_HOLDER=1`, its own data
directory, and `updateChannel: beta`, holding one login shell. The installed
`/Applications/Terminay.app` (`5.13.0-beta.32`) stayed running and untouched;
its updater cache was snapshotted first and restored afterwards, because the
two copies share `~/Library/Caches/com.terminay.app.ShipIt`.

| Step | Observed |
| --- | --- |
| Holder and shell before | holder pid 17747, started from `…/app.asar/dist-electron/sessionHolderEntry.js`; shell pid 17866 (`/bin/zsh -l`), a child of the holder |
| Update | the copy downloaded `5.13.0-beta.37` and staged it for the installer 18 s after launch |
| Quit | the application quit cleanly on `SIGTERM` |
| Install | `ShipIt` moved the new bundle into place and logged `Installation completed successfully` within a second of the quit; the bundle then read `5.13.0-beta.37` |
| Holder after install | alive, same pid |
| Shell after install | alive, same pid |
| Shell while nothing attached | answered `echo after-install-$((40+2))` through the holder, which was by then running from a bundle that had been replaced on disk |
| Relaunch as `5.13.0-beta.37` | one terminal panel, session `default` `running`, the same shell pid, and the `beta.36` holder serving the new version (a second connection was refused as busy) |

So in this run Squirrel.Mac's installer neither waited on nor killed the
session holder: it replaced the bundle under it within a second of the
application quitting, and the holder kept running from files it had already
loaded. A server of a newer build then drove the older holder over protocol
version 1. This is one run on one machine.

Nothing was left running, the scratch data directory was removed, and the
installed application's updater cache was put back as it was found.

## Not observed

- **Restart to update.** The update was installed by quitting, not through the
  title-bar action, which ends in `quitAndInstall` and relaunches the
  application itself.
- **A terminal with something running in the foreground** across the update;
  the held shell was idle at its prompt.
- **macOS privacy permissions** for a shell whose launching application has
  exited.
- **Linux:** an AppImage whose mount is released when the main process exits,
  and a standalone archive under a real systemd.
