# AGENTS — Terminay Cursor Agent extension

- This package is a public Terminay extension. Import only
  `@terminay/extension-api`; never import Terminay server-core, Electron,
  renderer, or workspace-private modules.
- Node.js APIs and declared dependencies are valid for ordinary local server
  work. Use the terminal observation API for terminal-scoped identity evidence.
- Bind a session only when the exact terminal process tree has a writable
  Cursor `store.db` descriptor. A title, cwd, transcript filename, or newest
  file is never sufficient evidence.
- Read only bounded Cursor metadata and the allowlisted lifecycle fields in a
  transcript. Never publish assistant content, tool input/output, reasoning,
  credentials, or raw native records.
- Cursor transcript task records do not currently provide stable child identity
  plus completion evidence. Do not infer subagents.
