# ADR-0064: Rich Markdown editing is a file viewer view over the panel's own file session

Status: accepted
Date: 2026-10-16

## Context

Markdown and MDX file panels had two presentations: the file viewer, and a
Documentation presentation that drew MDXEditor in place of the file viewer's
chrome. The Documentation presentation opened its own server file session by a
project-relative path. In a linked worktree folder (ADR-0050) that path names
the main checkout's file, so Documentation had to be switched off there, and
every open, flush, and close path had to branch on presentation.

## Decision

1. A file panel has one presentation, the file viewer. An alternative way of
   showing or editing a file is a view (`FileViewerMode`) in its view switcher,
   never a second presentation of the panel.
2. Every editable view, including the rich Markdown editor, edits the panel's
   own file session and draft through the folder-scoped file authority the
   panel was opened with. A view never opens a second session for the same
   panel or builds a project-root path for a folder's file.
3. A view may choose its save policy (the rich editor autosaves; Text and HEX
   save explicitly), but leaving a view flushes its pending save first.
4. Services that are still bound to the project root, such as MDX execution,
   are withheld from a view in a linked folder. They never redirect the view to
   another file.

## Consequences

- Rich editing works in linked worktree folders with no new server authority.
- Opening a file chooses a view, so the open path has one rule: a named view
  wins, otherwise the file type's default view applies.
- A future view (for example, a structured editor for another format) is added
  as a mode with the same session, not as a parallel panel kind.
- MDX components do not execute in linked folders until the MDX runtime becomes
  folder-aware, which is still ADR-0050's open item.
