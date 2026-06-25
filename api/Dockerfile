FROM node:22-alpine AS base
WORKDIR /app

# Build context must be the workspace root (.) so we can read
# the root package.json + package-lock.json that npm workspaces
# share. All COPY paths are prefixed with api/ to scope to this
# service. The web Dockerfile mirrors this structure with web/.

FROM base AS deps
# Copy only the manifest + lockfile first for better layer caching
COPY package.json package-lock.json* ./
COPY api/package.json ./api/package.json
# Install all workspaces; npm hoists shared deps to the root
# node_modules and per-workspace deps under node_modules/<name>.
# Including devDependencies here so we get the `prisma` CLI used
# by generate + migrate deploy below.
RUN npm ci --workspaces --include-workspace-root

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY api/tsconfig.json ./api/tsconfig.json
COPY api/src ./api/src
COPY api/prisma ./api/prisma
# prisma generate needs to run from inside the api directory so
# the generated client lands at the right path for tsc.
RUN cd api && npx prisma generate
RUN cd api && npx tsc -p tsconfig.json

FROM base AS prod-deps
COPY package.json package-lock.json* ./
COPY api/package.json ./api/package.json
# Install only production deps for the runtime image. The
# @prisma/client postinstall re-generates the client into this
# pruned node_modules.
RUN npm ci --workspaces --include-workspace-root --omit=dev \
 && npm cache clean --force

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Re-add the prisma CLI in the runtime image so the CMD can
# call `npx prisma migrate deploy`. The CLI is a devDependency
# that the prod-deps stage pruned.
COPY --from=deps /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/api/dist ./dist
COPY --from=build /app/api/prisma ./prisma
COPY api/package.json ./
EXPOSE 3001
# Apply pending migrations then start the api. `prisma migrate deploy`
# is the production-safe variant — it never resets, never creates,
# it just applies what's missing.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]