#!/usr/bin/env bash
# Create the free-tier VM for the FlowSketch demo with the OCI CLI.
#
# Builds (or reuses, by display name) a VCN, an internet gateway, a default
# route and a public subnet, then launches a VM.Standard.A1.Flex instance
# with your SSH key. The A1 shape is often "Out of host capacity"; the
# script walks every availability domain and keeps retrying until one has
# room. It ends by printing the instance's public IP and the setup command.
#
# Needs: the OCI CLI (`brew install oci-cli`) configured with an API signing
# key (`~/.oci/config`, see README § 1b) and `jq`.
#
#   deploy/oracle/provision.sh [--compartment <ocid>] [--ssh-key ~/.ssh/id_ed25519.pub]
#                              [--name flowsketch-demo] [--ocpus 4] [--memory 24]
#                              [--disk 100] [--ubuntu 24.04] [--retry-minutes 5]
#
# Run it again after a failure: every step is a lookup before it is a create.
set -euo pipefail

NAME=flowsketch-demo
SSH_KEY="$HOME/.ssh/id_ed25519.pub"
OCPUS=4
MEMORY=24
DISK=100
UBUNTU=24.04
RETRY_MINUTES=5
COMPARTMENT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --compartment) COMPARTMENT="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --ocpus) OCPUS="$2"; shift 2 ;;
    --memory) MEMORY="$2"; shift 2 ;;
    --disk) DISK="$2"; shift 2 ;;
    --ubuntu) UBUNTU="$2"; shift 2 ;;
    --retry-minutes) RETRY_MINUTES="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

for tool in oci jq; do
  command -v "$tool" >/dev/null || { echo "✗ $tool is not installed" >&2; exit 1; }
done
[ -f "$SSH_KEY" ] || { echo "✗ SSH public key not found: $SSH_KEY" >&2; exit 1; }

# The compartment defaults to the tenancy root, which is what a fresh
# account has. The OCID is an identifier, not a secret.
if [ -z "$COMPARTMENT" ]; then
  CONFIG="${OCI_CLI_CONFIG_FILE:-$HOME/.oci/config}"
  COMPARTMENT="$(awk -F= '/^tenancy/ { gsub(/ /, "", $2); print $2; exit }' "$CONFIG" 2>/dev/null || true)"
  [ -n "$COMPARTMENT" ] || { echo "✗ no tenancy in $CONFIG; pass --compartment <ocid>" >&2; exit 1; }
fi

echo "▶ Checking the CLI can reach your tenancy"
oci iam region-subscription list --query 'data[?"is-home-region"].["region-name"]' --raw-output >/dev/null

lookup() { # lookup <resource> <query-name> — prints the id of the named, live resource or nothing
  oci "$@" --compartment-id "$COMPARTMENT" --display-name "$NAME" --all \
    --query 'data[?"lifecycle-state"==`AVAILABLE` || "lifecycle-state"==`RUNNING` || "lifecycle-state"==`PROVISIONING`] | [0].id' \
    --raw-output 2>/dev/null | grep -v '^null$' || true
}

echo "▶ Network"
VCN="$(lookup network vcn list)"
if [ -z "$VCN" ]; then
  VCN="$(oci network vcn create --compartment-id "$COMPARTMENT" --display-name "$NAME" \
    --cidr-block 10.0.0.0/16 --dns-label fsdemo --wait-for-state AVAILABLE \
    --query data.id --raw-output)"
  echo "  created VCN"
fi

IGW="$(oci network internet-gateway list --compartment-id "$COMPARTMENT" --vcn-id "$VCN" \
  --query 'data[?"lifecycle-state"==`AVAILABLE`] | [0].id' --raw-output | grep -v '^null$' || true)"
if [ -z "$IGW" ]; then
  IGW="$(oci network internet-gateway create --compartment-id "$COMPARTMENT" --vcn-id "$VCN" \
    --display-name "$NAME" --is-enabled true --wait-for-state AVAILABLE \
    --query data.id --raw-output)"
  echo "  created internet gateway"
