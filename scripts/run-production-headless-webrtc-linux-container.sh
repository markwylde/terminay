#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || { [ "$1" != "x64" ] && [ "$1" != "arm64" ]; }; then
  echo "usage: $0 <x64|arm64>" >&2
  exit 64
fi

if ! command -v podman >/dev/null 2>&1; then
  echo "podman is required for the clean Linux proof" >&2
  exit 69
fi

case "$1" in
  x64)
    container_arch=amd64
    ;;
  arm64)
    container_arch=arm64
    ;;
esac

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
hosted_dir=${TERMINAY_HOSTED_SERVER_REPO:-"$repo_dir/../terminay.com-headless-webrtc-security"}
proof_runtime=${TERMINAY_PROOF_RUNTIME:-node-datachannel}
runtime_only=${TERMINAY_RUNTIME_ONLY:-0}

if [ "$proof_runtime" != "node-datachannel" ] && [ "$proof_runtime" != "secure-werift" ]; then
  echo "TERMINAY_PROOF_RUNTIME must be node-datachannel or secure-werift" >&2
  exit 64
fi

if [ ! -f "$hosted_dir/server/index.js" ]; then
  echo "hosted signaling worktree not found at $hosted_dir" >&2
  exit 66
fi

postgres_name="terminay-webrtc-linux-proof-$$"
podman run \
  --rm \
  --name "$postgres_name" \
  --env POSTGRES_DB=terminay_app \
  --env POSTGRES_USER=terminay \
  --env POSTGRES_PASSWORD=terminay \
  --publish 127.0.0.1::5432 \
  --detach \
  docker.io/library/postgres:17-alpine >/dev/null
trap 'podman rm --force "$postgres_name" >/dev/null 2>&1 || true' EXIT HUP INT TERM

attempt=0
until podman exec "$postgres_name" pg_isready -U terminay -d terminay_app >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "external proof PostgreSQL did not become ready" >&2
    exit 70
  fi
  sleep 1
done
postgres_port=$(podman port "$postgres_name" 5432/tcp)
postgres_port=${postgres_port##*:}

podman run \
  --rm \
  --arch "$container_arch" \
  --network host \
  --volume "$repo_dir:/source:ro" \
  --volume "$hosted_dir:/hosted-source:ro" \
  --env TERMINAY_E2E_DATABASE_URL="postgres://terminay:terminay@127.0.0.1:$postgres_port/terminay_app" \
  --env TERMINAY_PROOF_EXPECT_ARCH="$1" \
  --env TERMINAY_PROOF_REQUIRE_CLEAN_LINUX=1 \
  --env TERMINAY_PROOF_RUNTIME="$proof_runtime" \
  --env TERMINAY_RUNTIME_ONLY="$runtime_only" \
  docker.io/library/node:24.15.0-bookworm-slim \
  sh /source/scripts/support/production-headless-webrtc-linux-container.sh
