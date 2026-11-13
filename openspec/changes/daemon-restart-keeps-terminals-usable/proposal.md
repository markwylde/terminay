## Why

On a daemon host, `sudo systemctl restart terminay-server` broke every terminal.
Shells that survived the restart, and every terminal opened afterwards, failed
anything that touched `/tmp`: `claude` exited with
`ENOENT: no such file or directory, mkdir '/tmp/claude-999'`. Closing the tab,
opening a new one, and reconnecting all left the problem in place. The only way
out was to SIGKILL the service's whole control group from a shell, which ended
every session. The user saw nothing that explained what had happened.

The cause is a contradiction in the unit Terminay writes. `KillMode=process`
keeps the session holder and its shells alive across a stop, and
`PrivateTmp=true` gives each run of the service a private `/tmp` that systemd
deletes on stop. The surviving holder keeps that deleted `/tmp`. The next server
reuses the holder because its build matches, so every new shell inherits the
same broken `/tmp`. The spike that approved the holder under systemd checked
that the shell process was still alive, not that it still worked.

## What Changes

- **Server scratch files are hardened before `/tmp` is shared.** On macOS and
  Linux, clipboard images, dropped files, and window-message attachments move
  from fixed, shared names under the temporary directory to an owner-only
  per-account directory. The server verifies that directory before every use
  and writes files exclusively, owner-only, and never through a symlink. Today,
  `terminay-clipboard` is created with default permissions and written through
  whatever already exists at that path. Windows already uses the user's own
  `%TEMP%`.
- **The unit's `PrivateTmp` follows the release.** A release whose manifest
  declares it safe for a shared `/tmp` runs without `PrivateTmp`; any older
  release runs with it. `daemon upgrade` changes the unit only between stop and
  start, and restores its exact bytes on rollback. A downgrade to an unsafe
  release puts `PrivateTmp` back.
- **Installed units are repaired even when an older CLI does the upgrade.**
  `daemon upgrade` checks the unit before it resolves any release, so it
  repairs the unit even offline, on a source install, or when already current.
  A standalone server that finds itself under a systemd private `/tmp` waits
  for any running upgrade-helper run to finish, then asks the helper for the
  repair. The helper runs the CLI that has just been installed. A user-scope
  install reports it in `daemon status` and the server diagnostics.
- **Only a holder known to be healthy receives new terminals.** On every
  attach, the server checks each surviving holder: same mount namespace, and a
  writable `/tmp` and `TMPDIR` from the holder's view. A holder that fails, or
  that cannot be checked, keeps its live sessions but is drained, so new
  terminals go to a holder this server launches itself.
- **A damaged session is never silent.** When a surviving shell's `/tmp` or
  `TMPDIR` is missing or unwritable, but the server's is fine, its panel shows a
  banner: "This terminal's temporary directory is no longer usable. New
  terminals are not affected." Input is not blocked, and the health check never
  ends a session.
- A CI job runs under real systemd. On fresh data roots it proves that a
  surviving shell and a new shell can `mkdir` in the literal `/tmp` across
  several restarts. It reproduces this incident by starting from a pinned
  pre-change release that is switched the way the older upgrader does it, and
  proves self-repair. It also covers offline repair and rollback.

Out of scope, as a follow-up change: a **Restart terminal** action that
replaces a damaged session in place. Closing the panel and opening a new
terminal recovers in the meantime.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `daemon-cli`: the unit's `PrivateTmp` follows the active release and is
  changed transactionally. Upgrade repairs the unit before resolving any
  release, and a running server requests the repair itself.
- `persistent-terminal-sessions` (from the active change
  `terminals-survive-restart`): new sessions go only to a holder that has
  passed the health check; failed or uncheckable holders are drained; damaged
  sessions are flagged; survival is proven by using the shell.
- `terminal-workspace`: the browser clipboard image directory is per account,
  owner-only, and verified.
- `server-runtime-and-protocol`: every server scratch directory under the
  shared temporary directory is per account, owner-only, and verified, and
  files in it are written exclusively.

## Impact

- `packages/server-core/src/terminalService/clipboardImage.ts`, `fileDrop.ts`,
  `appWindows/attachments.ts`, and a new shared `scratchDirectory.ts`.
- `apps/terminay-cli/src/unit.ts` and `commands/upgrade.ts` (repair before the
  up-to-date return), and `commands/status.ts`.
- `apps/terminay-server/src`: start-up detection of a systemd private `/tmp`
  and a repair request through the upgrade helper's request file.
- `packages/server-core/src/sessionHolder/factory.ts`: a health check in
  `start()` and the drain cause `unhealthy`. Adopted sessions carry a
  `degraded` flag through to the client. `src/` shows the banner.
- `.gitea/workflows/ci.yml`: a systemd-in-container job.
- `docs/operations/standalone-server.md`.
- `apps/terminay-cli/src/manifest.ts` and `scripts/standalone-artifact.mjs`:
  the `sharedTmpSafe` manifest marker.
- **Sequencing:** `terminals-survive-restart` must be archived first. The
  `remote-file-drop` delta's wording is updated so that `terminay-drops` sits
  inside the per-account scratch root.
- **One-time cost:** on a host that already runs the faulty unit, the repair
  restarts the service once more. Shells open at that moment come back with the
  banner. Every restart after that is clean.
