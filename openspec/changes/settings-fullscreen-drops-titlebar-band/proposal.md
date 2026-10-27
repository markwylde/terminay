## Why

On macOS, Settings leaves a 28px band at the top of its sidebar and content for the traffic lights. In full screen macOS hides the traffic lights, but Settings keeps the band, so an empty gap sits above its header. The project window already drops its band in full screen.

## What Changes

- On macOS, native auxiliary windows (Settings and its siblings) drop the traffic-light band while the window is full screen and restore it when it leaves full screen. Windows' title-bar overlay is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: auxiliary windows reserve the macOS traffic-light band only while the traffic lights are shown.

## Impact

- `src/web/ConnectedWebRendererWorkspace.tsx`: the native auxiliary document follows the host's existing `window.fullscreen-state` event. No host or protocol change; Desktop already sends that event to every window, including on subscribe.