fi

# One default route out through the gateway. The VCN's default security list
# already admits SSH (22/tcp) and lets everything out; the tunnel dials out,
# so nothing else is opened.
RT="$(oci network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"' --raw-output)"
if ! oci network route-table get --rt-id "$RT" --query 'data."route-rules"[]."network-entity-id"' --raw-output \
    | grep -q "$IGW"; then
  oci network route-table update --rt-id "$RT" --force \
    --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" \
    --wait-for-state AVAILABLE >/dev/null
  echo "  added default route"
fi

SUBNET="$(lookup network subnet list --vcn-id "$VCN")"
if [ -z "$SUBNET" ]; then
  SUBNET="$(oci network subnet create --compartment-id "$COMPARTMENT" --vcn-id "$VCN" \
    --display-name "$NAME" --cidr-block 10.0.0.0/24 --dns-label fsdemo \
    --wait-for-state AVAILABLE --query data.id --raw-output)"
  echo "  created public subnet"
fi

echo "▶ Instance"
INSTANCE="$(lookup compute instance list)"
if [ -z "$INSTANCE" ]; then
  IMAGE="$(oci compute image list --compartment-id "$COMPARTMENT" \
    --operating-system "Canonical Ubuntu" --operating-system-version "$UBUNTU" \
    --shape VM.Standard.A1.Flex --sort-by TIMECREATED --sort-order DESC \
    --query 'data[0].id' --raw-output)"
  [ -n "$IMAGE" ] && [ "$IMAGE" != null ] || { echo "✗ no Ubuntu $UBUNTU image for A1.Flex in this region" >&2; exit 1; }

  mapfile -t ADS < <(oci iam availability-domain list --compartment-id "$COMPARTMENT" \
    --query 'data[].name' --raw-output | jq -r '.[]')
  echo "  ${#ADS[@]} availability domain(s); ${OCPUS} OCPU / ${MEMORY} GB / ${DISK} GB"

  attempt=0
  while [ -z "$INSTANCE" ]; do
    for AD in "${ADS[@]}"; do
      attempt=$((attempt + 1))
      out="$(oci compute instance launch --compartment-id "$COMPARTMENT" --availability-domain "$AD" \
        --shape VM.Standard.A1.Flex --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEMORY}" \
        --image-id "$IMAGE" --subnet-id "$SUBNET" --assign-public-ip true \
        --display-name "$NAME" --ssh-authorized-keys-file "$SSH_KEY" \
        --boot-volume-size-in-gbs "$DISK" --query data.id --raw-output 2>&1)" && { INSTANCE="$out"; break; }
      if grep -qiE 'out of (host )?capacity|InternalError' <<<"$out"; then
        echo "  $(date +%H:%M) $AD: no A1 capacity (attempt $attempt)"
      else
        echo "$out" >&2
        exit 1
      fi
    done
    [ -n "$INSTANCE" ] || { echo "  retrying in $RETRY_MINUTES min (Ctrl-C to stop; re-run resumes here)"; sleep $((RETRY_MINUTES * 60)); }
  done
  echo "  launched $INSTANCE"
fi

echo "▶ Waiting for the instance to run"
oci compute instance get --instance-id "$INSTANCE" --wait-for-state RUNNING >/dev/null
IP="$(oci compute instance list-vnics --instance-id "$INSTANCE" --query 'data[0]."public-ip"' --raw-output)"

echo "▶ Waiting for SSH at $IP"
until ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new -o BatchMode=yes "ubuntu@$IP" true 2>/dev/null; do
  sleep 10
done

cat <<EOF

✔ VM is up: ubuntu@$IP

Next — create the tunnel (README § 2), then install:

  ssh ubuntu@$IP 'curl -fsSL https://raw.githubusercontent.com/piper5ul/flowsketch/main/deploy/oracle/setup.sh | bash -s -- https://demo.yourdomain.com <tunnel-token>'

Tear it all down later with:

  oci compute instance terminate --instance-id $INSTANCE --force
EOF
