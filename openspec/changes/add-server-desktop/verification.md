# Verification — add-server-desktop

What was run, where, and what it showed. Anything not run is listed at the end
as not run.

## Official container image (run)

The image was built from this worktree's `Dockerfile` as a test-only tag and
run with no published port. Debian bookworm, account `terminay` (uid 10001).

| Check | Command | Result |
| --- | --- | --- |
| Fresh container has no display server | `ls /usr/bin/Xtigervnc` | absent |
| The server's root check | `sudo -n /usr/bin/env -i PATH=… /opt/terminay/bin/terminay daemon desktop check` | `{"install":1,"statusFile":"/run/terminay-desktop-setup/status.json"}`, status 0 |
| Setup, as the server runs it | the same command with `install` | steps and tenths printed from 0% to 90%, `The server desktop is set up.`, status 0, 56 s with real `apt-get` |
| Second run | `sudo -n /opt/terminay/bin/terminay daemon desktop install` | `Everything the server desktop needs is already installed.`, status 0 |
| Packages started nothing | `ps` for vnc, xfce, dbus, Xorg before the server restarted | no process |
| Server starts the desktop | `docker restart`, then `ps` | `Xtigervnc :765 -rfbport -1 -rfbunixpath /var/lib/terminay/desktop/rfb.sock -rfbunixmode 0600 -nolisten tcp -auth …`, `xfwm4`, `xfce4-panel` |
| Network filter | `grep -E '^(Seccomp\|NoNewPrivs):' /proc/<pid>/status` | `NoNewPrivs: 1`, `Seccomp: 2` |
| No desktop listener | `ss -H -lntup` as root | only the server's own `0.0.0.0:8443` and `127.0.0.1:8444` |
| Cookie | `xset q` with and without the cookie; `stat` of the cookie | status 0 with, 1 without; mode `600`, owner `terminay` |
| Reverse connection | `vncconfig -nowin -connect 127.0.0.1:5500` against a listener on that port | `connecting to 127.0.0.1:5500 failed`; the listener saw no connection in 8 s |
| Graphical program | `xfce4-terminal --title=verification-fixture` on the display | running |
| Server restart | restart marker, then `SIGTERM` to the server, as an in-place upgrade does | server pid 29 → 438; display server pid 121 unchanged; the program still running; one `Xtigervnc` |
| Container recreated | `docker rm`, `docker run` from the image | `Xtigervnc` absent, no display server |

`terminay daemon doctor` does not run in the image: it requires systemd, as it
did before this change.

## System-scope install under real systemd (run, in a container)

`node scripts/desktop-setup-systemd.mjs`: a privileged Debian bookworm
container with real systemd and the real package manager, the CLI installed
system-scope. Result: `desktop setup under systemd: all checks passed`.

- The run-as account can signal setup but cannot rename or unlink the trigger.
- Reinstall restored a disabled watch and a stopped watch without changing the trigger inode or timestamp or starting the package service.
- The trigger's content is ignored; only the fixed package list is installed.
- The run-as account reads the status file and cannot write it.
- An install killed at `installing 0.60` is recovered by the next run.
- No unit is newly enabled or running after the packages are installed.
- 40 triggers in 14 s started the helper twice.
- Uninstall removes the helper.

## Real display server (run, in containers)

`sh scripts/run-real-display-tests.sh` on Debian 13 (trixie): 24 pass, 0 fail.
It covers the holder, the service against a real `Xtigervnc` (controller input,
a viewer that delivers no input, gets no clipboard and cannot resize; take
control; turn off and on; a holder with another control protocol replaced), and
`end-sessions` ending the desktop.

## Client (run)

`npm run test:e2e -- e2e/server-desktop-browser.spec.ts e2e/server-desktop.spec.ts`
in Docker: 2 passed.

- Terminay Desktop paired to a real standalone server: no control on the
  device's own server; Show Desktop twice shows one window; setup progress from
  a stand-in root helper survives closing and reopening; a failure shows its
  step, reason and Try again.
- A browser client, with the production client and components over a stand-in
  wire: Show Desktop twice shows one window, and it reopens on setup in
  progress.

## Not run

- **A real Debian 13 system-scope install on a real host.** The only such host
  available is a live server, which was left untouched. The helper was
  exercised under real systemd on Debian 12 in a container instead (above).
- **Guided setup started from the client against real packages.** The client
  flow ran against a stand-in helper; the real install ran from the command the
  server uses. The two were not joined in one run.
- **`firefox` from a new terminal.** No browser was installed. A graphical
  program was started on the display directly; a terminal's display environment
  is covered by unit tests only.
- **An in-app upgrade with a program open.** A server restart through the
  upgrade's restart path was run (above); an upgrade to a different release was
  not.
- **Task 7.1's end-to-end spec.** No E2E drives a real desktop through the
  client: the E2E image has no desktop packages and no Docker, and no harness
  pairs a browser client with a standalone server. Seeing a program's window
  from a browser client, a second client as a viewer, and take control through
  the UI were not run end to end; the service-level equivalents ran against a
  real display server (above).
