## Context

**Today.** The activity reducer in `packages/server-core/src/activity/reducer.ts` keeps, per terminal session, a status, an `attention` flag, and an `acknowledged` flag. Viewing or typing acknowledges; a later meaningful transition makes it unread again. Clients receive that state as `activity.snapshot` and `activity.delta` and each derives its own notifications from it: `buildTerminalActivityOverview` in `src/workspace/TerminalActivityOverview.tsx` picks the terminals, `src/workspace/notificationText.ts` words the headline, and `src/App.tsx` reports the count to Desktop for the Dock badge. The same snapshots drive the dots on terminal and project tabs.

**What is missing.** There is no notification object, no identifier for one, no place to hold text an agent supplies, and no single point at which "should a person be told about this yet?" is decided.

**Constraints.**

- The server owns terminal-session state; clients are untrusted and derive no authority (ADR-0011, ADR-0048).
- A fact taken from terminal output is live server state and never a workspace commit (ADR-0058).
- The MCP surface is server-owned, reached through one local control endpoint with a per-terminal capability, and every operation sits in exactly one permission group (ADR-0031, ADR-0037).
- No polling (ADR-0028). A timer armed by an event is not a poll.
- Work on the output path is proportional to the output event (ADR-0044).

## Goals / Non-Goals

**Goals:**

- One component on the server owns what a notification is, when it exists, and when clients hear of it.
- A terminal adds and removes its notifications and knows nothing about timing, clients, or delivery.
- A notification that lasts less than five seconds is never shown to anyone.
- Every client shows the same list and count because they are sent it.
- An agent, or any process in a terminal, can send and dismiss a notification through the control endpoint.

**Non-Goals:**

- Push to the installed PWA. `pwa-push-notifications` consumes this manager's published set.
- Changing how activity, attention, or acknowledgement are decided. The reducer's rules stand.
- Delaying terminal and project status dots.
- Operating-system banners from Desktop, sounds, or per-kind preferences.
- A `terminay` CLI subcommand. The control-endpoint operations make one possible later.
- Persisting notifications across a server restart.

## Decisions

### D1. A notification is a server-owned record that belongs to one terminal

The manager holds records of the form: an opaque id unique on the server, the owning project and session ids, a source, a kind, optional title and body text, the time it was raised, and whether it has been published.

There are two sources:

- **`activity`**: at most one per terminal. It exists exactly while the reducer has that terminal unacknowledged and either needing attention or finished. Its kind is one of agent finished, agent waiting, agent blocked, command finished, or terminal needs attention.
- **`message`**: sent through the control endpoint by a process in that terminal. It carries the sender's title and body.

*Boundary:* terminal-session and project boundaries. A record's owner is resolved by the server from the session that produced the activity or from the capability that made the call. No client and no caller names an owner.

*Alternative.* Keeping notifications as a client-side view of activity state is what exists; it cannot hold agent text and has no place for a delay that all clients share.

### D2. Terminals add and remove; the manager decides when anyone is told

The manager's whole inbound surface is `add`, `update`, and `remove`. The activity layer calls them as the reducer's state changes; the control endpoint calls them for `send_notification` and `dismiss_notification`. Neither caller knows about the settle period, publication, or delivery.

Outbound, the manager publishes on the server's ordered event journal, and exposes the published set to in-process consumers (push, later). Nothing else in the server reads pending records.

*Boundary:* none crossed; this is an internal seam inside Terminay Server.

### D3. Pending for five seconds, then published; removal is always possible

When a record is added it is **pending** and a five-second timer is armed. If it is still present when the timer fires it becomes **published** and clients are told. If it is removed while pending it is deleted and nothing is ever sent, which is why removal needs no special case: the manager holds the record from the moment it is added, whether or not anyone has been told.

Removing a published record is published at once, so a notification never lingers after the reason for it has gone.

An update to an existing record (an activity notification moving from waiting to finished, or a message replaced by its sender) keeps the record's publication state. A published record's change is published at once; a pending record's change keeps its original deadline. This avoids a banner clearing and reappearing five seconds later for what the user sees as one continuing event.

The timer is armed by the add event and cancelled by the remove event. Nothing is sampled.

*Alternative.* Treating a change as remove plus add is simpler to state and makes every state change restart the five seconds, which reads as flicker.

### D4. Status dots are not notifications and are not delayed

Terminal tab dots and project dots continue to come from `activity.snapshot` and `activity.delta` and show state immediately. The header Notifications count and list, the Desktop icon badge, and anything built on the published set appear after the settle.

The result is a consistent reading: a dot says what a terminal is doing now; a notification says it has been waiting for you.

This is also what makes the settle effective. A client that is showing a terminal sees its state at once and acknowledges it as it does today, which removes the pending record before it is published.

### D5. Interaction removes every notification of that terminal

Acknowledging a terminal, by clicking its tab, clicking into it, typing, or the existing `activity.acknowledge` operation, removes all of that terminal's records, message records included. An agent's notification is therefore dismissed by the same act as any other.

A message sent while the user is already interacting with its terminal is acknowledged by that user's client in answer to the probe (D6), and is never published.

Dismissing one row in the list removes that one record. For an activity record that is the same server-owned acknowledgement as today. For a message record it removes the record and nothing else.

A terminal closing removes its records.

### D6. A sent notification does not change terminal activity

The first design had `send_notification` raise attention through the reducer, so the tab would turn red and acknowledgement would clear it for free. Implementation showed that cannot work where it matters most. For a terminal an agent owns, provider state is the only authority: the reducer ignores a notification signal there, and a client draws that terminal's indicator from agent status, not from fallback attention. Raising attention would have lit the indicator only for terminals with no agent, and would have added a second "needs attention" notification beside the one that was sent.

