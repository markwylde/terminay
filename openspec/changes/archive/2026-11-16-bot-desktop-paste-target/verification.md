# Verification

## Unit tests

`node --test --test-force-exit --test-timeout=120000 --experimental-strip-types src/workspace/bots/desktopClipboard.test.ts`: 16 pass, 0 fail. Five of these are new or changed:

- A paste raised at a stale page selection still reaches the bot.
- A paste elsewhere in Terminay is left alone.
- The shortcut moves focus to the catcher until its paste arrives.
- Focus returns to the desktop when no paste comes.
- A modifier released while the catcher has focus is released in the bot.

## Chromium

`evidence/chromium-stale-selection-paste-check.mjs` loads the real module, bundled with esbuild, into the Chromium 1254 that ships in the e2e base image. The page fakes noVNC's canvas: it cancels mousedown, focuses the canvas on click and swallows keydown. The check selects text elsewhere on the page, clicks into the canvas and presses Ctrl+V:

```
previous: Range selection, focus #c ["novnc:ControlLeft","-ControlLeft"] focus #c
fixed:    Range selection, focus #c ["novnc:ControlLeft","clip:from mac host ✓","+ControlLeft","+KeyV","-KeyV","-ControlLeft"] focus #c
```

- **Previous wiring** (layer listener, no catcher). Nothing reaches the bot. This is the reported bug.
- **New wiring.** The host text reaches the bot once, the bot receives Ctrl+V, and focus is back on the desktop.

## Static checks

- `tsc --noEmit` passes.
- Biome passes on the changed files.
