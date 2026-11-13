## Context

Macros, workflow templates, shell profiles, automations, and settings are all
server-owned. Each has a client in `@terminay/client-core`:
- `MacroClient`
- `WorkflowClient`, for templates
- `ShellProfilesClient`
- `AutomationClient`
- `SettingsClient`

Settings reaches them through the connection chosen in the server selector
(`useSelectedServerConnection`). A Desktop window already holds a
`WorkspaceConnection` with its own `TerminayClient` for the primary Local server
and for every attached remote (ADR-0047). The specs rule out routing between
servers and consistency across servers (`server-owned-workspace-state`).
Commands accept `expectedRevision` and fail on conflict, which is the canonical
revision contract.

ADR-0075 makes Settings the only management surface. It makes server-scoped
categories follow the server selector (rule 4), and it gives collection
categories a list column (rule 2). The user wants this tool reachable "under
Settings" in the Terminay menu. The mockup chosen in exploration is concept A,
the sync matrix: https://claude.ai/artifact/U6kySfEYxvgwZbsNdpnPrA.

## Goals / Non-Goals

**Goals:**
- See at a glance which servers have which items, and where they drift apart.
- Copy any set of items from one server, or from a bundle file, to one or more
  servers, deciding each clash explicitly.
- Back up a selection to a file, and restore it from that file.

**Non-Goals:**
- An ongoing sync or link between copies.
- Copying vault secrets, recordings, projects, terminals, bots, extensions, or
  the Remote Access, Recording, Shell launch, or Updates settings.
- Browser hosts.
- Any new server protocol operation or server-to-server traffic.

## Decisions

### D1. The client copies, and each write goes through the target's own client

**Boundary crossed:** client/server trust, once for each server. The renderer
reads the source through the source connection's client. It writes each item
through the target connection's client, using the operations that the target's
own Settings uses. Every target validates, bounds, authorizes, revisions, and
broadcasts the write exactly as it would a local edit.

*Alternative rejected:* a server-side "pull from server X". It needs
server-to-server credentials and routing, which the specs forbid.

### D2. A pure item model with explicit portable schemas

`src/importExport/` holds one module for each kind. Each module has an explicit
**portable schema** with bounds that mirror the server's. The client-core
response parsers are private and need ids, so they cannot be reused. Each module
provides:
- `read(client) -> { revision, items }`
- `toPortable(item, context)`, which strips ids and server fields and turns
  references into named references
- `key(portable)`: `kind:` plus the trimmed, case-folded name. Only the identity
  key folds case.
- `fingerprint(portable)`: canonical JSON with sorted keys. It is
  case-sensitive and excludes an automation's `enabled` state.
- `validatePortable(value)`, used by bundle import
- `plan(…)` and `apply(…)`

The matrix, review, and bundle code all share these modules, so the logic is
unit-testable without Electron.

### D3. Matching, duplicates, and clash choices

Items match by key. A server holding more than one item with the same key shows
**duplicate name**. That column cannot be the source for the row, and Replace on
such a target asks which item to replace.

Clash choices depend on the kind:
- **Macro, template, shell profile, automation:** Replace, Keep both, or Skip.
  Keep both writes under a fresh id with the next free `<name> (n)`.
- **Settings category:** Replace or Skip. There is nowhere to keep a second copy
  of a category.

None of these choices is preselected. The user decided this.

### D4. What each kind carries

| Kind | Read | Write | Notes |
|---|---|---|---|
| Macro | `MacroClient.get` | `upsert` (`expectedRevision`) | A missing category is added with a revision-guarded `replace(macros, {categories})` from the same read. Fresh ids for new items and for Keep both. |
| Workflow template | `templates` | `upsertTemplate` (`expectedRevision`) | Step ids are omitted. A missing category goes through revision-guarded `replaceTemplates`/`reorderTemplates` with categories. |
| Shell profile | `catalogue` + `detail` | `create` / `update` | Only `kind: "custom"`. Review runs `validate` on the target. A refused `detail` shows **not permitted**. |
| Automation | `get` | `upsert` (`enabled: false`) | `runMacro.macroId` becomes `{macro: name}` and `shellProfileId` becomes `{shellProfile: name}`. These are resolved at apply time (D5). |
| Settings category | `SettingsClient.get` | `update` nested patch | Covers **every** field key of `terminalSettingsSections` in the category, using the source's normalized value. Replace therefore converges to **same**. Only appearance, theme, cursor, interaction, keyboard, scrolling, accessibility, files, and ai. |

