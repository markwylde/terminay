## Why

Open a TypeScript file in Terminay and it is covered in red. `Cannot find
module '@xterm/headless'`, `TS2792`, a hover that tells you to set
`moduleResolution` to `nodenext`. None of it is true of the project. The file
viewer ships Monaco's in-browser TypeScript language service, which typechecks
one buffer against Monaco's default compiler options with no `tsconfig`, no
sibling files, and no `node_modules`. It cannot be right, and it looks like a
broken IDE.

It is also most of the UI. The TypeScript worker alone is a third of the
unpacked workspace bundle, and the TypeScript, CSS, HTML, and JSON workers
together are about 8.7 MB of the 20 MB every browser session downloads from
its server. Nobody asked for them: the file viewer only needs syntax
highlighting and plain editing from Monaco.

## What Changes

- The file viewer ships no language service. No diagnostics, completions,
  hovers, or signature help originate in the client. Highlighting stays.
- Monaco is imported as its editor core plus the tokenizers for the languages
  the file viewer names, not the whole package. The TypeScript, CSS, HTML, and
  JSON language workers and their language modes are not built into the
  bundle.
- `.tsx` and `.jsx` files highlight as TypeScript and JavaScript. Today they
  map to language ids Monaco does not know and fall through to plain text.
- The file viewer non-goals say what the client does not do: run a language
  service. Language intelligence, when it exists, comes from the server
  (phase 4).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `file-viewer`: Text mode's editor contract names highlighting and editing
  only; the non-goals state that no language service runs in the client;
  `.tsx` and `.jsx` highlight correctly.

## Impact

- `src/components/file-viewer/modes/TextViewer.tsx`: import
  `monaco-editor/esm/vs/editor/editor.api` and the chosen
  `basic-languages` contributions instead of the `monaco-editor` barrel;
  supply a `MonacoEnvironment` that returns only the base editor worker.
- `src/components/MacrosWindow.tsx`: same import change for the macro
  template editor.
- `src/components/file-viewer/codeHighlight.tsx`: map `.tsx` and `.jsx` to
  `typescript` and `javascript`.
- `dist-web` loses `ts.worker`, `css.worker`, `html.worker`, `json.worker`,
  and the language mode chunks. The server UI archive shrinks by roughly
  8.7 MB unpacked and 1.9 MB compressed.
- No protocol, server, or extension change.

## Sequencing

Phase 3 of four. Independent of phases 1 and 2. Phase 4 assumes it has
landed, because phase 4 adds server-provided language features to an editor
that no longer competes with a client-side language service.
