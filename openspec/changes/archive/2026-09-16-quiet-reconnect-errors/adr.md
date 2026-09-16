# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-16
- Reviewer: Mark Wylde
- Change: quiet-reconnect-errors

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - renderer code is untrusted. This change reads connection phase the renderer already holds and changes what it renders; no privileged call, IPC, or protocol message is added.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - surfaces read their state from the connection that owns what they show. Both suppressions key on the owning connection's phase through `useServerConnection(serverId)`, so one server's reconnect never hides another server's failures.
- openspec/adr/0012-pwa-framed-session-host.md - the framed browser session is where transport loss is routine (sleep, tab switch, network handoff), which is why the reconnect must present as one state rather than three.
- openspec/adr/0022-watch-do-not-poll.md - the Git refresh schedule and presentation renewal keep running against the dying client; this change does not add polling or stop the existing schedule, it only stops reporting their transport failures during the reconnect.
- Also reviewed and not engaged by this change: 0001, 0002, 0003, 0004, 0005, 0006, 0010, 0013, 0014, 0015, 0016, 0017, 0019, 0020, 0021, 0023. Superseded and treated as history only: 0007 (by 0008), 0008 (by 0018), 0009 (by 0017).

## Repository-Level ADRs Created

- None: no durable architectural decision was introduced. The change applies the existing rule that a surface reads its state from its owning connection to two error presentations.

## Notes

The highest ADR sequence number in use is 0023.
