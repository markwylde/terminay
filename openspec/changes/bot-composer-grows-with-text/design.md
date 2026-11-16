## Context

`BotChat` renders the composer as a `rows={2}` `<textarea>` inside
`.bots-composer form`. `botPanels.css` sets `.bots-composer textarea` three
times; the last block wins with `min-height: 40px`, `resize: none`, 13px text
and the inherited line height. Nothing sets a height from the content, so text
beyond two lines scrolls. The draft is held by the tab (`onDraftChange`) and
survives the component unmounting.

The change stays in the renderer. It crosses no host, server, or security
boundary: no privileged API, no protocol message, no new stored state.

## Goals / Non-Goals

- Goal: a three-line minimum, growth to `max(3 lines, min(12 lines, 40vh))`,
  internal scroll beyond it, shrink on delete/send/clear, re-fit on width or
  window-height change.
- Goal: unchanged Enter / Shift+Enter / IME behaviour, failed-post drafts, paste of files, and drop.
- Non-goal: a user-draggable resize handle, other textareas (the message
  editor, configure forms), or the composer's other controls.

## Decisions

- **Measure in JS rather than `field-sizing: content`.** `field-sizing` sizes a
  textarea to its content in Chromium (Electron) but not in every browser the
  PWA runs in, notably older iOS Safari. A layout effect that sets
  `height: auto` and then, for a nonempty draft, `height = scrollHeight` (clamped by CSS
  `min-height`/`max-height`) works everywhere and is a few lines.
- **Limits live in CSS.** The textarea gets an explicit `line-height: 1.5`,
  `min-height: calc(3 * 1.5em)` and `max-height: min(calc(12 * 1.5em), 40vh)`
  (it has no padding). JS only writes the content height; the browser clamps
  it. When both limits conflict in a very short window, CSS gives `min-height`
  precedence, so the box stays three lines; the spec states this.
- **`overflow-y: auto` for drafts, set in CSS.** With the height equal to
  `scrollHeight` nothing overflows, so no scrollbar shows. When the window gets
  shorter and `40vh` drops below the written height, `max-height` clamps it and
  the text scrolls without any re-measure. Toggling overflow from JS would need
  a re-measure on every height change; static CSS needs none. An empty textarea keeps `height: auto` at the CSS minimum and uses `:placeholder-shown` to hide overflow, so a long wrapped placeholder cannot enlarge the empty composer or show a scrollbar.
- **The placeholder never sizes the box.** A textarea's `scrollHeight`
  includes a wrapped placeholder, so a long bot name in a narrow tab would grow
  an empty box. An empty value leaves `height: auto`, so the CSS minimum
  applies, and `:placeholder-shown` hides overflow so the clipped placeholder
  shows no scrollbar.
- **The cap is on the text box only.** Attachments, the error note and the
  buttons sit outside it. With the box at its 40vh cap, the transcript still
  scrolls in what remains; a Home split shorter than the window is bounded by
  the same 12-line cap.
- **When to measure.** In a `useLayoutEffect` keyed on `draft`, so typing,
  paste, programmatic inserts (including #597's quote), send/clear (the draft
  becomes empty) and remount with a restored draft are all covered before
  paint. A `ResizeObserver` on the textarea re-measures when its width changes
  (window resize, split resize, rail toggled); it compares the observed width
  with the last one so the height it sets itself does not loop. A window that
  grows taller needs no re-measure: the written height is the full content
  height and only `max-height` was holding it back.
- **Send behaviour is untouched.** `keyDown` still ignores Enter during IME
  composition; `send` still clears the draft only when the post succeeds and
  the draft is unchanged, so a failed or overtaken post keeps its text, and the
  effect on `draft` sizes whatever remains.
- **`rows` drops to 1.** The CSS minimum sets the floor; `rows` only seeds the
  intrinsic height before the first measure.

## Risks / Trade-offs

- [The composer can take up to 40% of a short window, plus its attachments and
  controls] → The transcript keeps scrolling in the rest; attachments are a
  single wrapped row of thumbnails. No guarantee is made about a Home split
  shorter than the window beyond the 12-line cap.
- [#597 edits the same component in parallel] → The sizing hooks onto
  `draft`, which any insert updates, so the merge is mechanical; this branch
  merges main before CI.

## Migration Plan

None. Renderer-only; rolling back restores the fixed two-line box.

## Open Questions

None.
