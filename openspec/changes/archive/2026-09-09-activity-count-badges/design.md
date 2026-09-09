## Context

The header activity dropdown (`src/workspace/TerminalActivityOverview.tsx`) renders up to three `.terminal-activity-pill` spans. The CSS gives them `min-width: 20px`, `height: 18px`, and horizontal padding, so they render as stadium shapes rather than circles.

Per-project activity data already exists. Each project workspace publishes its visible activity items through `onTerminalActivityOverviewChange`, and `App.tsx` keeps them in `terminalActivityItemsByProject`, keyed by project id. The header flattens that record across all projects and passes the three counts to the dropdown. `ProjectTabList` and `ProjectSwitcherMenu` never receive it.

`ProjectTabList` measures tab widths in a layout effect keyed on `activeProjectId`, `draggingProjectId`, and `projects`, with a `ResizeObserver` on the tab bar and list root. A badge appearing inside one tab changes that tab's width without resizing the observed containers, so the cached widths would go stale.

Existing Playwright suites (`e2e/terminal.spec.ts`, `e2e/terminal-signals.spec.ts`) locate `.terminal-activity-pill--unviewed`, `--recent`, and `--attention` on the whole window and assert their text.

All work is inside the server-bundled workspace UI. No server, protocol, or persisted workspace state is touched, so no security boundary is crossed; the project and terminal session identities used for counts come from server-owned panel params that the UI already renders.

## Goals / Non-Goals

**Goals:**
- Header count badges are true circles of one fixed size with centred, digit-aware text.
- Each project tab and switcher row shows a single per-project count badge coloured by highest-priority state.
- The badge derives from the existing per-project activity items, honouring the existing indicator settings.
- Existing end-to-end locators keep working unchanged.

**Non-Goals:**
- No new user setting.
- No change to the `ProjectTab` model or server workspace state.
- No change to how activity states are computed or acknowledged.
- The tab badge does not split counts by state; it shows one total.

## Decisions

### Shared circular badge style, separate class for the tab surface

Introduce one base rule for the circle geometry (`width` and `height` both 18px, `padding: 0`, `border-radius: 50%`, inline-flex centring, `line-height: 1`, `font-weight: 800`) and apply it to both the header pill and a new `project-tab-activity-badge` class. Colour modifiers (`--attention`, `--recent`, `--unviewed`) stay per surface. Keeping the tab badge on its own class, rather than reusing `terminal-activity-pill`, means the existing whole-window Playwright locators still match exactly one element.

Alternative considered: reuse `terminal-activity-pill` on tabs. Rejected because strict-mode locators in the existing suites would fail on multiple matches, and because it couples two surfaces that may diverge later.

### Digit-aware font size through a data attribute

A small shared helper formats the count (`99+` above 99) and returns the digit class (`1`, `2`, or `3`). The badge element carries `data-digits`, and CSS steps the font size: 11px for one digit, 9px for two, 7px for three characters. The circle size never depends on content, so no measurement is needed.

Alternative considered: `font-size` via `clamp()` on container width. Rejected as the circle width is fixed, so there is nothing to scale against.

### Per-project counts computed in `App.tsx` from existing state

Add a memoised `Record<projectId, { count, state }>` derived from `terminalActivityItemsByProject`, using `terminalOverviewStateToAgentState` to resolve the highest-priority state: `blocked` or `waiting` map to attention, `working` to recent, `done` to unviewed. Pass this record to `ProjectTabList` as a new `activityByProject` prop, and from there to `ProjectSwitcherMenu`. The `ProjectTab` type is left unchanged because it mirrors persisted server workspace state and the counts are ephemeral client presentation.

Alternative considered: adding `activityCount` to `ProjectTab`. Rejected because it would leak presentation into the persisted model and into every reconciliation path that copies projects.

### Overflow layout re-runs on count changes

Add a stable derived key (for example the joined list of project ids with a badge and their formatted counts) to the layout effect dependencies in `ProjectTabList`, so the effect re-measures tab widths whenever a badge appears, vanishes, or changes digit count. The `ResizeObserver` alone is insufficient because the badge changes tab width, not container width.

Alternative considered: observing each tab element. Rejected as heavier than a dependency key and unnecessary given counts already flow through props.

### Badge is inert markup inside the tab

The badge is a `span` inside the tab, after `project-tab-main` and before `project-tab-close`, with an `aria-label` describing the count and state (for example "3 terminals, needs attention"). It is not a button, so clicks fall through to the tab's activate handler.

## Risks / Trade-offs

- [Tab width grows by roughly 22px when a badge is present, increasing overflow on tight bars] → the layout re-run decision above keeps the switcher accurate; tabs are capped at 240px so the badge never pushes past that.
- [Bold digits can look optically low in a flex-centred circle] → `line-height: 1` and a fixed pixel height give exact centring; verify with a screenshot at 1x and 2x during apply.
- [A project with a very large count gets `99+` at 7px, which is small] → acceptable per product direction; the exact count remains in the header dropdown menu items.
- [The switcher menu already has a numeric hidden-count badge on its button] → the per-project badge lives on rows only, not on the switcher button, so the two numbers are never adjacent.

## Migration Plan

No migration. Pure client rendering change shipped with the server-bundled UI.

## Open Questions

None. No in-force ADR is affected.
