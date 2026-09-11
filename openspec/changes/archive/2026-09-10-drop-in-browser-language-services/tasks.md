## 1. Import the editor core, not the package

- [x] 1.1 Replace the `monaco-editor` barrel import in `src/components/file-viewer/modes/TextViewer.tsx` with `monaco-editor/esm/vs/editor/editor.api` plus the `basic-languages` contributions for every id `codeHighlight.tsx` can emit, and register a `MonacoEnvironment.getWorker` that returns only the base editor worker. Verified by opening a `.ts`, `.css`, `.json`, and `.yaml` file in Text mode with highlighting and no console worker warning.
- [x] 1.2 Apply the same import change to the macro template editor in `src/components/MacrosWindow.tsx`, keeping the `eta-template` Monarch grammar and both `addCommand` bindings. Verified by the Macros window highlighting a template and saving with Cmd+Enter.
- [x] 1.3 Add a unit test asserting every language id `codeHighlight.tsx` emits is registered in Monaco after setup. Verified by the test passing.

## 2. React files highlight

- [x] 2.1 Map `.tsx` to `typescript` and `.jsx` to `javascript` in `codeHighlight.tsx` for the Monaco path, leaving the diff highlighter's own ids intact. Verified by a unit test for both extensions and by opening a `.tsx` file in Text mode.

## 3. The bundle carries no language workers

- [x] 3.1 Build `dist-web` and confirm no `ts.worker`, `css.worker`, `html.worker`, `json.worker`, or `*Mode` language-mode chunk is emitted. Verified by listing `dist-web/assets` after `npm run build:server-ui`.
- [x] 3.2 Add a build check to the server-UI bundle build that fails when a language worker or language mode chunk is present in the output, naming the file. Verified by a test that stages an output tree with and without a worker chunk.
- [x] 3.3 Record the new archive size with `scripts/server-ui-archive-benchmark.mjs` and update the benchmark evidence file. Verified by the evidence file showing the reduced compressed and unpacked sizes.

## 4. Close out

- [x] 4.1 Run `openspec validate --all`, `npm run lint`, `npm run test:ci`, and the file-viewer end-to-end suite through `npm run test:e2e`. Verified by all passing.
