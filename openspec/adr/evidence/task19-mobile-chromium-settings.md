# Task 19 locally emulated mobile-Chromium settings evidence

This evidence is a deterministic local Chromium device-emulation workflow. It
does not claim a physical mobile device, Safari, Android packaging, cellular
network behavior, or soft-keyboard fidelity.

`e2e/shared-production-routes.spec.ts` creates a touch-enabled, mobile-sized
Chromium context (`390 × 820`) and exercises the production shared Settings
route body. The workflow uses touch `tap()` navigation to select Terminal
settings, edits the terminal font size, observes the unsaved state, saves and
verifies the mutation acknowledgement, then resets and verifies the default
value and reset acknowledgement.

Run:

```sh
npx playwright test e2e/shared-production-routes.spec.ts \
  -g "locally emulated touch-mobile Chromium saves and resets terminal settings"
```

This advances the mobile-web Settings feature-matrix cell with a substantive
local interaction while leaving physical-mobile parity explicitly open.
