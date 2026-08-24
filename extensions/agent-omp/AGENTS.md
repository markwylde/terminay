# AGENTS — Terminay omp agent extension

- This is a public Terminay Node.js extension. Import only
  `@terminay/extension-api` and Node built-ins; never import Terminay Server
  Core, Electron, renderer, or host-private modules.
- Session ownership must be proven by OMP's terminal breadcrumb for the exact
  PTY. Never select a journal by cwd, modification time, or a newest-file scan.
- OMP's first 256 journal bytes are a mutable title slot, not a JSONL record or
  identity. Do not surface assistant text, tool arguments, tool output, paths,
  profile data, or breadcrumb contents.
- OMP does not persist enough permission-prompt information for `waiting` or
  `blocked` state. Do not infer either state.
