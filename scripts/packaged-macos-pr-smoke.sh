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
exec bash "$(dirname "$0")/run-packaged-macos-smoke.sh"
