#!/bin/sh
# Run a Linux artifact on the oldest supported host (ADR-0077): a clean glibc
# 2.31 container with no Node, npm, or compiler. The artifact is extracted
# there and its own runtime loads node-pty, runs a shell, and starts the
# session holder until it is ready.
#
#   probe-linux-glibc-floor.sh <appimage|server-archive> <file>
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <appimage|server-archive> <file>" >&2
  exit 64
fi
kind=$1
artifact=$2
case "$kind" in
  appimage|server-archive) ;;
  *) echo "Unknown artifact kind: $kind" >&2; exit 64 ;;
esac
if [ ! -f "$artifact" ] || [ -L "$artifact" ]; then
  echo "Artifact must be a regular file: $artifact" >&2
  exit 66
fi
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "Docker is required to probe the GNU/Linux floor." >&2
  exit 69
fi

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
platform=${TERMINAY_LINUX_FLOOR_PLATFORM:-}
if [ -z "$platform" ]; then
  case $(uname -m) in
    arm64|aarch64) platform=linux/arm64 ;;
    x86_64|amd64) platform=linux/amd64 ;;
    *)
      echo "Cannot determine a Docker platform for $(uname -m); set TERMINAY_LINUX_FLOOR_PLATFORM." >&2
      exit 69
      ;;
  esac
fi
image=terminay-linux-floor-runtime:local-${platform#linux/}
container=terminay-linux-floor-probe-$(date -u +%Y%m%dT%H%M%SZ)-$$

cleanup() {
  docker rm --force "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

# The image needs nothing from the repository, so it is built without context.
docker build --platform "$platform" --tag "$image" - < "$repo_dir/Dockerfile.linux-floor-runtime"

# Everything after the extraction runs on the artifact's own files.
case "$kind" in
  appimage)
    script='set -eu
ldd --version | head -n 1
cd "$HOME"
/probe/artifact --appimage-extract >/dev/null
runtime="$HOME/squashfs-root/terminay"
missing=$(ldd "$runtime" | grep "not found" || true)
if [ -n "$missing" ]; then
  echo "The packaged Electron binary has unresolved libraries:" >&2
  echo "$missing" >&2
  exit 1
fi
ELECTRON_RUN_AS_NODE=1 "$runtime" /probe/probe.mjs "$HOME/squashfs-root/resources/app.asar/dist-electron/sessionHolderEntry.js"'
    ;;
  server-archive)
    script='set -eu
ldd --version | head -n 1
mkdir "$HOME/archive"
tar -xzf /probe/artifact --no-same-owner -C "$HOME/archive"
root=$(find "$HOME/archive" -mindepth 1 -maxdepth 1 -type d)
test -n "$root"
"$root/bin/node" /probe/probe.mjs "$root/server/dist/sessionHolderEntry.js"'
    ;;
esac

docker create \
  --platform "$platform" \
  --name "$container" \
  --init \
  --network none \
  "$image" \
  sh -c "$script" >/dev/null
docker cp "$artifact" "$container:/probe/artifact"
docker cp "$repo_dir/scripts/linux-glibc-floor-probe.mjs" "$container:/probe/probe.mjs"
docker start --attach "$container"
echo "$(basename -- "$artifact") runs terminals on the glibc floor."
