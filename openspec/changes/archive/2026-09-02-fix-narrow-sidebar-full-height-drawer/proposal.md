## Why

In narrow layouts the workspace sidebar is capped at 24rem, so on a phone-sized viewport the file tree and Git panes occupy the top third of the screen while the rest sits empty behind them. The cap exists to stop the sidebar squeezing the terminal in a stacked layout, but it solves that by permanently shrinking the sidebar instead of by getting the two surfaces out of each other's way.

## What Changes

- **The narrow sidebar becomes a full-height drawer.** When navigation is visible at a narrow width it overlays the workspace content at the full height of the viewport, instead of taking a capped row above it.
- **The terminal keeps the whole viewport.** With the sidebar overlaying rather than stacking, content is no longer compressed into a remainder row, and closing the drawer reveals it unchanged — which is what the 24rem cap was protecting and which this preserves properly.
- **The drawer is dismissible and does not trap the user.** It can be closed by the navigation control, by the Escape key, and by activating the scrim over the content behind it. Focus moves into the drawer when it opens and returns to the control that opened it when it closes.
- **The sidebar stack fills the drawer.** Panes distribute the drawer's full height under the existing rules, so the sidebar itself still never becomes an outer scroller — a guarantee the current narrow layout breaks.
- **Wide layouts are unchanged.** The side-by-side split, the resize separator, and the persisted navigation width apply only above the narrow breakpoint and keep behaving exactly as they do today.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `project-sidebar-layout`: the available-height and outer-scrolling guarantees are stated for the narrow drawer as well as the wide split, and drawer presentation and dismissal are specified.
- `connections-and-client-hosts`: the narrow-layout parity requirement gains a concrete obligation that a navigation drawer occupies the full viewport height rather than a capped fraction.

## Impact

- **Affected code:** the shared workspace split layout component and its stylesheet, which own the narrow breakpoint, the stacked grid rows, and the 24rem cap. The sidebar pane stack itself is unchanged; it simply receives the height it was already written to distribute.
- **Affected behaviour:** at narrow widths only. The wide two-column split, the separator, and navigation width persistence are untouched.
- **Accessibility:** an overlay that covers the workspace is a materially different interaction from a stacked row. It needs a dismissible, focus-managed treatment, and the content behind it must be inert to assistive technology while it is open — otherwise this trades a layout defect for a navigation trap.
- **Existing coverage:** none. No test renders the split layout below the narrow breakpoint, and nothing asserts the stacked rows, the cap, or the narrow overflow behaviour, so the regression this fixes was never guarded and the new behaviour needs coverage built from scratch.
- **Reverted decision:** the narrow stacking that introduced the cap was added deliberately to stop the sidebar squeezing the terminal. That goal is preserved here by overlaying rather than by capping, so the original problem does not return.
- **Non-goals:** changing the narrow breakpoint, changing wide-layout behaviour, adopting the unused shared drawer model wholesale, altering pane registration, ordering, or persistence, and any change to how the sidebar behaves on Desktop at normal window sizes.
