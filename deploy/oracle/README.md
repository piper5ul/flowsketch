# Running the demo on an Oracle Cloud free-tier VM

One VM, four containers, nothing exposed to the internet except through a
Cloudflare tunnel. Total cost: $0 on the Always Free tier.

Three things have to exist: a VM, a tunnel, and the stack on the VM. The VM
can be made by hand in the console (§ 1a) or by a script through Oracle's API
(§ 1b). The tunnel is a two-minute job in the Cloudflare dashboard (§ 2). The
stack is one command (§ 3).

## 0. The account (once, by you)

Create an Always Free account at [cloud.oracle.com](https://cloud.oracle.com).
It asks for a card and an identity check; nothing is charged on the free
tier. Note the **region** you chose during sign-up (the "home region", e.g.
`us-ashburn-1`) — every resource lives there.

The free tier allows **4 OCPUs and 24 GB** of Arm (`VM.Standard.A1.Flex`) in
total, and 200 GB of block storage. One VM at that size is the whole
allowance, which is plenty.

## 1a. The VM by hand

1. Compute → Instances → **Create instance**.
2. Image: **Ubuntu 24.04** (or 22.04). Shape: **VM.Standard.A1.Flex**,
   4 OCPUs / 24 GB (or 2 / 12 — it is enough).
3. Networking: leave "Create new virtual cloud network" and "Assign a public
   IPv4 address" as they are.
4. SSH key: paste the public key you'll connect with
   (`cat ~/.ssh/id_ed25519.pub` on your Mac).
5. Create. Note the **public IP** once it is running.

No ingress rules are needed beyond the default (SSH): the tunnel dials out.

If the create fails with **"Out of host capacity"** — common for the free
Arm shape — retry with a different availability domain, or later. § 1b's
script does that retry for you.

## 1b. The VM by script (OCI CLI)

This is the path to take when somebody — or an agent — is doing it for you:
everything after the API key is a command.

**Create an API signing key** (in the console, once):

1. Profile menu (top right) → **My profile** → **API keys** → **Add API key**.
2. **Generate API key pair** → **Download private key**. Keep the dialog open.
3. Save the key as `~/.oci/oci_api_key.pem` and lock it down:
   ```bash
   mkdir -p ~/.oci && mv ~/Downloads/*.pem ~/.oci/oci_api_key.pem && chmod 600 ~/.oci/oci_api_key.pem
   ```
4. Click **Add**, then copy the **configuration file preview** it shows into
   `~/.oci/config`, and set its `key_file` line to
   `key_file=~/.oci/oci_api_key.pem`. The file holds your user, tenancy and
   fingerprint (identifiers, not secrets); the private key is the secret and
   it stays on your machine.

**Install the CLI and provision:**

```bash
brew install oci-cli jq
oci iam region-subscription list        # proves the key works
deploy/oracle/provision.sh              # network + VM, retries A1 capacity
```

`provision.sh` creates a VCN, an internet gateway, a default route and a
public subnet, then launches the instance with your SSH key at the free-tier
maximum (`--ocpus`, `--memory`, `--disk` and `--name` to change). It looks
every resource up by name before creating it, so re-running after any
failure resumes rather than duplicates. When the A1 shape has no capacity it
cycles the availability domains every five minutes until one has room
(`--retry-minutes`). It ends by printing the public IP and the exact § 3
command.

Neither the script nor the compose stack ever prints a secret; the only
credential involved is the API key in `~/.oci`, which the CLI reads itself.

## 2. The tunnel (once, in Cloudflare)

Zero Trust → Networks → Tunnels → **Create a tunnel** → Cloudflared → name it
(e.g. `flowsketch-demo`) → on the install page, copy the **token** — the long
string after `--token` in any of the install commands. Then under **Public
Hostname** add e.g. `demo.yourdomain.com` → Service **HTTP** → URL
**`app:3001`**. That name resolves inside the compose network on the VM;
cloudflared runs as a container beside the app.

## 3. Install

From your Mac, with the IP from § 1 and the token from § 2:

```bash
ssh ubuntu@<vm-ip> 'curl -fsSL https://raw.githubusercontent.com/piper5ul/flowsketch/main/deploy/oracle/setup.sh | bash -s -- https://demo.yourdomain.com <tunnel-token>'
```

That installs Docker, clones the repo, writes `deploy/oracle/.env` with fresh
secrets, builds the image (a few minutes on first run), applies the database
migrations and starts everything. It ends with `✔ FlowSketch is up`, and
`https://demo.yourdomain.com` answers a minute later once the tunnel
connects.

## 4. Updating

Re-run the same command. It pulls `main`, rebuilds and restarts; the database
and uploads live in Docker volumes and survive.

## 5. Tearing it down

`provision.sh` prints the terminate command. Deleting the instance deletes
the boot volume, database and uploads with it; the VCN can stay (it is free)
or go through Networking → Virtual cloud networks → Delete.

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
