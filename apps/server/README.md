# @storylane/server

Self-hostable single-process Storylane server: Hono on Bun, SQLite (via
`bun:sqlite`, migrations, and an online-backup subcommand), an authorization
core (`ProjectTx`, permission matrix), and the built `apps/web` SPA served
statically. Also provides config parsing, JSON request logging, and
`GET /healthz`.

## Development

```bash
bun run dev   # bun --watch src/index.ts serve
```

## Tests

```bash
bun test
```

## Configuration

All configuration is read from environment variables at startup; an invalid
value exits with code 2 and a JSON error line on stderr/stdout.

| Variable                 | Default | Description                              |
| ------------------------ | ------- | ---------------------------------------- |
| `STORYLANE_PORT`         | `3000`  | TCP port to listen on (1-65535)          |
| `STORYLANE_DATA_DIR`     | `/data` | Directory for persistent data            |
| `STORYLANE_BASE_URL`     | (none)  | Absolute http(s) URL the app is served at |
| `STORYLANE_TRUST_PROXY`  | `false` | `"true"` or `"false"`                    |
| `STORYLANE_GIT_SHA`      | `dev`   | Commit baked into the image at build time (`Dockerfile`'s `GIT_SHA` build arg); not meant for an operator to set |

Comment attachments are stored on disk at
`$STORYLANE_DATA_DIR/attachments/<project id>/<attachment id>`; their metadata is in SQLite.

An upload is `POST /api/projects/:id/stories/:storyId/comments/:commentId/attachments` with the
raw file as the body, `Content-Type: application/octet-stream`, a `Content-Length` of at most
25 MiB, the percent-encoded filename in `X-Filename` and the file's media type in
`X-Content-Type`. Only the comment's author may attach. This is the one route where the CSRF
guard accepts a non-JSON body.

## Backups

DB backups do not include attachments; back up `$STORYLANE_DATA_DIR/attachments` separately.

## Docker

Build context is the repo root:

```bash
docker build -f apps/server/Dockerfile -t storylane:dev .
```
