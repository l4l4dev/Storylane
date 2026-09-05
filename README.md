# Storylane

An open-source agile project management tool that rebuilds the Pivotal Tracker
workflow: velocity-based automatic iteration planning and a strict story-state
flow, as a self-hostable single-container app.

```bash
docker run -d -p 3000:3000 -v storylane:/data ghcr.io/l4l4dev/storylane
```

> **Status: rewrite in progress.** The pre-rewrite hosted architecture (tag
> `v0-supabase`) is being replaced by a single-container Bun/Hono + SQLite
> server. See [docs/design/2026-09-05-self-host-rewrite-design.md](docs/design/2026-09-05-self-host-rewrite-design.md).

See [INSTALL.md](INSTALL.md) for setup and [SPEC.md](SPEC.md) for the full
specification index.

## License

[MIT](LICENSE)
