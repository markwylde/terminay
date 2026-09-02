# ADR Review

## In-force ADRs reviewed
- ADR-0001 — Pin the Node runtime, toolchain, and compile targets across every lane
- ADR-0004 — Keep `node-pty` with one supervised child per PTY, and declare a bounded distribution matrix
- ADR-0008 — Ship the workspace UI from the server and keep Desktop and browser hosts protocol-blind
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review

## Decisions recorded
_No durable architectural decisions were introduced by this change._ The pinned
`@xterm/headless` and `@xterm/addon-serialize` versions follow ADR-0001's
pinning rule, and the checkpoint boundary is scoped by the terminal-session
trust boundary recorded in ADR-0011.
