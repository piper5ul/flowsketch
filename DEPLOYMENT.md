# Deployment

FlowSketch is a single Node process: Express serves the API and, in production, the built Vite bundle from `dist/`. It needs a PostgreSQL database and an SMTP server for verification and password-reset mail.

```
Browser ──HTTPS──▶ Cloudflare ──tunnel──▶ cloudflared ──HTTP──▶ node dist-server/server/index.js :3001
                                                                    │
                                                                    ├── serves dist/ (SPA)
                                                                    ├── /api/* (Express)
                                                                    └── PostgreSQL
```

## Requirements

- Node 22+
- PostgreSQL 15+
- An SMTP relay (verification/reset emails). Any host works; MailDev is fine for staging.
- A way to expose port 3001 over HTTPS. This guide uses a Cloudflare Tunnel; a reverse proxy with its own certificate works the same way.

## One-time server setup

```bash
# as root on the server
apt-get install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs

git clone https://github.com/piper5ul/flowsketch.git /opt/whimsy
cd /opt/whimsy
cp .env.example .env
$EDITOR .env        # DATABASE_URL, BETTER_AUTH_SECRET (long random string), BETTER_AUTH_URL=https://your.domain, SMTP_*

npm ci --legacy-peer-deps
npx prisma generate
npx prisma migrate deploy   # creates the schema from prisma/migrations/
npm run build && npm run build:server

install -m 644 deploy/whimsy.service /etc/systemd/system/whimsy.service
systemctl daemon-reload
systemctl enable --now whimsy
curl -s http://localhost:3001/api/health   # {"ok":true}
```

`BETTER_AUTH_URL` must be the public origin users hit (it is also the trusted CORS/CSRF origin). The unit file reads `/opt/whimsy/.env`; never commit that file.

Uploaded images are written to `UPLOAD_DIR` (default `./uploads`, so `/opt/whimsy/uploads`), resolved from the service's working directory. It is gitignored, so a deploy leaves it in place — but it is *not* in the database, so back it up alongside Postgres.

## Releasing

From a developer machine with SSH access, [`deploy/deploy.sh`](deploy/deploy.sh) pulls `main` on the server, installs, builds, applies the schema, and restarts the service:

```bash
./deploy/deploy.sh            # deploy origin/main
./deploy/deploy.sh v1.2.0     # deploy a tag or branch
```

The script refuses to run if the server checkout has local modifications, and prints the health check at the end. Set `DEPLOY_SSH` (default `localpve`) and `DEPLOY_PCT` (default `235`) to target a different host or container; set `DEPLOY_PCT=` to run the remote commands directly over SSH instead of through Proxmox's `pct exec`.

## Database migrations

The schema is versioned in `prisma/migrations/`. Every deploy — including `deploy/deploy.sh` — applies pending migrations with `prisma migrate deploy`, which is non-interactive, never resets, and never prompts.

```bash
npm run db:migrate:deploy      # or: npx prisma migrate deploy
```

**A new, empty database needs nothing else**: `migrate deploy` applies every migration in order and records each in `_prisma_migrations`.

| Migration | What it does |
|---|---|
| `20260906065812_init` | The whole schema as it stood before migrations existed |
| `20260906094058_sharing` | Adds `Diagram.shareToken` (nullable, unique) and the `DiagramMember` table, with cascading foreign keys to `Diagram` and `User` |
| `20260906114233_version_history` | Adds the `DiagramVersion` table (snapshots of a diagram's `data` and `title`), indexed by `(diagramId, createdAt DESC)`; `ON DELETE CASCADE` from `Diagram`, `ON DELETE SET NULL` from `User` |
| `20260906132915_comments` | Adds the `CommentThread` and `Comment` tables, indexed by `(diagramId, resolved)` and `(threadId, createdAt)`; `ON DELETE CASCADE` from `Diagram`, from the thread, and from `User` — a comment is a person speaking, so it goes when the account does |
| `20260906154210_image_refs_index` | Adds the `DiagramImage` join table — which images each live diagram draws — keyed on `(diagramId, imageId)` and indexed by `imageId`; `ON DELETE CASCADE` from both sides. **Needs the one-time backfill below.** |
| `20260906170500_folders` | Adds the `Folder` table (personal, one flat level), indexed by `userId`, and `Diagram.folderId` with its index; `ON DELETE CASCADE` from `User`, `ON DELETE SET NULL` from `Folder` — deleting a folder unfiles its diagrams rather than taking them with it |

Every migration after `init` is additive — new nullable columns and new tables — so they apply to a populated database without a backfill and without downtime, with the one exception noted next. Existing diagrams come out unshared (`shareToken IS NULL`), with no members, with an empty history, with no comment threads and unfiled (`folderId IS NULL`); their first data-changing save records the state they were already in.

### Backfilling the image index (one-time, required)

`20260906154210_image_refs_index` creates the table empty, and the server writes to it only when a diagram is saved. Until an existing diagram is indexed it looks like a board that draws no images at all: a member or a share link 404s on a picture plainly on the canvas, and the image garbage collector counts that picture as unreferenced. **Run the backfill in the same window as the migration, before the app takes traffic:**

```bash
npx tsx scripts/reindex-images.ts            # --dry-run to see the counts first
```

It reads diagrams a page at a time and makes each one's index rows match its JSON, so it is idempotent — a second run is a no-op, and an interrupted run can simply be repeated. Run it once per database (the shared dev database and the production LXC's both qualify). A database created empty after this migration needs nothing.

