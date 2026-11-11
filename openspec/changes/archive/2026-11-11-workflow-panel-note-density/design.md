## Context

Home's Workflows section offers a notes density (`full`, `short`, `current`)
inside its device-local view record (`terminay.workflowsHome.view.v1`). The
terminal's workflow panel (ADR-0097) keeps two device-local settings of its
own — collapse (`terminay.workflowPanel.v1`) and width
(`terminay.workflowPanelWidth.v1`) — each a small external store that every
pane on the device subscribes to, and that follows `storage` events from other
windows of the device.

## Goals / Non-Goals

**Goals:**

- Offer Home's three note densities in the expanded panel and its narrow-pane
  overlay, with the same labels and meaning.
- Keep the choice device-local and shared by every terminal on the device.

**Non-Goals:**

- Sharing the choice with Home's Workflows view.
- Any change to the collapsed rail, step actions, the brief, or workflow
  state on the server.

## Decisions

1. **Its own device-local setting, not Home's.** Stored under
   `terminay.workflowPanelNotes.v1` with the same store shape as the collapse
   and width settings. Home is an overview of many workflows and the panel is
   a single workflow beside its terminal; a user may well want Current only on
   Home and Full in the panel. Coupling them would make a change in one place
   silently change the other. *Alternative:* read and write Home's view
   record — rejected for that coupling, and because Home's record is a whole
   view whose other fields mean nothing to the panel.
2. **Same vocabulary and rule as Home.** Values `full`, `short`, `current`
   with labels Full, 2 lines, Current only. Current only shows the notes of
   `running`, `failed`, and `needs_input` steps, exactly Home's rule. The rule
   moves into `workflowPanelModel.ts` as `isCurrentStep`, with
   `showsStepNote(step, notes)` beside it, and Home's `isHighlighted` delegates
   to it, so the rule has one home and cannot drift. The Home model already
   imports the panel model; the panel model never imports Home's, so no import
   cycle is introduced.
3. **A native `<select>` in the header, under the summary.** A compact select
   labelled "Step notes" is the last line of the header's summary column,
   below the progress line, so it never competes with the collapse button for
   the header's width. A native select is keyboard and screen-reader accessible
   without extra code, works on touch devices, and matches Home's Sort
   control. Its keyboard events stay in the overlay because the overlay already
   stops every key at its root. *Alternative:* a custom popover menu —
   rejected as more code for the same choice. *Alternative:* the select beside
   the collapse button — rejected because at 200 px it squeezes the wrapping
   workflow name into a very tall header.
4. **2 lines is a CSS clamp.** The panel root carries
   `workflow-panel--notes-<value>`; `short` clamps `.workflow-step-note` to two
   lines with `-webkit-line-clamp`, as Home does. The full note stays in the
   DOM and, while cut, is given as the note's `title` so it can still be read
   on hover.
5. **Unknown stored values read as Full.** A missing, unreadable, or unknown
   stored value is `full`, so the panel shows today's behaviour by default.

## Boundaries

No security or architectural boundary is crossed. The setting stays in the
renderer's device-local storage; nothing reaches the server, the protocol,
MCP, or a template, so the terminal-session and project/window boundaries are
untouched. Notes are still rendered as text nodes.

## Risks / Trade-offs

- [The header is one line taller] → the select is compact (12 px text, about
  22 px high) and sits on its own line, so a long workflow name keeps wrapping
  as it does today and the collapse button keeps its place. Checked in E2E at
  the 200 px panel minimum and in an overlay narrower than that, with a long
  name.
- [Spec text elsewhere says a step's note is shown] → the expanded-panel and
  step-status requirements are modified to qualify note display by the
  density, so the contract stays consistent.
- [Two separate density choices may surprise a user who expects Home's to
  apply] → the panel's control shows its current value at all times, so the
  state is never hidden.
