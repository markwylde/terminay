# AGENTS — renderer

The renderer owns workspace interaction and presentation only.

- Use `window.terminay` from the preload contract for privileged operations;
  never import Node/Electron APIs into renderer code.
- Preserve Dockview panel parameters across moves, popouts, and project/window
  adoption. A terminal session is identified by its session ID, not its title.
- Keep settings normalization and command metadata centralized in their existing
  modules, and cover user-visible changes with an E2E test where practical.

