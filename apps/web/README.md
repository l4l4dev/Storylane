# @storylane/web

Vite + React + TypeScript SPA, built to `dist/` and served statically by
`apps/server` in production.

## Development

```bash
pnpm --filter @storylane/web dev
```

Runs on `:5173` and proxies `/api` and `/healthz` to the server on `:3000`
(`vite.config.ts`) — start `apps/server` separately for the proxy to work.
Start it with `STORYLANE_BASE_URL=http://localhost:5173` so the server's CSRF
origin check accepts requests coming through the Vite proxy.

## Tests

```bash
pnpm --filter @storylane/web test
```

## Lint / build

```bash
pnpm --filter @storylane/web lint
pnpm --filter @storylane/web build
```
