# syntax=docker/dockerfile:1
FROM oven/bun:1-slim AS base
WORKDIR /app
ENV BUN_INSTALL=/root/.bun PATH="/root/.bun/bin:${PATH}"
RUN bun add -g pnpm@11

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --filter @storylane/server... --prod \
 && mkdir -p packages/core/node_modules

FROM base AS web
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @storylane/web
COPY apps/web ./apps/web
RUN pnpm --filter @storylane/web build

FROM base AS runtime
ARG GIT_SHA=dev
ENV NODE_ENV=production STORYLANE_DATA_DIR=/data STORYLANE_PORT=3000 STORYLANE_GIT_SHA=$GIT_SHA
RUN groupadd -r storylane && useradd -r -g storylane -d /app storylane \
 && mkdir -p /data && chown storylane:storylane /data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY apps/server ./apps/server
COPY packages/core ./packages/core
COPY spec/fixtures ./spec/fixtures
COPY --from=web /app/apps/web/dist ./apps/web/dist
USER storylane
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD bun -e "const p=process.env.STORYLANE_PORT||'3000';fetch('http://127.0.0.1:'+p+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
WORKDIR /app/apps/server
ENTRYPOINT ["bun", "src/index.ts"]
CMD ["serve"]
