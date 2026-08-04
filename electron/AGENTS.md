# AGENTS — Electron main process

Electron owns privileged services and exposes narrow, validated IPC through
`preload.ts`.

- Keep PTY, filesystem, Git, recording, secret storage, agent hooks, MCP, and
  remote services out of the renderer.
- Validate IPC input and enforce the requesting window/project/session scope.
- Treat terminal output, device credentials, pairing secrets, and MCP tokens as
  sensitive. Persist only what the relevant feature specification permits.
- Add focused Node tests for service/protocol changes in `scripts/`.

