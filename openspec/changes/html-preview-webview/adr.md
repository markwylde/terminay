# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-07
- Reviewer: Mark Wylde
- Change: html-preview-webview

## In-Force ADR Context Reviewed

- openspec/adr/0038-app-views-run-in-a-self-sandboxing-proxy.md - the sandbox this change reuses. Its proxy, opaque origin, embedded policy, single-document rule, and gesture rule apply to an HTML preview unchanged. Extended to a new caller by ADR-0042, not superseded.
- openspec/adr/0011-security-trust-boundary-model.md - renderer content is untrusted at every privileged boundary. A previewed page gets no preload, IPC, storage, or protocol access.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - the workspace's own partition and content security policy are unchanged; nothing is loosened to run a page.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the preview is workspace-bundle presentation and must work in a remote browser, which rules out an Electron webview. A bundle may meet a server that does not publish `html`; the client then keeps the text preview.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - classification of a file as HTML stays on the server that owns the project.
- openspec/adr/0020-per-operation-canonical-roots.md - every inlined resource is a separate server read that canonicalizes and authorizes its own path.
- openspec/adr/0039-app-views-are-mirrored-from-the-controlling-client.md - not engaged. Each client renders its own preview from the shared draft; nothing is mirrored.
- openspec/adr/0028-no-polling-without-owner-approval.md - re-render is driven by draft changes; referenced resources are neither polled nor watched.
- openspec/adr/0037-mcp-apps-reach-terminals-through-a-terminay-gateway.md - not engaged. A file preview has no bridge to MCP or to a terminal.
- Also reviewed and not engaged by this change: 0002, 0003, 0006, 0010, 0012, 0013, 0015, 0016, 0019, 0021, 0023, 0025, 0026, 0027, 0029, 0031, 0033, 0034, 0035, 0036, 0040. Superseded and treated as history only: 0001 (by 0033), 0004 (by 0035), 0007 (by 0008), 0008 (by 0018), 0009 (by 0017), 0014 and 0024 (by 0025), 0022 (by 0028), 0030 (by 0031), 0032 (by 0036).

## Repository-Level ADRs Created

- openspec/adr/0042-file-previews-that-run-script-use-the-app-view-sandbox.md - a file preview may run file-provided script only inside the ADR-0038 proxy, with project resources inlined by the workspace and no network; no Electron webview is introduced.

## Notes

The highest ADR sequence number in use before this change was 0040.
