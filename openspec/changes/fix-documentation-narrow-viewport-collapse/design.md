## Context

`.documentation-editor` is a CSS grid inside the Documentation panel. Its child count is dynamic: an optional status row (rendered only for a conflict, a save failure, a preview diagnostic, or an in-flight download), the MDXEditor surface (always), and an optional live-preview `<section>` (rendered only when a compiled MDX runtime is available). `DocumentationEditor` signals which of those are present through the modifier classes `documentation-editor--with-status` and `documentation-editor--with-preview`, and the base rules key their grid templates off exactly those modifiers.

The `@media (max-width: 900px)` block does not. It restates the grid on the unmodified `.documentation-editor` selector with `grid-template-rows: auto minmax(360px, 1fr) minmax(280px, 1fr)` — the three-row form that only makes sense for status + editor + preview — and it applies to every Documentation panel below 900px regardless of what is actually rendered.

For the common case, a plain `.md` file with no diagnostics, the editor is the grid's only child. It is placed in row 1 (`auto`), while rows 2 and 3 still claim a 640px minimum. `.documentation-editor` carries `container-type: size`, so its own height is taken from the flex parent and is definite; the two phantom rows are satisfied first and row 1 receives whatever remains. The editing surface is `height: 100%; overflow: auto`, so a zero-height row clips the toolbar and the entire reading canvas.

Measured in Playwright against the real `MDXEditor`, `documentationEditorPlugins`, and `fileViewer.css`, on a 390×664 viewport the editing surface resolves to **25px** in WebKit and **25px** in Chromium, against 800px at 1280px wide. On an iPhone's ~620px content height the remainder is zero, which is the reported blank panel. The mechanism is width- and height-driven, not engine-driven; desktop Safari and Firefox stay above the breakpoint and never show it. ADR-0012 puts the workspace UI inside a fullscreen iframe on iOS, so phone-sized viewports are a first-class presentation, not an edge case.

## Goals / Non-Goals

**Goals:**

- The Documentation editing surface fills the panel at phone viewport sizes when no preview is presented.
- The narrow-viewport stacked arrangement is expressed against the same modifier classes the base rules use, so grid rows and rendered children cannot drift apart again.
- A regression test fails if the editing surface collapses at a mobile viewport.

**Non-Goals:**

- Redesigning the Documentation panel for touch (toolbar target sizes, gesture affordances, on-screen keyboard handling).
- Changing when a live preview is offered, or introducing a mobile preview toggle.
- Changing the 900px breakpoint, the reading-canvas typography rules, or the `80cqh` trailing scroll space, all of which measure correctly once the surface has height.
- Any server, protocol, or authority change. This is renderer presentation only and crosses no security boundary.

## Decisions

**Scope the narrow-viewport grid to `--with-preview` rather than adding a row-count override.**

The stacked three-row template is moved onto `.documentation-editor--with-preview`, with the status row added by the compound selector `.documentation-editor--with-preview.documentation-editor--with-status`. A panel without a preview then inherits the base single-row (or status + single-row) template at every width, which is already correct. The editor-to-preview separator moves under the same `--with-preview` prefix.

Alternatives considered:

- *Set the phantom rows to `minmax(0, …)`.* Keeps the three-row template but makes an absent preview merely collapse rather than not exist; the template still describes children that are not there, and a future fourth child would misplace itself. Rejected as papering over the mismatch.
- *Move the grid template into inline styles computed in `DocumentationEditor`.* Makes the row count follow the child count exactly, but pulls layout out of the stylesheet where every other Documentation rule lives, and makes the breakpoint unreachable from CSS. Rejected as disproportionate.
- *Switch the panel to flexbox.* A larger rewrite of working desktop layout to fix a media-query scoping error. Rejected.

**Verify with a DOM measurement at a mobile viewport, not a screenshot.**

The failure is a computed height of zero, which a bounding-box assertion states directly and a pixel comparison only implies. The test asserts the editing surface's height is a substantial fraction of the panel height at a phone-sized viewport, so it fails on collapse and does not churn on typography changes.

**Keep the test in the existing Electron end-to-end suite.**

Repository convention runs Playwright's Electron suite only through `npm run test:e2e`, which isolates Electron, Chromium, and Xvfb in Docker. The regression uses that path with a resized window rather than introducing a second browser harness. Chromium reproduces the collapse identically to WebKit, so it is a faithful guard even though the report came from iOS Safari.

## Risks / Trade-offs

- **The reported iPhone symptom might have a second, independent cause.** → The collapse is reproduced and measured in two engines at the reported viewport size and is sufficient on its own to produce an empty panel. Manual confirmation on the reporting device is an explicit task before the change is archived.
- **Narrow desktop windows with a preview keep a 640px minimum for the split.** → Unchanged behaviour, and now correctly limited to the case it was written for. If that minimum proves too tall for a short landscape phone, it is a separate, visible follow-up rather than a silent blank panel.
- **A future third Documentation surface could reintroduce the mismatch.** → The regression test measures the editor's height at a mobile viewport, so any new surface that steals it fails the suite.

## Migration Plan

Not applicable. The change is a stylesheet correction with no persisted state, no protocol surface, and no compatibility window; reverting the commit restores prior behaviour exactly.

## Open Questions

None. No in-force ADR needs revisiting: ADR-0012 establishes phone-sized viewports as a supported presentation and this change serves it.
