## 1. Renderer

- [x] 1.1 In `src/web/ConnectedWebRendererWorkspace.tsx`, subscribe the native auxiliary document to `window.fullscreen-state` on macOS and omit `data-native-titlebar` while full screen.

## 2. Validation

- [x] 2.1 Run `biome lint` and `tsc` on the change, and `openspec validate --all`.
- [ ] 2.2 Open a pull request on Gitea and read back every commit status as `success` or `skipped`.
