# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-27
- Reviewer: Claude (with Mark Wylde)
- Change: add-server-desktop

## In-Force ADR Context Reviewed

The full index (`openspec/adr/README.md`) and every `Supersedes:` field were walked to find the in-force set. The ADRs below bear on this change and were read; the rest of the in-force set was reviewed by title and found unrelated.

- openspec/adr/0005 - sandboxed, origin-bound client hosts; no ambient clipboard reads by the client.
- openspec/adr/0011-security-trust-boundary-model.md - the boundary table this change adds a server-wide domain beside.
- openspec/adr/0013 - credentials only on transport-authenticated channels; the desktop stream carries none.
- openspec/adr/0035 and 0116 - the session holder owns PTYs and adopts without respawn, so only new terminals get the display environment.
- openspec/adr/0047 and 0048 - a window is bound to one server; a connection belongs to a window and authority to a device.
- openspec/adr/0022 and 0028 - watch, do not poll; setup progress and desktop liveness are watched, not polled.
- openspec/adr/0053 - in-page windows share one modal frame; the browser desktop window uses it.
- openspec/adr/0055 - exclusive ownership by a process is a kernel-held lock; the desktop's adopt-or-start decision uses one.
- openspec/adr/0088 - state files are replaced durably; the desktop state record follows it.
- openspec/adr/0115 - settings are organised by where they are stored; the desktop's on and off state is server state changed by its own operations, not a generic setting.
- openspec/adr/0054 - local sockets live in an owner-only runtime directory; the RFB socket goes there.
- openspec/adr/0062 and 0117 - the path-activated root upgrade helper that the setup helper follows.
- openspec/adr/0098-bot-desktop-owns-graphical-applications.md and 0127 - bot desktop lifetime; unchanged.
- openspec/adr/0120-bot-containers-run-under-a-terminay-apparmor-profile-that-allows-user-namespaces.md - user-namespace availability, relevant to dropping network access.
- openspec/adr/0124 - a command default leaves an inherited variable as it is, so it does not override the display environment.
- openspec/adr/0075 - management lives in one settings surface; Terminay Desktop's native windows stay a fixed list, so the desktop uses the in-page frame.
- openspec/adr/0129, 0132, and 0133 - bot desktop clipboard rules, applied unchanged to the server desktop.

No in-force ADR is superseded by this change.

## Repository-Level ADRs Created

- openspec/adr/0145-the-server-desktop-is-one-whole-screen-display-terminay-owns-reachable-only-through-a-private-socket.md - one whole-screen display Terminay owns, no network listener, relayed only through the Terminay connection; per-window alternatives rejected.
- openspec/adr/0146-the-server-desktop-is-a-server-wide-trust-domain-with-one-controlling-client.md - pairing is the trust point; any full Terminay connection may use the desktop, nothing outside it can; one controller.
- openspec/adr/0147-bot-and-server-desktops-share-one-remote-desktop-package-and-differ-only-in-connector-and-authority.md - one shared package; connector and authority are per use.
- openspec/adr/0148-host-packages-are-installed-only-by-a-root-helper-with-a-fixed-command-line.md - fixed package set, fixed root helper, no client-supplied input.

## Notes

- ADR-0145's mechanism clauses rest on a spike that has not been run (task 1.1). If it refutes them, a superseding ADR is recorded before implementation continues.
- Two files already share each of the numbers 0098, 0120, and 0125; that predates this change and is left alone.
