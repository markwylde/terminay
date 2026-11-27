## Context

A standalone Terminay Server runs as an unprivileged account under systemd (`User=terminay`, `NoNewPrivileges=true`, `KillMode=process`) or as the `terminay` account in the official container image, which has unrestricted passwordless sudo and no systemd. Its PTYs run as that same account. A headless host has no display, so graphical programs cannot start.

Terminay already has a remote desktop, but only for bots:

- A bot's container runs `Xvnc :1` on the container's loopback, with a VNC password, plus an XFCE session (`docker/terminay-bot/bin/terminay-init`, `terminay-desktop-session`). The session script also starts a bot-only desktop-control service on loopback TCP 9223.
- The server reaches it through an engine `exec` tunnel and relays RFB to the client (`packages/server-core/src/botService/rfb.ts`). `BotRfbClientFilter` forwards an allowlist of client messages and drops input in view-only mode. `BotRfbRelay` answers the VNC challenge itself. It forwards the display server's bytes to the client unchanged.
- Bytes cross the Terminay connection as a pull stream with one credit per read (`packages/protocol/src/botIo.ts`, `packages/client-core/src/botIo.ts`). The client stream is keyed by bot.
- The renderer draws it with noVNC through a WebSocket-like adapter (`src/workspace/bots/BotDesktopView.tsx`, `rfbChannel.ts`), with clipboard sharing in `desktopClipboard*.ts`.
- `assertBotStreamAuthority` (`botService/streamAuthority.ts`) admits `write` or `admin` connections and refuses those narrowed to a project, session, capability, chat, or MCP principal.

Other facts this design rests on:

- Every approved remote device connects with `authScope: 'admin'` (`apps/terminay-server/src/remote/hostedPairingHost.ts`). Scope does not separate one paired device from another.
- Terminal environment is resolved in `packages/server-core/src/terminalService/launchResolver.ts`. The standalone baseline is a snapshot taken at startup (`apps/terminay-server/src/cli.ts`, `terminalLaunchEnvironment`); the per-terminal hook runs after the profile overlay. A command default leaves an inherited variable as it is (ADR-0124).
- A session holder owns PTYs across server restarts and adopts them without respawning (ADR-0035, ADR-0116). It accepts the environment at spawn time.
- A system-scope install has a root upgrade helper: a path unit watches a file the run-as account may change, and a root oneshot runs a command line fixed in the unit (`apps/terminay-cli/src/unit.ts`). Install and upgrade both re-render it.
- The canonical `daemon-cli` spec still requires `PrivateTmp=true`. The unit code no longer writes it, and the pending change `daemon-restart-keeps-terminals-usable` moves the spec to match (ADR-0116).
- In the container image, the `terminay` wrapper (`docker/terminay`) runs the release named in `<data root>/releases/running`, a file the run-as account can write.
- Terminay Desktop's native auxiliary windows are a fixed allowlist of Settings and Performance Log (`electron/auxiliaryRouteAllowList.ts`).
- Generic settings operations accept `write` scope and publish settings state (`packages/server-core/src/settings/protocol.ts`). Operation namespaces are classified in `packages/server-core/src/capabilities.ts`, where a bare `server` prefix falls through to connection mechanics.

Codex reviewed the first plan and then this change against the code; its findings are folded in. The display-server spike has been run on Debian 12 and 13 under the installer's unit and in the official image (`openspec/adr/evidence/server-desktop-spike.md`); decisions below cite it where it settled a mechanism.

## Goals / Non-Goals

**Goals:**

- A graphical program started from a terminal on a headless Debian standalone server is visible and usable from any Terminay client, in one window.
- The desktop is reachable only through the Terminay connection. Nothing else can view or control it from the network.
- Setup is one click where the install allows it, and one command otherwise.
- Bot and server desktops share one implementation of the session, relay, filter, viewer, and clipboard.
- Unsupported hosts degrade to an explanation.

**Non-Goals:**

- One Terminay window per application window.
- Audio, GPU acceleration, HiDPI tuning.
- Distributions other than Debian; a desktop for an embedded server.
- Separating one paired device from another, or one project from another, on the desktop.
- A native Desktop window, or a non-modal placement, for the desktop.

