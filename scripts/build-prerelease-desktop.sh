#!/bin/sh
# Build a Nightly or Canary Desktop payload (ADR-0110). Linux runs this inside
# the GNU/Linux floor image through run-in-linux-floor.sh (ADR-0077); macOS
# runs it on its runner, where it signs; Windows runs it on its x64 runner.
#
#   build-prerelease-desktop.sh <nightly|canary> <mac|linux|win> <electron-builder target> <asset name> <release notes file>
set -eu

if [ "$#" -ne 5 ]; then
  echo "Usage: $0 <nightly|canary> <mac|linux|win> <target> <asset> <release-notes-file>" >&2
  exit 64
fi
track=$1
platform=$2
target=$3
asset=$4
notes=$5
case "$track" in
  nightly|canary) ;;
  *) echo "Unsupported track: $track" >&2; exit 64 ;;
esac
case "$platform" in
  mac|linux|win) ;;
  *) echo "Unsupported platform: $platform" >&2; exit 64 ;;
esac
test -f "$notes"

# A Canary is signed but never submitted to Apple. The workflow holds no
# notarization credential for it; this makes the refusal explicit as well, so
# a credential that leaked into the environment still submits nothing.
notarize=
if [ "$platform" = mac ] && [ "$track" = canary ]; then notarize=-c.mac.notarize=false; fi

node scripts/stage-selected-secure-werift-runtime.mjs
npm run build:app
# The GitHub publish provider takes its channel from configuration, not from
# the version's prerelease component, so the track's channel is named
# explicitly: that is what makes electron-builder write nightly-*.yml or
# canary-*.yml rather than latest-*.yml. The metadata references the fixed
# artifact name set here.
# Windows ships x64 only (native-windows-desktop).
arch=
if [ "$platform" = win ]; then arch=--x64; fi
node_modules/.bin/electron-builder "--$platform" "$target" $arch --publish never \
  -c.directories.output=release/main-desktop \
  "-c.publish.channel=$track" \
  "-c.$platform.artifactName=$asset" \
  "-c.releaseInfo.releaseNotesFile=$notes" \
  $notarize
