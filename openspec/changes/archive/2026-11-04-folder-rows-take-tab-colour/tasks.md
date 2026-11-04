## 1. Model

- [x] 1.1 Carry the tab colour in `panelFactsFromInventory` and on `FolderTreeTerminalRow` with `hasOwnColor`. Verified by `scripts/folder-tree-sources.test.mjs` and a new case in `scripts/folder-tree-model.test.mjs`.

## 2. Row

- [x] 2.1 Set `--tab-color` on a terminal row, fill the active row as the active tab is filled, and edge an inactive row with its own colour in `foldersTree.css`. Verified by eye in `npm run dev`.

## 3. Delivery

- [x] 3.1 Run `openspec validate folder-rows-take-tab-colour --strict`. Verified by it exiting zero.
- [x] 3.2 Open the pull request on `origin` with `tea` and read back every commit status as `success` or `skipped`.

## Reconciliation evidence — 2026-11-04

Implementation is merged in [Gitea PR #464](https://git.i.wylde.net/markwylde/terminay/pulls/464). Read back all 27 head commit statuses on `96e29976c22ef73c12b0183efc523186f3cbcf32`: every status is success or skipped. The relevant code and existing tests are present in this checkout.
