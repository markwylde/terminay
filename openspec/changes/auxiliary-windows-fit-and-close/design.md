## Context

`createWindow` gives auxiliary windows a fixed 1180×820 with a hidden macOS title bar, and `openAuxiliaryRoute` parents them to the project window. App commands from the menu and from `before-input-event` are posted to the focused window's renderer as `menu.command`; the native auxiliary document does not handle `close-active`.

## Decisions

- **Fit to the source window's display.** Opening an auxiliary window reads `screen.getDisplayMatching(sourceWindow.getBounds()).workArea` and clamps the preferred size to it, centred. The work area excludes the menu bar and Dock, so the title bar is always reachable. Reusing an already-open window leaves its bounds alone.
- **Close in the host, not the renderer.** The main process tracks auxiliary windows in a `WeakSet` (torn-off workspace windows share `auxiliaryWindowsByPresentation`, so that map cannot tell them apart) and turns `close-active` for one into `BrowserWindow.close()`. The existing `will-prevent-unload` prompt still guards unsaved macros. Doing it in the host covers every auxiliary route and both the menu and key paths.

## Risks

- A display change after opening is not refitted. macOS constrains ordinary moves, and the window now closes from the keyboard regardless.
