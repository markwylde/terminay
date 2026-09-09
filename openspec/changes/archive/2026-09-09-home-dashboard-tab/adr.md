# ADR Review — home-dashboard-tab

ADR review completed for this change.

## In-force ADRs reviewed

Every file in `openspec/adr/` was read and the supersession graph built from each `Supersedes:` field. ADR-0007 is superseded by ADR-0008 and is historical context only. The currently in-force set is:

- ADR-0001 — Pinned Node runtime, toolchain, and compile targets
- ADR-0002 — SQLite through `node:sqlite` for the server state repository
- ADR-0003 — Vault interface and platform key protectors
- ADR-0004 — `node-pty` with one supervised child per PTY, bounded distribution matrix
- ADR-0005 — Sandboxed, origin-bound client hosts
- ADR-0006 — Terminay-owned Werift WebRTC runtime
- ADR-0008 — Server-bundled clients and protocol-blind hosts (supersedes ADR-0007)
- ADR-0009 — Server-owned project environments
- ADR-0010 — Provider-portable parallel pull-request CI
- ADR-0011 — Explicit trust-boundary model as the security contract
- ADR-0012 — PWA on the manager origin, framed session origin
- ADR-0013 — Device-bound host approval and channel-only credentials
- ADR-0014 — Declared provider capabilities proven against real CLIs

Highest sequence number in use: 0014.

## Decisions in this change measured against that set

The design introduces no new durable architectural commitment. Its decisions are renderer-local and tactical:

- **Selected view as a local discriminated state, Home rendered outside `ProjectTabList`, dashboard as a `.workspace-stack` sibling, CSS-only truncation** — component structure within the existing workspace UI. They bind no future change.
- **One widened panel-inventory publication feeding the dashboard, activity menu, and tab badges** — a consolidation inside `src/App.tsx`, not a new contract. The authority order it preserves (agent state over raw-output activity) is already normative in the `terminal-activity-signals` spec, which is the right home for it.
- **Per-device Home selection in `localStorage`** — an application of the existing canonical-state-versus-local-view separation already specified in `workspace-and-project-tabs` and `terminal-workspace`, not a new position.
- **`show-dashboard` as one more opaque host menu command name** — conforms to ADR-0008: the desktop menu forwards a name and the server-bundled UI decides what it means. Hosts stay protocol-blind.
- **No privileged boundary crossed** — the dashboard is renderer-only and performs no filesystem, PTY, or network operation, so ADR-0005 and ADR-0011 continue to hold unchanged.

No in-force ADR is diverged from, and none needs revisiting. No new repository-level ADR was created.
