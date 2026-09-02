## 1. Lifecycle authority

- [x] 1.1 Introduce one connection-scoped authority that evaluates combined peer and ICE state, verified by focused host tests driving both inputs
- [x] 1.2 Start one bounded recovery grace period for recoverable `disconnected` state and cancel it when transport health returns, verified by a disconnect-then-reconnect test
- [x] 1.3 Close immediately for explicit `failed` or `closed` state and close once when the grace period expires, verified by asserting a single close publication
- [x] 1.4 Cancel pending recovery during normal host cleanup without publishing a second close, verified by a teardown test

## 2. Verification

- [x] 2.1 Reproduce an authenticated session entering ICE `disconnected`, returning to `connected`, and continuing on its original application and terminal channels
- [x] 2.2 Prove a disconnect that outlasts the grace period closes exactly once
- [x] 2.3 Preserve immediate permanent-failure and revocation behaviour, verified by the existing regression coverage
- [x] 2.4 Run the focused host tests and the Docker-isolated Electron end-to-end suite through `npm run test:e2e`
