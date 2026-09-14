# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-14
- Reviewer: Mark Wylde
- Change: compact-unified-switcher

## In-Force ADR Context Reviewed

Supersession graph walked across `openspec/adr/`: ADR-0007 is superseded by
ADR-0008, ADR-0008 by ADR-0018, and ADR-0009 by ADR-0017. Those three are
historical and did not constrain this design. The in-force set reviewed:

- openspec/adr/0001-pinned-node-runtime-baseline.md - no bearing; no runtime change.
- openspec/adr/0002-sqlite-state-repository.md - no bearing; this change persists nothing.
- openspec/adr/0003-vault-interface-and-key-protectors.md - no bearing; no secrets touched.
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - no bearing; no PTY change.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - directly relevant: the compact application menu stays host-supplied through the existing presentation boundary rather than reaching into the shared tree or a host global.
- openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md - no bearing; no transport change.
- openspec/adr/0010-provider-portable-parallel-pull-request-ci.md - relevant to verification: pull-request CI is the Gitea workflow set.
- openspec/adr/0011-security-trust-boundary-model.md - directly relevant: the preview line is a window-local buffer read, adding no protocol surface and no privileged capability; row activation reuses the existing composed-tab path so project and session boundaries stay enforced where they already are.
- openspec/adr/0012-pwa-framed-session-host.md - directly relevant: the framed session host is the narrowest surface this change targets, and the collapsed band must not reintroduce a fixed inset there.
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md - no bearing; no credential or approval flow change.
- openspec/adr/0014-declared-provider-capabilities-proven-against-real-clis.md - no bearing; no provider change.
- openspec/adr/0015-self-hosted-direct-signaling-exposure.md - relevant only in that the compact connection control keeps the exposure tone it already carries.
- openspec/adr/0016-self-contained-server-archives-and-release-channels.md - no bearing; no packaging change.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - directly relevant: switcher rows activate on their own server and never merge two servers' state into one row.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - directly relevant: one responsive bundle, so the compact presentation is a breakpoint inside the shared tree and host difference stays capability-shaped.
- openspec/adr/0019-language-intelligence-from-server-hosted-language-server-extensions.md - no bearing.
- openspec/adr/0020-per-operation-canonical-roots.md - no bearing; no filesystem operation.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Every decision in `design.md` is a presentation choice inside boundaries
ADR-0018, ADR-0011, and ADR-0005 already fix. The one decision that looked
ADR-shaped — routing the compact application menu through the host presentation
boundary — is an application of ADR-0005 and ADR-0018 rather than a new
commitment: it adds an optional capability-shaped field to a boundary those ADRs
already establish, and binds no future change to a new pattern.
