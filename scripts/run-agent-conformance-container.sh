#!/bin/sh
# Runs one agent extension's real-CLI conformance suite in its own container.
#
#   sh scripts/run-agent-conformance-container.sh agent-grok
#
# The container is the only supported way to run these. On a developer host the
# terminal's login shell re-resolves PATH and a real CLI already installed wins
# over the one under test, and the run would read whatever credentials that
# developer happens to be logged in with. Here the image owns the CLI, the home
# directory is empty, and the only credential is the API key passed in.
set -eu

extension=${1:-}
if [ -z "$extension" ]; then
  echo "Usage: $0 <agent-extension-directory>" >&2
  echo "For example: $0 agent-claude-code" >&2
  exit 64
fi

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
dockerfile="$repo_dir/extensions/$extension/Dockerfile"
if [ ! -f "$dockerfile" ]; then
  echo "No conformance image for $extension: $dockerfile does not exist." >&2
  exit 64
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "Docker is required to run agent conformance tests." >&2
  exit 69
fi

# `.env` is git-ignored and holds the API keys; `.env.example` documents them.
if [ -f "$repo_dir/.env" ]; then
  # shellcheck disable=SC2046
  set -a
  . "$repo_dir/.env"
  set +a
fi

# Which enable flag and credentials this extension needs. A provider runs only
# when its own flag is set, so one extension's run never spends another's key.
case $extension in
  agent-claude-code) flag=TERMINAY_CONFORMANCE_CLAUDE_CODE; required=ANTHROPIC_API_KEY ;;
  agent-codex)       flag=TERMINAY_CONFORMANCE_CODEX;       required=OPENAI_API_KEY ;;
  agent-grok)        flag=TERMINAY_CONFORMANCE_GROK;        required=XAI_API_KEY ;;
  agent-opencode)    flag=TERMINAY_CONFORMANCE_OPENCODE;    required=OPENAI_API_KEY ;;
  agent-omp)         flag=TERMINAY_CONFORMANCE_OMP;         required=OPENAI_API_KEY ;;
  *) echo "Unknown agent extension: $extension" >&2; exit 64 ;;
esac

missing=$(eval "printf '%s' \"\${$required:-}\"")
if [ -z "$missing" ]; then
  echo "$required is not set. Copy .env.example to .env and fill it in." >&2
  exit 78
fi

image="terminay-conformance-$extension:local"
# The CLI layer must not be served from cache: Terminay supports the latest CLI
# only, so every run installs whatever `@latest` resolves to right now.
docker build \
  --file "$dockerfile" \
  --tag "$image" \
  --build-arg "CLI_REVISION=$(date -u +%Y%m%dT%H%M%SZ)" \
  "$repo_dir"

# Only the variables this provider needs cross into the container, and the
# enable flag is forced on: reaching this point is the opt-in.
docker run --rm \
  --env "$flag=1" \
  --env "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}" \
  --env "OPENAI_API_KEY=${OPENAI_API_KEY:-}" \
  --env "XAI_API_KEY=${XAI_API_KEY:-}" \
  --env "TERMINAY_CONFORMANCE_LOG=${TERMINAY_CONFORMANCE_LOG:-1}" \
  "$image"
