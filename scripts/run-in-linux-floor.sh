#!/bin/sh
# Run a build command inside the GNU/Linux floor image (ADR-0077) and copy its
# outputs back. The repository is the build context, never a bind mount: a CI
# job's Docker daemon cannot see the job's filesystem.
#
#   run-in-linux-floor.sh [--input <host-file>:<top-level-name>]...
#                         [--output <repo-path>]... [--env <NAME>]...
#                         -- <command> [args...]
#
# --input copies a host file to a top-level name in the workspace before the
# command runs.
# --output copies a workspace path back to the same repository path after the
# command succeeds; that path must not already exist. --env passes the named
# host variable through.
set -eu

usage() {
  echo "Usage: $0 [--input <host-file>:<top-level-name>]... [--output <repo-path>]... [--env <NAME>]... -- <command> [args...]" >&2
  exit 64
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to build at the GNU/Linux floor." >&2
  exit 69
fi
if ! docker info >/dev/null 2>&1; then
  echo "The Docker service is not available." >&2
  exit 69
fi

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
inputs=
outputs=
env_flags=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --input) [ "$#" -ge 2 ] || usage; inputs="$inputs
$2"; shift 2 ;;
    --output) [ "$#" -ge 2 ] || usage; outputs="$outputs
$2"; shift 2 ;;
    --env) [ "$#" -ge 2 ] || usage; env_flags="$env_flags --env $2"; shift 2 ;;
    --) shift; break ;;
    *) usage ;;
  esac
done
[ "$#" -gt 0 ] || usage

# Outputs are repository-relative and land where they were produced. Refuse to
# merge into, or overwrite, anything already there.
for output in $outputs; do
  case "$output" in
    /*|..|../*|*/../*|*/..) echo "Output must be a path inside the repository: $output" >&2; exit 64 ;;
  esac
  if [ -e "$repo_dir/$output" ]; then
    echo "Output already exists on the host: $output" >&2
    exit 73
  fi
done

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
image=terminay-linux-floor:local-${platform#linux/}
container=terminay-linux-floor-$(date -u +%Y%m%dT%H%M%SZ)-$$

cleanup() {
  docker rm --force "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

DOCKER_BUILDKIT=1 docker build \
  --platform "$platform" \
  --file "$repo_dir/Dockerfile.linux-floor" \
  --tag "$image" \
  "$repo_dir"

# shellcheck disable=SC2086 # each --env flag is its own word
docker create \
  --platform "$platform" \
  --name "$container" \
  --init \
  $env_flags \
  "$image" \
  "$@" >/dev/null

old_ifs=$IFS
IFS='
'
for input in $inputs; do
  source=${input%%:*}
  destination=${input#*:}
  case "$destination" in
    ''|*/*|.|..) destination= ;;
  esac
  if [ ! -f "$source" ] || [ -z "$destination" ] || [ "$destination" = "$input" ]; then
    echo "Input must be <host-file>:<top-level-name>: $input" >&2
    exit 64
  fi
  docker cp "$source" "$container:/workspace/$destination"
done
IFS=$old_ifs

# A failing command fails this script with its status; nothing is copied back.
docker start --attach "$container"

for output in $outputs; do
  mkdir -p "$(dirname -- "$repo_dir/$output")"
  docker cp "$container:/workspace/$output" "$repo_dir/$output"
done
