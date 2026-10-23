# Build context: repo root.
FROM node:22.23.4-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Root postinstall builds packages/shared, so its sources must exist before `npm ci`.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
# The api postinstall runs `prisma generate`, so the whole api source (schema, prisma.config.ts) must be present.
COPY apps/api apps/api
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspaces --include-workspace-root
# Reinstall production-only deps for the api (root-level `npm prune` strips workspace deps).
# --ignore-scripts: dist/generated already holds the Prisma client and shared is already built.
RUN npm run build -w @shiftswap/api \
  && rm -rf node_modules apps/*/node_modules packages/*/node_modules \
  && npm ci --omit=dev --ignore-scripts -w @shiftswap/api \
  && mkdir -p apps/api/node_modules

FROM node:22.23.4-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir /data && chown node:node /data
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/package.json package.json
COPY --from=build --chown=node:node /app/packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/apps/api/package.json apps/api/package.json
# npm may keep some api deps in apps/api/node_modules rather than hoisting them (the dir always exists).
COPY --from=build --chown=node:node /app/apps/api/node_modules apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/prisma apps/api/prisma
COPY --from=build --chown=node:node /app/apps/api/prisma.config.ts apps/api/prisma.config.ts
USER node
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/bootstrap/start.js"]
