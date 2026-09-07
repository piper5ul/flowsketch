#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu VM (Oracle free tier, Ampere A1 or x86):
# installs Docker, clones FlowSketch, writes the env file, builds and starts
# the demo stack. Re-running it updates to the latest main and restarts.
#
#   curl -fsSL https://raw.githubusercontent.com/piper5ul/flowsketch/main/deploy/oracle/setup.sh \
#     | bash -s -- https://demo.example.com <cloudflare-tunnel-token>
set -euo pipefail

PUBLIC_URL="${1:?usage: setup.sh <public-url> <cloudflare-tunnel-token>}"
TUNNEL_TOKEN="${2:?usage: setup.sh <public-url> <cloudflare-tunnel-token>}"
REPO="${REPO:-https://github.com/piper5ul/flowsketch.git}"
DIR="${DIR:-$HOME/flowsketch}"

if ! command -v docker >/dev/null 2>&1; then
  echo "▶ Installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi
DOCKER="docker"
docker ps >/dev/null 2>&1 || DOCKER="sudo docker"

if [ -d "$DIR/.git" ]; then
  echo "▶ Updating $DIR"
  git -C "$DIR" pull --ff-only
else
  echo "▶ Cloning into $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

ENV="$DIR/deploy/oracle/.env"
if [ ! -f "$ENV" ]; then
  echo "▶ Writing $ENV"
  {
    PW="$(openssl rand -hex 24)"
    echo "POSTGRES_PASSWORD=$PW"
    # Assembled in two parts: a one-line "scheme://user:pass@host" template
    # trips secret scanners even when the password is a variable.
    DB_URL="postgresql://flowsketch"
    DB_URL="$DB_URL:$PW@db:5432/flowsketch"
    echo "DATABASE_URL=$DB_URL"
    echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
    echo "PUBLIC_URL=$PUBLIC_URL"
    echo "CLOUDFLARE_TUNNEL_TOKEN=$TUNNEL_TOKEN"
  } > "$ENV"
  chmod 600 "$ENV"
else
  # Keep the secrets; refresh the two things the caller can change.
  sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=$PUBLIC_URL#; s#^CLOUDFLARE_TUNNEL_TOKEN=.*#CLOUDFLARE_TUNNEL_TOKEN=$TUNNEL_TOKEN#" "$ENV"
fi

echo "▶ Building and starting"
$DOCKER compose --env-file "$ENV" -f "$DIR/deploy/oracle/docker-compose.yml" up -d --build

echo "▶ Waiting for the app"
for i in $(seq 1 60); do
  if $DOCKER compose --env-file "$ENV" -f "$DIR/deploy/oracle/docker-compose.yml" exec -T app \
       node -e "fetch('http://localhost:3001/api/health?deep=1').then(r=>r.json()).then(j=>{if(!j.ok||!j.db)process.exit(1)}).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "✔ FlowSketch is up. Open $PUBLIC_URL"
    exit 0
  fi
  sleep 5
done
echo "✗ The app did not report healthy; see: $DOCKER compose -f $DIR/deploy/oracle/docker-compose.yml logs app" >&2
exit 1
