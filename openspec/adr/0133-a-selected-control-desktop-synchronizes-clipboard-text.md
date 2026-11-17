# ADR-0133: A selected control desktop synchronizes clipboard text independently of paste shortcuts

Status: accepted, supersedes ADR-0129 in part and ADR-0132 in part
Date: 2026-11-16
Supersedes: ADR-0129 (clipboard initiation and focus gates only), ADR-0132 (Desktop paste-only initiation only)

## Context

A real Mac reproduction established that Cmd+V transfers text through the existing terminal bridge, while Control+V reaches the bot without transferring the host clipboard. Right-click Paste inside the bot browser is disabled when its clipboard has not been populated. The owner clarified that the required behavior is bidirectional clipboard synchronization: copying on either side should make text available to the other side's own Paste action.

ADR-0129 explicitly chose native paste as the only host-to-bot trigger and confined bot-to-host writes to focused control. ADR-0132 changed the read mechanism but retained shortcut-only initiation. These restrictions do not satisfy the clarified requirement. Their transport bounds, PRIMARY isolation, and view-only rules remain in force, as do ADR-0005's sandbox and exact-document binding and ADR-0112's separate terminal OSC 52 policy.

## Decision

1. A Desktop host shares clipboard text with one selected, connected control desktop, independently of a paste command. Host text seeds a new session; subsequent eligible changes propagate in both directions while sharing is active, including while another host application has focus.
2. The most recently selected control desktop owns sharing across the host's windows. Hiding the desktop behind another view, minimizing/hiding its window, disconnection, view-only, or document retirement ends its session. No old owner automatically resumes. Native clipboard access remains in Electron behind an explicitly declared, narrow, exact-document session capability.
3. Synchronizing publishes clipboard text without synthesizing paste keys. A bot application's context-menu Paste or Linux shortcut consumes the synchronized clipboard. Mac shortcuts remain conveniences and construct complete Linux chords independently of asynchronous host modifier releases.
4. Sessions serialize updates, suppress echoes, and fence pending work by generation. Clipboard text remains transient and bounded; files, images, PRIMARY highlighting, and view-only streams do not participate. The initial host seed must not be replaced by a delayed initial remote snapshot.
5. Browser hosts without a continuous clipboard capability retain native user-initiated paste and present that limitation honestly. No ambient browser read permission is granted.
6. ADR-0028 still governs observation. This record approves no periodic monitor. Prefer a usable native/runtime event; any fallback poll needs the owner's specific approval, recorded in the introducing change with its interval and lifecycle.

## Consequences

- Right-click Paste and Control+V can use text copied on the Mac without a preceding Command+V upload.
- The selected bot receives eligible text copied in other host applications, and can change the host clipboard while its window lacks focus. This is the requested control-mode sharing behavior; closing or leaving that desktop stops it.
- One host session must arbitrate multiple windows and retire stale asynchronous work. Equality and line-ending normalization are necessary to avoid clipboard echo loops.
- Continuous background observation is an implementation prerequisite, not an assumed Electron feature. The pinned main-process API documents no change event; a focus-scoped browser event alone is insufficient.

## Open items

- Establish a usable background event source, or obtain Mark's specific approval for the 500 ms, active-session-only main-process monitor in `openspec/changes/bot-desktop-clipboard-sync/design.md`.
- Verify real Mac right-click Paste against Xvnc, both copy directions, ownership replacement, startup ordering, and retirement before reporting implementation complete.
