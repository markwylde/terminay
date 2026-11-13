## Why

When Pixel's chosen agent (Claude Code or Codex) is not installed, Pixel opens
as though it could chat. The first message then fails with a terse,
repetitive error ("Claude Code is not installed on this server. Claude Code is
not installed. Install it, or set TERMINAY_CLAUDE_CODE_COMMAND…"), and nothing
says where to get the agent. Installing it afterwards does not help until
Terminay restarts, because a missing executable is remembered for the whole
extension activation.

## What Changes

- When Pixel opens and its chosen agent reports `not_installed`, the balloon
  says so in a friendly message, with a button that opens that agent's
  official install guide. If the other agent is available, it suggests
  switching to it in Settings > AI > Pixel.
- When no agent can be chosen during onboarding and at least one is missing,
  the greeting gets a button for each missing agent's install guide instead of
  the technical detail line.
- The guides are <https://code.claude.com/docs/en/setup> for Claude Code and
  <https://learn.chatgpt.com/docs/codex/cli> for Codex.
- The built-in agents extension no longer remembers a missing executable, so
  an agent installed while Terminay runs is found the next time it is asked
  for. A found executable is still cached for the activation.
- The extension's `not_installed` detail no longer repeats "is not installed"
  and names the install guide.

Not changing: how a provider is chosen, the Pixel chat itself, and how the
server reports an unavailable agent.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pixel-pet`: Pixel explains a missing agent and links its install guide.
- `builtin-agents-extension`: a missing agent CLI is looked up again on the
  next request.

## Impact

- `src/pixel/Pixel.tsx`, `src/pixel/pixelModel.ts`, `src/pixel/usePixelServer.ts`
- `extensions/builtin-agents/src/chat/{locate,claudeCode,codex}.ts`
- Tests: `src/pixel/pixelModel.test.ts`,
  `extensions/builtin-agents/test/chat-locate.test.mjs`, `scripts/pixel-ui.test.mjs`
