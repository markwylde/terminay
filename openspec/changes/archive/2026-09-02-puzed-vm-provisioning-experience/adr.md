# ADR Review

## In-force ADRs reviewed

- ADR-0003 — Hold server secrets in a vault with AES-256-GCM entries and platform key protectors
- ADR-0009 — Make the selected Terminay Server the sole owner of project environment connections
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review
- ADR-0008 — Ship the workspace UI from the server and keep Desktop and browser hosts protocol-blind

Relevance to this change:

- ADR-0009 is why the compatibility preflight is server-side. The selected server owns the project-environment connection, derives it from canonical state, and cannot let a client-supplied worker, bridge, host, or address redirect a create.
- ADR-0003 governs the dedicated SSH keypair generated for a created VM: the private half exists only as an SSH-owned vault binding, and only the public half enters the Puzed request. It is also why the preflight runs before binding generation, so a rejected attempt mints no key material.
- ADR-0011 sets the redaction and boundary expectations a Puzed rejection must satisfy — a bounded provider-neutral error in the UI, audit records, and logs, with no raw provider payload or secret.
- ADR-0008 keeps the create form on the server-bundled workspace UI, so the corrected form ships with the server that validates it and there is no separately versioned Desktop create journey.

ADR-0007 was reviewed and found superseded by ADR-0008; it is historical context only.

## Decisions recorded

_No durable architectural decisions were introduced by this change._

Worker-scoped bridge discovery and the pre-create preflight are provider-level corrections inside the ownership model ADR-0009 already fixes. They introduce no new architectural commitment and diverge from no in-force ADR.
