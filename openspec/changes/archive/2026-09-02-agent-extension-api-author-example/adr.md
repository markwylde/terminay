# ADR Review

## In-force ADRs reviewed

- ADR-0001 — Pin the Node runtime, toolchain, and compile targets across every lane
- ADR-0003 — Hold server secrets in a vault with AES-256-GCM entries and platform key protectors
- ADR-0004 — Keep `node-pty` with one supervised child per PTY, and declare a bounded distribution matrix
- ADR-0008 — Ship the workspace UI from the server and keep Desktop and browser hosts protocol-blind
- ADR-0009 — Make the selected Terminay Server the sole owner of project environment connections
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review

Relevance to this change:

- ADR-0009 is the constraint the observation boundary follows from. Because the selected server owns every project-environment connection, an extension's Node filesystem and process access reaches the server account only, and terminal-scoped evidence for a non-local project must be routed through the environment's advertised capability.
- ADR-0008 keeps the authoring surface server-side. Desktop and browser hosts never install or execute an agent provider, so the SDK needs no client-host variant and the API exposes no renderer hook.
- ADR-0004 fixes the terminal identity an observation context is issued against: one supervised child per PTY, whose process boundary is what a provider proves ownership beneath.
- ADR-0011 governs the grants. Every capability the SDK exposes is scoped to a declared permission and a broker-issued terminal identity, and the handle-provenance rule is what keeps the terminal-session boundary intact.
- ADR-0003 bounds what the SDK may offer for secrets: resolution of the extension's own profile-bound fields through a scoped broker, never arbitrary vault ids.
- ADR-0001 fixes the Node engine range the example manifest declares.

ADR-0007 was reviewed and found superseded by ADR-0008; it is historical context only.

## Decisions recorded

_No durable architectural decisions were introduced by this change._

The authoring surface specifies how existing commitments are exposed to a package author. The extension boundary, the server-side execution rule, the environment routing rule, and the terminal-session boundary are all already in force; this change adds no new commitment and diverges from none of them.
