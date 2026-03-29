# Termide

Termide is a desktop terminal workspace built with Electron, React, and Vite. It pairs native shell sessions with a dockable tabbed layout, so you can split terminals, rearrange them, and pop active work out into separate windows.

![Termide screenshot](./screenshot1.png)

## What it does

- Open multiple terminal sessions in a single desktop app
- Split terminals horizontally and vertically
- Reorder tabs and organize them by workspace
- Pop active panels into separate windows
- Rename tabs and give them colors or emoji markers

## Getting started

### Prerequisites

- Node.js 24+
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
