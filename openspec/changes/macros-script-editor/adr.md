# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-10
- Reviewer: Claude (for Mark Wylde)
- Change: macros-script-editor

## In-Force ADR Context Reviewed

Depth of review: every ADR from 0001 to 0056 was screened by its title and status in `openspec/adr/README.md`. ADR-0056 was read in part, for the repository's format. ADR-0003 and ADR-0011 were searched for macro references; none of the others was opened.

- openspec/adr/0003-vault-interface-and-key-protectors.md - the vault and its privileged-callback read path stay as they are. This change removes the macro runner as a consumer; it does not alter the vault.
- openspec/adr/0011-security-trust-boundary-model.md - the renderer is untrusted. Macro definitions are renderer-authored, which is why a macro choosing a vault entry is removed and why the server, not the client, rejects a macro with an unsupported step.
- openspec/adr/0023-server-owned-clipboard-scratch.md - the reason the `paste` step is rejected. Not revisited; `paste` keeps its own rule.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - the Macros window presents the window's server and has no selector.
- openspec/adr/0053-in-page-windows-share-one-modal-frame.md - the redesigned window stays inside the shared in-page frame.
- Screened by title and not engaged: every other ADR from 0001 to 0056.

## Repository-Level ADRs Created

- openspec/adr/0057-nothing-written-into-a-terminal-is-a-secret.md - terminal input is never treated as confidential, and no feature resolves a vault entry into a PTY.

## Notes

The highest ADR sequence number in use is now 0057. No prior ADR is superseded. Categories, the script editor, and the unsupported-step rule are recorded in `design.md` only; they are choices within the macros capability and do not bind other changes.
