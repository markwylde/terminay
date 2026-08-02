# AGENTS — Terminay

Terminay is a local-first Electron terminal workspace. Product behaviour is
specified in `specs/`; read the relevant feature before changing code.

- Work feature-first: update `specs/features/` when behaviour, constraints, or
  acceptance expectations change, then implement and test it.
- Keep Electron privileged. Renderer code uses the preload API; filesystem,
  PTY, secrets, Git, and network services stay in `electron/`.
- Preserve the project/window and terminal-session boundaries. They are security
  boundaries for remote access, MCP, and agent status.
- Agents must run Electron end-to-end tests through `npm run test:e2e`, which
  isolates Electron, Chromium, and Xvfb in Docker. Never run Playwright's
  Electron suite directly on the host unless the user explicitly requests it;
  `npm run test:e2e:host` is reserved for isolated CI runners.
