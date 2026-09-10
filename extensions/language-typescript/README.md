# Terminay TypeScript Language extension

`terminay-language-typescript` is the official TypeScript and JavaScript
language server extension for Terminay. It is an ordinary ESM Node.js
extension: it imports only `@terminay/extension-api` and public Node APIs. It
does not import Terminay Server Core, Electron, renderer code, or a private
host bridge.

It contributes one language server, `typescript`, serving `.ts`, `.tsx`,
`.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs`, for the `typescript`,
`typescriptreact`, `javascript`, and `javascriptreact` language ids.

## What it decides, and what it does not

The extension decides exactly one thing: which TypeScript a project should be
served by. Given a project root it looks for that project's own
`node_modules/typescript`. A project's TypeScript is what its `tsconfig`, its
build, and its editors already agree on, so its diagnostics are the true ones
for that project. When the project has none, the TypeScript bundled with this
extension is used instead — that copy is part of the extension's production
dependency closure, so a server never depends on a machine-wide install and
never reaches npm at runtime.

Either way the session reports which one it used, as `project typescript
5.9.3` or `bundled typescript 5.9.3`, and Settings shows that.

Everything else belongs to the host: it spawns the language server with the
project root as the working directory, frames stdio, runs LSP initialise,
owns lifecycle, deadlines and crash accounting, and translates results into
Terminay's bounded language DTOs. No LSP JSON-RPC crosses the application
protocol, and this extension contributes no UI and registers no protocol
operations.

The launch runs `typescript-language-server --stdio` through this extension's
own Node executable rather than through the CLI's executable bit, so the
server runs on the runtime the host already vouches for and the launch does
not depend on how the package was extracted.

## Tests

`npm test` runs the unit tests for TypeScript resolution — with and without a
project TypeScript — and a conformance test against the **real**
`typescript-language-server`. That test builds a fixture project with a
`tsconfig`, a dependency in `node_modules`, the project's own TypeScript, and
one genuine type error, then asserts over stdio that the import resolves to a
definition in the dependency's declaration file, that hover and completion
answer, and that a real diagnostic is published for a `.ts`, `.tsx`, `.js`,
and `.jsx` file. It skips itself, rather than failing, when the language
server binary is not installed.
