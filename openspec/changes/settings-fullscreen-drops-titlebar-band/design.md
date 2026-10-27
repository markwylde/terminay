## Context

The native auxiliary document sets `data-native-titlebar="mac"`, which gives Settings `--settings-chrome-top: 28px`. The project window drops its equivalent inset with `subscribeWindowFullScreenState`. Desktop sends `window.fullscreen-state` to every window on enter, on leave, and when its renderer subscribes.

## Decisions

- On macOS the auxiliary document subscribes to the same event and omits `data-native-titlebar` while full screen, so the band is 0. Reusing the event keeps one source of truth for full-screen state and needs no host change.
- Windows keeps its overlay inset: its title-bar overlay is not hidden the same way, and the report is macOS-only.
