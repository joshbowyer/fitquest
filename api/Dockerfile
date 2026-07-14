FROM node:22-alpine AS base
# Prisma's query engine is a native binary. The api/prisma/
# schema.prisma has binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
# so the generated engine is libquery_engine-linux-musl-openssl-3.0.x.so.node,
# which links against OpenSSL 3.x (libssl.so.3, libcrypto.so.3).
# Alpine ships those via the standard `openssl` package. Without
# this apk add, prisma generate + migrate deploy fail with:
#   "Error: Could not parse schema engine response:
#    SyntaxError: Unexpected token 'E', 'Error load'..."
# (the engine binary fails to dlopen and the wrapper returns
# the raw stderr as an unparseable JSON response).
RUN apk add --no-cache openssl
WORKDIR /app

# Build context is the workspace root (.) so the shared root
# package-lock.json (npm workspaces) is in scope. All api-scoped
# paths are prefixed with api/.

FROM base AS deps
# Copy manifests first for better layer caching. Both root and
# api/package.json so npm can resolve the workspace.
COPY package.json package-lock.json* ./
COPY api/package.json ./api/package.json
# Install all workspaces; devDeps included here so we get the
# `prisma` CLI used by generate + migrate deploy below. The
# prod-deps stage strips them for the runtime image.
RUN npm ci --workspaces --include-workspace-root

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
# Only api's source files + its own tsconfig — there is no root
# tsconfig.json in this repo.
COPY api/tsconfig.json ./api/tsconfig.json
COPY api/src ./api/src
COPY api/prisma ./api/prisma
# prisma generate + tsc both run from inside api/ so the
# generated client lands at the right path and tsc's rootDir
# resolves correctly.
WORKDIR /app/api
RUN npx prisma generate
# Hard gate as of 2026-07-14 — the pre-existing 170-error backlog
# (src/lib/import.ts, routes/workouts.ts, homeBase.ts, status.ts,
# users.ts, and ~19 test files) has been paid down to 0. Matches
# the web image's tsc gate, which is what caught the Dashboard-crash
# class of bug — this is the same protection for the api.
RUN npx tsc -p tsconfig.json

FROM base AS prod-deps
COPY package.json package-lock.json* ./
COPY api/package.json ./api/package.json
# Production-only deps. @prisma/client's postinstall re-generates
# the client into this pruned node_modules.
RUN npm ci --workspaces --include-workspace-root --omit=dev \
 && npm cache clean --force

FROM node:22-alpine AS runner
# The CMD below runs `npx prisma migrate deploy`, which needs
# the OpenSSL 3.x libs for the Prisma query engine binary.
# This stage is FROM node:22-alpine (not FROM base) so it
# doesn't inherit the apk add — install openssl again here.
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
# Re-add the prisma CLI in the runtime image so the CMD can
# call `npx prisma migrate deploy`. The CLI is a devDep that
# the prod-deps stage pruned.
COPY --from=deps /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma
# Copy the schema + the compiled api before prod-deps so the
# prisma generate step below can find schema.prisma.
COPY --from=build /app/api/prisma ./prisma
COPY --from=build /app/api/dist ./dist
COPY api/package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
# Generate the Prisma client in the runtime image. The build
# stage ran `prisma generate` too, but `npm ci --omit=dev` in
# prod-deps overwrites node_modules with a freshly-installed
# @prisma/client that doesn't have the generated files
# (postinstall scripts run, but they regenerate against an
# empty schema since ./prisma isn't visible during npm install).
# Running it here, with ./prisma in place, produces a client
# that matches the actual schema in the runtime image.
RUN npx prisma generate
EXPOSE 3001
# Apply pending migrations then start the api. `prisma migrate deploy`
# is the production-safe variant — it never resets, never creates,
# it just applies what's missing.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]