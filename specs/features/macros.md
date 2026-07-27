# Macros Specification

## Summary

Terminay macros are reusable terminal automation recipes. A macro is made from ordered execution steps and optional user-supplied fields. Users launch macros from the Command bar, fill any required fields in a parameter modal, preview the rendered output, then type the rendered steps into the active terminal.

## Ownership

Macro definitions, normalization, execution scheduling, inactivity waits, and
secret interpolation live in the selected Terminay Server. The shared client
continues to edit fields and show a safe preview, but a remote client never
receives plaintext secrets merely to write them back to a PTY. Macro commands
are authorized against the exact target terminal/project and continue if the
launching client disconnects only where the macro's documented cancellation
policy permits.

See [server-owned workspace state](./server-owned-workspace-state.md).

## Template Syntax

Type steps support Eta templates configured for plain terminal text rather than
HTML:

- Eta tags such as `<% if (message === 'one') { %>...<% } %>` can control output.
- Eta interpolations such as `<%= message %>` insert values.
- Field names are available as top-level identifiers, so users can write `message` instead of `it.message`.
- XML escaping is disabled because macro output is terminal input, not HTML.
- Legacy `{{Field Name}}` placeholders continue to work for existing macros.

Terminay Server renders each `type` step immediately before writing to the
target terminal.

Wait steps store user-facing durations in seconds through `durationSeconds`. Runtime execution renders the duration and converts it to milliseconds only when scheduling the delay or inactivity timer. Older saved `durationMs` values are migrated to seconds during normalization.

## Fields

Macro fields are stored on the macro definition and keyed by `field.name`. Supported field types are:

- `text`
- `textarea`
- `select`
- `number`
- `checkbox`
- `emoji`
- `file`

When the user runs a macro, the client opens a parameter modal if the macro has
fields. The modal:

- initializes each field from `defaultValue`
- validates required fields before execution
- renders a live preview with `tryRenderMacroTemplate(...)`
- executes the macro only after the user submits the form

`Sync from Steps` detects both legacy `{{Field}}` placeholders and common Eta identifiers inside template tags. For wait durations, it also detects single-brace fields such as `{Delay}`. This detection is a convenience for creating fields; explicit fields are preserved on save even when they are not currently detected in a step.

## Select Fields

Select options are edited as raw textarea text in the macro editor. The editor must not parse or rewrite the text on each keystroke, because incomplete input such as `First|` is valid while the user is still typing.

On save, select options are parsed and validated:

- each non-empty line is either `label|value` or a single label
- `label|value` lines must include both sides
- duplicate values are rejected
- a select field must have at least one option
- if the existing default value does not match a saved option, it is reset to the first option value

The parsed options are persisted as `{ label, value }[]`; transient raw editor text is not persisted.

## Macro Editor

The multiline text step editor uses Monaco with an Eta-oriented language definition. It highlights:

- Eta delimiters and output tags
- JavaScript keywords, identifiers, comments, strings, numbers, and operators inside Eta tags
- legacy `{{Field}}` placeholders

Keyboard behavior:

- `Cmd/Ctrl+Enter` applies the text
- `Escape` cancels the editor

Inline single-line type-step editing remains available for quick edits.

## Persistence

Macros are server-owned, revisioned state and are loaded, normalized, saved,
reset, and executed through the application protocol. Normalization preserves
explicit field definitions, normalizes values by type, migrates legacy
template-only macros into step-based macros, and derives legacy compatibility
fields from the step list.

## Tests

Macro coverage lives in `e2e/macros.spec.ts`. It covers:

- creating and saving a macro with synced fields
- starter macro field display
- raw select option editing and persistence
- clearing finished macro runs from the queue
- file-field search behavior relative to the project root
