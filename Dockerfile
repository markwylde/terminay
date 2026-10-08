# syntax=docker/dockerfile:1.7

FROM node:24.15.0-bookworm-slim AS build

WORKDIR /workspace

RUN npm install --global npm@12.2.0

# Keep OS toolchain and npm dependency installation ahead of source copies so
# ordinary code edits do not invalidate the slow apt/npm layers.
RUN --mount=type=cache,id=terminay-apt-cache-bookworm,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,id=terminay-apt-lists-bookworm,target=/var/lib/apt/lists,sharing=locked \
  rm -f /etc/apt/apt.conf.d/docker-clean \
  && apt-get update \
  && apt-get install --yes --no-install-recommends python3 make g++ git ca-certificates curl xz-utils patch

COPY package.json package-lock.json ./
COPY apps/terminay-cli/package.json ./apps/terminay-cli/package.json
COPY apps/terminay-desktop/package.json ./apps/terminay-desktop/package.json
COPY apps/terminay-server/package.json ./apps/terminay-server/package.json
COPY apps/terminay-web/package.json ./apps/terminay-web/package.json
COPY extensions/builtin-agents/package.json ./extensions/builtin-agents/package.json
COPY extensions/gitea/package.json ./extensions/gitea/package.json
COPY extensions/language-typescript/package.json ./extensions/language-typescript/package.json
COPY packages/client-core/package.json ./packages/client-core/package.json
COPY packages/cron/package.json ./packages/cron/package.json
COPY packages/extension-api/package.json ./packages/extension-api/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/protocol-conformance/package.json ./packages/protocol-conformance/package.json
COPY packages/responsive-ui/package.json ./packages/responsive-ui/package.json
COPY packages/server-core/package.json ./packages/server-core/package.json
COPY packages/ui-bundle/package.json ./packages/ui-bundle/package.json
COPY scripts/ensure-node-pty-helper-mode.mjs ./scripts/ensure-node-pty-helper-mode.mjs

RUN --mount=type=cache,id=terminay-npm-cache-node24,target=/root/.npm,sharing=locked \
  npm ci

COPY . .

ARG OCI_VERSION=0.0.0

# The repository carries a placeholder version; a release names its own. Stamp
# it before anything is compiled so the server, its UI bundle manifest, and the
# CLI all agree. A non-release build keeps the placeholder and is identified by
# its revision instead.
RUN if printf '%s' "$OCI_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-beta\.[1-9][0-9]*)?$' \
    && [ "$OCI_VERSION" != "0.0.0" ]; then \
    node scripts/sync-package-version.mjs "$OCI_VERSION"; \
  fi

RUN npm run build:application-graph \
  && npm run build:server-postcompile \
  && npm run build:server-ui:bundle \
  && npm run build --workspace terminay

ARG TARGETARCH
ARG OCI_REVISION=unknown
ARG TERMINAY_CHANNEL=main

# Assemble the same self-contained tree the release archives carry: the pinned
# Node runtime, the compiled server with its production dependency closure and
# native node-pty, the server-served workspace UI, the built-in extensions, and
# the selected WebRTC runtime. An image that leaves any of these out starts,
# reports ready, and cannot be paired with.
RUN set -eu; \
  case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
    amd64) target=linux-x64 ;; \
    arm64) target=linux-arm64 ;; \
    *) echo "unsupported image architecture: ${TARGETARCH:-unknown}" >&2; exit 1 ;; \
  esac; \
  # The manifest pins the payload to a commit. A build that was not told its
  # commit is a local one, recorded as such rather than refused.
  channel="$TERMINAY_CHANNEL"; revision="$OCI_REVISION"; \
  if ! printf '%s' "$revision" | grep -Eq '^[a-f0-9]{40}$'; then \
    channel=source; revision=0000000000000000000000000000000000000000; \
  fi; \
  node scripts/stage-selected-secure-werift-runtime.mjs; \
  node_archive_url="$(node -e 'import("./scripts/pty-runtime-platforms.mjs").then((module) => process.stdout.write(module.getPtyRuntimePlatform(process.argv[1]).nodeArchive))' "$target")"; \
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --output /tmp/node-runtime.tar.xz "$node_archive_url"; \
  node scripts/build-standalone-server-artifact.mjs \
    --target "$target" \
    --channel "$channel" \
    --revision "$revision" \
    --node-archive /tmp/node-runtime.tar.xz \
    --runtime-modules node_modules \
    --webrtc-runtime build/webrtc-runtime \
    --output-dir /tmp/standalone > /tmp/standalone-build.json; \
  mkdir -p /out/terminay /out/terminay-cli; \
  tar -xzf "$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync("/tmp/standalone-build.json", "utf8")).archivePath)')" \
    --strip-components=1 -C /out/terminay; \
  npx esbuild apps/terminay-cli/dist/cli.js \
    --bundle --platform=node --format=esm --target=node24 \
    --banner:js="import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" \
    --outfile=/out/terminay-cli/terminay.mjs

