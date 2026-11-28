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

## Browser workspace against the official container image (run)

`sh scripts/run-server-desktop-e2e.sh`: 2 passed without retries. The
standalone server was the Debian bookworm image previously built from this
branch's Dockerfile as `terminay-pr678:local`. Playwright ran in the existing
Electron E2E image with the current acceptance spec and fixture copied in.

The Chromium fixture supplies the production browser workspace with an
authenticated loopback WebSocket to the standalone server. The second browser
enrolls a distinct device and connects with its one-use ticket. This exercises
the standalone protocol and browser workspace. Hosted pairing and WebRTC are
outside this run's scope.

- The browser's Set up desktop action installed the real Debian packages.
- A workspace terminal created after setup launched XFCE Terminal. The first
  browser and the second browser as a viewer both rendered the same magenta
  fixture window from the real framebuffer.
- The viewer took control through the dropdown. The first browser switched
  to viewing.
- A replacement container from the same image, with a fresh data volume,
  offered Set up desktop again.

## Browsers (run)

On a live Debian 13 standalone server whose desktop was already set up on
display 765, and in plain `debian:trixie-slim` containers.

| Check | Command | Result |
| --- | --- | --- |
| The host before | `command -v chromium`; `command -v firefox-esr` | no Chromium; Firefox present, installed by hand |
| The two packages, as setup installs them | `apt-get install --yes --no-install-recommends -- chromium firefox-esr` as root | status 0, `No services need to be restarted` |
| Neither ships a unit | `dpkg -L chromium chromium-common firefox-esr`, searched for `systemd`, `init.d`, and `/etc/xdg/autostart` | nothing |
| Chromium on the desktop | `chromium --auto-open-devtools-for-tabs about:blank` from a terminal with `DISPLAY=:765` | the browser process and eight renderers running on the display |
| Firefox on the desktop | `firefox-esr --devtools about:blank` from the same terminal | running, no display error |
| Size | `du -sh /usr/lib/chromium /usr/lib/firefox-esr` in a container | 382M and 295M |
| Chromium in a container, default seccomp | `chromium --headless --dump-dom about:blank` as an unprivileged account, with and without `chromium-sandbox` | `No usable sandbox!`, aborted |
| Chromium in a container, seccomp lifted | the same, in a container run with `--security-opt seccomp=unconfined` | `Check failed: . : Permission denied (13)`, aborted |
| Firefox in the same container | `firefox-esr --headless --screenshot /tmp/x.png about:blank` | wrote the screenshot; logged that it could not create a user namespace |

The packages were installed on the host with `apt-get` directly, not through
`terminay daemon desktop install`. The command's own path is covered by the
CLI tests and by the systemd job, which now asserts that both browsers are
present after a real install.

## Not run

- **A real Debian 13 system-scope install on a real host.** The only such host
  available is a live server, which was left untouched. The helper was
  exercised under real systemd on Debian 12 in a container instead (above).
- **`firefox` from a new terminal.** The browser acceptance test launches
  XFCE Terminal from a new workspace terminal.
- **An in-app upgrade with a program open.** A server restart through the
  upgrade's restart path was run (above); an upgrade to a different release was
  not.
