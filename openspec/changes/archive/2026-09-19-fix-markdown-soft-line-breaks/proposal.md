## Why

A Markdown file whose paragraphs are hand-wrapped over several source lines —
the normal way people keep raw Markdown readable — is shown in the Documentation
editor with a hard line break at every one of those wraps. The document on
screen does not look like the document any Markdown renderer produces, including
the live preview sitting beside it, so the rich-text surface misrepresents the
file a user is editing.

The cause is a soft line break losing its meaning between two layers. Markdown
treats a single newline inside a paragraph as a space and only a blank line as a
paragraph boundary. MDXEditor imports the paragraph text with that newline
character still in it, and Lexical forces `white-space: pre-wrap` on its editable
root, which renders the newline literally. Upstream has declined the closest
report (mdx-editor/editor#646) as a difference between Markdown engines, so
Terminay carries the correction.

## What Changes

- The Documentation editor's rich-text surface renders a Markdown soft line
  break as a space, matching the live preview and every standard renderer, while
  a real hard break, and every line break inside code, continue to render as
  written.
- Opening a document never writes to it. The editor reports the normalization it
  performs when it parses a document, and that report no longer marks the
  document dirty or reaches autosave, so reading a file leaves its bytes alone.
- Once a user edits a document, the save writes the document as the editor holds
  it, which puts each wrapped paragraph on one line. The words are unchanged;
  their line wrapping is not preserved. This is the accepted cost of the fix.

## Capabilities

### New Capabilities

<!-- None. This corrects existing Documentation editor behaviour. -->

### Modified Capabilities

- `documentation-sidebar-and-editor`: the rich-text editing surface gains stated
  requirements that it renders Markdown soft line breaks as spaces, that reading
  a document never rewrites it, and that a save writes the document as the
  surface holds it.

## Impact

- `src/components/file-viewer/documentationMarkdownCompat.ts` — gains the
  collapse, beside the existing MDX compatibility fix.
- `src/components/file-viewer/documentationEditorPlugins.tsx` — a small MDXEditor
  plugin that puts a corrected text import visitor in front of the core one.
- `src/components/file-viewer/DocumentationEditor.tsx` — the editor's initial
  normalization no longer counts as an edit.
- No change to the server, the file session, the autosave protocol, or any file
  that is only read.
- **Line wrapping is not preserved** in a document the user edits. Anyone whose
  Markdown is hand-wrapped will see a one-time reflow diff for each file they
  edit.
