# syntax=docker/dockerfile:1.7

FROM node:22.23.1-bookworm-slim AS build
WORKDIR /workspace

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

RUN --mount=type=cache,id=terminay-apt-cache-bookworm,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,id=terminay-apt-lists-bookworm,target=/var/lib/apt/lists,sharing=locked \
  rm -f /etc/apt/apt.conf.d/docker-clean \
  && apt-get update \
  && apt-get install --yes --no-install-recommends python3 make g++
RUN --mount=type=cache,id=terminay-npm-cache-node22,target=/root/.npm,sharing=locked \
  npm ci

COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm run build --workspace @terminay/protocol
RUN npm run build --workspace @terminay/server
RUN npm prune --omit=dev

FROM node:22.23.1-bookworm-slim AS runtime
ENV NODE_ENV=production \
	HOME=/var/lib/terminay \
    TERMINAY_DATA_ROOT=/var/lib/terminay \
    TERMINAY_ENDPOINT=loopback \
	TERMINAY_HTTP_HOST=0.0.0.0 \
	TERMINAY_HTTP_PORT=4317 \
    TERMINAY_HEALTH_HOST=0.0.0.0 \
    TERMINAY_HEALTH_PORT=8080

RUN --mount=type=cache,id=terminay-apt-cache-bookworm,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,id=terminay-apt-lists-bookworm,target=/var/lib/apt/lists,sharing=locked \
  rm -f /etc/apt/apt.conf.d/docker-clean \
  && apt-get update \
  && apt-get install --yes --no-install-recommends git \
  && groupadd --system --gid 10001 terminay \
  && useradd --system --uid 10001 --gid 10001 --home-dir /var/lib/terminay --no-create-home terminay
WORKDIR /opt/terminay

COPY --from=build --chown=10001:10001 /workspace/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /workspace/apps/terminay-server/package.json ./apps/terminay-server/package.json
COPY --from=build --chown=10001:10001 /workspace/apps/terminay-server/dist ./apps/terminay-server/dist
COPY --from=build --chown=10001:10001 /workspace/packages/protocol/package.json ./packages/protocol/package.json
COPY --from=build --chown=10001:10001 /workspace/packages/protocol/dist ./packages/protocol/dist
COPY --from=build --chown=10001:10001 /workspace/packages/server-core/package.json ./packages/server-core/package.json
COPY --from=build --chown=10001:10001 /workspace/packages/server-core/dist ./packages/server-core/dist
COPY --chown=10001:10001 apps/terminay-server/entrypoint.sh /usr/local/bin/terminay-server-entrypoint
RUN printf '%s\n' '#!/bin/sh' 'exec node /opt/terminay/apps/terminay-server/dist/mcpEntry.js "$@"' > /usr/local/bin/terminay-mcp \
  && chmod 0755 /usr/local/bin/terminay-server-entrypoint /usr/local/bin/terminay-mcp \
  && mkdir -p /var/lib/terminay \
  && chown 10001:10001 /var/lib/terminay

USER 10001:10001
VOLUME ["/var/lib/terminay"]
EXPOSE 4317 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/usr/local/bin/terminay-server-entrypoint"]
