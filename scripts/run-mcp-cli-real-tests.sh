#!/bin/sh
set -eu

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for real MCP CLI compatibility tests." >&2
  exit 69
fi
if ! docker info >/dev/null 2>&1; then
  echo "The Docker service is not available." >&2
  exit 69
fi

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
platform=${TERMINAY_MCP_CLI_PLATFORM:-}
if [ -z "$platform" ]; then
  case $(uname -m) in
    arm64|aarch64) platform=linux/arm64 ;;
    x86_64|amd64) platform=linux/amd64 ;;
    *)
      echo "Cannot determine an MCP CLI Docker platform for $(uname -m); set TERMINAY_MCP_CLI_PLATFORM." >&2
      exit 69
      ;;
  esac
fi
image=${TERMINAY_MCP_CLI_IMAGE:-terminay-mcp-cli-compat:local}
cache_bust=$(date -u +%Y%m%dT%H%M%SZ)

docker build \
  --pull \
  --platform "$platform" \
  --build-arg "CLI_COMPAT_CACHE_BUST=$cache_bust" \
  --file "$repo_dir/Dockerfile.mcp-cli-compat" \
  --tag "$image" \
  "$repo_dir"

docker run \
  --rm \
  --init \
  --platform "$platform" \
  --network none \
  "$image"
