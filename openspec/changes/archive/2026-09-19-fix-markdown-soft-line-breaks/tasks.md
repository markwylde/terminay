## 1. Reproduce and pin the defect

- [x] 1.1 Add a hand-wrapped Markdown fixture containing a paragraph wrapped
      over several source lines, a blank-line paragraph break, a hard line
      break, a wrapped list item, and a wrapped block quote. It lives as a
      seeded workspace document in `e2e/documentation-sidebar-editor.spec.ts`,
      which is how every other Documentation end-to-end test supplies its
      content; `tests/fixtures/documentation-project/` is a static fixture no
      end-to-end test reads. Verified by the checks in 1.2 and 3.1 loading it.
- [x] 1.2 Extend `e2e/documentation-sidebar-editor.spec.ts` with a failing
      check that the wrapped paragraph renders as one continuous run of prose in
      the rich text surface. Verified by the check failing before the fix lands.

## 2. Correct the rendering

- [x] 2.1 Collapse the soft line break on import. `collapseSoftLineBreaks` in
      `src/components/file-viewer/documentationMarkdownCompat.ts` replaces a
      newline and its surrounding spaces with one space, and
      `softLineBreakPlugin` in
      `src/components/file-viewer/documentationEditorPlugins.tsx` puts a text
      import visitor using it in front of `importVisitors$`, ahead of the core
      visitor. It runs on parsed `text` nodes, never on raw source, so code,
      tables, hard breaks, and list and quote markers cannot be reached.
      Verified by the check from 1.2 passing.
      *(A CSS fix was attempted first and does not work: Chromium implements no
      `white-space-collapse` value that collapses newlines while keeping spaces.
      See design.md.)*
- [x] 2.2 Keep reading a document free of writes: the editor's initial
      normalization returns before the panel's `onChange` and before autosave in
      `src/components/file-viewer/DocumentationEditor.tsx`. Verified by
      `scripts/documentation-soft-line-breaks.test.mjs`, which pins the collapse
      itself, the visitor's placement, the early return's position, and the
      absence of a stylesheet attempt. It lives in `scripts/` and is registered
      in `npm run smoke`, because no npm script runs the `src/**/*.test.ts`
      files.

## 3. Verify behaviour end to end

- [x] 3.1 Extend the end-to-end coverage to the remaining scenarios: blank-line
      paragraph breaks still separate paragraphs, a hard break still renders as
      a break, the wrapped list item and block quote read as continuous prose,
      and source mode still shows the file as written. Verified by
      `npm run test:e2e` passing.
- [x] 3.2 Cover typed whitespace: consecutive spaces and a trailing space at the
      end of a line stay visible and the caret stays put. Verified by the same
      end-to-end suite.
- [x] 3.3 Cover caret and selection across a wrap point: arrow keys, shift
      selection, and backspace treat the wrap as a single continuous paragraph.
      Verified by the same end-to-end suite.
- [x] 3.4 Cover both halves of the write contract: opening a hand-wrapped
      document and waiting past the autosave delay leaves the file byte for byte
      unchanged, and editing it writes each wrapped paragraph on one line with
      the same words. Verified by the same end-to-end suite.

## 4. Record the behaviour

- [x] 4.1 Sync the new requirements into
      `openspec/specs/documentation-sidebar-and-editor/spec.md`. Verified by
      `openspec validate` passing and the requirements appearing in the main
      spec.
- [x] 4.2 Run `npm run lint` and the unit suite. Verified by both passing with
      no new findings.
