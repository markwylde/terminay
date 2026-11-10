## Context

The chooser focuses **Open a folder** when it is shown. The recent list arrives asynchronously, and the search box appears only once the list holds more than five folders. Arrow movement walks every element marked `data-start-chooser-item`, and finds the current position by the focused element's index in that list.

## Decisions

- **Search takes focus when it first appears, judged by current focus only.** If focus is on **Open a folder** or on nothing (`document.body`), the search box takes it; anywhere else (Home directory, an open folder browser, another tab's content) it is left alone. Focusing only on mount would miss the async list. Tracking an interaction history would add state for no visible difference.
- **No autofocus in the compact layout.** Focusing a text field on a phone raises the on-screen keyboard and hides most of the chooser.
- **Forget controls leave the arrow order, not the tab order.** They stay reachable with Tab, so the existing keyboard-operation scenario still holds. From a forget control, which has no index in the arrow order, ↓ goes to the item after its row and ↑ to its row's folder, rather than jumping to the first start.
- **The row draws the outline** through `:has(.project-start__recent-open:focus-visible)`, so the forget control sits inside it. `:has` is supported by Electron's Chromium and every supported browser host (Chromium, Safari 15.4+, Firefox 121+). Where it is unsupported, the row shows no outline but focus still works.

## Risks / Trade-offs

- With five or fewer folders there is no search box, so **Open a folder** keeps first focus, as before.
- An unavailable folder stays in the arrow order, as the canonical spec requires; Enter on it opens nothing.
