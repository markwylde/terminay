## Context

A window today holds a primary connection and any number of attached ones (ADR-0018, the archived `multi-server-workspace` change). The reality underneath is narrower than the model:

- The renderer already works in one server at a time. `src/App.tsx` binds every workspace surface to one active connection and remounts when it changes. Other attached servers contribute only read-only project tabs (`useConnectionProjectTabs`) and agent badges.
- So the aggregating surfaces fall short of their specs: Home's tab and terminal counts, the Tabs list's panel rows, and the Notifications control cover the working server only.
- A Desktop window whose one connection is a remote server still works. `createWindow` accepts a remote launch and transport, `mountCanonicalLaunch` binds it, reload reconnects it, and it runs Desktop's packaged bundle. Only three callers use it: two tear-off paths and pairing.
- No action switches a window to a remembered server. The renderer has a dormant `connection.select` request with no protocol action and no handler in `electron/main.ts`.
- After pairing, `switchToPairedDesktopServer` remounts the window that issued the request, which in the shipped UI is the Remote Control window.
- The new-project flow has no VM or environment choice. Project environments were removed on 2026-09-10 (ADR-0017). The only "where" choice left is which attached server.
- There is no lightweight way to learn that another server has activity. It takes a full authenticated application connection and that server's workspace snapshot, and a server holds at most one live connection per device.

The owner's decisions, taken by questionnaire on 2026-10-07: switching happens in the current window, with a new window as the second action; no cross-server activity badge; this is one change; unarchived changes that carry multi-server wording are archived first; no Puzed placeholder card; pairing switches the window.

In-force ADRs that bear on this: ADR-0005 (sandboxed, origin-bound client hosts), ADR-0011 (trust boundaries), ADR-0012 (the PWA frames the session origin), ADR-0013 (device-bound approval, channel-only credentials), ADR-0017 (every project executes on the server that owns it), ADR-0018 (one bundle, many connections — revisited here), ADR-0028 (no polling), ADR-0040 (Home tabs are device-local). ADR-0008 and ADR-0009 are superseded and are history only.

## Goals / Non-Goals

**Goals:**

- A window is one server, and a person can tell which.
- The dropdown switches the window's server; a second action opens a server in its own window.
- Every surface loses its server dimension: no selectors, no server chips, no cross-server rows.
- Keep what the multi-server work got right: Desktop's packaged bundle for every server, and compatibility negotiated in the hello.
- Add connection takes its options from one provider list, so a later provider that starts a server for the person slots in without redesigning the page.

**Non-Goals:**

- Showing activity on a server no window is showing.
- Any Puzed provider, card, or API.
- A provider that runs Docker or creates a VM on the person's behalf.
- Changing pairing, approval, credentials, or any server behaviour.
- Changing the manager at `app.terminay.com`, beyond the framed-host surface this repository owns.

## Decisions

### 1. The window, not the connection set, is the unit

A window holds exactly one connection. `ConnectionRegistry` is reduced to that one connection (client, heartbeat, recovery, workspace store, agent store), and `ConnectionRole` goes. Everything built to combine servers is deleted rather than hidden: `composition.ts`, `projectTabComposition.ts`, `useConnectionProjectTabs.ts`, `useConnectionAgentSnapshots.ts`, `crossServerAgentBadges.ts`, `crossServerRows.ts`, `serverSelection.ts`, `ServerSelector.tsx`, the automations server select, inert-tab rendering, and the `namesServers` branches in the Home, dashboard, Command Bar, and compact switcher models.

- *Alternative: keep the machinery and cap the attached set at zero.* Rejected: it keeps every `(serverId, …)` branch alive and untested.

### 2. Switching is a host action that remounts the window

**Boundary:** which server a window is bound to is a host decision. The renderer is untrusted (ADR-0005, ADR-0011) and holds no origin and no credential.

Two closed actions join the `connections` host capability: `connections.select { profileId }` and `connections.open-window { profileId }`. Both name a remembered profile by id, are source-bound to the requesting window, and require a user gesture. Main resolves the profile, opens the authenticated transport (or the Local session), and only then calls the existing `mountCanonicalLaunch` path on the target window, releasing the previous binding with reason `server-switch`. Until the transport is ready the window keeps its current document; a failed attempt leaves it there and rejects the action with a reason the menu shows. This is the path pairing already uses, generalised.

