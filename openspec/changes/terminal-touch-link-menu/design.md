## Context

A tap on the xterm surface replays a mouse move at the finger so xterm's link
providers resolve the link under it (`activateTerminalLinkAtTouch`), then
opens it through `createTerminalLinkInteraction`, which lets a touch
activation skip the modifier key. Opening goes through `openExternalUrl`:
the Desktop bridge, or `window.open` in a browser.

In an installed PWA the workspace runs framed inside `app.terminay.com`
(ADR-0012). `window.open` from a standalone PWA opens an in-app browser sheet
on both iOS and Android, not the user's browser app.

## Goals / Non-Goals

**Goals:**

- A tap on a link offers Copy Text, Copy Link, and Open Link rather than
  navigating.
- A way out of the PWA's in-app sheet into the real browser where the platform
  allows one.

**Non-Goals:**

- Changing mouse or trackpad link handling.
- Link menus in the file viewer, docs editor, or other non-terminal surfaces.

## Decisions

- **Every touch tap shows the menu**, not only standalone PWA mode. One
  behaviour across Safari tabs and the installed app, and no display-mode
  detection.
- **Touch activation never opens directly.** The `isTouchActivation` escape
  hatch in `createTerminalLinkInteraction` is removed; the tap path shows the
  menu, and xterm's own activation still requires the modifier. A tap on a
  link does not focus the terminal, so the keyboard does not cover the menu.
- **Copy Text is the visible text.** OSC-8 hover reports the buffer range, and
  the panel reads that range from the buffer. Detected web links are their
  own text.
- **Open Link runs from the menu button's click**, which carries user
  activation, so Safari does not block the window it opens.
- **Open in Browser uses platform URL schemes.** iOS 17+ opens
  `x-safari-https://…` in Safari. Android opens
  `intent://…#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=…;end`
  in Chrome. The item appears only where a scheme exists (iOS and Android
  browsers, not Desktop, which already opens the system browser). Only
  credential-free `http:`/`https:` URLs are converted.
- **The menu closes on the next terminal touch.** xterm cancels the
  compatibility mousedown a touch would send, so the shared `ContextMenu`
  outside-mousedown dismissal never sees taps on the terminal itself.

Boundary: the renderer trust boundary (ADR-0011). Terminal text is untrusted;
this change only copies it to the clipboard on a user's tap or passes a
validated http(s) URL to the same user-activated navigation that exists today.
No privileged call, IPC, or protocol message is added.

## Risks / Trade-offs

- The `x-safari-` and `intent:` schemes are undocumented or platform-specific
  and may stop working or prompt the user. Open Link remains alongside as the
  standard path.
- Opening a link on touch now takes two taps. That is the point.
