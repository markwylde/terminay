# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-17
- Reviewer: Claude (for Mark Wylde)
- Change: whats-new-home-section

## In-Force ADR Context Reviewed

- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - server UI runs sandboxed and origin-bound; the What's New frame is nested inside it and gains nothing from the host.
- openspec/adr/0011-security-trust-boundary-model.md - renderer content is untrusted; the frame's only channel is a closed, origin-checked message schema.
- openspec/adr/0028-no-polling-without-owner-approval.md - the unread check is on demand (start, selecting Home), throttled, never on a timer.
- openspec/adr/0038-app-views-run-in-a-self-sandboxing-proxy.md - avoided loosening the workspace CSP for untrusted HTML; this change admits one fixed first-party origin instead, keeping `'self'` for those frames.
- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - What's New is a Home tab, and its viewed state is device-local presentation.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - renderer-only change inside the host bundle; no protocol or server surface.
- openspec/adr/0106 (forge sections on Home) - Pull Requests and Issues remain conditional; the restated sidebar requirement reflects that.

## Repository-Level ADRs Created

- openspec/adr/0136-the-workspace-admits-terminay-com-as-its-only-hosted-content-origin.md - `https://terminay.com` is the workspace's only hosted content origin, framed sandboxed, contacted data-blind, and talking back only through a closed `ready` / `open-external` bridge.

## Notes

No prior ADR is superseded.
