# AGENTS — Terminay

Terminay is a local-first Electron terminal workspace. Product behaviour is
specified in `specs/`; read the relevant feature before changing code.

- Never make changes in the main clone. Create and use a dedicated Git worktree
  for every implementation or documentation change.
- Work feature-first: update `specs/features/` when behaviour, constraints, or
  acceptance expectations change, then implement and test it.
- Keep Electron privileged. Renderer code uses the preload API; filesystem,
  PTY, secrets, Git, and network services stay in `electron/`.
- Preserve the project/window and terminal-session boundaries. They are security
  boundaries for remote access, MCP, and agent status.
- Prefer local data and OS-backed secret storage. Do not log terminal contents,
  credentials, pairing material, or capability tokens.
- Run the smallest relevant test plus `npm run smoke` before handing off a code
  change.
- Add a concise local `AGENTS.md` when introducing a significant new subsystem.
