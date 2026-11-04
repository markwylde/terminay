#!/bin/bash
set -euo pipefail

test "$(uname -s)" = Darwin
test "$(uname -m)" = arm64
NODE_DIRECTORY="$(mktemp -d "$RUNNER_TEMP/terminay-node.XXXXXX")"
ARCHIVE="$NODE_DIRECTORY/node.tar.gz"
curl --fail --silent --show-error --location --retry 3 \
  https://nodejs.org/dist/v24.15.0/node-v24.15.0-darwin-arm64.tar.gz \
  --output "$ARCHIVE"
echo "372331b969779ab5d15b949884fc6eaf88d5afe87bde8ba881d6400b9100ffc4  $ARCHIVE" | shasum -a 256 --check
tar -xzf "$ARCHIVE" --strip-components=1 -C "$NODE_DIRECTORY"
rm "$ARCHIVE"
echo "$NODE_DIRECTORY/bin" >> "$GITHUB_PATH"
test "$("$NODE_DIRECTORY/bin/node" --version)" = v24.15.0
