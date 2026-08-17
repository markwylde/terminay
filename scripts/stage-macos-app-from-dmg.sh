#!/usr/bin/env bash
# Copy Terminay.app off a read-only DMG onto a writable directory.
# Chromium aborts (SIGABRT) on quit when the bundle itself is on a read-only
# volume; users also run the installed copy, not the mounted installer.
set -euo pipefail

if [[ $# -ne 2 ]]; then
	echo "usage: stage-macos-app-from-dmg.sh <installer.dmg> <destination-directory>" >&2
	exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
	echo "stage-macos-app-from-dmg.sh requires macOS." >&2
	exit 1
fi

dmg=$1
dest=$2
if [[ ! -f "$dmg" ]]; then
	echo "DMG not found: $dmg" >&2
	exit 1
fi

mount_point="$(mktemp -d "${TMPDIR:-/tmp}/terminay-dmg-XXXX")"
cleanup() {
	hdiutil detach "$mount_point" -force >/dev/null 2>&1 || true
	rmdir "$mount_point" >/dev/null 2>&1 || true
}
trap cleanup EXIT

hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mount_point" >/dev/null

bundle_count=0
app_bundle=""
while IFS= read -r candidate; do
	bundle_count=$((bundle_count + 1))
	app_bundle=$candidate
done < <(find "$mount_point" -type d -name 'Terminay.app' -print)
if [[ "$bundle_count" -ne 1 ]]; then
	echo "Expected exactly one Terminay.app in the DMG, found ${bundle_count}." >&2
	exit 1
fi
if [[ -L "$app_bundle" ]]; then
	echo "Terminay.app in the DMG must not be a symlink." >&2
	exit 1
fi
app_executable="$app_bundle/Contents/MacOS/Terminay"
if [[ ! -f "$app_executable" || -L "$app_executable" ]]; then
	echo "Terminay executable is missing or is a symlink." >&2
	exit 1
fi

mkdir -p "$dest"
staged="$dest/Terminay.app"
rm -rf "$staged"
ditto "$app_bundle" "$staged"
# Do not run a strict signature check here. Unsigned electron-builder --dir
# apps fail that check even before a DMG round-trip. Release verification
# still inspects the notarized bundle on the installer and again after staging.

cleanup
trap - EXIT

printf '%s\n' "$staged"
