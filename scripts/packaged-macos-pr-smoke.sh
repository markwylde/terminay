#!/usr/bin/env bash
# Wrap the unsigned --dir app in a read-only DMG, copy it off, then boot the
# writable copy. Chromium SIGABRTs on quit when launched from the installer
# volume itself.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
	echo "packaged-macos-pr-smoke.sh requires macOS." >&2
	exit 1
fi

source_app="${TERMINAY_PACKAGED_SOURCE_APP:-release/0.0.0/mac-arm64/Terminay.app}"
work_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
if [[ ! -d "$source_app" ]]; then
	echo "Packaged app not found: $source_app" >&2
	exit 1
fi

dmg_root="$work_root/terminay-pr-dmg-root"
unsigned_dmg="$work_root/terminay-pr-unsigned.dmg"
staged_dir="$work_root/terminay-pr-staged"

rm -rf "$dmg_root"
mkdir -p "$dmg_root"
ditto "$source_app" "$dmg_root/Terminay.app"
hdiutil create \
	-volname Terminay \
	-srcfolder "$dmg_root" \
	-ov \
	-format UDZO \
	"$unsigned_dmg"

staged_app="$(bash "$(dirname "$0")/stage-macos-app-from-dmg.sh" "$unsigned_dmg" "$staged_dir")"
test -d "$staged_app"
export TERMINAY_PACKAGED_APP="$staged_app"

xml_escape() {
	local value="$1"
	value="${value//&/&amp;}"
	value="${value//</&lt;}"
	value="${value//>/&gt;}"
	value="${value//\"/&quot;}"
	printf '%s' "$value"
}

run_packaged_smoke() {
	npm run test:packaged-startup-macos
}

uid="$(id -u)"
session="$(launchctl managername 2>/dev/null || true)"
if [[ "$session" == "Aqua" || -n "${TERMINAY_IN_AQUA:-}" ]]; then
	run_packaged_smoke
	exit 0
fi

if launchctl print "gui/${uid}" >/dev/null 2>&1; then
	aqua_dir="$work_root/terminay-aqua-$$"
	label="net.wylde.terminay.packaged-smoke.$$"
	mkdir -p "$aqua_dir"
	env_file="$aqua_dir/env.sh"
	run_file="$aqua_dir/run.sh"
	plist="$aqua_dir/${label}.plist"
	exit_file="$aqua_dir/exit-code"
	stdout_file="$aqua_dir/stdout.log"
	stderr_file="$aqua_dir/stderr.log"
	cwd="$(pwd)"
	export -p > "$env_file"
	cat > "$run_file" <<RUN
#!/bin/bash
set -euo pipefail
set -a
# shellcheck disable=SC1091
source $(printf '%q' "$env_file")
set +a
export TERMINAY_IN_AQUA=1
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
		echo "packaged-macos-pr-smoke: re-entered gui/${uid} from ${session:-unknown}" >&2
		tail -n +1 -F "$stdout_file" "$stderr_file" &
		tail_pid=$!
		deadline=$((SECONDS + 180))
		while [[ ! -f "$exit_file" ]]; do
			if (( SECONDS >= deadline )); then
				kill "$tail_pid" >/dev/null 2>&1 || true
				wait "$tail_pid" >/dev/null 2>&1 || true
				launchctl bootout "gui/${uid}/${label}" >/dev/null 2>&1 || true
				echo "packaged-macos-pr-smoke: Aqua session smoke timed out" >&2
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
	echo "packaged-macos-pr-smoke: Aqua bootstrap failed; Chromium will start headless" >&2
fi

echo "packaged-macos-pr-smoke: session=${session:-unknown}; launching Chromium headless" >&2
export TERMINAY_ELECTRON_HEADLESS=1
run_packaged_smoke
