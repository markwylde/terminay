#!/bin/sh
# Gate item 1: record the file events of Codex sign-in and sign-out in a throwaway CODEX_HOME,
# to find the lock sidecar and temporary-file names the host-auth watch must allow.
# Runs inside a bot container as the bot user. Fake keys only.
set -eu
CODEX=/usr/local/bin/codex
CH=$(mktemp -d)
inotifywait -m -q -e create,moved_to,moved_from,delete --format '%e %f' "$CH" > "$CH.events" &
W=$!
sleep 1
echo sk-fake-x | CODEX_HOME="$CH" "$CODEX" login --with-api-key >/dev/null
echo sk-fake-y | CODEX_HOME="$CH" "$CODEX" login --with-api-key >/dev/null
CODEX_HOME="$CH" "$CODEX" logout >/dev/null || true
sleep 1
kill "$W"
cat "$CH.events"
echo "--- final entries"
ls -A "$CH"
