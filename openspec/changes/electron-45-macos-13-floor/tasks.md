## 1. Electron 45

- [x] 1.1 Move `electron` to ^45.0.0. Verified by `npm run build:app` and the workspace typecheck passing.
- [x] 1.2 Port smart paste to `clipboard.read()`. Verified by an Electron 45 probe on macOS reading a copied file as `text/uri-list`, text as `text/plain`, and a screenshot as `image/png`.
- [x] 1.3 Name performance traces `.pftrace` and keep recognising `.json`. Verified by `scripts/local-desktop-diagnostics-core.test.mjs` and `scripts/local-desktop-diagnostics-performance.test.mjs`.
- [x] 1.4 Audit sandboxed preloads and `window.open` handlers against the Electron 45 breaking changes. Verified by `electron/serverUiPreload.ts` using no `Buffer`, `setImmediate`, or Node module, and every window being sandboxed.

## 2. Update floor

- [x] 2.1 Add `scripts/declare-update-minimum-system-version.mjs` and `--minimum-system-version` to the verifier. Verified by `scripts/desktop-update-release.test.mjs`.
- [x] 2.2 Declare and verify `22.0.0` in the stable and beta macOS lanes. Verified by `scripts/release-config.test.mjs` and `scripts/task20-ci-security.test.mjs` passing, and both workflows parsing.

## 3. Proof

- [ ] 3.1 Pull-request CI green, including the E2E shards, the packaged macOS startup smoke, and the Linux glibc floor probe on the Electron 45 AppImage. Verified by reading back every commit status on the head SHA.
