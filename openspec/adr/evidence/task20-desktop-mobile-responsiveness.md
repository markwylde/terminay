# Task 20 Desktop and mobile responsiveness evidence

Date: 2026-07-28

The current production artifact passed the serial responsiveness matrix:

```sh
npx playwright test \
  e2e/task20-desktop-stream-responsiveness.spec.ts \
  e2e/task20-browser-responsiveness.spec.ts \
  e2e/task20-untrusted-stream-responsiveness.spec.ts \
  e2e/task20-background-stream-failure.spec.ts \
  e2e/task20-queue-bounds.spec.ts \
  --workers=1 --max-failures=1
```

Result: 10/10 tests passed in 17.3 seconds.

The matrix covers the real Electron Desktop renderer, a touch-enabled mobile
Chromium context at 390×740, and wide/narrow browser shells. During bounded
terminal-output, agent-event, file-watch, and transfer-progress pressure:

- Desktop opens its connection menu and creates another terminal within the
  fixed 500 ms interaction bound while 120 animation frames continue;
- the Desktop pressure queue retains at most one latest update for each of four
  lanes and drains to zero;
- the mobile context uses actual touch `tap()` navigation and completes route
  changes within the same bound while animation frames continue;
- wide and narrow browser routes remain interactive;
- untrusted payloads remain inert text;
- a failing background stream is contained without page errors; and
- a 10,000-message pressure run retains at most eight messages/16 KiB, renders
  one inert output node, and drains completely.

This is fresh-artifact Electron Desktop and touch-mobile browser-emulation
evidence. It does not claim physical iOS/Android device certification or native
mobile packaging.
