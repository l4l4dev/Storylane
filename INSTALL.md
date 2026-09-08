# Install

This guide covers running Storylane self-hosted with Docker. It assumes Docker
(or a Docker-compatible runtime, such as OrbStack) is already installed and
running, and that you have never used Docker Compose before — every command
is spelled out on its own line.

Storylane is a single container: the app, the SQLite database, and the built
web UI all live in one image and store everything under `/data`.

## 1. Try it in 60 seconds

This image is published by CI from this repository (`.github/workflows/publish.yml`)
and is public — no login needed to pull it.

Run:

```bash
docker run -d --name storylane -p 3000:3000 -v storylane:/data ghcr.io/l4l4dev/storylane:edge
```

No tagged release exists yet, so `:edge` (built from `main`) is the entry point;
after the first tagged release, `:latest` becomes available — until then use
`:edge`.

Then open `http://localhost:3000` in a browser — it shows the setup page.
Get the one-time setup token from the container's logs:

```bash
docker logs storylane 2>&1 | grep 'setup token'
```

Paste that token into the setup page along with your name, email, and a
password (at least 12 characters), and submit. That account becomes the
instance admin. The token expires after 30 minutes — restart the container
(`docker restart storylane`) to get a new one if it does.

To stop it:

```bash
docker ps
```

Find the container ID or name in the output, then:

```bash
docker stop <container-id-or-name>
```

Data stays in the `storylane` Docker volume until you remove it explicitly
(`docker volume rm storylane`).

## 2. Run it for a team with HTTPS

This mode uses Docker Compose plus [Caddy](https://caddyserver.com/) as a
reverse proxy that gets and renews a TLS certificate automatically. It needs a
domain name that already points at this host's public IP address.

Create a directory for the deployment and fetch the three files it needs:

```bash
mkdir storylane
cd storylane
```

```bash
curl -O https://raw.githubusercontent.com/l4l4dev/storylane/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/l4l4dev/storylane/main/Caddyfile
curl -O https://raw.githubusercontent.com/l4l4dev/storylane/main/.env.example
```

Copy the example environment file and edit it:

```bash
cp .env.example .env
```

Open `.env` in a text editor and set:

```
DOMAIN=your-actual-domain.example.org
STORYLANE_BASE_URL=https://your-actual-domain.example.org
STORYLANE_TRUST_PROXY=true
```

You do not need to set `STORYLANE_BIND` here: the compose file already binds
port 3000 to `127.0.0.1`, so it is reachable only from Caddy on the same host.
That matters in this mode — `STORYLANE_TRUST_PROXY=true` tells the app to
believe the `X-Forwarded-For` header Caddy adds, and anyone who could reach
port 3000 directly could send that header themselves and slip past the
per-IP rate limits. Caddy alone should be reachable, on 80/443.

`DOMAIN` must already resolve (in public DNS) to this host before you start
Caddy — that's how Caddy proves domain ownership to get a certificate. If DNS
isn't ready yet, wait for it to propagate first.

Start everything:

```bash
docker compose --profile https up -d
```

Check the logs if it doesn't come up right away (certificate issuance can
take a few seconds):

```bash
docker compose logs -f
```

Once it's running, open `https://your-actual-domain.example.org`.

## 3. Run it on a LAN without a domain

If you don't have a domain and only need plain HTTP on your local network
(e.g. a home server), skip the `https` profile and Caddy entirely.

Fetch just the compose file:

```bash
mkdir storylane
cd storylane
```

```bash
curl -O https://raw.githubusercontent.com/l4l4dev/storylane/main/docker-compose.yml
```

Port 3000 is bound to `127.0.0.1` by default, which is not reachable from
other machines — this mode is the one that wants it reachable, so set
`STORYLANE_BIND` when starting:

```bash
STORYLANE_BIND=0.0.0.0 docker compose up -d
```

Open `http://<this-machine's-LAN-IP>:3000` from another device on the network,
or `http://localhost:3000` from the same machine.

To use a different host port, set `STORYLANE_HOST_PORT` before starting, e.g.:

```bash
STORYLANE_BIND=0.0.0.0 STORYLANE_HOST_PORT=8080 docker compose up -d
```

(Both are easier to keep in a `.env` file next to `docker-compose.yml` than to
retype on every command.)

In this mode cookies are **not** marked `Secure`, because the connection is
plain HTTP. Don't expose this setup directly to the public internet — use
section 2 (HTTPS) for anything beyond a trusted LAN.

## 4. Upgrade

Pull the new image and recreate the container:

```bash
docker compose pull
```

```bash
docker compose up -d
```

On startup the server writes a pre-migration snapshot to
`/data/backups/pre-<version>.db` and then applies any pending database
migrations automatically, before it starts serving traffic.

These snapshots are never removed automatically — one accumulates per version
you upgrade through. Delete the older ones once an upgrade has been verified.

If the container exits right after starting and its logs contain
`migration failed`, the upgrade did not apply:

```bash
docker compose logs app
```

Restore the pre-migration snapshot using the steps in section 6 (substitute
`pre-<version>.db` for `backup.db`), then report the issue (open a GitHub
issue with the log output) — don't retry the upgrade blindly.

## 5. Back up

Take a backup at any time while the app is running:

```bash
docker compose exec app bun src/index.ts backup /data/backups/manual-$(date +%F).db
```

