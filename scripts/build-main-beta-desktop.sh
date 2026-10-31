#!/bin/sh
# Build the `main` channel's beta Desktop payload. Linux runs this inside the
# GNU/Linux floor image through run-in-linux-floor.sh (ADR-0077); macOS runs it
# on its runner, where it signs; Windows runs it on its x64 runner.
#
#   build-main-beta-desktop.sh <mac|linux|win> <electron-builder target> <asset name> <release notes file>
set -eu

if [ "$#" -ne 4 ]; then
  echo "Usage: $0 <mac|linux|win> <target> <asset> <release-notes-file>" >&2
  exit 64
fi
platform=$1
target=$2
asset=$3
notes=$4
case "$platform" in
  mac|linux|win) ;;
  *) echo "Unsupported platform: $platform" >&2; exit 64 ;;
esac
test -f "$notes"

node scripts/stage-selected-secure-werift-runtime.mjs
npm run build:app
# The GitHub publish provider takes its channel from configuration, not from
# the version's prerelease component, so the beta channel is named explicitly:
# that is what makes electron-builder write beta-*.yml rather than latest-*.yml.
# The metadata references the fixed artifact name set here.
# Windows ships x64 only (native-windows-desktop).
arch=
if [ "$platform" = win ]; then arch=--x64; fi
node_modules/.bin/electron-builder "--$platform" "$target" $arch --publish never \
  -c.directories.output=release/main-desktop \
  -c.publish.channel=beta \
  "-c.$platform.artifactName=$asset" \
  "-c.releaseInfo.releaseNotesFile=$notes"
