## 1. Renderer

- [x] 1.1 In `src/web/ConnectedWebRendererWorkspace.tsx`, subscribe the native auxiliary document to `window.fullscreen-state` on macOS and omit `data-native-titlebar` while full screen.

## 2. Validation

- [x] 2.1 Run `biome lint` and `tsc` on the change, and `openspec validate --all`.
- [x] 2.2 Open a pull request on Gitea and read back every commit status as `success` or `skipped`.

## Reconciliation evidence — 2026-11-04

Implementation is merged in [Gitea PR #447](https://git.i.wylde.net/markwylde/terminay/pulls/447). Read back all 26 head commit statuses on `65e95533b8f3a30fdb7138721b6620390cfd0af0`: every status is success or skipped. The relevant code and existing tests are present in this checkout.
