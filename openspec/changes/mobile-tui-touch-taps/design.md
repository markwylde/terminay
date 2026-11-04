## Context

xterm cancels compatibility mouse events to own touch panning. TerminalPanel already recognizes taps separately and resolves touch links before focusing. Desktop mouse input already reaches the PTY via xterm's encoding and the panel's attachment queue.

## Goals / Non-Goals

**Goals:** Make stationary non-link taps activate mouse-reporting TUIs exactly once, preserving existing gesture priorities and both SGR and binary mouse protocols.

**Non-Goals:** Touch drag reporting, new scroll behavior, or changes to agent programs and terminal transport.

## Decisions

Resolve selection and links first. For remaining taps, check xterm's public mouseTrackingMode and dispatch a primary mousedown and mouseup at the release coordinates through the terminal DOM. This retains xterm's encoding, coordinates, protocol filtering, and attachment input boundary. Directly constructing PTY bytes would duplicate those responsibilities. Sending on pointerdown would activate controls during pans and selection, so defer until tap recognition on release. Share the path between pointer events and legacy touch events.

The renderer-to-server security boundary remains the existing panel input queue. No new authority or host API is introduced; ADR-0005 remains satisfied.

## Risks / Trade-offs

- Duplicate presses or accidental activation during scrolling → real touch E2E asserts exactly one press/release and pans produce only wheel reports.
- Link and selection interference → existing link-first/selection-first routing remains, with regression tests.
- Browser differences → cover pointer and legacy handler paths in focused tests; physical iOS keyboard behavior remains outside Chromium evidence.

## Migration Plan

No data migration. Rollback removes the tap bridge.

## Open Questions

None.
