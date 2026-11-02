#!/bin/sh
# Gate item 2: Claude Code reads and removes its credential file in CLAUDE_SECURESTORAGE_CONFIG_DIR,
# separate from its config dir. Fake credentials, no network sign-in. Runs as the bot user.
set -u
CLAUDE=/usr/local/lib/node_modules/@agentclientprotocol/claude-agent-acp/node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64/claude
T=$(mktemp -d)
EXP=$(( $(date +%s) * 1000 + 86400000 ))
mkdir -p "$T/home/.claude" "$T/hostauth"
printf '%s' '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-fake","refreshToken":"sk-ant-ort01-fake","expiresAt":'$EXP',"scopes":["user:inference","user:profile"],"subscriptionType":"max"}}' > "$T/hostauth/.credentials.json"
chmod 600 "$T/hostauth/.credentials.json"
echo "== status with the credential only in the secure-storage dir"
HOME="$T/home" CLAUDE_SECURESTORAGE_CONFIG_DIR="$T/hostauth" timeout 60 "$CLAUDE" auth status 2>&1 | head -3 | tr '\n' ' '; echo
echo "== status without it (control)"
HOME="$T/home" timeout 60 "$CLAUDE" auth status 2>&1 | head -3 | tr '\n' ' '; echo
echo "== entries the CLI created"
echo "home/.claude:"; ls -A "$T/home/.claude"
echo "hostauth:"; ls -A "$T/hostauth"
echo "== logout"
HOME="$T/home" CLAUDE_SECURESTORAGE_CONFIG_DIR="$T/hostauth" timeout 60 "$CLAUDE" auth logout >/dev/null 2>&1
echo "hostauth:"; ls -A "$T/hostauth"
