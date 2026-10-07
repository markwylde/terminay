#!/bin/sh
# Run one agent, non-interactively, in a throwaway repository with the Trace2
# variables set, and ask it to run a single Git command.
# usage: run-agent.sh <claude|codex|grok|omp> <socket-path> <repo-dir>
agent="$1"; sock="$2"; repo="$3"

if [ ! -d "$repo/.git" ]; then
	mkdir -p "$repo"
	git -C "$repo" init -q -b main
	echo hello > "$repo/README.md"
	git -C "$repo" add .
	git -C "$repo" -c user.email=a@b -c user.name=a commit -qm init
fi

export GIT_TRACE2_EVENT="af_unix:stream:$sock"
export GIT_TRACE2_EVENT_BRIEF=1
export GIT_TRACE2_EVENT_NESTING=1
export GIT_TRACE2_PARENT_SID="spike-$agent"

prompt='Run the shell command `git status --short --branch` exactly once using your shell tool, then reply with only its output. Do nothing else.'
cd "$repo" || exit 1
case "$agent" in
	claude) claude -p "$prompt" --allowedTools 'Bash(git status:*)' ;;
	codex) codex exec "$prompt" ;;
	grok) grok -p "$prompt" ;;
	omp) omp -p --auto-approve "$prompt" ;;
esac
echo "[exit $?]"
