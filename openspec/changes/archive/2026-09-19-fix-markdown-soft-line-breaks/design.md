## Context

The Documentation panel's rich text surface is MDXEditor 4.2.1 over Lexical.
Two behaviours combine into the defect:

1. `MdastTextVisitor` imports an mdast `text` node verbatim —
   `$createTextNode(mdastNode.value)` — and remark leaves the soft line break in
   that value as a literal `\n` (verified: `hello there,\nworld again.` arrives
   as one text node containing the newline).
2. Lexical sets `white-space: pre-wrap` as an inline style on the editable root
   (`lexical/dist/Lexical.dev.mjs:7808`), so that newline renders as a visible
   break.

Neither layer is wrong on its own. mdast is a faithful syntax tree; Lexical
needs preserved whitespace so a typed space at the end of a line does not
vanish. The defect is the absence of the step in between that a renderer does:
CommonMark says a softbreak may be emitted as a line ending *or* a space, and in
HTML both collapse to a space — unless whitespace preservation is on.

Upstream declined the nearest report (mdx-editor/editor#646) on the grounds that
Markdown engines differ, citing GitHub rendering a multi-line quote as multiple
lines. That evidence came from a GitHub *comment*, which is the one context
where GitHub enables hard wrapping. GitHub's own API separates the two:

```
POST /markdown mode=markdown  ->  <p>one line here,\ntwo lines here.</p>
POST /markdown mode=gfm       ->  <p>one line here,<br>two lines here.</p>
```

Terminay edits files, not comments, so the file behaviour is the one to match.
No in-force ADR speaks to editor rendering; this design crosses no security or
architectural boundary, and touches only bundled workspace UI presentation.

## Goals / Non-Goals

**Goals:**

- The rich text surface agrees with the live preview beside it about where a
  paragraph breaks.
- Reading a document never changes it on disk.
- Typed whitespace stays significant, so the fix cannot regress ordinary editing.

**Non-Goals:**

- Preserving the author's line wrapping through an edit. It is not preserved;
  see the decision below.
- Introducing a wrap width, a reflow rule, or any other formatting opinion.
- Forking or patching MDXEditor, or fixing source mode, diff mode, or the
  preview, none of which have the defect.

## Decisions

### There is no CSS fix, because Chromium does not implement the value

The first design corrected the rendering with
`white-space-collapse: preserve-spaces`, which is the exact inverse of the
defect: segment breaks become spaces while typed spaces stay significant. It was
chosen because it changes nothing on disk.

It does not work. MDN documents the value, but no Chromium implements it, so the
declaration is invalid and dropped and the inline `pre-wrap` wins unchallenged.
Measured in Chrome 153, the same engine as the bundled Electron:

```
CSS.supports('white-space-collapse', 'collapse')        -> true
CSS.supports('white-space-collapse', 'preserve-spaces') -> false
```

The implemented values are `collapse`, `preserve`, `preserve-breaks` and
`break-spaces`. None of them means "collapse segment breaks, keep spaces", and
`white-space: normal` would collapse the runs of spaces Lexical depends on. The
correction therefore cannot be presentational, and the document model has to
hold the space the newline stood for.

### Collapse on import, and accept that wrapping is not preserved

The newline is replaced by a space when the document is parsed. A paragraph the
author wrapped over four lines becomes one paragraph, and when the user edits
that document the save writes it as one line.

The alternative was to re-wrap on export at a chosen width, which keeps raw
Markdown readable but invents a formatting rule, cannot reproduce the author's
own break positions, and still reflows the file on first save. The cost of the
simpler choice is a one-time reflow diff per edited file; the cost of the other
is that plus a wrap rule to own forever. This was the user's call, made with
both costs stated.

### Correct the import visitor, not the Markdown source

The collapse runs on an mdast `text` node's value, inside a replacement for
MDXEditor's `MdastTextVisitor`, rather than on the Markdown string before it is
parsed.

A string preprocessor would have to re-derive, with regular expressions,
everything the parser already knows: fenced and indented code, tables whose row
newlines are structural, frontmatter, hard breaks, list and quote markers, HTML
and JSX blocks, and link reference definitions. Every one of those is a way to
corrupt a document. By the time a `text` node exists, the parser has already
separated prose from all of it, list indentation and quote markers are stripped
(verified: `* item one\n  continues here` arrives as `"item one\ncontinues
here"`), a hard break is a `break` node, and code is a `code` node. The
correction is then one `replace` that cannot reach anything else.

Import visitors are matched first to last and `corePlugin` registers its text
visitor before any plugin's, so the replacement has to go in front of
`importVisitors$` rather than be appended to it. Later plugins append, which
leaves it in front.

### Reading a document is not editing it

MDXEditor reports its initial normalization through `onChange` with
`initialMarkdownNormalize` set. The autosave controller already ignored that
flag, but `DocumentationEditor` passed the value to the panel's `onChange`
first, which set the panel dirty. With the collapse in place that would rewrite
every hand-wrapped file the moment it was opened — the whole cost of the fix,
charged for merely reading. The initial report now returns before reaching
either, while still updating the editor's own value so the document is not
re-imported.

## Risks / Trade-offs

- **A user's line wrapping is lost on the first edit** → Stated in the proposal
  and in the spec, and it is the decision the user made. Nothing is lost while a
  file is only read.
- **The fix depends on MDXEditor internals: `importVisitors$`, visitor order,
  and the shape of the core text visitor** → All are exported API, and a unit
  test pins the visitor's placement at the front of the list. A version bump
  that changes the order shows up as a failing end-to-end check, not as silent
  corruption.
- **Upstream could fix this later and double-collapse** → Their fix would remove
  the newline before our visitor sees it, leaving the `replace` with nothing to
  do.
- **A hard break must keep working** → A hard break is a `break` node handled by
  a different visitor and rendered as `<br>`, untouched by this change.

## Migration Plan

None. No stored state, protocol, or file changes shape, and the change is
reverted by removing the plugin.

## Open Questions

None outstanding. No in-force ADR needs revisiting.
