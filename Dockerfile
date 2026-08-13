# syntax=docker/dockerfile:1.7

FROM node:24.15.0-bookworm-slim AS build

WORKDIR /workspace

# Keep OS toolchain and npm dependency installation ahead of source copies so
# ordinary code edits do not invalidate the slow apt/npm layers.
RUN --mount=type=cache,id=terminay-apt-cache-bookworm,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,id=terminay-apt-lists-bookworm,target=/var/lib/apt/lists,sharing=locked \
  rm -f /etc/apt/apt.conf.d/docker-clean \
  && apt-get update \
  && apt-get install --yes --no-install-recommends python3 make g++

COPY package.json package-lock.json ./
COPY apps/terminay-desktop/package.json ./apps/terminay-desktop/package.json
COPY apps/terminay-server/package.json ./apps/terminay-server/package.json
COPY apps/terminay-web/package.json ./apps/terminay-web/package.json
COPY packages/client-core/package.json ./packages/client-core/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/protocol-conformance/package.json ./packages/protocol-conformance/package.json
COPY packages/responsive-ui/package.json ./packages/responsive-ui/package.json
COPY packages/server-core/package.json ./packages/server-core/package.json
COPY scripts/ensure-node-pty-helper-mode.mjs ./scripts/ensure-node-pty-helper-mode.mjs

RUN --mount=type=cache,id=terminay-npm-cache-node24,target=/root/.npm,sharing=locked \
  npm ci

COPY . .

# Build the standalone server and its server-owned workspace dependencies from
# the repository lockfile. The final image receives only the runtime workspaces
# and pruned production dependencies.
RUN npm run build --workspace @terminay/protocol \
  && npm run build --workspace @terminay/server \
  && npm prune --omit=dev

FROM node:24.15.0-bookworm-slim AS runtime

ARG OCI_VERSION=0.0.0
ARG OCI_REVISION=unknown
ARG OCI_SOURCE=https://github.com/markwylde/terminay

LABEL org.opencontainers.image.title="Terminay Server" \
  org.opencontainers.image.description="Standalone Terminay server" \
  org.opencontainers.image.url="https://github.com/markwylde/terminay" \
  org.opencontainers.image.source="${OCI_SOURCE}" \
  org.opencontainers.image.version="${OCI_VERSION}" \
  org.opencontainers.image.revision="${OCI_REVISION}" \
  org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
	HOME=/var/lib/terminay \
  TERMINAY_DATA_ROOT=/var/lib/terminay \
  TERMINAY_ENDPOINT=loopback

WORKDIR /opt/terminay

RUN --mount=type=cache,id=terminay-apt-cache-bookworm,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,id=terminay-apt-lists-bookworm,target=/var/lib/apt/lists,sharing=locked \
  rm -f /etc/apt/apt.conf.d/docker-clean \
  && apt-get update \
  && apt-get install --yes --no-install-recommends git \
  && groupadd --system --gid 10001 terminay \
  && useradd --system --uid 10001 --gid terminay --home-dir /var/lib/terminay --shell /usr/sbin/nologin terminay \
  && install --directory --owner=terminay --group=terminay --mode=0700 /var/lib/terminay

# npm workspaces use relative links under node_modules. Keep the linked
# server-owned workspaces at their repository-relative paths in the image.
COPY --from=build --chown=terminay:terminay /workspace/node_modules ./node_modules
COPY --from=build --chown=terminay:terminay /workspace/apps/terminay-server/package.json ./apps/terminay-server/package.json
COPY --from=build --chown=terminay:terminay /workspace/apps/terminay-server/dist ./apps/terminay-server/dist
COPY --from=build --chown=terminay:terminay /workspace/packages/server-core/package.json ./packages/server-core/package.json
COPY --from=build --chown=terminay:terminay /workspace/packages/server-core/dist ./packages/server-core/dist
COPY --from=build --chown=terminay:terminay /workspace/packages/protocol/package.json ./packages/protocol/package.json
COPY --from=build --chown=terminay:terminay /workspace/packages/protocol/dist ./packages/protocol/dist

USER terminay

ENTRYPOINT ["node", "apps/terminay-server/dist/cli.js"]
CMD ["--data-root", "/var/lib/terminay", "--endpoint", "loopback"]