`connections.attach`, `connections.detach`, `connections.composition.write`, the attached byte endpoints (`server-ui-host:connection-endpoint`, `acquireDesktopAttachedTransport`), and the `composition` field of the host context are removed. `connections.list`, `connections.rename`, `connections.forget`, and the `connections.changed` event stay.

- *Alternative: switch inside the renderer by swapping the registry's connection.* Rejected: the host would have to hand a second transport to a live document, which is the attached-endpoint machinery under another name.
- *Alternative: always open a new window.* Rejected by the owner: switching in place is the default.

### 3. Local is restored, not restarted

Switching back to Local re-prepares the embedded server's session for that window. Nothing on any server is stopped by switching away from it, so Local's projects and terminals are as they were. The window's Local workspace view binding is kept across a visit to a remote server.

### 4. The window remembers its server

Desktop persists, per window and beside its geometry, the profile id the window shows and its workspace view. `DesktopWindowCompositionStore` and `window-composition.v1.json` are removed; the file is left on disk and ignored. At startup a window reopens on its remembered server. If that server cannot be reached the window shows the connection state with the connection menu usable, so the person is never stuck outside Local. A remembered profile that has since been forgotten falls back to Local.

- *Alternative: always start on Local.* Rejected: a person who works on one remote server would switch on every launch.

### 5. Failure and incompatibility are window states

There are no greyed tabs. An offline, reconnecting, unauthenticated, or incompatible server is presented for the whole window, by the reconnecting overlay and recovery surface the window already has. The header's connection menu is rendered outside that overlay so it stays reachable.

### 6. Pairing switches the workspace window

Remote Control is an auxiliary window. The pair action carries on as a closed host action, but its target is the workspace window Remote Control was opened from, not the Remote Control window. When enrollment succeeds and the transport is ready, main switches that workspace window (decision 2) and publishes the new profile to every window. If the first connection fails, the profile is saved, the workspace window is left alone, and Remote Control reports it. If the originating window has closed, the profile is saved and nothing is switched.

### 7. Forget, and windows on the forgotten server

Forgetting a remembered server (introduced by `pairing-install-instructions-and-beta-image`) keeps its rule: it is refused while any window shows that server. The refusal names the action that resolves it, which is now switching that window to another server.

### 8. Tear-off and cross-window drags stay on one server

A torn-off window is opened on the source window's server. A project tab may be dropped only on a native window showing the same server; the drag preview state main already publishes carries the source server identity, and a window on another server does not present itself as a target.

### 9. Several windows on one server

Two windows may show the same remote server, as a torn-off window already does. Each is its own connection under the same device key. How the server treats a second live connection from one device (`remote-access`: "One live connection per device") is not established for this case and is the first thing the apply phase verifies; see Open Questions.

### 10. Add connection reads a provider list

`ServerInstallGuide` takes its options from an ordered list of provider descriptors — id, label, hint, and the steps to show — in `serverInstallCommands.ts`. Docker and Linux host are the two entries. The radio group, steps, and More options render from the list. No provider is added.

**Boundary:** a provider descriptor is static data in the bundle. It is not an extension point and loads nothing.

- *Alternative: an extension-contributed provider API now.* Rejected: there is one consumer in view and no second design to generalise from.

### 11. Browser hosts

A browser session already shows one server, chosen in the manager. The framed-host `connections.*` attach surface in `apps/terminay-web/src/framedConnectionHost.ts` and `src/web/sessionTransportHost.ts` is removed. A manager that still offers it is harmless: the bundle no longer asks.

### 12. Spec deltas are written in two passes

Thirteen unarchived changes modify requirements this change also rewrites. A delta written against today's main spec would be overwritten when they archive, or would overwrite them. So this change's deltas written now are limited to requirements none of those changes touch: the connection model in `connections-and-client-hosts`, the tab strip and new-project control in `workspace-and-project-tabs`, and the four selector requirements. The rest are written after the archive step, against the main specs as they then stand. They are:

