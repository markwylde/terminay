#!/bin/sh
# Gate item 2: does Claude Code on Linux read ~/.claude/.credentials.json through a symlink,
# and how does it write it? Fake, unexpired-looking credentials only; no network sign-in.
# Runs inside a bot container as the bot user, with a throwaway HOME.
set -u
CLAUDE=/usr/local/lib/node_modules/@agentclientprotocol/claude-agent-acp/node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64/claude
T=$(mktemp -d)
EXP=$(( $(date +%s) * 1000 + 86400000 ))
CRED='{"claudeAiOauth":{"accessToken":"sk-ant-oat01-fake","refreshToken":"sk-ant-ort01-fake","expiresAt":'$EXP',"scopes":["user:inference","user:profile"],"subscriptionType":"max"}}'

status() { HOME="$1" timeout 60 "$CLAUDE" auth status 2>&1 | head -5 | tr '\n' ' '; echo; }

echo "== regular file"
mkdir -p "$T/a/.claude" && printf '%s' "$CRED" > "$T/a/.claude/.credentials.json" && chmod 600 "$T/a/.claude/.credentials.json"
status "$T/a"

echo "== symlink to a file elsewhere"
mkdir -p "$T/b/.claude" "$T/shared" && printf '%s' "$CRED" > "$T/shared/.credentials.json" && chmod 600 "$T/shared/.credentials.json"
ln -s "$T/shared/.credentials.json" "$T/b/.claude/.credentials.json"
status "$T/b"

echo "== logout through the symlink"
HOME="$T/b" timeout 60 "$CLAUDE" auth logout >/dev/null 2>&1
ls -la "$T/b/.claude/" | grep credentials || echo "link gone"
ls -la "$T/shared/"

echo "== logout on a regular file: inode and entries"
ls -i "$T/a/.claude/.credentials.json"
HOME="$T/a" timeout 60 "$CLAUDE" auth logout >/dev/null 2>&1
ls -la "$T/a/.claude/"
