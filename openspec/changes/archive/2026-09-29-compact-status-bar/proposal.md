## Why

In the compact chrome layout the status bar is always hidden, yet the View menu still shows **Show Status Bar** as checked and toggling it does nothing visible. The menu lies about the bar, and a phone user who wants the bar cannot get it.

## What Changes

- The compact chrome layout gets its own device-local status bar preference, hidden by default.
- **Show Status Bar** toggles the preference for the layout currently in effect, so toggling it on at phone width shows the bar.
- The View menu check mark, in the browser host's in-page menu, reflects whether the bar is actually shown.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `workspace-status-bar`: the status bar may be shown in the compact chrome layout, governed by a separate preference that defaults to hidden.

## Impact

- `src/types/settings.ts`, `src/terminalSettings.ts` and its status bar test: new `showStatusBarCompact` device setting.
- `src/App.tsx`: visibility and toggle follow the layout in effect; the effective visibility is published to the browser host's menu.
- No protocol, security-boundary or packaging changes.
