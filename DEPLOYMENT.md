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
npx prisma db push   # until migrations exist (roadmap: deploy-migrate)
npm run build && npm run build:server

install -m 644 deploy/whimsy.service /etc/systemd/system/whimsy.service
systemctl daemon-reload
systemctl enable --now whimsy
curl -s http://localhost:3001/api/health   # {"ok":true}
```

`BETTER_AUTH_URL` must be the public origin users hit (it is also the trusted CORS/CSRF origin). The unit file reads `/opt/whimsy/.env`; never commit that file.

## Releasing

From a developer machine with SSH access, [`deploy/deploy.sh`](deploy/deploy.sh) pulls `main` on the server, installs, builds, applies the schema, and restarts the service:

```bash
./deploy/deploy.sh            # deploy origin/main
./deploy/deploy.sh v1.2.0     # deploy a tag or branch
```

The script refuses to run if the server checkout has local modifications, and prints the health check at the end. Set `DEPLOY_SSH` (default `localpve`) and `DEPLOY_PCT` (default `235`) to target a different host or container; set `DEPLOY_PCT=` to run the remote commands directly over SSH instead of through Proxmox's `pct exec`.

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
| Health | `curl -s localhost:3001/api/health` |
| Schema after a pull | `npx prisma db push` (or `prisma migrate deploy` once migrations exist) |
| Roll back | `git checkout <previous-tag> && npm ci --legacy-peer-deps && npm run build && npm run build:server && systemctl restart whimsy` |

Backups: the only state is the PostgreSQL database (diagrams are JSON in the `Diagram` table) — `pg_dump` it. Pasted images currently live inside that JSON; once uploads move to disk (roadmap `img-upload`) the upload directory needs backing up too.

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

Known gaps, tracked on the roadmap:

- `/opt/whimsy` is an rsync copy with no `.git`, and the unit runs `npx tsx server/index.ts` rather than the compiled build. Migrate it to the git-checkout layout above: `mv /opt/whimsy /opt/whimsy.bak && git clone … /opt/whimsy && cp /opt/whimsy.bak/.env /opt/whimsy/`, then follow *One-time server setup* from `npm ci`.
- The tunnel should run on the container (a dedicated `flowsketch` tunnel as above), after which the `whimsical.vedalogy.com` rule is removed from the Mac's config. Until then, the site goes down whenever the Mac's `cloudflared` is not running.
- Nothing merged to `main` reaches production until `deploy/deploy.sh` is run.
