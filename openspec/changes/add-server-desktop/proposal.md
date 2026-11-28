## Why

On a Mac, a terminal or an agent can run `firefox` and the window appears on the machine. On a standalone Terminay Server there is no desktop, so the same command fails with "cannot open display" and a graphical program cannot be used at all. Users who run their server on a headless Debian box want graphical programs to work there too, and to see them from whichever Terminay client they are using.

Terminay already runs a virtual desktop for every bot and relays it over the Terminay connection. That pipeline is bound to bots and containers, so nothing offers the same for the server's own account.

## What Changes

- Add a **server desktop**: one virtual desktop per standalone server, running as ordinary processes on the server's own host and account. There is no VM and no container.
- Add a **Show Desktop** control beside the server menu. It opens a dropdown with a live view of the whole desktop and an action to open it as a tab in the current project or Home, with view-only and control modes. Any number of desktop tabs share one stream.
- New terminals on a server whose desktop is set up get `DISPLAY` and `XAUTHORITY`, so `firefox` appears on that desktop. `DISPLAY=:765 firefox` works too: 765 is the preferred display number.
- Terminay starts and owns its own display server. It never uses, configures, or disturbs an X or VNC session the machine already has. The display server has no network listener; pixels and input travel only over the existing Terminay connection.
- Pairing is the trust point: any client that is in Terminay may use the desktop, because it can already run programs as the server account. Nothing outside the Terminay connection can reach it. The desktop is shared by every project on the server. One client controls it at a time; others watch.
- **Guided setup.** The first Show Desktop on a server that lacks the packages offers to install them and shows real progress. Supported targets are Debian standalone servers and the official container image. An unprivileged server cannot install packages, so a root helper with a fixed command line does it, following the existing in-app upgrade helper. Where no helper exists, the dropdown shows one command to run.
- Servers that cannot offer a desktop say why, and never fail. An embedded server does not offer the control at all, because its programs already open on the machine's own desktop.
- Use the **same desktop session, configuration, relay, viewer, and clipboard behaviour as the bot desktop**. Extract those pieces into one shared package that both desktops use. Bot behaviour does not change.
- Close out `adopt-atlas-bot-runtime`. Its implementation is on `main` and nobody is continuing it. Its six unfinished tasks are removed unticked: the relay's negative-access checks, the bot end-to-end run, and the closing gates move into this change, and the rest are recorded as dropped. It is then archived, so the shared package is extracted from canonical bot contracts.

Not in this change: one Terminay window per application window, a native Desktop window for the desktop, audio, GPU acceleration, HiDPI tuning, distributions other than Debian, and a desktop for an embedded server.

This change builds on `daemon-restart-keeps-terminals-usable`: the desktop needs the server and its terminals to share the host's temporary directory.

## Capabilities

### New Capabilities

- `server-desktop`: the server's own virtual desktop. Covers availability and capability reporting, guided setup, the isolated display server, who may view and control it, the Show Desktop dropdown and desktop tabs, resize, clipboard, and lifetime across server restarts.

### Modified Capabilities

- `daemon-cli`: a system-scope install carries a root desktop-setup helper beside the upgrade helper; `terminay daemon desktop install` runs the same fixed setup; `daemon doctor` reports the desktop's state.
- `shell-profiles-and-terminal-launch`: a launched terminal receives the server desktop's display environment by default, and an explicit profile value still wins.

## Impact

- **New package** `packages/remote-desktop`: RFB relay and client-message filter, upstream connectors (container exec tunnel, host unix socket), the pull byte stream, the noVNC viewer and clipboard sharing, and the XFCE session script and configuration. Moved out of `packages/server-core/src/botService/rfb.ts`, `packages/client-core/src/botIo.ts`, `src/workspace/bots/` (`BotDesktopView.tsx`, `rfbChannel.ts`, `desktopClipboard*.ts`), and `docker/terminay-bot/bin/terminay-desktop-session`.
- **Protocol** (`packages/protocol`): a `server-desktop.v1` feature capability and `server.desktop.*` operations for status, setup, turning the desktop on and off, stream open, and control handoff. Bot wire operations are unchanged.
- **Server** (`packages/server-core`, `apps/terminay-server`): a desktop service and a detached desktop holder that supervises the display server and session, the desktop authority, the relay to a unix socket, and a per-launch baseline provider in the launch resolver.
- **Installer** (`apps/terminay-cli`): two more rendered units, a `desktop install` subcommand, and a doctor check.
- **UI** (`src/`): the Show Desktop control in the title bar, the dropdown, desktop tabs in projects and Home sharing one stream, and the setup and unavailable states.
- **System dependencies** on supported hosts: stock Debian packages only (`tigervnc-standalone-server` and the XFCE, D-Bus, and font packages the bot image already uses). Nothing is added for other hosts.
- **Docs**: `docs/operations/standalone-server.md` gains a desktop section.
- **Housekeeping**: `openspec/changes/adopt-atlas-bot-runtime` is archived, which adds `bot-desktop`, `bot-cli-runtime`, and `bot-image-build-progress` to `openspec/specs/`.
