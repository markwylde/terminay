## 1. Renderer

- [x] 1.1 Track whether the pet is out from its root's `data-state` and mark the dock with `data-out`
- [x] 1.2 Ghost the dock icon while `data-out` is set, leaving the badge untouched

## 2. Verification

- [x] 2.1 End-to-end: the dock is ghosted while Pixel is out and whole again once the balloon is closed
- [x] 2.2 Pull request checks green

## Reconciliation evidence — 2026-11-04

Implementation is merged in [Gitea PR #431](https://git.i.wylde.net/markwylde/terminay/pulls/431). Read back all 26 head commit statuses on `868fa7fadf9df91f28c4b8bfeae8eb4be83e8cef`: every status is success or skipped. The relevant code and existing tests are present in this checkout.
