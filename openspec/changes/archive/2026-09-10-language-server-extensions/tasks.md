## 1. Protocol surface and cancellation

- [x] 1.1 Emit a `cancel` envelope for aborted queries in `packages/client-core/src/client.ts`, not only commands, and add a protocol conformance test that aborts a query and asserts the server handler's signal fired and no result was delivered. Verified by the conformance suite passing.
- [x] 1.2 Add `language.capabilities`, `language.completion`, `language.hover`, `language.definition` query DTOs, the `language.diagnostics` event DTO, `MAX_LANGUAGE_RESULT_BYTES` and item caps, and a `language.v1` capability to `packages/protocol`, with a `packages/client-core/src/language.ts` feature client. Verified by DTO validation tests including an over-cap result marked `isTruncated`.

## 2. Extension API

- [x] 2.1 Add `LanguageServerContribution` (id, language ids, file selectors, display name, runtime notes) to the manifest types, `contributes.languageServers` validation with limits in `constants.ts`, and `context.registerLanguageServerProvider` supplying a `launch(projectRoot)` that returns argv, cwd policy, environment, and initialisation options. Verified by validation tests accepting a valid manifest and rejecting one with a renderer or operation contribution.
- [x] 2.2 Extend `packages/extension-api/src/testing.ts` and `conformance.ts` with a language-server fixture that launches a stub LSP over stdio. Verified by the fixture passing conformance.

## 3. Language sessions in the host

- [x] 3.1 Add a `language.*` invocation kind to `packages/server-core/src/extensions/child.ts` and the host: the child spawns the language server as its own child with the project root as cwd, frames stdio, runs LSP initialise, opens and changes documents, forwards requests with deadlines, and reports crashes once through the existing crash accounting. Verified by host tests against the stub LSP covering start, request, crash, and quarantine.
- [x] 3.2 Add a session manager in `packages/server-core/src/languageService/` keyed by `(projectId, languageServerId)`: start on first request, share across clients, idle reap, per-server cap with a typed unavailable outcome, `starting`/`ready`/`unavailable` states. Verified by unit tests for sharing, idle reaping, and the cap.
- [x] 3.3 Register the language operation registries in `composition.ts` with read scope, resolving every path through the canonical project resolver, translating LSP results into bounded DTOs, and rejecting absolute or escaping paths. Verified by dispatcher tests including a path-escape rejection and a truncation case.
- [x] 3.4 Fan out `publishDiagnostics` as debounced `language.diagnostics` events on the workspace journal, and feed disk changes from the watch registry into the session. Verified by a test that a reconnecting client resyncs the latest diagnostics.

## 4. The TypeScript extension

- [x] 4.1 Create `extensions/language-typescript/` publishing `terminay-language-typescript` with id `com.terminay.language.typescript`, serving `.ts`, `.tsx`, `.js`, `.jsx`, launching `typescript-language-server --stdio` with the project's own TypeScript when `node_modules/typescript` exists and a bundled TypeScript otherwise, reporting which. Verified by conformance tests against the real language server on a fixture project with a `tsconfig` and a dependency, asserting a resolved import and a real diagnostic.
- [x] 4.2 Add it to `extensions/builtins.json`, the catalogue, `turbo.json`, `Dockerfile.e2e`, root scripts, staging and verification scripts, and the packaging contract tests. Verified by the packaged built-in inventory listing six extensions.
- [x] 4.3 Show the extension's languages and an enable toggle in Settings. Verified by the extension Settings unit test.

## 5. The editor consumes it

- [x] 5.1 Add a language gateway in `src/services/fileViewer/` that opens and changes documents with the draft revision, issues debounced completion, hover, and definition queries with deadlines, aborts superseded queries, and drops stale results. Verified by unit tests for debounce, abort, and stale-drop.
- [x] 5.2 Register Monaco completion, hover, and definition providers in `TextViewer.tsx` that call the gateway, apply `language.diagnostics` as model markers keyed by revision, open definition targets through the ordinary file-viewer open path, and fall back to highlighting only with no error when no provider serves the file or the session is unavailable. Verified by the file-viewer end-to-end test opening a `.ts` file in a fixture project and asserting a resolved import shows no error, a real error shows a marker, and completion lists a member.

## 6. Close out

- [x] 6.1 Update `docs/product-overview.md` pillars and boundaries to name language intelligence as a server-hosted extension capability. Verified by the document stating the client runs no language service.
- [x] 6.2 Run `openspec validate --all`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, and the Desktop end-to-end suite through `npm run test:e2e`. Verified by all passing.
