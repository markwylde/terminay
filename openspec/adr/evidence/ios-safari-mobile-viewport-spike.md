# iOS Safari xterm mobile-viewport evidence

Date: 2026-07-27

This is client-host composition evidence for
[Server architecture decision spikes](../../changes/archive/2026-07-27-server-architecture-decision-spikes/).
It supplements the Chromium host-isolation test with a real iOS Simulator
Safari/WebKit run. It does not claim physical-iPhone coverage or prove the
eventual complete Terminay Web application.

## Environment

- Xcode `26.6` (`17F113`)
- iOS Simulator runtime `26.5` (`23F77`)
- clean iPhone 17 Pro simulator
- Mobile Safari from that runtime
- `@xterm/xterm` `6.0.0` from the repository lockfile
- the distinct parent and session origins from
  `e2e/support/web-client-host-fixture.ts`
- direct Simulator accessibility, tap, text, and screenshot control through
  `idb`/`idb_companion`

The proof uses the fixture's `/mobile-viewport-probe` route. The parent owns a
single exact-origin sandboxed session iframe. The session loads the real xterm
browser build, not the plain input used by the original host-contract test.
Both documents observe their actual `window.visualViewport`; the parent binds
the session shell height to the visual viewport, and the session resizes xterm
from its measured container.

The probe sends bounded diagnostic events back to its in-memory fixture
server. Each event records the active element, xterm data received, layout and
visual viewport heights, visual offset, and terminal bounds. The diagnostic
endpoint is confined to the test fixture.

## Observations

The clean run produced this state sequence:

| State | Active element | Typed | Layout / visual height | Terminal bounds |
| --- | --- | --- | ---: | ---: |
| Initial | `BODY` | empty | `714 / 714` | `48–708` |
| xterm focused | `TEXTAREA.xterm-helper-textarea` | empty | `714 / 714` | `48–708` |
| Software keyboard visible | `TEXTAREA.xterm-helper-textarea` | empty | `404 / 404` | `48–398` |
| `o` tapped on software keyboard | `TEXTAREA.xterm-helper-textarea` | `o` | `404 / 404` | `48–398` |
| `k` tapped on software keyboard | `TEXTAREA.xterm-helper-textarea` | `ok` | `404 / 404` | `48–398` |
| Keyboard dismissed with Done | `BODY` | `ok` | `714 / 714` | `48–708` |

The Simulator accessibility tree exposed the real software keyboard, including
the `q` through `p`, `a` through `l`, `z` through `m`, delete, numbers, space,
and return keys. The `o` and `k` characters above came from coordinate taps on
those exposed keys. They reached xterm through its `onData` event while the
software keyboard remained visible.

During keyboard presentation, the terminal bottom remained six CSS pixels
inside the `404`-pixel visual viewport. The visible status and terminal input
stayed above the Safari form controls and software keyboard. After dismissal,
the same iframe, session layout, and xterm container returned to their initial
heights without navigation or reload, and the typed data remained.

Safari reported both the iframe session's layout viewport and visual viewport
shrinking in this composition. The top-level parent retained its layout height
but reported a `404`-pixel visual viewport and resized the iframe shell from
that value. This is why the parent observes `visualViewport` instead of
assuming that `100vh` follows the keyboard.

## Checked-in regression coverage

`e2e/web-client-host.spec.ts` contains a headless regression check for the
probe route. It verifies that:

- the session loads the real xterm helper textarea;
- focus reaches `TEXTAREA.xterm-helper-textarea`;
- typed input reaches xterm's `onData`; and
- the reported terminal bottom stays inside the reported visual viewport.

The complete web-client host suite passes with five tests:

```text
npx playwright test e2e/web-client-host.spec.ts --reporter=line
5 passed
```

Headless Chromium validates the probe plumbing but is not the soft-keyboard
evidence. The state table above comes from Mobile Safari in the iOS runtime.

## Limitations and required follow-through

- This is an iOS Simulator result, not a physical-device result.
- The probe is a minimal host/session/xterm composition. The production
  Terminay Web responsive layout still needs the same visual-viewport sizing
  rule and a release-candidate smoke test.
- Portrait orientation is covered. Landscape, rotation while focused, split
  keyboard behavior on iPad, browser zoom, and accessibility text sizes are
  separate release tests.
- The test validates xterm focus and character input. Terminal-specific mobile
  controls for Escape, Control, Alt, arrows, and paste remain product behavior
  outside this spike.
- Clipboard permission, CSP, navigation blocking, `frame-ancestors`, and
  origin/storage isolation remain covered by the existing Chromium host suite;
  this run does not repeat every security assertion in Safari.

The evidence establishes a viable mobile client-host path: an exact-origin
session iframe containing real xterm responds to the actual iOS software
keyboard without trapping its terminal content, and restores its geometry
after dismissal.
