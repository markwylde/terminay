#!/bin/sh
set -eu

state_file="${TMPDIR:-/tmp}/terminay-docs-codex-stub-${PPID}"
mode=exec
prompt=""
rows=24
cols=80

while [ $# -gt 0 ]; do
	case "$1" in
		exec)
			mode=exec
			shift
			;;
		resume)
			mode=resume
			shift
			;;
		--last|--include-non-interactive|--skip-git-repo-check|--all|--json|--ephemeral)
			shift
			;;
		--sandbox|--cd|--output-last-message|--model|--profile|-C|-o|-m|-p|-s|-c)
			shift
			[ $# -gt 0 ] && shift
			;;
		--)
			shift
			break
			;;
		-*)
			shift
			;;
		*)
			prompt=$1
			shift
			;;
	esac
done

if [ -z "$prompt" ] && [ $# -gt 0 ]; then
	prompt=$1
fi

term_size() {
	size=$(stty size 2>/dev/null || true)
	stty_rows=${size%% *}
	stty_cols=${size##* }
	if [ -n "$stty_rows" ] && [ "$stty_rows" -gt 0 ] 2>/dev/null; then
		rows=$stty_rows
	elif [ -n "${LINES:-}" ]; then
		rows=$LINES
	else
		rows=24
	fi
	if [ -n "$stty_cols" ] && [ "$stty_cols" -gt 0 ] 2>/dev/null; then
		cols=$stty_cols
	elif [ -n "${COLUMNS:-}" ]; then
		cols=$COLUMNS
	else
		cols=80
	fi
	if [ "$rows" -lt 12 ]; then
		rows=12
	fi
	if [ "$cols" -lt 40 ]; then
		cols=40
	fi
}

hline() {
	i=0
	width=$((cols - 4))
	if [ "$width" -lt 8 ]; then
		width=8
	fi
	printf '  '
	while [ "$i" -lt "$width" ]; do
		printf '─'
		i=$((i + 1))
	done
	printf '\n'
}

begin_tui() {
	term_size
	printf '\033[?1049h\033[2J\033[H\033[?25l'
	printf '\033[1;36m  gpt-5.6\033[0m  \033[2mhigh · %s\033[0m\n' "$1"
	printf '\033[2m'
	hline
	printf '\033[0m\n'
	printf '\033[1m  ▌ %s\033[0m\n\n' "$2"
}

end_tui() {
	term_size
	footer_row=$((rows - 2))
	if [ "$footer_row" -lt 8 ]; then
		footer_row=8
	fi
	printf '\033[%d;1H' "$footer_row"
	printf '\033[2m'
	hline
	printf '\033[0m'
	printf '  \033[36m›\033[0m \033[2mAsk Codex\033[0m\n'
	printf '\033[2m    ⏎ send  ⌃J newline  ⌃C quit\033[0m'
}

hold_math_journals() {
	dir="${TMPDIR:-/tmp}/sessions/2026/08/28"
	mkdir -p "$dir"
	root="$dir/rollout-docs-root.jsonl"
	printf '%s\n' \
		'{"timestamp":"2026-08-28T18:00:00.000Z","type":"session_meta","payload":{"id":"docs-agent-root","cli_version":"0.150.1","originator":"codex-tui","source":"cli","model":"gpt-5.6"}}' \
		'{"timestamp":"2026-08-28T18:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"Spawn 3 subagents to solve simple math problems"}}' \
		'{"timestamp":"2026-08-28T18:00:02.000Z","type":"event_msg","payload":{"type":"task_started","turn_id":"docs-math-turn"}}' \
		> "$root"
	for child in addition:Addition multiplication:Multiplication division:Division; do
		id=${child%%:*}
		name=${child#*:}
		path="$dir/rollout-docs-$id.jsonl"
		printf '%s\n' \
			"{\"timestamp\":\"2026-08-28T18:00:03.000Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"docs-$id\",\"originator\":\"codex-tui\",\"source\":{\"subagent\":{\"thread_spawn\":{\"parent_thread_id\":\"docs-agent-root\",\"agent_nickname\":\"$name\",\"agent_role\":\"research\"}}},\"parent_thread_id\":\"docs-agent-root\",\"agent_nickname\":\"$name\",\"model\":\"gpt-5.6\"}}" \
			"{\"timestamp\":\"2026-08-28T18:00:04.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"docs-$id-turn\"}}" \
			> "$path"
	done
	exec 3>>"$root"
	exec 4>>"$dir/rollout-docs-addition.jsonl"
	exec 5>>"$dir/rollout-docs-multiplication.jsonl"
	exec 6>>"$dir/rollout-docs-division.jsonl"
}

draw_resume_tui() {
	case "$1" in
		*subagents*|*math*)
			hold_math_journals
			begin_tui "working" "$1"
			printf '  \033[33m• Working\033[0m  3 subagents\n\n'
			printf '    ↳ Addition        Solve 128 + 256\n'
			printf '    ↳ Multiplication  Solve 24 × 18\n'
			printf '    ↳ Division        Solve 1,024 ÷ 16\n'
			;;
		*Summarize*|*repository*)
			begin_tui "complete" "$1"
			printf '  \033[32m• Done\033[0m  explored README.md\n\n'
			printf '    Terminay is a local-first terminal\n'
			printf '    workspace for project work: split\n'
			printf '    shells, files, macros, and remote\n'
			printf '    access from a paired browser.\n'
			;;
		*git\ status*)
			begin_tui "complete" "$1"
			printf '  \033[32m• Done\033[0m  ran git status\n\n'
			printf '    README.md is modified on main.\n'
			printf '    The docs screenshot workspace is\n'
			printf '    being refreshed; nothing is staged.\n'
			;;
		*handbook*)
			begin_tui "working" "$1"
			printf '  \033[33m• Working\033[0m  read handbook/\n\n'
			printf '    architecture.md   system shape\n'
			printf '    contributing.md   patch guidance\n'
			printf '    releases.md       shipping steps\n'
			printf '    roadmap.md        what is next\n'
			printf '    security.md       trust model\n'
			;;
		*roadmap*)
			begin_tui "complete" "$1"
			printf '  \033[32m• Done\033[0m  read handbook/roadmap.md\n\n'
			printf '    Now: docs that live with the\n'
			printf '    project. Next: connected workspaces\n'
			printf '    so desktop and browser share one\n'
			printf '    terminal, document, and change log.\n'
			;;
		*)
			begin_tui "complete" "$1"
			printf '  \033[32m• Done\033[0m\n\n'
			printf '    Ready for the next instruction.\n'
			;;
	esac
	end_tui
}

case "$mode" in
	exec)
		printf '\033[1;36mCodex\033[0m  GPT-5.6  \033[2mexec\033[0m\n\n'
		printf '\033[1m› %s\033[0m\n\n' "$prompt"
		printf 'Working...\n'
		printf 'CODEX_EXEC_DONE\n'
		printf '%s\n' "$prompt" > "$state_file"
		exit 0
		;;
	resume)
		if [ -z "$prompt" ] && [ -f "$state_file" ]; then
			prompt=$(cat "$state_file")
		fi
		cleanup() {
			printf '\033[?1049l\033[?25h'
			exit 0
		}
		trap cleanup INT TERM HUP
		draw_resume_tui "$prompt"
		while :; do
			sleep 3600
		done
		;;
	*)
		printf 'unknown stub mode: %s\n' "$mode" >&2
		exit 2
		;;
esac
