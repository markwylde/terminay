# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-07
- Reviewer: Claude (with Mark Wylde)
- Change: fix-ai-tab-title-server-mutation

## In-Force ADR Context Reviewed

- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - Embedded and standalone servers are one server type; the design removes the embedded-only generation handler and shares one apply path.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - The renderer holds no authority; the design moves the title and note write from the client to the server.
- openspec/adr/0002-sqlite-state-repository.md - The new optional panel fields persist through the existing workspace state repository with no schema version change.
- openspec/adr/0011-security-trust-boundary-model.md - Client-supplied patches cannot set the metadata revision; provider output is applied by the server, not vouched for by a client.
- openspec/adr/0028-no-polling-without-owner-approval.md - Clients learn the result from pushed workspace state; nothing polls.
- All other in-force ADRs - Not affected: no transport, pairing, packaging, runtime, CI, extension, MCP, or automation changes.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The change brings the code into line with commitments already recorded: server-owned workspace state (including panel notes, per `server-owned-workspace-state`) and a single server implementation. The per-panel metadata revision is a field-level mechanism for one requirement, not a new pattern for other state.
