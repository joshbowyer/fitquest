FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
# Include devDependencies here so we get the `prisma` CLI used
# by migrate deploy + generate below. The runner image strips
# them via the prod-deps stage.
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
COPY prisma ./prisma
RUN npx prisma generate
RUN npx tsc -p tsconfig.json

FROM base AS prod-deps
COPY package.json package-lock.json* ./
# Install only production deps for the runtime image. The
# @prisma/client postinstall re-generates the client into this
# pruned node_modules.
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Re-add the prisma CLI in the runtime image so the CMD can
# call `npx prisma migrate deploy`. We copy only the binary +
# supporting files, not the full dev tree.
COPY --from=deps /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
EXPOSE 3001
# Apply pending migrations then start the api. `prisma migrate deploy`
# is the production-safe variant — it never resets, never creates,
# it just applies what's missing.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