FROM debian:bookworm-slim AS runtime

ARG OCI_VERSION=0.0.0
ARG OCI_REVISION=unknown
ARG OCI_SOURCE=https://github.com/markwylde/terminay

LABEL org.opencontainers.image.title="Terminay Server" \
  org.opencontainers.image.description="Standalone Terminay server" \
  org.opencontainers.image.url="https://github.com/markwylde/terminay" \
  org.opencontainers.image.source="${OCI_SOURCE}" \
  org.opencontainers.image.version="${OCI_VERSION}" \
  org.opencontainers.image.revision="${OCI_REVISION}" \
  org.opencontainers.image.licenses="AGPL-3.0-or-later"

RUN --mount=type=cache,id=terminay-apt-cache-bookworm,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,id=terminay-apt-lists-bookworm,target=/var/lib/apt/lists,sharing=locked \
  rm -f /etc/apt/apt.conf.d/docker-clean \
  && apt-get update \
  && apt-get install --yes --no-install-recommends git ca-certificates curl sudo \
  && groupadd --system --gid 10001 terminay \
  && useradd --system --uid 10001 --gid terminay --create-home --home-dir /home/terminay --shell /bin/bash terminay \
  && install --directory --owner=terminay --group=terminay --mode=0700 /var/lib/terminay

# The server and its terminals run as `terminay`, and a terminal's user installs
# packages, so that account may become root through passwordless sudo. The
# server itself never uses it: `no-new-privileges` or dropped capabilities
# switch it off and leave the server running.
RUN printf 'terminay ALL=(ALL:ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/terminay \
  && chmod 0440 /etc/sudoers.d/terminay \
  && visudo --check --quiet --file=/etc/sudoers.d/terminay

COPY --from=build /out/terminay /opt/terminay
COPY --from=build /out/terminay-cli /opt/terminay-cli
COPY docker/terminay /usr/local/bin/terminay
COPY docker/terminay-server-entrypoint /usr/local/bin/terminay-server-entrypoint
RUN chmod 0755 /usr/local/bin/terminay /usr/local/bin/terminay-server-entrypoint

# Hosted and direct exposure are on, so a bare `docker run` yields a server a
# device can pair with. The public host defaults to loopback, which names a
# direct origin for a client on the same machine and offers no ICE candidate;
# set TERMINAY_PUBLIC_HOST to a routable address for browsers and phones. The
# ICE range is pinned only once a public host or TERMINAY_ICE_PORT asks for it,
# because a pinned range is a budget every connected device draws from.
ENV HOME=/home/terminay \
  TERMINAY_DATA_ROOT=/var/lib/terminay \
  TERMINAY_PROJECT_ROOT=/home/terminay \
  TERMINAY_ENDPOINT=loopback \
  TERMINAY_EXPOSE=hosted,direct \
  TERMINAY_HTTP_HOST=0.0.0.0 \
  TERMINAY_HTTP_PORT=8443 \
  TERMINAY_PUBLIC_HOST=localhost \
  TERMINAY_ICE_PORT_SPAN=16 \
  TERMINAY_HEALTH_HOST=127.0.0.1 \
  TERMINAY_HEALTH_PORT=8444 \
  TERMINAY_UI_RENDERER_DIRECTORY=/opt/terminay/ui \
  TERMINAY_MANAGED_BY=container \
  TERMINAY_SERVER_REVISION=${OCI_REVISION}

USER terminay
WORKDIR /home/terminay
VOLUME ["/var/lib/terminay"]
EXPOSE 8443/tcp 51000-51015/udp
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["/opt/terminay/bin/node", "-e", "fetch('http://127.0.0.1:8444/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/terminay-server-entrypoint"]
