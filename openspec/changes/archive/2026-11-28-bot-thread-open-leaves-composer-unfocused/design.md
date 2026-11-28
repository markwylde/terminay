## Context

`BotThreadPanel` runs an effect on `rootId` that focuses its composer. `BotChat` keys the panel by root, so every opened thread mounts a fresh panel. The panel's Escape handler is on its `<aside>`, so Escape works only while focus is inside it. On a narrow chat the panel covers the main stream.

## Goals / Non-Goals

**Goals:** no text field focused on open; Escape and Tab keep working for keyboard users.

**Non-Goals:** changing focus on close, Quote, or the main composer; any touch-versus-desktop detection. No privileged boundary is crossed: this is renderer-only presentation.

## Decisions

- **Focus the panel `<aside>` (`tabIndex={-1}`, `preventScroll`) in the same effect.** Alternatives: leave focus where it was (Escape stops working, a menu-opened thread returns focus to the message, and a narrow panel leaves focus on a covered control); focus the close button (a stray Enter or Space closes the thread, and it draws a ring on a control the user did not choose).
- **Same behaviour on every device.** The user decided the composer is never focused on open, so there is no pointer-type branch.
- **Draw the panel's keyboard focus ring inset**, so the shared `:focus-visible` outline is not clipped at the panel's edges.
- **Keep Escape within the active surface.** A message menu or dialog blocks the panel's Escape dismissal. A menu restores focus to the exact message element that opened it, including the root's copy inside the panel, so a second Escape closes the panel. This uses renderer DOM references only and grants no project, session, or host authority.

## Risks / Trade-offs

- [Automation cannot observe a phone's on-screen keyboard] → E2E verifies that no text field has focus, which is what keeps a keyboard down. A check on a real phone is not automated; the pull request says so.
- [Desktop users now need a click or Tab before typing a reply] → Accepted by the user's decision.
- [The message menu hands focus back to its message when it closes] → It does so only when focus fell to the document body; the panel's effect runs first. Covered by e2e.
