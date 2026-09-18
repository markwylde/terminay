# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-18
- Reviewer: Mark Wylde
- Change: lockable-mobile-modifiers

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - renderer code is untrusted. This change alters renderer-local modifier state and the bytes it composes before the panel's existing input boundary; no privileged call, IPC, or protocol message is added.
- openspec/adr/0012-pwa-framed-session-host.md - the framed browser session on a phone is where the accessory row appears; this change touches only its presentation and input composition.
- Also reviewed and not engaged by this change: 0001, 0002, 0003, 0004, 0005, 0006, 0010, 0013, 0014, 0015, 0016, 0017, 0018, 0019, 0020, 0021, 0022, 0023, 0024. Superseded and treated as history only: 0007 (by 0008), 0008 (by 0018), 0009 (by 0017).

## Repository-Level ADRs Created

- None: no durable architectural decision was introduced.

## Notes

The highest ADR sequence number in use is 0024.
