## Context

`src/App.tsx` already computes the header number: `buildTerminalActivityOverview` over the notable inventory of every project in the window, across every attached server, yielding `notificationCount`. It is renderer state; the Electron main process knows nothing about it.

The renderer reaches Desktop only through the closed host action set in `packages/protocol/src/host.ts`, parsed in the preload and again in main, and dispatched per window in `onHostAction` in `electron/main.ts`. `menu.accelerators.update` is the existing precedent for a renderer pushing presentation state to the host without a user gesture behind it.

Projects live in exactly one native window at a time (tear-off moves, never copies), so each window's count covers a disjoint set of terminals.

Electron exposes one call for this, `app.setBadgeCount(n)`. On macOS it sets the Dock tile badge. On Linux it emits the `com.canonical.Unity.LauncherEntry` D-Bus signal keyed by the app's desktop file — the de facto shared convention, read by Ubuntu Dock, Dash to Dock, KDE Plasma's task manager, and others. Stock GNOME Shell without a dock extension reads nothing and shows nothing. On Windows the call is a no-op.

In-force ADRs constrain this: ADR-0011 (renderer is untrusted at the privileged boundary), ADR-0018 (one workspace bundle, hosts are protocol-blind), ADR-0028 (no polling).

## Goals / Non-Goals

**Goals:**

- The application icon shows the header's number, always, with no second definition of "unread".
- One code path for macOS and Linux.
- Correct totals with several native windows, and no stale badge after a window closes or the app quits.

**Non-Goals:**

- No setting, no Windows overlay icon, no PWA `setAppBadge`, no OS notification banners, no push.
- No desktop-environment-specific Linux code and no detection of whether the launcher honours the count.
- No server or persistence change; the count is not stored.

## Decisions

### The renderer reports its window's count; main only sums

A new host action `badge.count.set` carries `{ count }`. The renderer sends the header's `notificationCount` from an effect whenever it changes, and once on mount. Main keeps a count per window web contents, recomputes the sum on every report, and calls `app.setBadgeCount(sum)`.

This crosses the renderer-to-host privileged boundary (ADR-0011). It stays narrow: the payload is one integer, validated by the protocol parser on both sides (integer, `0..9999`), attributed to the sending window by the existing window binding rather than by anything in the payload, and able to affect only a number on the app's own icon. It carries no titles, project ids, or server ids, so the host stays protocol-blind (ADR-0018) and nothing crosses the project/window or terminal-session boundary.

Alternative considered: main derives the count itself from server activity streams. Rejected — it would be a second definition of the number, would have to re-implement the activity settings and acknowledgement filtering the renderer applies, and would make the host protocol-aware.

Alternative considered: report the notification list and let main count. Rejected — it sends terminal detail across the boundary for no benefit.

### Per-window bookkeeping in a small pure module

`electron/appBadge.ts` exports a tracker with `set(windowId, count)`, `clear(windowId)`, and `total()`, taking the `setBadgeCount` function as a dependency. `main.ts` wires it to `app.setBadgeCount`, calls `clear` from the window's existing `closed` handler and when the window's document navigates or reloads (so a renderer that never reports again does not leave its old count in the sum), and sets zero during quit so a Linux launcher does not keep the last value. The tracker skips the native call when the total is unchanged.

Keeping it out of `main.ts` makes the summing and clearing testable in a Node test under `scripts/`, following `electron/AGENTS.md`.

### Event-driven, no timer

The renderer effect fires on count change; main recomputes on report and on window close. Nothing polls (ADR-0028).

### Linux: rely on Electron's Unity launcher signal, nothing else

`app.setBadgeCount` is called unconditionally on every platform and its boolean result is ignored. Whether a badge appears is the desktop's business. Packaged builds already install a desktop entry; the task list confirms Electron resolves the same desktop file name the package installs, since the launcher matches on it.

Alternative considered: per-desktop integrations (GNOME extension, KDE-specific API, tray icon overlays). Rejected by the owner's request — one standard path or nothing.

### The count is shown uncapped to the OS

The header caps its display at `99+`; the icon gets the raw number and the OS formats it. The protocol bound of 9999 exists only to reject nonsense.

## Risks / Trade-offs

- [Stock GNOME shows no badge] → Accepted and specified; it works wherever a dock or task manager implements the launcher count.
- [A renderer that hangs or crashes keeps its last count in the sum] → Cleared on window close, on navigation/reload, and on `render-process-gone`.
- [An unpackaged development run on Linux has no matching desktop entry, so no badge appears] → Expected; verified in a packaged build only.
- [The badge cannot be seen in the Docker e2e environment, which has no Dock or launcher] → Cover the parser and the tracker with Node tests, assert the host total through a test seam, and check the Dock by eye on macOS.
- [Users who dislike the badge cannot turn it off in Terminay] → Out of scope by request; a setting can be added later without changing this contract.

## Migration Plan

Additive. The new action is unknown to an older host, so the renderer treats a rejected report as a no-op. Rollback is reverting the change.

## Open Questions

None. No in-force ADR needs revisiting.
