# Verification — bot-desktop-clipboard

## Real-protocol check against Xvnc 1.15 (task 4.1)

Run on 2026-11-16 with [evidence/xvnc-clipboard-check.mjs](evidence/xvnc-clipboard-check.mjs). The script sends every client message through `BotRfbClientFilter('control')`.

```sh
docker run --rm -v "$WORKTREE:/w:ro" -v "$EVIDENCE:/check:ro" docker.io/library/node:26.13.0-trixie-slim sh -c '
  apt-get update -qq && apt-get install -y -qq --no-install-recommends tigervnc-standalone-server tigervnc-tools xclip
  Xvnc :1 -rfbport 5901 -SecurityTypes None -ac -localhost yes -geometry 800x600 -depth 24 -AlwaysShared -SendPrimary=0 -MaxCutText=1048576 &
  Xvnc :2 -rfbport 5902 -SecurityTypes None -ac -localhost yes &
  sleep 2; node /check/xvnc-clipboard-check.mjs'
```

Output, with tigervnc-standalone-server 1.15.0+dfsg-2.1~deb13u1:

```
PASS server offers ExtendedClipboard caps
PASS Xvnc does not request before an application pastes
PASS the paste makes Xvnc request the text
PASS the application receives the UTF-8 text — "café ✓ — 漢字\nline2"
PASS bot copy is notified
PASS bot → device UTF-8 decodes — "from bot ✓"
PASS a PRIMARY-only selection sends nothing
PASS legacy Latin-1 cut text lands in CLIPBOARD
PASS runtime SendPrimary=0 on an older Xvnc — on → off
PASS new Xvnc has MaxCutText 1 MiB
exit=0
```

Xvnc requests the text only when an X application pastes. The bot's paste chord is that request, so the chord can follow the Notify immediately. This confirms the ordering in design decision 1.

## Native paste on a non-editable canvas (design decision 1)

Script: [evidence/chromium-native-paste-check.mjs](evidence/chromium-native-paste-check.mjs). It runs Playwright Chromium in the repo's `terminay-e2e-base` image, with no Electron. A capture listener stops the paste shortcut. Below it, a stand-in for noVNC cancels every key it sees.

```
Control+V ["novnc:ControlLeft","paste:café ✓ from host"]
Control+Shift+V ["novnc:ControlLeft","novnc:ShiftLeft","paste:café ✓ from host"]
Shift+Insert ["novnc:ShiftLeft","paste:café ✓ from host"]
Control+B ["novnc:ControlLeft","novnc:KeyB"]
```

Each shortcut raises exactly one native `paste` event with the host text, and noVNC never receives the V or Insert key. Other shortcuts still reach noVNC. On macOS Desktop, Cmd+V reaches the canvas through the application menu's `paste` role (`electron/main.ts`, Edit menu), which raises the same event.

## Spec coverage

| Spec item | Evidence |
|---|---|
| Allowlist accepts extended `ClientCutText` (4 B to 1 MiB) and drops it in view-only | `bot-rfb.test.mjs`: extended pass/drop at every split, and the size and flags bounds |
| `SetEncodings` keeps ExtendedClipboard | `bot-rfb.test.mjs` |
| Bot to device, gated on control mode, desktop focus, document focus and visibility | `desktopClipboard.test.ts` covers all 16 gate combinations and the controller drop cases |
| Bot to device rejects control characters, empty text, and text over 1 MiB | `desktopClipboard.test.ts` |
| Device to bot uses only the native paste, exactly once | `desktopClipboard.test.ts` controller test; Chromium check above |
| Paste on macOS: Ctrl+V with no Alt or Super | `desktopClipboard.test.ts`, both Cmd keys |
| Paste with no text, or too large | `desktopClipboard.test.ts`; `BotDesktopView` bar message |
| Selection alone, including older containers | `bot-init.test.mjs` argv; `bot-rfb.test.mjs` runtime `vncconfig` at control open; Xvnc check |
| Unicode in both directions | Xvnc check |
| View-only and thumbnail | Relay discard tests; the viewer attaches only for a control-mode, non-thumbnail stream; noVNC ignores clipboard while `viewOnly` |

Known limit: a container created before this change keeps Xvnc's 256 KiB `MaxCutText` until it is recreated. Its image fingerprint changes, so it is recreated at its next start. A paste between 256 KiB and 1 MiB is ignored there until then. The design's Risks section records this.

## `openspec validate --all`

`bot-desktop-clipboard` is valid. Seven changes fail validation, and they already failed on `main` before this change: `add-terminay-bots`, `bot-chat-image-attachments`, `linked-folders`, `one-window-one-server`, `outbound-bot-triggers`, `server-notification-manager` and `unified-settings-window`. They are outside this change's scope.
