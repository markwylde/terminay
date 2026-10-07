## Why

A Terminay window can hold project tabs from several servers at once, and nobody can tell at a glance what a window is. Attaching a server adds its tabs to the strip beside Local's, yet Home's counts, the Tabs list, and Notifications cover the other server only in outline, Automations shows one server behind a picker, and Settings, Macros, Recordings, and Shell profiles each carry their own server selector. Every surface has to answer "which server?" separately, and a month after it shipped three of them still do not do what their specs say.

The simpler product is the one a person already expects: a window is one server. Local is always there on Desktop, other servers are added, and choosing one shows that server's window. It is also the right foundation for what comes next. Starting a server somewhere new, in a container or on a VM, is then one more way to add a server, not a special kind of project.

## What Changes

- **BREAKING** A window shows exactly one server. Attach and Detach are removed, as are the mixed-server tab strip, the per-tab server labels, greyed tabs for a lost server, and the window "composition" that Desktop persisted.
- **The header dropdown is a server switcher.** On Desktop it lists Local and every saved server. Choosing one switches the current window to that server; **Open in new window** is the second action on each row. Nothing on the server left behind is stopped.
- **Pairing takes you there.** After a server is added, the workspace window that opened Remote Control switches to it. Remote Control itself stays Remote Control.
- **A window remembers its server.** Desktop reopens a window on the server it last showed. A server that cannot be reached, or whose version is incompatible, is a state of the whole window, from which the dropdown still leads back to Local.
- **Every surface covers the window's server.** The server selectors on Settings, Extensions, Macros, Recordings, Shell profiles, and Automations are removed, and Home, Tabs, Notifications, the Agents pane, and the Command Bar stop naming or aggregating servers.
- **New projects are created on the window's server.** The server chooser on the new-project control is removed.
- **Add connection lists ways to get a server from one provider list.** Docker and a Linux host are the two providers today. The list is the slot a later change fills with a provider that starts the server for you; no such provider, and no Puzed card, is added here.
- **Kept from the multi-server work:** Desktop runs the workspace bundle packaged with it for every server and downloads none, and compatibility is negotiated per connection by the bundle's client in the protocol hello.
- **Not in this change:** showing another server's activity while you are in a different one. A window knows nothing about a server it is not showing.

Decisions taken with the owner: switching happens in the current window with a new window as the second action; no cross-server activity badge; one change rather than three; the finished-but-unarchived changes that carry multi-server wording are archived first; no Puzed placeholder; pairing switches the window.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `connections-and-client-hosts`: a connection window is bound to one server; the connection menu switches servers and opens windows instead of attaching; window persistence, reload, failure, pairing, and the bundle and compatibility requirements are restated for one server; Add connection draws its options from a provider list.
- `workspace-and-project-tabs`: the tab strip holds one server's projects; the new-project control has no server chooser; tear-off and cross-window drags stay on one server.
- `macros`: the server selector requirement is removed.
- `recording`: the server selector requirement is removed.
- `settings-shortcuts-and-desktop-integration`: the server selector requirement for Settings and Extensions is removed.
- `shell-profiles-and-terminal-launch`: the server selector requirement is removed.
- `server-owned-workspace-state`, `server-runtime-and-protocol`, `remote-access`, `agent-status-and-sidebar`, `workspace-dashboard`, `automations`, `mcp-server`, `dictation`, `workspace-status-bar`, `terminal-stream-congestion-and-recovery`: requirements whose wording assumes several attached connections are restated for one. Their deltas are written after the archive step in task group 1, because thirteen unarchived changes modify the same requirements and a delta written against today's text would be overwritten or would overwrite theirs. `design.md` lists every requirement concerned.

## Impact

- **Renderer:** `src/shared/connections/` (registry reduced to one connection; `composition.ts`, `serverSelection.ts` removed), `src/shared/ServerSelector.tsx`, `src/workspace/ConnectionsControl.tsx`, `RemoteAccessConnectionMenu.tsx`, `projectTabComposition.ts`, `useConnectionProjectTabs.ts`, `useConnectionAgentSnapshots.ts`, `crossServerAgentBadges.ts`, `crossServerRows.ts`, the Home, dashboard, Command Bar, compact switcher, and automations models, and the server-binding sections of `src/App.tsx`.
- **Electron main:** `electron/desktopWindowConnections.ts` and `desktopWindowComposition.ts` are removed; `electron/main.ts` gains switching a window to a remembered server and opening a window on one, and loses attached lanes and the composition store.
- **Protocol:** `packages/protocol/src/host.ts` — the `connections` host capability loses attach, detach, and composition and gains select and open-window; the context loses `composition`. `packages/client-core/src/connections.ts` loses its attached set.
- **Browser hosts:** `apps/terminay-web/src/framedConnectionHost.ts` and `src/web/sessionTransportHost.ts` lose the attached-connection surface. The manager at `app.terminay.com` is in the `terminay.com` repository; if it shipped attach, removing it there is a follow-up.
- **Device-local data:** `window-composition.v1.json` is no longer read or written. Saved servers and their credentials are untouched.
- **Decisions:** a new ADR supersedes ADR-0018, keeping its bundle and compatibility commitments and replacing its many-connections-per-window ones.
- **Unarchived changes:** thirteen in-flight changes carry multi-server wording in their deltas and are archived before this change's remaining deltas are written.