## Decisions

### D1. One whole-screen desktop in one window, over VNC

The server desktop is a single X screen streamed whole, shown in one Terminay window. A window manager on that screen handles application windows.

*Why:* VNC streams a screen, and everything needed to stream a screen already exists and is tested for bots.

*Alternatives considered:*

- **Private cells on one hidden screen, cropped per Terminay window.** Rejected: override-redirect menus and drag icons cross any gutter and grab the pointer, applications restore their own geometry, and Xvnc's framebuffer is capped at 16,384 pixels per axis and costs up to 1 GiB at that size.
- **Xpra.** The only mature per-window tool. Rejected: stock Debian 13 does not package it; the upstream package starts a root proxy on TCP 14500 at install; its browser client is global scripts with jQuery UI, its own frames, and a hard-wired WebSocket, so it must be forked or rewritten; and it permits command start, file transfer, and shell by default.
- **`x11vnc -id` per window.** Rejected: its own manual says menus and transients may be clipped and that it may crash when the window is obscured or resized.
- **Our own per-window capture bridge.** Rejected by the user: it amounts to rebuilding a remote-desktop protocol.

*Boundary:* none crossed; the existing remote-desktop relay stays the only path for pixels and input.

### D2. Terminay-owned `Xtigervnc`, unix socket only

The server's desktop holder (D4) starts `Xtigervnc` directly, never `vncserver` or the Debian systemd template, with no RFB TCP port (`-rfbport -1`), an RFB unix socket (`-rfbunixpath`, mode 0600) inside the server's owner-only runtime directory (ADR-0054), `-nolisten tcp`, and `-auth <cookie file>`. No `~/.vnc` is read or written: every option is passed explicitly and the session's configuration directories point at Terminay's own.

The RFB socket uses VNC password authentication with two generated passwords, full and view-only, held in an owner-only file. RFB fixes a connection's rights when it authenticates, so each client stream gets its own upstream connection, opened with the credential for its mode: the display server itself refuses a view-only stream's input, and the relay filter remains a second control. Changing mode opens a new stream and a new upstream connection, as it does for bots. The client never sees either password.

The X socket has to be at `/tmp/.X11-unix/X<n>`, with its lock file `/tmp/.X<n>-lock`, because that is where `DISPLAY=:<n>` looks. They are the only desktop files outside Terminay's own directories. The path is world-reachable, and on Linux an abstract socket may exist too, where file permissions do not apply, so the MIT cookie is the X11 access control. The cookie file is 0600, generated by the server, passed as a path, and never logged.

Xvnc's VNC extension lets an X client ask the server to dial out to a listening viewer, which the listener flags do not stop, and which would carry the screen outside Terminay. That is the one thing the owner rules out, so there is no fallback: the display server always runs unable to open a network connection, and a host where that cannot be arranged reports `unsupported`. Only the display server is restricted; the session and the programs on the display keep their network. The mechanism is a launcher that installs a seccomp filter refusing IP sockets and then execs the display server. It needs no privilege and no user namespace. The spike showed it working under the unit and under Docker's default confinement, where an empty network namespace cannot be created, so it is the only mechanism used.

*Alternatives considered:* `Xvfb` plus `x11vnc` (two processes, a scraper); loopback TCP with a password as bots do (a listener any local account can reach, and unnecessary without a container boundary).

*Boundary:* host network exposure and the same-account process boundary. Settled by the spike on TigerVNC 1.12 and 1.15: socket-only listening has no TCP or UDP listener; an abstract X socket exists and another account is still refused by the cookie; a view-only credential refuses input, resize, and clipboard content; the seccomp launcher blocks the reverse connection. Still unproven: the product's own holder and server in place of the spike's stand-in scripts (task 7.2).

### D3. Display number 765, treated as a preference

The server claims display 765. If its socket or lock file belongs to a process the server did not start, it scans upward for a free number. The chosen number is recorded in the data root so restarts reuse it. Socket paths are always derived from the number, never read from a record.

