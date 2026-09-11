# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-09
- Reviewer: Mark Wylde
- Change: language-server-extensions

## In-Force ADR Context Reviewed

- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - a project's files are on its server, which is why the language server can run there
- openspec/adr/0009-server-owned-project-environments.md - superseded by ADR-0017; its extension placement rule (extension code runs only on the server, nothing enters the renderer) is carried forward in ADR-0017 and honoured here
- openspec/adr/0011-security-trust-boundary-model.md - the "Server → extension child" row applies to the language session child unchanged; a language server is a process the extension could already spawn
- openspec/adr/0014-declared-provider-capabilities-proven-against-real-clis.md - the same principle applies to language servers: the TypeScript extension is proven against the real `typescript-language-server` in conformance tests
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - the editor adapter lives in the server-bundled UI; hosts see only opaque `language.*` frames
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - every language request targets one server and one project, so attached servers need no special handling

ADR-0001 through 0006, 0010, 0012, 0013, 0015, and 0016 are in force and do not
constrain this change.

## Repository-Level ADRs Created

- openspec/adr/0019-language-intelligence-from-server-hosted-language-server-extensions.md - the client runs no language service; language servers are an extension contribution kind hosted on the server; core owns a bounded language protocol surface; one shared session per project and language

## Notes

The query-cancellation fix is a protocol correctness change that every
feature benefits from. It is recorded in ADR-0019 because language queries
are the first surface that cannot work without it.
