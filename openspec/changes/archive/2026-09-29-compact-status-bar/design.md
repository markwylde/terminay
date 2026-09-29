## Context

`isStatusBarVisible` in `App.tsx` is `showStatusBar && !isCompactChrome`. The browser host's View menu reads the published value of `showStatusBar` alone, so at phone width it shows a check mark for a bar that is never rendered, and toggling flips a preference that has no effect there.

## Goals / Non-Goals

**Goals:**
- Hidden by default at phone width, and the menu says so.
- Toggling the command at phone width shows or hides the bar there.

**Non-Goals:**
- Redesigning the bar's content for narrow widths; it keeps its existing overflow clipping.
- Reflecting compact state in the native Electron menu, which is built from settings and never sees the renderer's layout.

## Decisions

- **Two preferences, one per layout.** `showStatusBar` (default shown) governs the regular layout and `showStatusBarCompact` (default hidden) governs compact chrome. A single preference would force a choice between showing the bar on phones by default or hiding it on desktops after a phone toggle. Both are device-local, so a phone's choice does not reach a desktop through server settings.
- **Toggle what you see.** The command flips the preference for the layout in effect, and the published visibility is the effective one, so the check mark always matches the screen.

## Risks / Trade-offs

- A desktop window narrowed to compact width uses the compact preference while the native menu's check mark shows the regular one → acceptable; the native menu has no layout signal and narrow desktop windows are uncommon.
