## Context

See proposal.md — Why for motivation, and the spec deltas for the behaviour contract.

The relevant existing shape:

- The workspace split layout is a shared component compiled into both the Electron renderer and the server-bundled web UI. It renders a navigation aside, a resize separator, and a content section inside a CSS grid, and it owns width only — the navigation width is published as a custom property on the root and adjusted imperatively during a separator drag.
- Height reaches the sidebar through an unbroken `height: 100%` chain from the document root down to the sidebar element. There is no viewport-unit bug in that path.
- Below the narrow breakpoint the grid switches from two columns to two stacked rows, the separator is hidden, and the navigation row is capped at `min(40dvh, 24rem)`. On any viewport taller than 960px the `24rem` term always wins, so the sidebar is a fixed 384px regardless of how much room exists. The narrow rule additionally makes the aside itself an overflow container.
- That narrow stacking was introduced deliberately to stop the sidebar squeezing the terminal. The cap is the mechanism it chose, and it is the defect being reported.
- The breakpoint is expressed purely in CSS. No JavaScript width check drives the production workspace's narrow layout, though the same breakpoint value is duplicated as a constant in the shared responsive library and in two other stylesheets.
- The shared responsive library exports an accessible drawer model, but nothing in the production workspace imports it; the drawer machinery that exists today is reachable only from a test fixture.

Two constraints follow. The fix must keep the terminal from being squeezed, because that is the problem the current cap was solving. And it must not introduce a keyboard or assistive-technology trap, because promoting a stacked row to an overlay changes the interaction model, not just the geometry.

## Goals / Non-Goals

**Goals:**
- Give the narrow sidebar the full height available to the workspace.
- Preserve the terminal's full height, by removing the sidebar from the content's track rather than by rationing pixels between them.
- Keep the wide layout byte-for-byte equivalent in behaviour.
- Establish the narrow-layout coverage that does not exist today, so this cannot silently regress again.

**Non-Goals:**
- Moving or parameterising the narrow breakpoint, or reconciling its four separate declarations. That duplication is real but independent of this defect.
- Adopting the shared accessible drawer model wholesale. Its behavioural rules are the right reference, but wiring an unused module into the production workspace is a larger change than this defect warrants.
- Changing pane registration, ordering, persistence, or the space-distribution algorithm. The stack already distributes whatever height it is given; this change gives it the right height.
- Any change to Desktop behaviour at normal window sizes.

## Decisions

### The narrow sidebar overlays rather than shares the grid

Below the breakpoint the navigation leaves the grid flow and is positioned over the workspace content at full height, with a scrim between them. The content track then always occupies the full viewport, whether navigation is open or closed.

This keeps the original intent — the terminal is never compressed by the sidebar — while removing the cap that intent was implemented with. It also matches the vocabulary the parity requirement already uses for narrow layouts, which names drawers explicitly.

**Alternative considered — raise or remove the cap and keep stacking.** Rejected: with both surfaces in the same column, any height the sidebar gains is height the terminal loses. It trades one complaint for the original one.

**Alternative considered — let the sidebar take the slack only when no panel is open.** Rejected: the sidebar would change height as panels open and close, which is a surprising reflow, and it leaves the sidebar capped in the common case where a terminal is running.

### Presentation switches on the same breakpoint, still in CSS

The overlay is selected by the existing narrow media query rather than by a new JavaScript width check, so there is one authority for what "narrow" means and no hydration mismatch between server-rendered markup and client layout. The behavioural additions that cannot be expressed in CSS — focus movement, Escape handling, and marking the content inert — are driven by the component, conditioned on the same breakpoint observed once.

**Trade-off:** the component must learn the breakpoint that until now lived only in the stylesheet. This is the one place the change adds coupling, and it is the minimum needed for the accessibility obligations.

### Dismissal has three routes, and the drawer is focus-managed

The navigation control, Escape, and the scrim all close it. Focus enters the drawer on open, is confined while open, and returns to the opening control on close; content behind is marked unavailable to assistive technology. These are not embellishments — an overlay that covers the workspace without them is a trap, which would be a worse defect than the one being fixed.

## Risks / Trade-offs

- **An overlay hides the content the user is working in** → dismissal is available from three routes including a tap anywhere over the content, so the drawer is never more than one gesture from being out of the way.
- **The narrow rule currently makes the aside an overflow container; removing that could reintroduce clipped or scrolling stacks on short viewports** → the existing minimum-host-height requirement already governs what happens when a viewport cannot meet the title budget, and it applies unchanged inside the drawer. Coverage must include a short narrow viewport to prove the status is shown rather than a clipped stack.
- **Two surfaces now overlap where they previously tiled** → stacking context and scrim opacity need to be correct against the workspace's existing overlays. Getting this wrong is visible immediately rather than silently, which limits the risk.
- **No existing narrow-layout test exists to catch a regression here** → treated as part of the work rather than as an assumption; the task list builds that coverage.

## Migration Plan

None. The change is confined to client-side layout in the shared workspace UI. No persisted state, protocol surface, or server behaviour is involved; navigation visibility and width already persist and keep their current meaning. Reverting is a straight revert of the commit.