### Version history and storage

`DiagramVersion` stores a **full copy** of a diagram's JSON per snapshot, in the same database as the diagrams themselves — there is no separate store and nothing extra to back up, but a backup of Postgres is now also the backup of every version, and the database grows with editing activity rather than only with the number of diagrams. Two settings bound it, both read from the environment at request time:

| Variable | Default | What it does |
|---|---|---|
| `VERSION_INTERVAL_MS` | `600000` (10 min) | Minimum age of the newest snapshot before a save records another. Lower it for finer history at the cost of more rows. |
| `MAX_VERSIONS` | `50` | Versions kept per diagram. The surplus is deleted as new ones arrive. |

So the ceiling is roughly `MAX_VERSIONS × the size of a diagram` per diagram — at the API's 5 MB body limit, a worst case of 250 MB for a single pathological board, and in practice a few MB. Anything unparseable or non-positive in either variable falls back to the default rather than being obeyed, so a typo cannot turn into "snapshot every save" or "keep nothing".

### Baselining a database created with `db push` (one-time, required)

Before migrations existed the schema was applied with `prisma db push`, which writes no `_prisma_migrations` table. Such a database already *has* the init schema but cannot prove it, so `migrate deploy` would try to re-create every table and fail on the first `CREATE TABLE`. Mark the initial migration as already applied, once per such database, **before the first deploy that runs `migrate deploy`**:

```bash
npx prisma migrate resolve --applied 20260906065812_init
```

That only writes the bookkeeping row; it runs no SQL against your tables. Run it once for **every** database that predates this change — the shared dev database and the production LXC's database both qualify (see *Reference deployment* below). Afterwards `migrate deploy` reports "No pending migrations" and future migrations apply normally.

If you are unsure whether a database is baselined, `SELECT migration_name FROM "_prisma_migrations";` — a missing table or an empty result means it is not.

### Changing the schema

Edit `prisma/schema.prisma`, then generate a migration against a scratch database:

```bash
npm run db:migrate -- --name add_something   # prisma migrate dev
```

Commit the generated `prisma/migrations/<timestamp>_add_something/` directory with the schema change. `npm run db:push` is still there for a throwaway local database you do not mind losing — it skips the migration history entirely, so never point it at the shared dev database or production.

## Exposing it

**Cloudflare Tunnel** (recommended — no inbound ports, TLS handled by Cloudflare). On the server:

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
apt-get update && apt-get install -y cloudflared
cloudflared tunnel login
cloudflared tunnel create flowsketch
cloudflared tunnel route dns flowsketch your.domain
cat > /etc/cloudflared/config.yml <<EOF
tunnel: flowsketch
credentials-file: /root/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: your.domain
    service: http://localhost:3001
  - service: http_status:404
EOF
cloudflared service install && systemctl enable --now cloudflared
```

**Nginx** instead: proxy `your.domain` to `http://127.0.0.1:3001` with `proxy_set_header Host $host;` and `X-Forwarded-Proto https;`, and terminate TLS with certbot. Nothing in the app depends on Nginx; it is optional.

## Operations

| Task | Command (on the server) |
|---|---|
| Logs | `journalctl -u whimsy -f` |
| Restart | `systemctl restart whimsy` |
| Health (liveness) | `curl -s localhost:3001/api/health` → `{"ok":true}` — answered by the process alone, never touches Postgres |
| Health (readiness) | `curl -s localhost:3001/api/health?deep=1` → `{"ok":true,"db":true}`, or `503 {"ok":false,"db":false}` when the database is unreachable |
| Schema after a pull | `npx prisma migrate deploy` (`deploy/deploy.sh` already runs it) |
| Roll back | `git checkout <previous-tag> && npm ci --legacy-peer-deps && npm run build && npm run build:server && systemctl restart whimsy` |

