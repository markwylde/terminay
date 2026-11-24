## 1. Renderer

- [x] 1.1 `VideoPlayer` records the video's aspect ratio on `loadedmetadata` and applies it to its frame
- [x] 1.2 `botPanels.css` sizes the frame from that ratio, capped at the message width and 70vh, and fits the video inside it

## 2. Verification

- [x] 2.1 Extend the inline video E2E case with a 1:2 video that must be shown whole
- [x] 2.2 `npm run test:e2e -- e2e/bots.spec.ts --grep "videos play inline"` passes
- [x] 2.3 `openspec validate bot-video-keeps-its-shape` passes
