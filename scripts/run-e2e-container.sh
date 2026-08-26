#!/bin/sh
set -eu

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for local Electron end-to-end tests." >&2
  exit 69
fi
if ! docker info >/dev/null 2>&1; then
  echo "The Docker service is not available." >&2
  exit 69
fi

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
platform=${TERMINAY_E2E_PLATFORM:-}
if [ -z "$platform" ]; then
  case $(uname -m) in
    arm64|aarch64) platform=linux/arm64 ;;
    x86_64|amd64) platform=linux/amd64 ;;
    *)
      echo "Cannot determine a Docker platform for $(uname -m); set TERMINAY_E2E_PLATFORM." >&2
      exit 69
      ;;
  esac
fi
preloaded_image=${TERMINAY_E2E_IMAGE_IS_PRELOADED:-}
image=${TERMINAY_E2E_IMAGE:-terminay-e2e:local-${platform#linux/}}
run_id=$(date -u +%Y%m%dT%H%M%SZ)-$$
container=terminay-e2e-$run_id
artifact_dir=${TERMINAY_E2E_ARTIFACT_DIR:-"$repo_dir/.docker-cache/e2e/$run_id"}

cleanup() {
  docker rm --force "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

if [ "$preloaded_image" = 1 ]; then
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "The preloaded Docker E2E image is not available: $image" >&2
    exit 69
  fi
else
  build_image() {
    docker build \
      --pull \
      --platform "$platform" \
      --file "$repo_dir/Dockerfile.e2e" \
      --tag "$image" \
      "$@" \
      "$repo_dir"
  }
  if [ -n "${TURBO_TOKEN:-}" ] && [ -n "${TURBO_REMOTE_CACHE_SIGNATURE_KEY:-}" ]; then
    DOCKER_BUILDKIT=1 build_image \
      --build-arg "TURBO_TEAM=${TURBO_TEAM:-wylde}" \
      --secret id=turbo_token,env=TURBO_TOKEN \
      --secret id=turbo_signature_key,env=TURBO_REMOTE_CACHE_SIGNATURE_KEY
  else
    DOCKER_BUILDKIT=1 build_image
  fi
fi

docker create \
  --platform "$platform" \
  --name "$container" \
  --init \
  --shm-size 2g \
  "$image" \
  "$@" >/dev/null

set +e
docker start --attach "$container"
status=$?
set -e

mkdir -p "$artifact_dir"
for output in playwright-report test-results; do
  docker cp "$container:/workspace/$output" "$artifact_dir/" >/dev/null 2>&1 || true
done
echo "Container E2E artifacts: $artifact_dir"

exit "$status"