- `connections-and-client-hosts`: Versioned source-bound host bridge; Bounded host bridge surface; Web connection host scope; Bundle content stays out of the manager origin; One responsive workspace implementation; Remote code containment in Electron; Renderer context contents; Browser connection journeys; Allowed and forbidden host-local profile data; Desktop persistence allowlist; Desktop bundle commitment from the packaged artifact; Exposing a server from a client host; and, once archived, Remote Control lists the host's remembered servers and Renaming and forgetting a remembered server on Desktop.
- `workspace-and-project-tabs`: Project tab management; Project activity count follows viewed terminals; Project tab activity count badge; Project switcher rows show the activity count badge; Project overflow switcher; Reordering projects; Pending project tab during creation; New project roots; Panel creation, splitting, and movement; Window closing and application shutdown; Canonical workspace state and presentation-local selection; Authorization derives from server identities; Compact switcher terminal creation shows the created terminal; Compact bar presentation; Unified compact switcher; Compact switcher panel rows; Dropping a terminal tab on a project tab.
- `server-owned-workspace-state`: Canonical model ownership and client role; Workspace views are not window ids; Client-owned device-local state; Desktop persistence allowlist; Browser connection-host persistence; Consistency scope; Native project-host window binding; Identity-based authority for requests; Disconnect and restart lifecycle; Workspace state non-goals; Cross-client convergence for panel changes; Ids are namespaced by server.
- `server-runtime-and-protocol`: Servers bundle their own workspace UI; Host supplies transport and presentation bridge only; Desktop byte endpoint binds server identity; Bundle manifest declarations govern launch; Contract and bootstrap failure reporting; Bundle acquisition per host.
- `remote-access`: Ownership boundaries; Closed framed-host message schema; Server-bundled workspace delivery; Single connection generation per mounted workspace; One live connection per device; Desktop remote-code containment; Consistent workspace across clients; Returning to the manager list.
- `agent-status-and-sidebar`: Server-owned authorization and client subscription; Agents pane presentation; Terminal tab and header status surfaces; Header activity dropdown count badges are fixed-size circles; Header Notifications control; Notifications list; Dismissing notifications.
- `workspace-dashboard`: Dashboard row model; Home overview section; Home search; Dashboard agent detail; Dashboard summary and filter; Board grouping by project; Command Bar contents; Automation tabs.
- `automations`: Automations section.
- `mcp-server`: One MCP socket per server and no cross-server addressing.
- `dictation`: Dictation resolves its server from the target terminal.
- `workspace-status-bar`: Remote access indicator.
- `terminal-stream-congestion-and-recovery`: Renderer behaviour while the client is unusable.
- `recording`: Recording surfaces require the canonical client. `settings-shortcuts-and-desktop-integration`: Server settings client boundary.

## Risks / Trade-offs

- [A person loses sight of an agent waiting on another server] → accepted by the owner for now. Two windows show two servers. A host-readable activity summary is recorded as an open item in the new ADR.
- [Two windows on one remote server may fight over one device connection] → verified first in apply (task 2.1). If the server replaces the older connection, **Open in new window** focuses an existing window on that server instead of opening a second, and tear-off of a remote window is resolved the same way.
- [A window starts on an unreachable server] → the connection menu stays usable in the failure state, and Local is one choice away.
- [The second pass of spec deltas is large] → it is mechanical: each listed requirement loses its attached-connection wording. The list above is the checklist, and `openspec validate` gates it.
- [Archiving thirteen changes first is its own piece of work] → each is finished or nearly so by its task count; any that turns out not to be mergeable is left unarchived and its overlapping requirement is handled in this change's delta instead, noted in the pull request.
- [The `terminay.com` manager may still offer attach] → harmless to this bundle, and removing it there is a follow-up.
- [Stale composition files on disk] → ignored, never read; they hold no secrets.
- [A large deletion across `src/App.tsx`] → done after the switch works end to end, in steps that each keep the suite green.

## Migration Plan

1. Archive the unarchived changes that carry multi-server wording, and write the remaining deltas.
2. Add switching and open-in-new-window in the host while attach still exists, and point the connection menu at them.
3. Move pairing's target to the workspace window.
4. Remove attach, composition, and the cross-server renderer code; then the selectors.
5. Persist each window's server and restore it.
6. Move the install guide onto the provider list.

A person upgrading keeps every saved server and credential. A window that had servers attached opens showing Local; the others are in the dropdown. Rollback is reverting the change; saved servers are untouched either way.

## Open Questions

- How does a server treat two live connections under one device key? (Decision 9; resolved by task 2.1.)
- Should the Desktop File menu gain **New Window** on the current server, now that windows are the way to see two things at once?
- ADR-0018 is revisited: its many-connections-per-window decisions are replaced and its bundle and compatibility decisions kept. The adr step records the superseding ADR.
