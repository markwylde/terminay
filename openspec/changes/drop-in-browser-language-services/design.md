## Context

`TextViewer.tsx` imports the whole `monaco-editor` package. Monaco's ESM
language contributions resolve their workers with `new Worker(new URL(...))`,
so Vite emits the TypeScript, CSS, HTML, and JSON workers into `dist-web`
whether or not anything configures them. Nothing does: there is no
`MonacoEnvironment`, no compiler options, no extra libs, no model URIs. The
TypeScript worker therefore runs with defaults against a single anonymous
buffer and reports project errors that do not exist.

The file viewer spec asks Monaco for language detection, syntax highlighting,
and standard editing. Tokenizers provide all three.

## Goals / Non-Goals

**Goals:**

- No language service in the client.
- Remove the four language workers and their modes from the bundle.
- Keep highlighting for every language the viewer names today, including
  `.tsx` and `.jsx`.

**Non-Goals:**

- Replacing Monaco with another editor. That is a separate decision and is
  not required for this change or for phase 4.
- Removing PDF.js or the MDX editor's CodeMirror language packs.

## Decisions

### Import the editor core and named tokenizers

`TextViewer.tsx` and `MacrosWindow.tsx` import
`monaco-editor/esm/vs/editor/editor.api` and the `basic-languages`
contributions the viewer maps to. Nothing imports `vs/language/*`, so the
workers and modes are unreachable and Vite emits nothing for them. A
`MonacoEnvironment.getWorker` returns the base `editor.worker` only, so link
detection and word-based suggestions keep working without a console warning.

Alternative rejected: keep the barrel import and exclude workers in the Vite
config. It leaves the language modes registered, so Monaco still tries to
start the workers and logs failures, and it leaves the bundle one refactor away
from shipping them again.

Boundary: none crossed. This is client bundle composition.

### Highlight `.tsx` and `.jsx` as their base languages

Monaco's language ids are `typescript` and `javascript`; the JSX grammar is
part of both tokenizers. The `typescriptreact` and `javascriptreact` ids used
today exist only for the hand-rolled diff highlighter and fall through to
plain text in Monaco.

## Risks / Trade-offs

- [Word-based completion disappears if the base worker is omitted] → the base
  editor worker is kept; only language workers go.
- [A language the viewer relies on is not in the named import set] → the
  language map in `codeHighlight.tsx` is the source of truth, and a test
  asserts every id it emits is registered in Monaco after setup.
