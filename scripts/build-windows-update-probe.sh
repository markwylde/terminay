#!/bin/sh
# Build N+1 for the Windows update probe (native-windows-desktop, task 6.3):
# the app already built for this run, repackaged one version higher with a
# Nightly `nightly.yml` beside it, which is the channel the test feed override
# reads. It is a feed for the probe only and is never published.
#
#   build-windows-update-probe.sh <version of build N> <output directory>
#
# Prints the update's version.
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <version> <output directory>" >&2
  exit 64
fi
next=$(node scripts/update-probe-version.mjs "$1")
node_modules/.bin/electron-builder --win nsis --x64 --publish never \
  "-c.directories.output=$2" \
  -c.publish.channel=nightly \
  "-c.extraMetadata.version=$next" \
  "-c.win.artifactName=terminay-update-probe-Setup.exe" >&2
test -f "$2/nightly.yml"
test -f "$2/terminay-update-probe-Setup.exe"
echo "$next"
