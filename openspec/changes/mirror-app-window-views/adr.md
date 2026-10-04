# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-04
- Reviewer: Claude (with Mark Wylde)
- Change: mirror-app-window-views

## In-Force ADR Context Reviewed

The supersession graph was built from the index in `openspec/adr/README.md`;
0001, 0004, 0007, 0008, 0009, 0014, 0022, 0024, 0030 and 0032 are superseded and
were treated as history only. In-force ADRs that constrain this change:

- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - the workspace partition the mirror's sandbox sits beside.
- openspec/adr/0011-security-trust-boundary-model.md - a recording is untrusted view content at the workspace and server boundaries.
- openspec/adr/0012-pwa-framed-session-host.md - hosted sessions frame the same proxy; the mirror must need nothing more from that surface.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the mirror is a negotiated capability in one bundle.
- openspec/adr/0028-no-polling-without-owner-approval.md - flow control and recovery are acknowledgement- and request-driven, never timed.
- openspec/adr/0036-five-minute-ci-budget-with-parallel-gates-and-eighteen-shards.md - new E2E must fit the shard budget.
- openspec/adr/0037-mcp-apps-reach-terminals-through-a-terminay-gateway.md - windows are server-owned state of one terminal session; the new holder rebuilds a view from that record.
- openspec/adr/0038-app-views-run-in-a-self-sandboxing-proxy.md - the mirror runs in the same proxy, unchanged.

Reviewed and not constraining: 0002, 0003, 0006, 0010, 0013, 0015, 0016, 0017,
0019, 0020, 0021, 0023, 0025, 0026, 0027, 0029, 0031, 0033, 0034, 0035.

## Repository-Level ADRs Created

- openspec/adr/0039-app-views-are-mirrored-from-the-controlling-client.md - a view runs only on the controlling client and is mirrored to observers as a recorded DOM stream; the server relays and stores nothing; shared-by-protocol window sources do not use the mirror.

## Notes

- No in-force ADR is superseded. ADR-0038's isolation is reused as is.
- ADR-0039 rests on one unmeasured point: the replayer working inside an opaque-origin document. Task 1.1 measures it before any other work, and records the result in `openspec/adr/evidence/`. If it fails and the stated fallback fails too, ADR-0039 is superseded before implementation continues.
