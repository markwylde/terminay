#!/bin/sh
# Prepares the container's own HOME so the real `claude` CLI reaches a
# conversation without a human at the keyboard, then runs the conformance suite.
#
# Two things stand between a fresh HOME and the first journal record, and
# neither is something the provider under test can be blamed for:
#
#   1. Onboarding. A HOME the CLI has never seen shows the theme and login
#      screens before anything else. `hasCompletedOnboarding` retires them.
#   2. The custom API key prompt. When ANTHROPIC_API_KEY is set, the CLI asks
#      "Do you want to use this API key?" and writes nothing until it is
#      answered, so the harness would time out waiting for a binding that
#      cannot exist yet. The CLI records that answer in
#      `customApiKeyResponses.approved` as the key's last 20 characters, which
#      is what is pre-recorded here.
#
# The folder-trust prompt is deliberately NOT pre-answered: the harness works
# in a fresh temporary directory every run, and the descriptor answers that
# prompt through the PTY like a user would.
#
# The key itself is never echoed; only its last 20 characters reach the config,
# which is the CLI's own representation.
set -eu

: "${HOME:?HOME must be set}"
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
	echo "ANTHROPIC_API_KEY is not set inside the container." >&2
	exit 78
fi

mkdir -p "$HOME"
approved=$(printf '%s' "$ANTHROPIC_API_KEY" | tail -c 20)
cat >"$HOME/.claude.json" <<JSON
{
  "hasCompletedOnboarding": true,
  "theme": "dark",
  "customApiKeyResponses": { "approved": ["$approved"], "rejected": [] }
}
JSON
chmod 600 "$HOME/.claude.json"

exec npm run test:conformance --workspace terminay-agent-claude-code
