## Why

A Grok session that is clearly running in a Terminay terminal can be missing
from the Agents pane, while another project's Grok row still shows. After a
turn goes green, sending another message or typing `grok --resume` can make
that row vanish even though the TUI is still live. It looks like only one
Grok can be observed at a time.

Observation is per PTY, not global. The Grok registry path failed closed when
`active_sessions.json` listed more than one descendant pid of the issued
terminal — a helper, a leftover resume pid, or a second Grok in the same
process tree. After a shell or resume edge, that registry is often the only
binding path, so the pane goes empty.

## What Changes

- Bind a Grok root when any descendant pid in `active_sessions.json` owns an
  eligible primary journal, even if several descendant pids are listed.
- Keep identity on pid and the primary journal. CWD is still not identity.
- When more than one listed descendant owns an eligible primary journal, select
  the most recently modified one, the same rule already used for writer-held
  journals.
- Keep a later `turn_started` after `turn_ended` as `working` on the same
  root. Resume MCP records after `turn_ended` still do not return the root to
  `working`.
- Prove two concurrent Grok terminals, a PTY with two registry pids, a later
  turn after completion, and `grok --resume` while another Grok is still live.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-status-and-sidebar`: Grok registry binding must admit a PTY whose
  `active_sessions.json` match set is larger than one descendant pid, as long
  as an eligible primary journal is proven for that tree.

## Impact

- `extensions/agent-grok`: `findActiveSessionRoot` selection.
- `extensions/agent-grok/test/provider.test.mjs`: concurrent registry binding
  and two-pid PTY coverage; later-turn mapping.
- `packages/server-core/test/extension-agent-runtime.test.mjs`: two terminals
  of one provider keep independent active roots.
- `e2e/fixtures.ts`: pid-keyed native Grok stub sessions so two processes do
  not share one journal. The existing single-CLI Electron spec stays.
- No protocol, host-API, or client change. Observation stays inside the public
  Extension API.