### D5. The plan is a dependency graph with bindings

For each target, review builds write nodes. A node for an automation depends on
the node, or on the existing target item, for each named reference. If the
target lacks the reference, a dependency node is added and shown.

At apply time, a reference binds to the dependency's outcome:
- **Replace:** the target id that was replaced.
- **Keep both:** the new id.
- **Skip, or up to date:** the existing target id.
- **Failed, blocked, or changed since review:** the dependent is blocked.

Nodes run in topological order: shell profiles and macros, then templates,
settings, and automations.

### D6. Writes are revision-guarded and never roll back

Every write carries the `expectedRevision` that review read for that target and
kind. Writes are sequential for each target and kind, and each success updates
the expected revision from the returned state. A conflict reports **changed
since review** and the other client's edit is kept. Nothing rolls back: a
partial copy is still a correct state on each server, and a rollback would be a
second set of writes that nobody reviewed.

### D7. Selection lifecycle

The source defaults to the active project's server, and to the primary
connection when no project is active. Changing the source clears the row
selection. An open review is discarded when its source or any chosen target
connection leaves `ready` or is detached.

### D8. Column states

A column can be **not ready** (the connection phase), **not supported** (the
server does not offer the kind's operations, decided per connection under
ADR-0047), or **not permitted** (the read or write was refused for this
device). Columns in any of these states cannot be a source or a target for
those rows.

### D9. The bundle is versioned, contains no ids, and is validated in full

The bundle has this shape:
`{ "format": "terminay.import-export", "version": 1, "exportedAt", "source": { "label" }, "items": [ { "kind", "name", "content" } ] }`.

- Content is the D2 portable shape, with named references.
- Export adds the dependencies of the selected items.
- Import refuses the whole file, with a reason, when it is over 4 MiB, malformed,
  of an unknown version or kind, or has forbidden fields (ids, revisions), a
  duplicate key, an out-of-bounds item, or a dangling reference.
- **Import:** the renderer reads a user-chosen `File`, so no path or bridge is
  involved.
- **Export:** a new bounded host action `import-export.bundle.save` carries the
  bytes and a sanitized filename to the save dialog, modelled on
  `preview.download`. **Boundary crossed:** the renderer-to-Electron bridge.
  The action takes no path, needs a user gesture, and is capped at 4 MiB.

Vault secrets are never involved, because no copied kind references the vault
(`macros.ts`: macros never read it). Literal content such as scripts, prompts,
and profile environment values is copied verbatim. The export UI says the file
holds it as plain text.

### D10. Placement: one Settings category that spans connections

`import-export` joins **Connections** after Remote Access, and is added only
when `hostKind === 'desktop'`. Its page is full width with no list column, and
the server selector is hidden for it. Each column is still that server's data
through its own client, and nothing is merged.

This departs from ADR-0075 rules 2 and 4 for this one category, so ADR-0111
records the partial supersession. The Terminay menu gains **Import & Export…**
below **Settings…**, dispatching `open-import-export`, which opens
`openSettings('import-export')`. The Command Bar gets the same command.

*Alternatives rejected:*
- A separate window (ADR-0075 rule 1).
- A Home section, because Home is for workspace content.

## Risks / Trade-offs

- [Copied settings change the look for other clients of that server] → Settings
  rows are opt-in, and review names each category being replaced.
- [Copied paths do not exist on the target: shell profile, automation `cwd`] →
  Target-side `validate`, review warnings, and automations arrive disabled.
- [Exported files hold literal content, which may include pasted credentials] →
  The export warning, and the save dialog is under the user's control.
- [A large matrix] → Reads run in parallel for each connection, rows are
  virtualized beyond 200, and refresh is driven by each kind's change events.
- [A macro category add replaces the whole macro library] → It is
  revision-guarded with the same read, so any concurrent edit turns it into
  **changed since review**.

## Migration Plan

This is an additive Desktop surface with no data migration. To roll back,
remove the category, the menu item, and the host action.

## Open Questions

- `settings-shortcuts-and-desktop-integration` "Management surface commands"
  still describes the File menu that ADR-0075 removed. That drift predates this
  change and is out of its scope.
- `openspec validate --all` already fails on 7 items unrelated to this change.
  Task 5.3 checks that this change adds no new failures.
