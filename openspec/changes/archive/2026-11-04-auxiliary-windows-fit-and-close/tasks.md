## 1. Desktop host

- [x] 1.1 Add `electron/auxiliaryWindowPlacement.ts` with `fitAuxiliaryWindowBounds` and `closesAuxiliaryWindow`.
- [x] 1.2 In `electron/main.ts`, open auxiliary windows fitted to the source window's display work area, track them in `auxiliaryWindows`, and close a focused one on `close-active` from the menu and from key input.

## 2. Tests

- [x] 2.1 Add `scripts/auxiliary-window-placement.test.mjs` (large, small, and offset displays; close command) and run it from `test:window-menu-policy` and `smoke`.

## 3. Validation

- [x] 3.1 Run `openspec validate --all`.
- [x] 3.2 Open a pull request on Gitea and read back every commit status as `success` or `skipped`.

## Reconciliation evidence — 2026-11-04

Implementation is merged in [Gitea PR #446](https://git.i.wylde.net/markwylde/terminay/pulls/446). Read back all 26 head commit statuses on `e7db82c3e28c9e2178e794a81d355434b3570b02`: every status is success or skipped. The relevant code and existing tests are present in this checkout.