*Boundary:* collision avoidance with displays Terminay does not own.

### D4. A desktop holder owns the display across server restarts

Starting on first Show Desktop would leave earlier terminals holding a `DISPLAY` that nothing answers. So once set up and on, the desktop runs whenever the server runs.

A small detached **desktop holder** process starts and supervises the display server and the session as its children. It is adopted the way the PTY session holder already is (`packages/server-core/src/sessionHolder/factory.ts`, `client.ts`): the server derives the control socket's path in the owner-only runtime directory itself, and the two sides complete a credential handshake using a secret in a file only the server account can read. The server never trusts a pid or path written in a file. A lock the kernel holds (ADR-0055) only guarantees there is one holder; it does not authenticate it, and the handshake does.

- On startup the server derives the socket path and attempts the handshake. Success adopts the holder.
- Failure with the lock free means no holder is alive: the server removes stale sockets for its own display number and starts one.
- Failure with the lock held means a holder that cannot be spoken to; the server reports `failed` and starts nothing beside it.
- The control protocol carries a version. A new release that cannot speak the running holder's version asks it to stop and starts a new one, which restarts the desktop.
- With `KillMode=process`, systemd leaves the holder running when the server's main process exits.
- The desktop's directory is `desktop` in the data directory, or, where that path is too long for a socket, in the per-data-directory runtime directory under the temporary directory (ADR-0054), never `XDG_RUNTIME_DIR`, which is emptied at logout while the desktop lives on.
- The holder releases its lock before it closes the server's connection, so a server told that a stop finished can start another at once.
- A holder whose directory has been removed, by an uninstall or a deleted data directory, ends its desktop within seconds.

Turning the desktop off, and `daemon uninstall`, tell the holder to stop through the same handshake; uninstall runs as root and can read the secret. The holder ends the session and the display server. Every window closes with the display; a program that keeps running after losing its display is an ordinary process the holder never owned, and the documentation says so. In a container, a container restart ends everything, and the server starts a new holder if the programs are still installed.

This needs the server and its PTYs to share the host's `/tmp`. Under a unit with `PrivateTmp=true` the X socket would live in a directory systemd removes when the service stops, so such an install reports `unsupported`. The canonical `daemon-cli` spec still requires `PrivateTmp=true`; the pending change `daemon-restart-keeps-terminals-usable` removes it for releases that declare shared-temporary-directory safety. That change's code is on `main` already (`sharedTmpSafe` in the release manifest and the unit renderer); its spec must be archived before this change is, and this release must carry the declaration.

*Alternatives considered:* a state file with pids and start times (forgeable by anything running as the account, and open to pid reuse); authenticating by the lock's owner pid and peer uid alone (proves who holds an inode, not what the process is); having the PTY session holder own the desktop (ADR-0116 ties it to environment health, and the desktop needs no PTY); a separate systemd unit (not available in the container image or to a user-scope install).

*Boundary:* process ownership across server restarts.

### D5. Display environment from a per-launch baseline provider

The startup snapshot cannot change when the desktop starts or stops, and the existing per-terminal hook runs after the profile overlay, which would make the display environment override profiles. So the launch resolver gains a per-launch baseline provider, consulted before the profile overlay. It returns `DISPLAY` and `XAUTHORITY` only while the desktop is running, and nothing when the server process itself has `DISPLAY` or `WAYLAND_DISPLAY`. Profile overlays then override it by the existing rules. Command defaults are unchanged: they leave an inherited variable alone (ADR-0124). A launch through a surviving session holder passes the same resolved environment at spawn time. Running shells are not changed; the window says terminals opened earlier need reopening.

*Boundary:* the canonical launch policy. No protected variable is introduced.

### D6. Pairing is the trust point; the desktop is one shared domain

A connection that is "in Terminay" can already run programs as the server account, so the desktop adds no authority it lacks. Every approved device already connects as `admin`, so a scope check would not separate devices anyway. The rule is therefore the bot desktop's: `write` or `admin`, with none of the narrowing claims. Connections narrowed to a project, session, capability, chat, or MCP principal are refused, because they are deliberately less than "in Terminay".

