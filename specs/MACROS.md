# Macros Specification

## Summary

Terminay macros are reusable terminal automation recipes. A macro is made from ordered execution steps and optional user-supplied fields. Users launch macros from the Command bar, fill any required fields in a parameter modal, preview the rendered output, then type the rendered steps into the active terminal.

## Template Syntax

Type steps support Eta templates. The renderer is configured for plain terminal text rather than HTML:

- Eta tags such as `<% if (message === 'one') { %>...<% } %>` can control output.
- Eta interpolations such as `<%= message %>` insert values.
- Field names are available as top-level identifiers, so users can write `message` instead of `it.message`.
- XML escaping is disabled because macro output is terminal input, not HTML.
- Legacy `{{Field Name}}` placeholders continue to work for existing macros.

Template rendering is centralized in `src/macroSettings.ts` through `renderMacroTemplate(...)`. Runtime execution in `src/App.tsx` uses that renderer for each `type` step before writing to the terminal.

## Fields

Macro fields are stored on the macro definition and keyed by `field.name`. Supported field types are:

- `text`
- `textarea`
- `select`
- `number`
- `checkbox`
- `emoji`
- `file`

When the user runs a macro, `src/App.tsx` opens a parameter modal if the macro has fields. The modal:

- initializes each field from `defaultValue`
- validates required fields before execution
- renders a live preview with `tryRenderMacroTemplate(...)`
- executes the macro only after the user submits the form

`Sync from Steps` detects both legacy `{{Field}}` placeholders and common Eta identifiers inside template tags. This detection is a convenience for creating fields; explicit fields are preserved on save even when they are not currently detected in a step.

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

Macros are loaded, normalized, saved, and reset through Electron IPC:

- `window.terminay.getMacros()`
- `window.terminay.updateMacros(macros)`
- `window.terminay.resetMacros()`

Normalization in `src/macroSettings.ts` preserves explicit field definitions, normalizes values by type, migrates legacy template-only macros into step-based macros, and derives the legacy `template` / `submitMode` fields from the step list for compatibility.

## Tests

Macro coverage lives in `e2e/macros.spec.ts`. It covers:

- creating and saving a macro with synced fields
- starter macro field display
- raw select option editing and persistence
- clearing finished macro runs from the queue
- file-field search behavior relative to the project root
