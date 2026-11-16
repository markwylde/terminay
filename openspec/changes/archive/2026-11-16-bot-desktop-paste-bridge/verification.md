# Verification

## Unit tests

`node --test --test-force-exit --test-timeout=120000 --experimental-strip-types src/workspace/bots/desktopClipboard.test.ts` passed 19 tests with 0 failures. Three tests are new and cover the bridge path:

- The shortcut is cancelled, the bridge is read once, and the macOS chord is sent: release Alt_L, then Ctrl+V, then press Alt_L again.
- If Cmd is released before the read resolves, it is not pressed again.
- An empty read, an oversized read and a rejected read each send nothing. Only the oversized read reports "too large".

## Electron

The test files are in `evidence/` (`main.cjs`, `preload.cjs`, `page.html`, `check.mjs`). They ran in `terminay-e2e:local-amd64` under `xvfb-run`, with that image's Electron. The setup matches Terminay:

- an Edit menu with `role: 'paste'`;
- a preload bridge whose main-process handler awaits `clipboard.readText()`;
- a fake noVNC canvas that cancels mousedown and swallows keydown.

The real `desktopClipboard.ts` is bundled into `dc.js` with esbuild. Before each run the host clipboard is set in the main process. The test then selects text elsewhere on the page, clicks the canvas and presses Ctrl+V:

```
bridge: ["novnc:ControlLeft","read","got:{\"kind\":\"text\",\"text\":\"from host ✓ café\"}","clip:from host ✓ café","-ControlLeft","+ControlLeft","+KeyV","-KeyV","-ControlLeft","+ControlLeft"] focus c
native: ["novnc:ControlLeft","clip:from host ✓ café","+ControlLeft","+KeyV","-KeyV","-ControlLeft"] focus c
bridge: ["novnc:ControlLeft","read","got:{\"kind\":\"text\",\"text\":\"from host ✓ café\"}","clip:from host ✓ café","-ControlLeft","+ControlLeft","+KeyV","-KeyV","-ControlLeft","+ControlLeft"] focus c
```

The bridge path read the host clipboard in the main process. It sent the text once and pressed Ctrl+V in the bot, and focus stayed on the desktop.

This setup cannot show the macOS failure itself: Linux Electron also raised the native paste. The bridge path does not depend on that event, which is the reason for this change. A macOS check in the user's deployed app is still pending.

## Static checks

`tsc --noEmit` and Biome pass.