Two things are stated plainly instead of prevented:

- The desktop cannot respect project or terminal-session boundaries. Every program the account runs shares the screen and its input, and RFB delivers the whole framebuffer.
- Agents running in terminals can reach the display directly with the cookie, as any same-account process can. The API restriction governs remote viewing, not local X11 access.

The hard line is the other one: nothing outside the Terminay connection can reach the desktop (D2).

One control stream exists at a time. Takeovers are serialized: the old control stream's upstream connection is closed and confirmed closed before the new one is opened. TigerVNC tracks held keys per connection, so closing the connection that pressed them is what releases them; the spike confirmed that on both versions. Pointer buttons differ: TigerVNC 1.15 releases them on close, but 1.12 leaves them down until a full-rights connection sends a pointer event with no buttons, and a view-only connection cannot do it. So after every control stream ends, the server sends one no-buttons pointer event at the last position through a full-rights connection it opens for that purpose, before the next controller's input is admitted. The tests check the display's actual input state after an upstream failure. Viewers learn of a handoff from a `server.desktop.control` event.

*Alternatives considered:* a separate per-device desktop grant (rejected by the user: pairing is the trust point); per-project displays (they share one account, so they would suggest an isolation they do not provide); shared control (interleaved input from two devices).

*Boundary:* project/window and terminal-session boundaries (ADR-0011, ADR-0047, ADR-0048). The desktop sits outside them and says so.

### D7. Shared `packages/remote-desktop`, with per-use connector and authority

Extraction is done in two steps: move with no behaviour change, then add options.

| Entry point | Contents | From |
| --- | --- | --- |
| `server` | RFB relay, client-message filter, held-input tracking, upstream connector interface | `botService/rfb.ts` |
| `client` | pull byte-stream client keyed by an opaque stream handle, WebSocket-like RFB channel | `client-core/src/botIo.ts`, `src/workspace/bots/rfbChannel.ts` |
| `ui` | desktop canvas, mode bar, reconnect, clipboard sharing | `BotDesktopView.tsx`, `desktopClipboard*.ts` |
| `session` | XFCE session script and configuration | `docker/terminay-bot/bin/terminay-desktop-session` |

Per use:

- **Connector.** Bots: engine exec tunnel plus VNC challenge. Server desktop: a unix socket plus VNC challenge.
- **Authority and operations.** Bot streams keep `bots.*` operations and `BotStreamAuthority`. The server desktop gets `server.desktop.*` operations and its own authority check. The pull-stream machinery under both is shared; the wire operations are not merged, so bot wire compatibility is untouched.
- **Session services.** The session script takes its display, home, state directory, launcher set, and a list of extra services. The bot image passes its browser, creative applications, and the desktop-control service. The server desktop passes none, so it starts no TCP listener.

The session assets must reach every place they run: the bot image build context, the standalone release archive, and the official image.

There is one copy of the script, in the bot image's build context (`docker/terminay-bot/session/`), because that directory is used as a complete context as it stands, by the embedded server in development and by the packaged app. The shared package's build copies it into its compiled output, which the release archive and the official image already ship, and exports its location. In the bot image, the bot's own wrapper passes the bot's launchers and its desktop-control service. The archive does not keep execute bits on these files, so the session and the display launcher are run through their interpreters.

Whoever starts the session ends it as a process group. On Debian 12, `dbus-run-session` does not pass a signal on to the session it wraps, so signalling the one process would leave the desktop running.

*Alternatives considered:* copying the bot code (two filters to keep in step on a security boundary); making the server desktop a pseudo-bot (inherits container assumptions and the wrong authority).

*Boundary:* the RFB filter is a security control; having one copy is the point.

### D8. Relay changes: clipboard on view-only streams, and resize

The relay forwards the display server's bytes unchanged today, so a view-only viewer receives whatever clipboard messages the display sends. The bot spec already says view-only streams neither read nor write a clipboard; whether bots meet that today is established first (task 2.3), and the fix lands in the shared relay for both.

