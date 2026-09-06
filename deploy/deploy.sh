#!/usr/bin/env bash
# Deploy a git ref to the production server and restart the service.
#
#   ./deploy/deploy.sh            # origin/main
#   ./deploy/deploy.sh v1.2.0     # a tag or branch
#
# Environment:
#   DEPLOY_SSH   ssh target that can reach the app (default: localpve, a Proxmox host)
#   DEPLOY_PCT   LXC id to enter with `pct exec` on that host (default: 235);
#                set to an empty string if DEPLOY_SSH is the app server itself
#   DEPLOY_DIR   checkout on the server (default: /opt/whimsy)
#   DEPLOY_UNIT  systemd unit to restart (default: whimsy)
set -euo pipefail

REF="${1:-main}"
SSH_TARGET="${DEPLOY_SSH:-localpve}"
PCT="${DEPLOY_PCT-235}"
DIR="${DEPLOY_DIR:-/opt/whimsy}"
UNIT="${DEPLOY_UNIT:-whimsy}"

remote() {
  if [[ -n "$PCT" ]]; then
    ssh -o BatchMode=yes "$SSH_TARGET" "pct exec $PCT -- bash -lc $(printf %q "$1")"
  else
    ssh -o BatchMode=yes "$SSH_TARGET" "bash -lc $(printf %q "$1")"
  fi
}

echo "▶ Deploying $REF to $SSH_TARGET${PCT:+ (LXC $PCT)}:$DIR"

remote "
  set -euo pipefail
  cd '$DIR'
  if [[ ! -d .git ]]; then
    echo '✗ $DIR is not a git checkout. See DEPLOYMENT.md → Reference deployment.' >&2
    exit 1
  fi
  if [[ -n \"\$(git status --porcelain)\" ]]; then
    echo '✗ Server checkout has local modifications; refusing to deploy.' >&2
    git status --short >&2
    exit 1
  fi
  git fetch --tags origin
  git checkout -q --detach 'origin/$REF' 2>/dev/null || git checkout -q --detach '$REF'
  echo \"▶ At \$(git rev-parse --short HEAD): \$(git log -1 --pretty=%s)\"
  npm ci --legacy-peer-deps --no-audit --no-fund
  npx prisma generate
  npx prisma migrate deploy
  npm run build
  npm run build:server
  systemctl restart '$UNIT'
  sleep 2
  systemctl is-active '$UNIT'
  curl -sf http://localhost:3001/api/health
  echo
"

echo "✔ Deployed $REF"
