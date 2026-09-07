# Conformance image for the Codex agent extension.
#
# Terminay supports the latest Codex CLI only, so this installs
# `@latest` and never pins. Rebuild with `--build-arg CLI_REVISION=$(date -u
# +%s)` to defeat Docker's layer cache and pick up a new release; the runner
# script does that on every run.
#
# Build and run through `sh scripts/run-agent-conformance-container.sh
# agent-codex`, which passes the API key in and never mounts a
# developer's home.
FROM node:24.15.0-bookworm-slim

# node-pty is built from source: the harness drives the CLI through a real PTY.
# procps and lsof are the process-observation tools the harness and the
# provider read the process tree and open files with; without `ps` the
# probe returns nothing and no CLI is ever seen below the shell.
RUN apt-get update \
	&& apt-get install --yes --no-install-recommends \
		build-essential ca-certificates git python3 \
		procps lsof \
	&& rm -rf /var/lib/apt/lists/* \
	&& npm install --global npm@12.0.2

ARG CLI_REVISION=unset
RUN CLI_REVISION=${CLI_REVISION} npm install --global @openai/codex@latest \
	&& codex --version

WORKDIR /workspace
COPY . .
# The repository's own graph build, rather than a hand-listed subset that
# would drift as packages are added.
RUN npm ci \
	&& npm run build:workspaces

# The CLI must never see a developer's credentials: the run authenticates from
# OPENAI_API_KEY alone, inside a home this image owns.
ENV HOME=/tmp/conformance-home
RUN mkdir -p /tmp/conformance-home

# Codex does not read `OPENAI_API_KEY` on its own: with no `auth.json` it opens
# the browser sign-in flow and the TUI never reaches a prompt. `codex login
# --with-api-key` writes that key into this image's own home, which is the only
# credential the run ever has.
CMD ["sh", "-c", "printenv OPENAI_API_KEY | codex login --with-api-key && exec npm run test:conformance --workspace terminay-agent-codex"]
