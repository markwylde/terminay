# Termide

Termide is a desktop terminal workspace built with Electron, React, and Vite. It pairs native shell sessions with a dockable tabbed layout, so you can split terminals, rearrange them, and pop active work out into separate windows.

## What it does

- Open multiple terminal sessions in a single desktop app
- Split terminals horizontally and vertically
- Reorder tabs and organize them by workspace
- Pop active panels into separate windows
- Rename tabs and give them colors or emoji markers

## Stack

- Electron
- React
- Vite
- TypeScript
- xterm.js
- node-pty
- dockview

## Getting started

### Prerequisites

- Node.js 20+
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

### Build the app locally

```bash
npm run build
```

Platform-specific packaging is also available:

```bash
npm run build:mac
npm run build:linux
```

## Continuous integration

GitHub Actions is configured to:

- run linting and a production build smoke test on every pull request
- provide a manual `Trigger Release` workflow that creates a semantic release
- build macOS and Linux binaries for that release and attach them to GitHub Releases

The `Trigger Release` workflow expects an `OPENROUTER_API_KEY` repository secret so the AI release-notes step can run.

## Repository layout

```text
electron/           Electron main and preload processes
src/                React renderer application
public/             Icons and static assets
.github/workflows/  CI and build automation
```

## License

[MIT](./LICENSE)
