# Task 19 locally emulated mobile-Chromium terminal evidence

This is deterministic local Chromium device emulation. It is not evidence from
a physical phone, mobile Safari, Android packaging, a real mobile network, or
soft-keyboard behavior.

At a touch-enabled `390 × 820` viewport,
`e2e/shared-production-routes.spec.ts` exercises the production shared Terminal
route through its server-owned client boundaries. The workflow taps New
terminal, observes bounded replayed output, enters and sends terminal input,
taps resize, and taps detach. It verifies the exact ordered client actions:
create, attach, write, resize, and detach.

Run:

```sh
npx playwright test e2e/shared-production-routes.spec.ts \
  -g "locally emulated touch-mobile Chromium drives a terminal session lifecycle"
```

This advances one substantive mobile-web terminal workflow while full
soft-keyboard, xterm gesture, backgrounding, network, and physical-mobile parity
remain open.
