#!/bin/sh
# Codex is out of quota, so run Git directly under Codex's own sandbox instead
# of through the model. usage: run-codex-sandbox.sh <socket-path> <repo-dir>
sock="$1"; repo="$2"
export GIT_TRACE2_EVENT="af_unix:stream:$sock"
export GIT_TRACE2_EVENT_BRIEF=1
export GIT_TRACE2_EVENT_NESTING=1
export GIT_TRACE2_PARENT_SID="spike-codex-sandbox"
cd "$repo" || exit 1
codex sandbox git status --short --branch
echo "[exit $?]"
