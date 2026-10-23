# Build context: repo root.
FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
# Root postinstall builds packages/shared, so its sources must exist before `npm ci`.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# --ignore-scripts: the api's `prisma generate` postinstall is not needed for the web build.
RUN npm ci --workspaces --include-workspace-root --ignore-scripts \
  && npm run build -w @shiftswap/shared
COPY apps/web apps/web
RUN npm run build -w @shiftswap/web

FROM node:22.23.4-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# `vite preview` needs vite (a devDependency) and the config's plugin imports, so keep node_modules.
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/package.json package.json
COPY --from=build --chown=node:node /app/packages/shared packages/shared
COPY --from=build --chown=node:node /app/apps/web apps/web
USER node
WORKDIR /app/apps/web
EXPOSE 5173
CMD ["npx", "--no-install", "vite", "preview"]