Point uptime monitoring at the deep probe: the shallow one stays green while the app is unusable because Postgres is down.

**Rate limits.** `/api` allows 600 requests per 15 minutes per IP, `POST /api/images` a further 60 per 15 minutes, and `/api/shared/*` — the share-link routes, the only ones that need no session — 300 per 15 minutes; over budget is `429 {"error":"Too many requests"}`. Counting is per process and in memory, so it resets on restart. For that counting to be per client rather than per proxy, `server/index.ts` sets `app.set('trust proxy', 1)`: the app only ever sees the tunnel's (or Nginx's) address on the socket, so it trusts exactly one hop of `X-Forwarded-For`. Raise that number only if you add another proxy in front — trusting more hops than you actually run lets a client forge its own IP and dodge the limits.

Backups: the state is the PostgreSQL database (diagrams are JSON in the `Diagram` table, and their version history in `DiagramVersion` — same database, so one `pg_dump` covers both) — `pg_dump` it — **and `UPLOAD_DIR`**, where uploaded image bytes live. Back up both, or a restored database points at images that are no longer there. Note that `DiagramVersion` is the bulk of what the dump grows by from here: see *Version history and storage* above for the knobs that bound it.

**Share links are bearer credentials.** `Diagram.shareToken` is 144 bits of `crypto.randomBytes`, and anyone holding one can read that diagram — and the images it draws — at `/api/shared/<token>` with no account. Revoking is `DELETE /api/diagrams/:id/share`, which nulls the column; a later re-share mints a *different* token, so the old URL stays dead. Nothing else is reachable with a token: an image id the diagram does not reference is a 404, and the response carries no owner, no members and never the token itself. Treat a database dump as containing live credentials.

**First open of a pre-upload diagram uploads its images.** Diagrams saved before `/api/images` existed carry their pictures inline as base64; opening one now uploads each of them in the background and rewrites the nodes to `/api/images/<id>` URLs, which the next autosave persists. Expect a burst of `POST /api/images` and some growth in `UPLOAD_DIR` the first time old diagrams are opened after a release — a diagram with more than 60 inlined images will hit the image rate limit and finish the rest on its next open.

---

## Reference deployment (maintainer notes)

The public instance at `whimsical.vedalogy.com`, as verified on 2026-09-05:

| Piece | Where |
|---|---|
| Container | Proxmox LXC **235** (`whimsy`) at `192.168.68.251`, on host `192.168.68.240` (`ssh localpve`, then `pct exec 235 -- …`) |
| App | `/opt/whimsy`, `whimsy.service`, Node 22 |
| Database | shared PostgreSQL at `192.168.68.242:5432` |
| Tunnel | **runs on the maintainer's Mac** (`~/.cloudflared/config.yml`, shared with ~25 other hostnames) with `whimsical.vedalogy.com → http://192.168.68.251:3001` |
| Nginx | installed on the container with the stock config; unused |

**Required one-time step — baseline both databases.** Both the production database and the shared development database on `192.168.68.242` were created with `prisma db push`, so neither has a `_prisma_migrations` table. The next deploy runs `prisma migrate deploy` and will fail on `CREATE TABLE "User"` until each is baselined. With `DATABASE_URL` pointing at the database in question:

```bash
npx prisma migrate resolve --applied 20260906065812_init
```

Do this **once per database, before the first deploy of this change** — for the LXC 235 app database and for the shared dev database. It writes only the bookkeeping row; no schema SQL runs.

Known gaps, tracked on the roadmap:

- `/opt/whimsy` is an rsync copy with no `.git`, and the unit runs `npx tsx server/index.ts` rather than the compiled build. Migrate it to the git-checkout layout above: `mv /opt/whimsy /opt/whimsy.bak && git clone … /opt/whimsy && cp /opt/whimsy.bak/.env /opt/whimsy/`, then follow *One-time server setup* from `npm ci`.
- The tunnel should run on the container (a dedicated `flowsketch` tunnel as above), after which the `whimsical.vedalogy.com` rule is removed from the Mac's config. Until then, the site goes down whenever the Mac's `cloudflared` is not running.
- Nothing merged to `main` reaches production until `deploy/deploy.sh` is run.
