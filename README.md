# Terminay

Terminay is a desktop terminal workspace built with Electron, React, and Vite. It pairs native shell sessions with dockable project tabs, file tools, macros, settings, and browser-based remote access so project work can stay in one focused desktop app.

![Terminay workspace screenshot](https://terminay.com/screenshots/terminay-hero-workspace.png)

## What it does

- Open multiple native shell sessions in project workspaces
- Split terminal, file, and folder tabs horizontally or vertically with Dockview
- Reorder tabs, pop active panels into separate windows, and close the active tab from shortcuts or menus
- See tab activity at a glance with working, finished, and attention indicators driven by terminal signals from shells and AI agents
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

## Getting started

### Prerequisites

- Node.js 22+
- npm 10+
- macOS or Linux for the packaged binaries in CI

### Install dependencies

```bash
npm ci
```

### Start local development

```bash
npm run dev
```

### Run the smoke checks

```bash
npm run smoke
```

`smoke` runs Biome linting and the renderer/main TypeScript plus Vite build.

## Terminal recordings

Terminal recording is off by default. Enable **Record new terminals** in Settings, or right-click a terminal tab and choose **Start Recording** for one session. Recordings are local asciicast v3 `.cast` files saved under `~/Documents/TerminaySessions/YYYY-MM-DD/` by default, with Terminay metadata stored beside each cast file.

Recording can capture terminal output, typed input, commands, file paths, tokens, and other sensitive text. Terminay uses a conservative best-effort filter for likely password or secret prompts, but terminal apps do not expose a perfect universal secure-input signal. Keep recordings local unless you deliberately share them.

## Tab activity indicators

Terminal tabs show a colored dot when work happens on a tab you are not looking at: amber while a tab is working, green when it finished and you have not viewed it, and a red **attention** dot when an agent finishes a turn or asks for permission or input. Configure the indicators under **Appearance → Tab Indicators** in Settings.

With **Use terminal signals for activity** enabled (the default), Terminay consumes the escape sequences that shells and AI agents such as Claude Code and Codex CLI already emit, instead of guessing from raw output, which fixes spinner-driven flickering on agent tabs. The consumed sequences are:

- `OSC 9;4` progress (ConEmu/Windows Terminal) — drives the working dot, cleared when progress ends.
- `OSC 133` and `OSC 633` command markers (FinalTerm/VS Code shell integration, subcommands `A`/`B`/`C`/`D`) — track command start and finish.
- `OSC 777;notify;<title>;<body>` and `OSC 9;<message>` (iTerm2-style) notifications — raise the attention dot.
- Terminal `BEL` — raises the attention dot.

**Progress signal timeout** (default 15 seconds) sets how long without a progress update before a busy tab is treated as finished, so a crashed program cannot pin a tab busy forever. Sequences are consumed for state only and still pass through to the terminal unchanged.

### Run end-to-end tests

```bash
npm run test:e2e
```

### Build the app locally

```bash
npm run build
```

Platform-specific packaging is also available:

```bash
npm run build:mac
npm run build:linux
```

Release packaging syncs `package.json` from the release tag during CI, so the source tree can use the placeholder version while published builds carry the tagged version.
