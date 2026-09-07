# FlowSketch, one image: the built client is served by the same Node process
# that runs the API and the realtime server. Multi-arch: works on the ARM
# (Ampere) Oracle free-tier VM and on x86 alike.
#
# Build context is the repository root:
#   docker build -f deploy/oracle/Dockerfile -t flowsketch .

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV CI=1
COPY package.json package-lock.json ./
COPY prisma ./prisma
# --legacy-peer-deps: npm 10's arborist trips on vitest's peer set (see CLAUDE.md).
RUN npm ci --legacy-peer-deps
COPY . .
RUN npx prisma generate \
  && npm run build \
  && npm run build:server

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# openssl: Prisma's engine wants it at runtime on slim images.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/prisma ./prisma
# Prisma 7 reads the datasource URL through this file (it falls back to the
# container's DATABASE_URL when there is no .env beside it).
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/shared ./shared
# The server resolves the client from the working directory (STATIC_DIR
# overrides); uploads go to UPLOAD_DIR, which the compose file mounts.
ENV STATIC_DIR=/app/dist
ENV UPLOAD_DIR=/data/uploads
ENV PORT=3001
EXPOSE 3001
# Apply migrations, then serve. `migrate deploy` is idempotent.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist-server/server/index.js"]
