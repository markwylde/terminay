## Context

`SessionWorkspace` in `src/web/main.tsx` mounts the connections provider, upgrade board, and modal only when a primary workspace context exists. The registry clears that context on connection loss. The other branch draws the full-screen reconnect state, unmounting the progress UI and its board. The existing reconnect-overlay guard covers only the workspace branch.

## Goals / Non-Goals

Keep the same upgrade board and modal alive across context loss, timeout, and recovery. Preserve retry behaviour, authority checks, and normal disconnected controls.

## Decisions

Compose both connection presentations beneath one stable connections provider and upgrade board. Draw the single modal alongside the chosen presentation, above it through its existing fixed backdrop. This uses the current upgrade visibility policy, including initiated-here outcomes until closed. Merely changing z-index cannot fix an unmounted modal. Retaining a stale workspace context would risk operating through a retired connection and is unnecessary.

This is renderer presentation only. No privileged or server-authority boundary is crossed; unavailable workspace contexts remain unavailable.

## Risks / Trade-offs

- A slow or failed restart must still be recoverable → keep the ordinary disconnected surface underneath and let the existing outcome/close policy expose it.
- Moving providers could reset the board → keep one unconditional provider tree across all presentations and exercise a real timeout in the restart regression.

## Migration Plan

No data migration. Revert the rendering change to roll back.

## Open Questions

None.
