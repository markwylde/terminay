# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-15
- Reviewer: Mark Wylde
- Change: browser-clipboard-image-paste

## In-Force ADR Context Reviewed

- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md — clipboard read
  stays exact-origin and user-initiated; it is not elevated through Desktop
  and is not a credential-isolation boundary. Framed hosts already delegate
  `clipboard-read`.
- openspec/adr/0011-security-trust-boundary-model.md — project filesystem
  mutations stay inside the canonical project root. This change must not
  widen `files.create` into `/tmp`.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md —
  the path inserted into the terminal has to exist on the server that owns
  the PTY, not on the phone.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md — paste
  lives in the shared workspace bundle and is host-neutral.
- openspec/adr/0020-per-operation-canonical-roots.md — client-supplied paths
  are not authority; the scratch command does not take a destination path.

Superseded and therefore historical only: ADR-0007 (by ADR-0008), ADR-0008
(by ADR-0018), ADR-0009 (by ADR-0017).

## Repository-Level ADRs Created

- openspec/adr/0023-server-owned-clipboard-scratch.md — browser clipboard
  images are written by the server into `os.tmpdir()/terminay-clipboard`
  under a server-chosen name; this is not a project-catalog write.

## Notes

Safari's user-activation rule for `clipboard.read()` is the same trap already
handled for `writeClipboardText`. It is an implementation constraint, not a
new durable boundary.
