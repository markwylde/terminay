# AGENTS — Terminay Claude Code extension

- This is a public ESM Node.js extension. Import only `@terminay/extension-api`,
  Node built-ins, and dependencies declared in this package manifest.
- Do not import Server Core, Electron, renderer, host IPC internals, or another
  workspace package.
- Terminal identity comes only from the terminal-scoped observation broker. A
  title, journal filename, cwd, timestamp, or newest-file heuristic is never
  enough to bind a session.
- Read only allowlisted, bounded Claude journal fields. Never publish prompts
  other than the safe user preview, tool inputs/results, assistant text,
  credentials, local command metadata, or provider-private raw records.
- Keep fixtures synthetic. The opt-in real CLI smoke test must not mutate a
  user project or depend on credentials beyond an already authenticated CLI.
