← [SPEC.md](../SPEC.md)

## Local Development Setup

### Prerequisites
- Node.js 22 LTS (see `.nvmrc`)
- pnpm 11
- Bun 1.4+
- Docker runtime (OrbStack recommended on macOS, or Docker Desktop) — optional,
  only needed to build/run the container image

### Install

```bash
pnpm install
```

### Server

```bash
cd apps/server
bun run dev   # bun --watch src/index.ts serve
```

Configuration is read from `STORYLANE_*` environment variables (see
`apps/server/README.md`). `STORYLANE_DATA_DIR` defaults to `/data`; locally,
set it to a repo-relative directory instead:

```bash
STORYLANE_DATA_DIR=./.data bun run dev
```

`.data/` is gitignored.

After editing `src/db/schema/*.ts`, regenerate migrations and commit the
generated SQL:

```bash
pnpm --filter @storylane/server db:generate
```

### Web

```bash
pnpm --filter @storylane/web dev
```

Runs on `:5173` and proxies `/api` and `/healthz` to the server on `:3000` —
start the server first.

### Tests

```bash
cd apps/server && bun test
pnpm --filter @storylane/web test
pnpm --filter @storylane/core test
```

### Lint / typecheck

```bash
pnpm --filter @storylane/server lint
pnpm --filter @storylane/server typecheck
pnpm --filter @storylane/web lint
```

### Docker

```bash
docker build -f apps/server/Dockerfile -t storylane:dev .
docker run -d -p 3000:3000 -v storylane:/data storylane:dev
```
