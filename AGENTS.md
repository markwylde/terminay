# AGENTS — Terminay

Terminay is a local-first Electron terminal workspace. Product behaviour is
specified in `specs/`; read the relevant feature before changing code.

- Work feature-first: update `specs/features/` when behaviour, constraints, or
  acceptance expectations change, then implement and test it.
- Keep Electron privileged. Renderer code uses the preload API; filesystem,
  PTY, secrets, Git, and network services stay in `electron/`.
- Preserve the project/window and terminal-session boundaries. They are security
  boundaries for remote access, MCP, and agent status.