This uses SQLite's online backup mechanism (`VACUUM INTO`), so it's safe to
run while the app is serving traffic. The backup command refuses to overwrite
an existing file (it exits with the error `backup target already exists`), so
each run needs a filename that doesn't exist yet — that's why the date-stamped
name above matters, and why the nightly cron example below embeds the date too.
Copy the resulting file off the host — a backup that stays in the same Docker
volume as the live database doesn't protect you from losing that volume:

```bash
docker compose cp app:/data/backups/manual-2026-09-06.db ./manual-2026-09-06.db
```

(replace the date in the filename with the one the previous command printed).

To back up automatically every night at 03:00, add this line with
`crontab -e` (note the `\%` — cron treats a bare `%` specially, so it must be
escaped in the crontab file):

```
0 3 * * * cd /opt/storylane && docker compose exec -T app bun src/index.ts backup /data/backups/nightly-$(date +\%F).db
```

Adjust `/opt/storylane` to wherever you placed `docker-compose.yml`. Keep the
most recent 7 nightly backups and delete older ones (a small cron line or
`find /opt/storylane/backups -name 'nightly-*.db' -mtime +7 -delete` run
right after the backup command works).

## 6. Restore

Stop the app first so nothing writes to the database while you replace it:

```bash
docker compose stop app
```

Copy your backup file into the container's data volume. Do this by running a
short-lived copy of the same app image with the volume attached — that way
the restored file ends up owned by the same user the server runs as (a plain
`alpine cp` leaves the file owned by root, and the server, which runs as a
non-root user, then fails to open it):

```bash
docker compose run --rm --no-deps --entrypoint sh -v "$PWD":/host app -c \
  "cp /host/manual-2026-09-06.db /data/storylane.db && rm -f /data/storylane.db-wal /data/storylane.db-shm"
```

(replace `manual-2026-09-06.db` with your backup's filename; it must be in
the current directory, since that's what `-v "$PWD":/host` mounts).

Deleting `storylane.db-wal` and `storylane.db-shm` (SQLite's write-ahead-log
side files) matters — if either is left over from before the restore, SQLite
will try to replay it against the restored file and can reintroduce data the
backup didn't have, or fail to open the database at all.

Start the app again:

```bash
docker compose start app
```

Confirm it's healthy:

```bash
curl -s localhost:3000/healthz
```

Expected output: `{"status":"ok"}`.

## 7. Rules

- **One running server per data volume.** Two containers pointed at the same
  `/data` will corrupt the SQLite database (SQLite allows one writer at a
  time; nothing here coordinates that across containers). Run one instance
  per dataset.
- **Never place `/data` on NFS or SMB (CIFS) network storage.** SQLite
  requires reliable file locking, which most network filesystems don't
  provide correctly; this leads to silent corruption or crashes, not a clean
  error. Local disk (or a local Docker volume, which is what these examples
  use) only.
- **Environment variables and their defaults** (all optional — the container
  works with none of them set):

  | Variable                | Default | Meaning                                    |
  | ------------------------ | ------- | ------------------------------------------- |
  | `STORYLANE_PORT`         | `3000`  | TCP port the server listens on inside the container |
  | `STORYLANE_DATA_DIR`     | `/data` | Directory for the database and backups      |
  | `STORYLANE_BASE_URL`     | (none)  | Public URL the app is served at; set this when a proxy fronts the app, since it is both the origin the CSRF check accepts and what decides whether the session cookie is marked `Secure`, and it makes generated links absolute |
  | `STORYLANE_TRUST_PROXY`  | `false` | Trust `X-Forwarded-*` headers from a reverse proxy; set to `true` only when a proxy you control (like the bundled Caddy) sits in front |
  | `STORYLANE_GIT_SHA`      | `dev`   | Commit baked into the image at build time; not something an operator sets |

## 8. Uninstall

Stop and remove the containers:

```bash
docker compose down
```

This keeps your data. To also delete the data volume — **this permanently
deletes your database and everything in it, with no way to undo it** — run:

```bash
docker compose down -v
```

Back up first (section 5) if there's any chance you'll want this data again.

## 9. Password reset

There is no self-service "forgot password" flow yet — an instance admin mints
a one-time reset link for the person who's locked out.

First, find the user's id. There's no admin UI for this yet either, so read
it straight out of the database with `bun:sqlite` (replace `storylane` with
your container's name if you didn't use `--name storylane`, and
`user@example.org` with the person's email):

```bash
docker exec storylane bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('/data/storylane.db');
console.log(db.query('select id, email from users where email = ?').all('user@example.org'));
"
```

Then, as the admin, sign in to Storylane in a browser and copy the
`storylane_session` cookie value from the browser's dev tools (Application →
Cookies). Mint the reset link (replace `<user-id>` and `<session-cookie>`):

```bash
curl -s -X POST http://localhost:3000/api/admin/users/<user-id>/reset-link \
  -H "Content-Type: application/json" \
  -H "Sec-Fetch-Site: same-origin" \
  -b "storylane_session=<session-cookie>" \
  -d '{}'
```

The response is JSON: `{"token", "expiresAt", "path", "url"}`. Send the
person `path` (or `url`, if `STORYLANE_BASE_URL` is set) — opening it lets
them set a new password. The link expires; mint a fresh one if it does before
they use it.