So the manager alone holds a sent notification, and sending one changes no indicator and no activity state. It appears in the Notifications list and count once published. Two small seams replace what attention was meant to give:

- **Interaction is reported, not inferred.** The activity service tells the manager whenever a user types in a terminal or any client acknowledges it, including when the reducer had nothing left to clear. The manager removes what was sent to that terminal.
- **A probe asks whether anyone is already there.** When a process sends a notification the server emits `notifications.probe`, naming the terminal and nothing else. A client whose user is clicking or typing in that terminal answers with the ordinary activity acknowledgement, which removes the pending record before it is published. The record itself is never shown to a client while pending.

*Boundary:* the activity reducer stays the single authority for attention and the manager does not write activity state. The probe carries a project and session id under the same project scoping and automation-space withholding as every other event.

### D7. Two control-endpoint operations, wrapped as MCP tools

`send_notification` takes a body of at most 280 characters and an optional title of at most 80, and returns an opaque handle. Given the handle of a notification the calling terminal sent, it replaces that notification's text in place. `dismiss_notification` takes a handle and removes that notification. A handle is valid only for the terminal that sent it, and neither tool can see or remove an activity notification or another terminal's.

They are operations of the local control endpoint, dispatched through the explicit operation table with the resolved scope of the capability that called. The stdio adapter exposes them as tools. Any process in the terminal that inherited the capability can call them over the socket, which is how `show_window` already works.

A terminal may hold at most eight message notifications, and sends are rate-limited per terminal. Over the bound the call fails with a bounded error.

*Boundary:* local control socket → Server. Scope comes from the capability's server-owned session, never from a parameter.

### D8. Agent text is bounded plain text

Title and body are stored as plain text within their bounds, with control characters and escape sequences removed, and are rendered as text everywhere. They select nothing, are never written to a terminal, and are never interpreted as markup or a link.

The message body of an `OSC 9` or `OSC 777` notification remains unused. This change does not turn terminal output into notification text; only an explicit call through the capability does.

### D9. A new permission group, Notifications

The two operations form their own group, defaulting to Always Allow. They are less powerful than App Windows, which is also Always Allow, and a user who finds an agent noisy needs a switch that does not also remove its windows. Under Ask Permission the prompt states the notification's title and body.

### D10. Clients render the published set

The protocol gains `notifications.snapshot` and `notifications.delta`, carried on the ordered event journal with the same contiguous-revision and resync rules as activity, a `notifications.dismiss` operation that names one notification by id together with its exact project and session ids, and the `notifications.probe` event of D6. A server advertises them as the `notifications.v1` feature capability, which a client treats as optional.

The wire types live beside activity's, in `packages/server-core` and `packages/client-core`, not in `packages/protocol`; that is where every other server projection keeps them.

The workspace's list, count, and Desktop badge report render that set when the server advertises `notifications.v1`. Desktop runs its own bundle against servers of other versions (ADR-0047), so against a server that does not publish notifications the window keeps reading terminal activity itself, as it did before. The client-side rule therefore stays in the bundle as that fallback and is not deleted. The headline for an activity notification is still worded on the client from its kind, so wording stays with presentation. The **Show indicator for active tabs** and **Show indicator for finished tabs** settings continue to govern what the list shows.

### D11. Notifications are live state and are not persisted

The manager's records live in memory. After a server restart, activity notifications reappear from the reducer's restored state and settle again; message notifications are gone. This follows ADR-0058: a notification is a fact about a live terminal, not a workspace commit.

## Risks / Trade-offs

- [The header and Dock badge lag reality by five seconds] → Intended. Tab and project dots stay immediate, so nothing is hidden, only not yet announced.
- [Existing e2e scenarios assert a count straight after a terminal finishes] → The manager takes an injectable clock; tests advance it instead of sleeping.
- [An agent floods a terminal with notifications] → Eight per terminal, a rate limit, a permission group that can be set to Ask or Never, and any interaction with the terminal clears them all.
- [Agent text is used to mislead, for example naming another terminal] → A row always shows the owning terminal and project, resolved by the server, beside the text.
- [A message sent while the user is watching the terminal is never shown] → Accepted: the agent's output is in front of them. Stated in the tool description so an agent does not rely on it.
- [Message notifications vanish on restart] → Accepted for now and recorded as an open question against `terminals-survive-restart`.
- [`one-window-one-server` restates the requirements this change modifies] → Whichever is archived second rebases its delta; the content does not conflict, only the headings.
- [A second projection beside activity doubles client resync logic] → It reuses the activity projection's revision and resync machinery, not a new one.

## Migration Plan

1. Land the manager fed by the reducer, publishing alongside the existing activity stream, with clients unchanged.
2. Switch the workspace list, count, and badge report to the published set wherever the server advertises `notifications.v1`, keeping the client-side derivation only for servers that do not.
3. Add the control-endpoint operations, the MCP tools, and the permission group.

A client that predates step 2 keeps deriving from activity and shows notifications without the settle; it is not broken. A new client against an older server does the same. Rollback of step 2 is to stop advertising the capability. The manager holds no persisted state, so there is nothing to migrate or clean up.

## Open Questions

- **Should the settle be longer while someone is actively using a client on that server?** A flat five seconds does not stop a phone buzzing for a background terminal while the user is at their desk. Left flat for now by the owner's choice; the manager is the one place a longer hold would go.
- **Should message notifications survive a server restart** once `terminals-survive-restart` lands? Assumed no.
- **Are the two Show indicator settings device-local or server-scoped?** This decides whether push, which has no client to filter for it, can honour them. Carried by `pwa-push-notifications`.
- **Does `workspace-and-project-tabs` need its sentence that project dots use "the same per-terminal items that feed the header Notifications list" reworded?** The dots keep their source; the list changes its own. To check when the derivation is deleted.
