# Running the demo on an Oracle Cloud free-tier VM

One VM, four containers, nothing exposed to the internet except through a
Cloudflare tunnel. Total cost: $0 on the Always Free tier.

## 1. The VM (once, in the Oracle console)

1. Create an Always Free account at cloud.oracle.com.
2. Compute → Instances → Create instance:
   - Image: **Ubuntu 24.04** (or 22.04).
   - Shape: **VM.Standard.A1.Flex**, 2 OCPUs / 12 GB is plenty (the free tier allows up to 4 / 24).
     If A1 capacity is "out of host capacity" in your region, retry later or pick a different availability domain.
   - SSH key: paste the public key you'll connect with (`cat ~/.ssh/id_ed25519.pub` on your Mac).
3. Note the public IP. No ingress rules are needed — the tunnel dials out.

## 2. The tunnel (once, in Cloudflare)

Zero Trust → Networks → Tunnels → Create a tunnel (Cloudflared) → name it →
copy the **token** from the install command (the long string after `--token`).
Then under Public Hostname add e.g. `demo.yourdomain.com` → Service
**HTTP** → URL **app:3001**. That name resolves inside the compose network.

## 3. Install

From your Mac:

```bash
ssh ubuntu@<vm-ip> 'curl -fsSL https://raw.githubusercontent.com/piper5ul/flowsketch/main/deploy/oracle/setup.sh | bash -s -- https://demo.yourdomain.com <tunnel-token>'
```

That installs Docker, clones the repo, writes `deploy/oracle/.env` with fresh
secrets, builds the image (a few minutes on first run), applies the database
migrations and starts everything. It ends with `✔ FlowSketch is up`.

## 4. Updating

Re-run the same command. It pulls `main`, rebuilds and restarts; the database
and uploads live in Docker volumes and survive.

## What the demo does and doesn't do

- Sign-up works. Verification and password-reset mails go to a mail sink on
  the VM (MailDev at port 1080, not published) — nobody receives them, which
  is fine for a demo where accounts are throwaway. Sign-in does not require
  verification.
- Uploads persist in the `uploads` volume, the database in `pgdata`.
- Everything else — live collaboration, sharing, history, exports — runs
  exactly as in the main deployment.

## Useful commands (on the VM)

```bash
cd ~/flowsketch
docker compose -f deploy/oracle/docker-compose.yml logs -f app
docker compose -f deploy/oracle/docker-compose.yml ps
docker compose -f deploy/oracle/docker-compose.yml exec db psql -U flowsketch flowsketch
```
