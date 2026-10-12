# PrismaStream backend (sync, accounts, server-side catalog, play urls, proxy).
# Build context = the REPO ROOT, because the shared core (src/core + src/lib) is bundled here:
#
#   docker build -f server/Dockerfile -t prismastream-server .
#
# Stage 1 bundles src/core/node.ts into server/vendor/prisma-core.mjs (npm run build:core:node).
# Stage 2 is the runtime: only server/src (TypeScript, run directly by Node 26), its production
# dependencies and the bundle. No ../src at runtime, non-root, healthcheck.

FROM node:26-alpine AS core
WORKDIR /repo
COPY package.json package-lock.json ./
# Scripts off: `prepare` (svelte-kit sync) is not needed to bundle the core.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY vite.core.node.config.ts ./
COPY src/core ./src/core
COPY src/lib ./src/lib
RUN mkdir -p server/vendor && npm run build:core:node && test -s server/vendor/prisma-core.mjs

FROM node:26-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data \
    NODE_OPTIONS=--max-old-space-size=512
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server/src ./src
COPY --from=core /repo/server/vendor/prisma-core.mjs ./vendor/prisma-core.mjs
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/v1/health >/dev/null || exit 1
STOPSIGNAL SIGTERM
CMD ["node", "src/main.ts"]
