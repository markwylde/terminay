## Why

The Notifications icon in the header carries one red number: the terminals that need attention plus the ones that finished unviewed. That number is only visible while a Terminay window is in view. With Terminay behind another app, minimised, or on another desktop, nothing says a terminal is waiting — which is exactly when it matters.

## What Changes

- Terminay Desktop shows the Notifications count on its application icon: the macOS Dock tile, and on Linux the launcher or taskbar entry of any desktop that implements the shared launcher-count convention.
- The icon number is the same number as the header: it rises, falls, and clears with it, including when a notification is dismissed or its terminal is viewed.
- With more than one native window open the icon shows the total across them, since each window's header counts only its own projects.
- At zero the icon carries no badge.
- Linux gets one implementation for every desktop. Where a desktop offers no launcher count the icon is simply unbadged; nothing desktop-specific is built.

Out of scope: a setting to turn the badge off, the Windows taskbar overlay, the installed PWA's icon badge, OS notification banners or sounds, and push notifications.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: adds the application icon badge that mirrors the Notifications count on Desktop.

## Impact

- Protocol: one new closed host action in `packages/protocol/src/host.ts` carrying a bounded non-negative integer, with parser coverage in `packages/protocol/test/host.test.mjs`.
- Desktop: `electron/main.ts` handles the action per window, sums across windows, and calls Electron's `app.setBadgeCount`; a small pure module holds the per-window bookkeeping.
- Renderer: `src/host/nativeActions.ts` gains the reporting call and `src/App.tsx` reports the count it already computes for the header. Browser and PWA hosts have no bridge and do nothing.
- No server, persistence, or settings change. No new dependency.
