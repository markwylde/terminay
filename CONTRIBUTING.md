# Contributing

Read [AGENTS.md](AGENTS.md) first. It covers the OpenSpec workflow, the
engineering boundaries, and how the Gitea remote and CI work.

## Prerequisites

- Node.js 22+
- npm 10+
- Docker, for the end-to-end tests

## Develop

```bash
npm ci
npm run dev
```

A build run from source keeps its state in its own `Terminay Development`
data directory, so it never reads or changes an installed Terminay's. Nothing
has to be set for that. To run a second development build beside the first, or
to start from empty state, give it a data directory of its own:

```bash
TERMINAY_USER_DATA_DIR=/path/to/any/directory npm run dev
```

The directory can be at any path, however long.

In a fresh checkout or worktree, build the workspaces once before the first
`npm run dev`:

```bash
npx turbo run build:dev-desktop
```

## Check

```bash
npm run smoke      # Biome lint, TypeScript, and the Vite build
npm run test:e2e   # Electron end-to-end tests in Docker
npm run test:e2e -- e2e/settings.spec.ts:212
```

The end-to-end tests run inside a pinned Linux container so they never open
windows on your desktop. Reports and failure traces are copied to
`.docker-cache/e2e/<run>/`.

## Build

```bash
npm run build
npm run build:mac
npm run build:linux
```

The source tree keeps a placeholder version. Release CI sets `package.json`
from the release tag.
