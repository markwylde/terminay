# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-19
- Reviewer: Mark Wylde
- Change: terminal-touch-link-menu

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - terminal content is untrusted renderer data. This change copies it to the clipboard or passes a validated http(s) URL to user-activated navigation; no privileged call, IPC, or protocol message is added.
- openspec/adr/0012-pwa-framed-session-host.md - the framed session in the installed PWA is where links open in an in-app sheet; Open in Browser leaves it through platform URL schemes without changing the framing.
- Also reviewed and not engaged by this change: 0001, 0002, 0003, 0004, 0005, 0006, 0010, 0013, 0014, 0015, 0016, 0017, 0018, 0019, 0020, 0021, 0022, 0023, 0024. Superseded and treated as history only: 0007 (by 0008), 0008 (by 0018), 0009 (by 0017).

## Repository-Level ADRs Created

- None: no durable architectural decision was introduced.

## Notes

The highest ADR sequence number in use is 0024.
