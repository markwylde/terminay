# Server desktop spike

Date: 2026-11-27. Supports ADR-0145, ADR-0146, and the `add-server-desktop` change (task 1.2).

## What was run

A stand-in holder (`server-desktop-spike/spike/holder.sh`) started TigerVNC's `Xtigervnc` on display 765 and a minimal XFCE session, as an unprivileged account, and a test script drove it through a small RFB client written for the spike. Everything ran in Docker containers on a Debian 13 host (kernel 6.12.118, amd64). Nothing was installed on the host.

| Configuration | How it was built | TigerVNC |
| --- | --- | --- |
| Debian 13, service unit | `debian:trixie-slim`, real systemd as PID 1, privileged container | 1.15.0 |
| Debian 12, service unit | `debian:bookworm-slim`, real systemd as PID 1, privileged container | 1.12.0 |
| Official image | Built from this repository's `Dockerfile`, started with its own entrypoint and Docker's default seccomp and AppArmor, the real server running | 1.12.0 |

In the two unit configurations the service unit is the installer's own rendering: `render-unit.mts` calls `renderUnit` from `apps/terminay-cli/src/unit.ts` for a system-scope install of a release with `sharedTmpSafe`, and the result (`spike/terminay-server.service`) is installed unchanged. What it names is a stand-in: an empty environment file and a script at `ExecStart` that starts the holder and stays up.

Three launch modes were tried in each: `none` (no restriction, to prove the reverse-connection test detects a connection), `netns` (`unshare -rn`), and `seccomp` (a launcher that refuses `socket(AF_INET|AF_INET6)` and then execs the display server).

Scripts: `server-desktop-spike/` (`run-systemd.sh trixie|bookworm`, `run-image.sh`). Raw result lines: `server-desktop-spike/output/`.

## Limits of this evidence

- The desktop holder is a stand-in script, and so is the server process in the unit configurations. Adoption after restart was shown at the process level (same pids, display still answering), not through a handshake.
- In the official image the holder was started through `docker exec`, not by the server, so nothing here shows what the server does to its own children when it stops.
- The fixture was `xterm`. Firefox was not run.
- amd64 only.

## Results

Every item passed in every configuration with the `seccomp` mode. Item (e) passed after the design changed: on TigerVNC 1.12 a held pointer button outlives its connection and needs the release step in finding 2.

| Item | Debian 13 unit | Debian 12 unit | Official image |
| --- | --- | --- | --- |
| (a) No TCP/UDP listener | pass | pass | pass |
| (b) Other account refused on X display and RFB socket | pass | pass | pass |
| (c) Reverse connection refused, X clients still connect, other programs keep network | pass (`netns` and `seccomp`) | pass (`netns` and `seccomp`) | pass (`seccomp`); `netns` cannot start |
| (d) View-only credential: input refused | pass | pass | pass |
| (d) View-only credential: no clipboard content | pass | pass | pass |
| (e) Held key released when its connection closes | pass | pass | pass |
| (e) Held pointer button released when its connection closes | released on close | held until the release step | held until the release step |
| (e) Nothing held after close plus the release step | pass | pass | pass |
| (f) `SetDesktopSize` resizes the screen | pass | pass | pass |
| (g) XFCE session without a login session, no TCP listener | pass | pass | pass |
| (h) Fixture renders and takes input through RFB | pass | pass | pass |
| (i) Display, session, and fixture survive a server restart | pass (`systemctl restart`) | pass (`systemctl restart`) | pass (entrypoint restarted the real server) |
| (j) Installing the package set enables or starts nothing | pass | pass | pass (listeners only; no systemd) |

## Findings that change the design

1. **Network denial: use the seccomp launcher everywhere.** `unshare -rn` works under the unit, including with `NoNewPrivileges=true`, but the official image under Docker's default confinement refuses it (`unshare failed: Operation not permitted`). The seccomp launcher worked in all three configurations: the display server ran with `NoNewPrivs: 1` and `Seccomp: 2`, `vncconfig -connect` failed (`Connecting to 127.0.0.1::5599 failed`), cookie-holding X clients still connected, and an ordinary program of the account still reached the listener. In mode `none` the same reverse connection reached the listener, so the test detects it. One mechanism is simpler than two, so the design uses the launcher only.

2. **Held pointer buttons are not released on close in TigerVNC 1.12.** Keys are, in both versions. On 1.12 a button held by a connection that closes stays down. A pointer event with no buttons from a *new full-rights* connection releases it; the same event from a view-only connection does not (`output/bookworm-held-input.txt`). TigerVNC 1.15 releases both on close. The design therefore sends a no-buttons pointer event through a full-rights connection after every control stream ends, and item (e) checks the display's input state after that step.

3. **A view-only credential withholds clipboard, in both versions.** After text was put on the display's clipboard, a full-rights connection received it in the legacy form (`ServerCutText legacy len=12 data=b'spike-secret'`) and the extended form (`provide`). A view-only connection received nothing in the legacy form. With the extended clipboard encoding enabled it received only the capabilities message, which carries no content, and nothing after an explicit request. The view-only credential is therefore the enforcement mechanism; the relay also withholds the extended clipboard encoding from view-only streams, so they carry no clipboard message at all.

4. **A view-only connection cannot resize.** Its `SetDesktopSize` left the desktop at 1600x900.

5. **An abstract X socket exists** beside `/tmp/.X11-unix/X765` and `/tmp/.X765-lock`. Another account is still refused, because access is by cookie.

6. **The XFCE session starts under `dbus-run-session`** with a private `XDG_RUNTIME_DIR`, with no login session, and opens no TCP or UDP listener.

7. **The desktop survives a server restart.** Under the installer's unit (`KillMode=process`) the display server, window manager, and fixture kept their pids across `systemctl restart`, one display existed, and its socket and lock file were still present. In the official image the entrypoint's own restart path (`restart-requested`, then the server ended) started a new server while the same three processes carried on.

8. **The package set is inert.** 125 packages were configured on Debian 13, 109 on Debian 12, and 106 in the official image; no unit became enabled or running and no listener appeared.

9. **The launcher needs `python3-seccomp`** as written. It is a stock Debian package, so it joins the fixed package set with `python3`.
