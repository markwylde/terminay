# AGENTS — Terminay Grok extension

- This is a public Terminay agent extension. Import only `@terminay/extension-api`
  and public Node.js modules; never import Server Core, Electron, renderer, or
  workspace-private files.
- Bind a Grok session only to a writable `events.jsonl` journal demonstrably
  owned by the issued terminal's process tree, or to Grok's pid-keyed
  `active_sessions.json` registry for a descendant of that tree. Never use cwd,
  timestamps, or newest-file discovery as identity evidence.
- Read only `events.jsonl` lifecycle records and the bounded title/model fields
  from the sibling `summary.json`. Never publish assistant output, reasoning,
  chat history, ACP updates, tool arguments, or tool output.
- Do not match the `agent` executable. Cursor already owns that name; Grok must
  be launched as `grok`.
- Mapping 0.1 does not invent child agents from `spawn_subagent` tool calls.
  Keep fixtures synthetic.
