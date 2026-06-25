FROM node:22-alpine AS base
WORKDIR /app

# Build context is the workspace root (.), mirroring api/Dockerfile.
# Vite lives in the web/ subdirectory but shares the root lockfile
# via npm workspaces.

FROM base AS deps
COPY package.json package-lock.json* ./
COPY web/package.json ./web/package.json
RUN npm ci --workspaces --include-workspace-root

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
# Copy only what's needed to build the web bundle. tsconfig + vite
# config + src + public assets + the nginx config used by the
# runner image below.
COPY tsconfig.json* ./
COPY web/tsconfig.json* ./web/
COPY web/vite.config.ts ./web/
COPY web/index.html ./web/
COPY web/src ./web/src
COPY web/public ./web/public
COPY web/nginx.conf ./web/
# VITE_API_URL is intentionally unset; the web's lib/api.ts falls
# back to '/api' and the nginx inside this image proxies /api/* → api:3001.
WORKDIR /app/web
RUN npm run build

FROM nginx:1.27-alpine AS runner
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY --from=build /app/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]