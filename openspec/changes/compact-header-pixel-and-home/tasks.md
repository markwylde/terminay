## 1. Renderer

- [x] 1.1 Remove the Home control from `CompactChromeRow`; add a Home control to the start of the `CompactSwitcher` toolbar that selects Home and closes the sheet
- [x] 1.2 Give `CompactChromeRow` a Pixel slot that replaces the connection glyph when supplied, and move the unreachable and upgrade signals onto the breadcrumb in that case
- [x] 1.3 Let `PixelCompanion` dock into the compact header slot ahead of the status bar and the corner

## 2. Verification

- [x] 2.1 End-to-end: Home is reached from the switcher at phone width; with Pixel on its dock is in the header and not in the corner, and opening it brings Pixel out
- [ ] 2.2 Pull request checks green
