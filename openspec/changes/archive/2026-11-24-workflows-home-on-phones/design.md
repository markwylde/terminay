## Context

`WorkflowsHome.tsx` renders Home's Workflows section: a header, a wrapping toolbar of eleven controls, and a body that is either one sideways scroller of fixed-width columns (290px, or 236px with Narrow columns) or, when grouped, a sideways or stacked set of groups that each hold a sideways row. Nothing responds to width. On a phone the toolbar wraps to about half the screen, and the 290px columns sit in a sideways scroller with the next column cut off at the edge.

The view (`workflowsHomeView.ts`) is device presentation state in local storage (ADR-0040 places Home tab presentation on the device). This change stays in the renderer and crosses no Electron, server, or storage boundary.

## Goals / Non-Goals

**Goals:**
- A phone shows workflows full width, stacked, scrolling vertically.
- The toolbar takes little space on a phone without losing any option.
- The same behaviour in a narrow Home tab on a desktop.

**Non-Goals:**
- Changing the stored view model or its defaults.
- Changing the terminal pane's workflow panel (`WorkflowPanel`), which has its own narrow-pane rules.
- Restyling the wide layout.

## Decisions

1. **Narrowness is the section's own width, measured with a `ResizeObserver`, threshold 600px.** The section can be narrow inside a desktop window (a split Home tab), and the phone case is the same thing. A viewport media query would miss the split tab. A CSS container query alone can restyle but cannot stop offering controls or drive `aria-expanded`, so the component keeps a `compact` boolean from the observer and adds `workflows-home--compact`. It measures the border box, not `clientWidth`: compact mode makes the section scroll vertically, and a scrollbar subtracted from `clientWidth` would otherwise hold a 601px section compact. 600px matches the settings detail's container breakpoint and sits above the widest phones in portrait.

2. **Stacking is CSS under `.workflows-home--compact`, with the section as the one scroll owner.** Compact sets `.workflows-home` to `overflow-y: auto; overflow-x: hidden` (the base `.home-section` is already an absolutely positioned scroll box), so header, toolbar and body scroll together. That also keeps a tall expanded View options panel reachable on a short screen or with the software keyboard open. The body, scrollers and row scrollers drop their `height: 100%`/flex sizing and become plain vertical flex columns; columns take `width: auto`, no fixed height, `overflow: visible`, and the reused `.workflow-steps` loses its own `overflow-y`. The DOM stays the same, so the column component is untouched.

3. **View options is a disclosure button with transient state.** A `useState` toggle, not stored, starting collapsed; it is rendered only when compact. The controls behind it are the same components, wrapped in a container that is hidden while collapsed. The button shows a dot and the accessible suffix "changed" when `isDefaultWorkflowsHomeView(view)` is false, the same comparison that decides whether Reset view is offered.

4. **Options that do nothing are not offered, but are never rewritten.** The layout segmented control and Narrow columns are not rendered while compact; their stored values are untouched, so widening restores the remembered view.

5. **Touch targets are 36px under compact.** Inputs, selects, the picker button, segmented buttons, chips, checkbox labels, project menu items, View options, and the column open and fold buttons get `min-height: 36px` (icon buttons 36×36). 36px is the smallest that keeps the phone toolbar to two rows while staying comfortable to tap.

## Risks / Trade-offs

- [Observer flicker at exactly 600px while resizing] → a single threshold on the content box; a frame of the other layout is acceptable.
- [Stacked columns with long step lists make a long page] → that is the intended phone reading pattern; the Notes option and grouping fold still shorten it.
- [Hidden options are less discoverable] → View options sits next to the filter and marks a changed view.
