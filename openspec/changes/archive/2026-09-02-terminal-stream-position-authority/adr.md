# ADR Review

## In-force ADRs reviewed

- ADR-0001 — Pin the Node runtime, toolchain, and compile targets across every lane
- ADR-0004 — Keep `node-pty` with one supervised child per PTY, and declare a bounded distribution matrix
- ADR-0005 — Load server UI in a sandboxed, origin-bound partition in both Desktop and browser hosts
- ADR-0006 — Use a Terminay-owned deterministic Werift ESM artifact as the headless WebRTC runtime
- ADR-0008 — Ship the workspace UI from the server and keep Desktop and browser hosts protocol-blind
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review
- ADR-0012 — Keep the installable PWA on the manager origin and frame the session origin

Relevance to this change:

- ADR-0004 constrains the producer side. The server must keep consuming PTY output into bounded replay and checkpoint state; nothing in this change may block or pause a supervised PTY child to make a slow presentation converge.
- ADR-0008 is what makes removing `resync_required` outright acceptable. Because the workspace UI ships from the server and Desktop and browser hosts are protocol-blind, server and clients are versioned together and no mixed-version wire compatibility window is owed.
- ADR-0006 and ADR-0012 fix the transports the skip marker must traverse unchanged: the change alters only the application-level representation of a discontinuity, not the WebRTC runtime, the framed session host, or the byte transport beneath either.
- ADR-0011 governs the boundary the change works inside. The terminal-session identity remains the authority for delivery, skips are scoped to one exact attachment identity, carry no terminal content, and are authored only by the server.
- ADR-0005 and ADR-0001 were reviewed and place no constraint that this change tests.

ADR-0007 was reviewed and found superseded by ADR-0008; it is historical context only.

## Decisions recorded

_No durable architectural decisions were introduced by this change._

The in-band skip marker, the three position owners, and the attachment-replacement suppression exit are the terminal-stream contract recorded in `specs/terminal-stream-congestion-and-recovery/spec.md` rather than a new repository-wide architectural commitment. They sit inside the boundaries ADR-0004, ADR-0008, and ADR-0011 already fix, and diverge from none of them.
