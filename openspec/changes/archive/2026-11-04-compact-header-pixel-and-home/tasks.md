## 1. Renderer

- [x] 1.1 Remove the Home control from `CompactChromeRow`; add a Home control to the start of the `CompactSwitcher` toolbar that selects Home and closes the sheet
- [x] 1.2 Give `CompactChromeRow` a Pixel slot that replaces the connection glyph when supplied, and move the unreachable and upgrade signals onto the breadcrumb in that case
- [x] 1.3 Let `PixelCompanion` dock into the compact header slot ahead of the status bar and the corner

## 2. Verification

- [x] 2.1 End-to-end: Home is reached from the switcher at phone width; with Pixel on its dock is in the header and not in the corner, and opening it brings Pixel out
- [x] 2.2 Pull request checks green

## Reconciliation evidence — 2026-11-04

Implementation is merged in [Gitea PR #429](https://git.i.wylde.net/markwylde/terminay/pulls/429). Read back all 26 head commit statuses on `392c2e2436ba44a0f385daf3952a65c78c24e8e5`: every status is success or skipped. The relevant code and existing tests are present in this checkout.
