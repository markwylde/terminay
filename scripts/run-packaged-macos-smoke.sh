#!/usr/bin/env bash
# Run a packaged macOS app inside Aqua when a GUI session is available. On
# headless runners, use Chromium's supported headless switches instead.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
	echo "run-packaged-macos-smoke.sh requires macOS." >&2
	exit 1
fi

if [[ -z "${TERMINAY_PACKAGED_APP:-}" || ! -d "$TERMINAY_PACKAGED_APP" ]]; then
	echo "TERMINAY_PACKAGED_APP must name an existing packaged app." >&2
	exit 1
fi

run_packaged_smoke() {
	npm run test:packaged-startup-macos
}

xml_escape() {
	local value="$1"
	value="${value//&/&amp;}"
	value="${value//</&lt;}"
	value="${value//>/&gt;}"
	value="${value//\"/&quot;}"
	printf '%s' "$value"
}

uid="$(id -u)"
session="$(launchctl managername 2>/dev/null || true)"
if [[ "$session" == "Aqua" || -n "${TERMINAY_IN_AQUA:-}" ]]; then
	run_packaged_smoke
	exit 0
fi

if launchctl print "gui/${uid}" >/dev/null 2>&1; then
	work_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
	aqua_dir="$work_root/terminay-aqua-$$"
	label="net.wylde.terminay.packaged-smoke.$$"
	run_file="$aqua_dir/run.sh"
	plist="$aqua_dir/${label}.plist"
	exit_file="$aqua_dir/exit-code"
	stdout_file="$aqua_dir/stdout.log"
	stderr_file="$aqua_dir/stderr.log"
	cwd="$(pwd)"
	mkdir -p "$aqua_dir"
	cat > "$run_file" <<RUN
#!/bin/bash
set -euo pipefail
export PATH=$(printf '%q' "$PATH")
export HOME=$(printf '%q' "$HOME")
export CI=$(printf '%q' "${CI:-1}")
export TERMINAY_IN_AQUA=1
export TERMINAY_PACKAGED_APP=$(printf '%q' "$TERMINAY_PACKAGED_APP")
export TERMINAY_RELEASE_DIAGNOSTICS_DIR=$(printf '%q' "${TERMINAY_RELEASE_DIAGNOSTICS_DIR:-}")
unset TERMINAY_ELECTRON_HEADLESS
cd $(printf '%q' "$cwd")
set +e
npm run test:packaged-startup-macos
status=\$?
set -e
printf '%s\\n' "\$status" > $(printf '%q' "$exit_file")
exit "\$status"
RUN
	chmod +x "$run_file"
	touch "$stdout_file" "$stderr_file"
	cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$(xml_escape "$label")</string>
	<key>LimitLoadToSessionType</key>
	<string>Aqua</string>
	<key>ProcessType</key>
	<string>Interactive</string>
	<key>RunAtLoad</key>
	<true/>
	<key>WorkingDirectory</key>
	<string>$(xml_escape "$cwd")</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>$(xml_escape "$run_file")</string>
	</array>
	<key>StandardOutPath</key>
	<string>$(xml_escape "$stdout_file")</string>
	<key>StandardErrorPath</key>
	<string>$(xml_escape "$stderr_file")</string>
</dict>
</plist>
PLIST
	launchctl bootout "gui/${uid}/${label}" >/dev/null 2>&1 || true
	if launchctl bootstrap "gui/${uid}" "$plist"; then
		echo "run-packaged-macos-smoke: re-entered gui/${uid} from ${session:-unknown}" >&2
		tail -n +1 -F "$stdout_file" "$stderr_file" &
		tail_pid=$!
		deadline=$((SECONDS + 180))
		while [[ ! -f "$exit_file" ]]; do
			if (( SECONDS >= deadline )); then
				kill "$tail_pid" >/dev/null 2>&1 || true
				wait "$tail_pid" >/dev/null 2>&1 || true
				launchctl bootout "gui/${uid}/${label}" >/dev/null 2>&1 || true
				echo "run-packaged-macos-smoke: Aqua session smoke timed out" >&2
				exit 1
			fi
			sleep 1
		done
		kill "$tail_pid" >/dev/null 2>&1 || true
		wait "$tail_pid" >/dev/null 2>&1 || true
		status="$(cat "$exit_file")"
		launchctl bootout "gui/${uid}/${label}" >/dev/null 2>&1 || true
		exit "$status"
	fi
	echo "run-packaged-macos-smoke: Aqua bootstrap failed; Chromium will start headless" >&2
fi

echo "run-packaged-macos-smoke: session=${session:-unknown}; launching Chromium headless" >&2
export TERMINAY_ELECTRON_HEADLESS=1
run_packaged_smoke