Enforcement is on the stream's bytes, for both the legacy `ServerCutText` and the extended clipboard forms, and it is one mechanism for both desktops. The spike showed that a connection authenticated with a view-only credential is sent no clipboard content on either TigerVNC version: nothing in the legacy form, and in the extended form only the capabilities message, even after an explicit request. So the mechanism is the view-only credential: the server desktop uses it as in D2, and the bot bootstrap gains a view-only password so bot view-only streams and thumbnails authenticate with it. The relay also withholds the extended clipboard encoding from view-only streams, so they carry no clipboard message at all. The test reads raw viewer bytes, for a bot stream and a server-desktop stream.

Measured before the change (task 2.4, `packages/server-core/test/real-display/bot-view-only-clipboard.test.mjs` on TigerVNC 1.15, every bot stream authenticating with the one full password): a bot view-only stream received the bot's clipboard text in the legacy form (`ServerCutText` carrying the text) and, with the extended encoding negotiated, an unsolicited `provide` carrying it. The relay dropping the viewer's own clipboard messages did not stop either, because both are sent by the display server. So this is a fix to the bot desktop as well as a rule for the server desktop.

`SetDesktopSize` is admitted only as a named option, on control streams, for a single screen, clamped to 640x480–3840x2160, at most ten per second with the latest winning. A multi-screen or malformed layout closes the stream. Bots keep the option off.

*Boundary:* the relay's allowlist.

### D9. Capability on every standalone server; dedicated operations

`server-desktop.v1` is advertised by every standalone server build, including unsupported hosts, and never by an embedded server. The client shows Show Desktop when it sees the capability and asks `server.desktop.status` for the state.

The whole `server.desktop.` prefix is classified to that capability before the bare `server` prefix is considered. Turning the desktop on and off is `server.desktop.enable` and `server.desktop.disable`, not a generic setting: generic settings accept `write` from narrowed connections and publish state to every client, which would bypass the authority check and the confirmation. Status changes are published only to connections that pass the desktop authority check.

*Boundary:* capability negotiation and the settings surface.

### D10. Setup through a root helper with a fixed command line

`terminay daemon desktop install` installs a package list compiled into the CLI, with `--no-install-recommends`, and reports apt's status-fd progress. It takes a root-side exclusive lock, waits a bounded time for the dpkg lock, builds its own environment for the package manager, finishes any interrupted configuration first, and exits early without touching the network when the programs are already present.

Ways to reach it:

1. **System-scope install:** a second path-activated root helper, rendered beside the upgrade helper, with a start deadline and a start-rate limit. Its executable is the install's own `<prefix>/current/bin/terminay`, as for upgrade. Progress goes to a status file in a root-owned directory under `/run`, written atomically and carrying the run's identity; the server watches it and cannot write it. The trigger file is separate. A run that ends without a recorded outcome, because it was killed or hit its deadline, is reported as failed: the server sees the helper unit inactive with no outcome for that run.
2. **Official image:** the account is root-equivalent there by design (`NOPASSWD:ALL`), so no containment is claimed. The server recognises the image by its root-owned release directory (`TERMINAY_IMAGE_RELEASE`, `/opt/terminay`) and runs `sudo -n` on that directory's CLI, not the `terminay` wrapper, whose target is chosen by a file the account can write, and with a cleared environment. If that CLI predates the command, which happens when a newer server was upgraded in place on the data volume over an older image, or if `sudo -n` is refused or absent, this falls through to 3, and the command shown tells the operator to update the image.
3. **Otherwise:** the window shows the command and a Check again action. The server re-examines the host on a status request and on Check again; it does not poll (ADR-0028).

The trigger file can be touched by anything running as the account, which skips the application's authority check. That is accepted: the effect is a fixed, idempotent, rate-limited install.

The package set is the bot image's desktop packages without its applications, plus what the network-denial launcher needs: `tigervnc-standalone-server tigervnc-tools xfwm4 xfce4-panel xfce4-settings xfce4-terminal xfdesktop4 x11-xserver-utils dbus-x11 xauth fonts-dejavu-core fonts-noto-color-emoji adwaita-icon-theme python3 python3-seccomp`. The spike showed that installing the desktop packages enables no unit and opens no listener on Debian 12 and 13.

