## 1. Status bar

- [x] 1.1 Return an empty label from `remoteIndicatorState` for the Desktop Local server when it is not exposed or has no connections, and render the label only when non-empty. Verified by `workspaceStatusBarModel.test.ts`.

## 2. Loading mark

- [x] 2.1 Remove the black tile and rounded clip from the mark in `electron/startupLoadingDocument.ts`, `src/web/main.tsx` and `src/web/index.css`. Verified by the startup loading document tests.
- [x] 2.2 Draw the glyph inline in `server.html` instead of loading `terminay.svg`. Verified by running `npm run dev` and watching the handoff.

## 3. Verification

- [x] 3.1 `npm run lint`, typecheck and `openspec validate --all` pass. Verified by command output.
