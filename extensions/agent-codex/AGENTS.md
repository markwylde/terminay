# AGENTS — Terminay Codex extension

- This is a public Terminay agent extension. Import only `@terminay/extension-api`
  and public Node.js modules; never import Server Core, Electron, renderer, or
  workspace-private files.
- Bind a Codex rollout only to a writable journal demonstrably owned by the
  issued terminal's process tree. Never use cwd, timestamps, or newest-file
  discovery as identity evidence.
- Publish only bounded lifecycle metadata. Prompts are intentionally bounded;
  assistant output, reasoning, command arguments, tool output, and image data
  must never cross the extension host boundary.