"Not using an existing install" is met at the instance level: Terminay shares the system's packages, which are inert binaries, and isolates everything that runs or is configured.

*Alternatives considered:* letting the server run `sudo apt` (the shipped unit's `NoNewPrivileges` forbids it, deliberately); private copies of the packages under the prefix (no root needed, but library dependencies and security updates become Terminay's job); baking the packages into the official image (see Open Questions).

*Boundary:* privilege escalation from the run-as account to root.

### D11. The desktop window is the shared in-page frame on every host

Terminay Desktop's native auxiliary windows are a deliberate fixed list, keyed by profile, not by the window that opened them. Adding the desktop there would need a new route bound to the originating window's server. The desktop window instead uses the shared in-page frame everywhere: movable, resizable, maximisable, one per client window.

*Trade-off:* that frame is modal, so the user cannot type in a terminal while the desktop is open. Accepted for this change.

*Boundary:* none crossed; the Electron route allowlist is unchanged.

### D12. Close out `adopt-atlas-bot-runtime` without ticking anything

That change's code is on `main` and nobody is continuing it. Its six unfinished tasks have been removed from its `tasks.md`, not ticked, with a dated record in its `verification.md` of which were moved here and which were dropped. Moved: the relay's loopback, no-published-port, and view-only negative-access checks; the Docker-isolated bot end-to-end run; the closing lint, type, and validation gates. Dropped: per-application document saving on both architectures and the full desktop-control journey, which concern bot applications and have no planned work. The change is then archived so `bot-desktop` is canonical before the shared package is extracted.

## Risks / Trade-offs

- [The spike used stand-in scripts for the holder and, under the unit, the server, and ran no browser] → Task 7.2 repeats the checks with the product on a real install and the real image.
- [A host's own confinement forbids installing a seccomp filter] → The display server does not start and the state is `unsupported`; the owner's rule is not relaxed.
- [Every paired device and every project shares one desktop] → Stated in the window and the docs. This is the user's chosen trust model.
- [Any same-account process, including an agent, can read and type into the display] → Accepted and stated.
- [Idle memory for a desktop nobody is watching] → It can be turned off; status shows it is running.
- [Extracting the shared package regresses the bot desktop] → Move first with no behaviour change; bot suites and the bot E2E must pass before options are added.
- [The desktop window is modal] → Accepted; a non-modal placement is a follow-up.
- [Setup in a container is lost when the container is recreated] → The state returns to `needs-setup`; see Open Questions.
- [A root helper is one more privileged unit, and its trigger is writable by the account] → Fixed command line, no input, locked, rate-limited, idempotent; `doctor` reports its presence.
- [An install still on `PrivateTmp=true` cannot host the desktop] → Reported as `unsupported`; the operations page says how to correct the install.
- [The holder runs old code after an upgrade] → Its control protocol is versioned and small; an incompatible holder is replaced, which restarts the desktop.
- [Software rendering makes heavy pages slow] → Documented limit.
- [A bot container created before this change has no view-only VNC password in its password file] → Its view-only streams and thumbnails fail to connect until the container is recreated, which the existing out-of-date-container update does because the image fingerprint changes. There is no fallback to the full password: that would put the clipboard back on view-only streams.

## Migration Plan

1. Archive `daemon-restart-keeps-terminals-usable` (a prerequisite, not part of this change) and `adopt-atlas-bot-runtime`; validate specs.
2. Extract `packages/remote-desktop` with no behaviour change.
3. Add the server desktop behind its capability. Servers without it show nothing new.
4. Existing system-scope installs receive the setup helper on their next upgrade, because upgrade re-renders units. Until then the window shows the manual command.

Rollback: turning the desktop off stops everything Terminay started. Installed Debian packages stay, which is harmless; `daemon uninstall` removes the helper units and stops the holder.

## Open Questions

- Should the official container image ship the desktop packages, so a recreated container needs no setup? The default here is on-demand setup.
- Should Debian derivatives be admitted once Debian works? The support check is one place.
- No in-force ADR needs revisiting.
