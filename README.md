# Terminay

A desktop terminal workspace that keeps shells, files, agents, and remote access for a project in one app.

![Terminay workspace screenshot](https://terminay.com/screenshots/terminay-hero-workspace.png)

[![Specification progress](docs/spec-progress.svg?v=1791396439)](openspec/README.md)

## What it does

- Open multiple native shell sessions in project workspaces
- Split terminal, file, and folder tabs horizontally or vertically with Dockview
- Reorder tabs, pop active panels into separate windows, and close the active tab from shortcuts or menus
- See recognized Codex status at a glance with journal-driven RAG indicators, a project-scoped Agents pane, and exact click-to-focus navigation
- Keep activity indicators for ordinary terminals through structured terminal signals and raw-output fallback
- Create project tabs with root folders, per-project file explorer state, colors, and short icons
- Rename project and terminal tabs, set tab colors, and inherit project styling
- Use the Command bar to search app commands and run saved macros
- Build reusable macros with typed steps, placeholder fields, waits, clipboard paste, and stored secrets
- Browse project folders from a resizable sidebar with Git new/modified coloring
- Open folders as dockable folder tabs with tree, list, thumbnail, and gallery views
- Open files beside terminals with preview, text, hex, and Git diff modes
- Edit and save text/hex files, detect external changes, and resolve dirty-file conflicts
- Preview Markdown, images, and PDFs, with large-file handling for heavy text buffers
- Optionally record terminal sessions to local asciicast files and replay them from a timeline
- Tune terminal appearance, shell launch behavior, shortcuts, accessibility, scrolling, themes, and remote host settings
- Pair a browser over the built-in HTTPS remote host, manage devices, inspect live connections, and review audit events
- Check for GitHub release updates from the app chrome

## Install

### Terminay Desktop

The desktop app for macOS (arm64) and Linux (x64). It runs its own Terminay
server, so it works on its own, and it can also connect to Terminay servers on
other machines.

Download the DMG or AppImage from the
[latest release](https://github.com/markwylde/terminay/releases/latest).

<details>
<summary>Verify the download</summary>

Each asset has a `.sha256` file beside it. From the download directory:

```bash
shasum -a 256 -c Terminay-Mac-<version>-Installer.dmg.sha256
```

</details>

### Terminay Server

A standalone server for your own servers, VMs, and containers, so you can
reach them from the desktop app or a browser. It runs on Linux (x64 or arm64)
with systemd.

```bash
sudo npx terminay daemon install
sudo npx terminay daemon qr-code
```

The second command prints a QR code to pair a device. To connect from the
desktop app instead, paste the pairing URL it prints into **Add connection**.

Full guides live at [terminay.com/docs](https://terminay.com/docs).
Contributing? See [CONTRIBUTING.md](CONTRIBUTING.md).
