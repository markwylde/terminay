## Why

Handing an AI agent a prompt from an automation means cramming the prompt into
the Command field, where every quote, newline, `$`, and backtick has to be
escaped for the shell. A prompt of more than a line is unpleasant to write and
easy to break. Automations need a way to write the prompt as plain multi-line
text and keep the shell command short.

## What Changes

- Add a second run-launching action, **Prompt an agent**, alongside "Run a
  command". It has the same fields as Run a command — command, working
  directory, shell, stop after — plus a multi-line **Prompt**.
- A prompt-agent run is a run-command run in every respect (automation
  terminal space, exit code as outcome, maximum duration, recording, keep
  terminal, every trigger), with one addition: the prompt text reaches the
  command verbatim as the `PROMPT` environment variable. `claude $PROMPT` (or
  `codex exec "$PROMPT"`, `opencode run "$PROMPT"`) is all the command needs.
- Terminay knows nothing about any agent CLI. The command is whatever the user
  writes; no provider name, flag, or syntax is built in, and the prompt is
  never spliced into the command line or interpreted.
- The editor, the automation list, the run detail, the client validation, and
  the MCP automation tools all accept and show the new action.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `automations`: adds the prompt-agent action and its `PROMPT` environment
  variable.

## Impact

- `packages/server-core/src/automationService/` — action type, normalization,
  executor launch, MCP rendering, protocol run-now check.
- `packages/client-core/src/automations.ts` — action type and validation.
- `src/workspace/automations/` — editor form, model, list and summary text.
- `apps/terminay-server/src/mcp/` — `create_automation` / `update_automation`
  descriptions and schema.
- Stored automations are unaffected: the new action is an additional `kind`,
  and the automation schema version does not change.
- An older client attached to a newer server cannot display a prompt-agent
  automation it does not understand.
