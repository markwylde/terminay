# Language server conformance fixture

An independent, third-party language server extension used to prove the public
`@terminay/extension-api` surface end to end: the manifest validates, the
package packs, the extension activates against
`createLanguageServerExtensionHarness`, and the launch it returns starts a real
child process that speaks the Language Server Protocol over stdio.

`dist/stub-language-server.js` is a deliberately tiny server. It answers
`initialize`, `textDocument/completion` with one item, `textDocument/hover` and
`textDocument/definition`, and publishes one diagnostic after `didOpen`. It
implements nothing else, because nothing else is part of the contract this
fixture proves.
