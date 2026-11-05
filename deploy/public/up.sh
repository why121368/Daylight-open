#!/usr/bin/env sh
# Public HTTPS entry for a retained Daylight Compose project. Does not buy resources,
# configure DNS/security groups, source shell code from env files, or rotate secrets.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
ENV_FILE=${DAYLIGHT_ENV_FILE:-$ROOT/deploy/compose.env}
PROJECT=${DAYLIGHT_PROJECT:-daylight}
PUBLIC_HOST=
ACME_EMAIL=
CHECK_ONLY=0
INGRESS_SUBNET=${DAYLIGHT_INGRESS_SUBNET:-}
CADDY_IP=${DAYLIGHT_CADDY_IP:-}

usage() {
  cat <<'USAGE'
Usage:
  sh deploy/public/up.sh --domain daylight.your-domain.cn --email admin@your-domain.cn
    [--env-file /opt/daylight/compose.env] [--project daylight] [--check]
    [--ingress-subnet 172.30.255.0/29 --proxy-ip 172.30.255.2]

Requires an existing Linux server, Docker Compose >= 2.24.4, openssl, curl,
DNS pointing to that server, and inbound TCP 80/443. --check validates configuration
without starting services. The first run generates an env file if it is absent;
existing secrets, host ports and project volumes are preserved.
Ingress addresses are retained in the public env file; choose a non-overlapping
private subnet and an unused Caddy address inside it when defaults conflict.
USAGE
}

fail() { printf '%s\n' "$*" >&2; exit 1; }
value() { [ "$#" -ge 2 ] && [ -n "$2" ] || fail "Missing value for $1"; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --domain) value "$@"; PUBLIC_HOST=$2; shift 2 ;;
    --email) value "$@"; ACME_EMAIL=$2; shift 2 ;;
    --env-file) value "$@"; ENV_FILE=$2; shift 2 ;;
    --project) value "$@"; PROJECT=$2; shift 2 ;;
    --ingress-subnet) value "$@"; INGRESS_SUBNET=$2; shift 2 ;;
    --proxy-ip) value "$@"; CADDY_IP=$2; shift 2 ;;
    --check) CHECK_ONLY=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; fail "Unknown option: $1" ;;
  esac
done

PUBLIC_HOST=$(printf '%s' "$PUBLIC_HOST" | tr '[:upper:]' '[:lower:]')
[ "${#PUBLIC_HOST}" -le 253 ] || fail 'Hostname is too long.'
printf '%s' "$PUBLIC_HOST" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$' \
  || fail '--domain must be a hostname, without https://, port, path, or IP address.'
case "$PUBLIC_HOST" in
  localhost|*.localhost|*.local|*.internal|*.lan|*.home|*.test|*.invalid|*.example|*.home.arpa|example.com|*.example.com|example.org|*.example.org|example.net|*.example.net|daylight.your-domain.cn)
    fail 'Use a real public domain you control; local/example domains cannot be published.' ;;
esac
printf '%s' "$ACME_EMAIL" | grep -Eq '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$' \
  || fail '--email must be a valid certificate contact email.'
printf '%s' "$PROJECT" | grep -Eq '^[a-z0-9][a-z0-9_-]*$' \
  || fail '--project must be a lowercase Compose project name.'

for command in docker openssl curl; do
  command -v "$command" >/dev/null 2>&1 || fail "Missing command: $command"
done
COMPOSE_VERSION=$(docker compose version --short 2>/dev/null) || fail 'Install Docker Compose v2 >= 2.24.4.'
printf '%s\n' "$COMPOSE_VERSION" | sed 's/^v//; s/[-+].*//' | awk -F. \
  '{ exit !(($1 > 2) || ($1 == 2 && ($2 > 24 || ($2 == 24 && $3 >= 4)))) }' \
  || fail 'Docker Compose >= 2.24.4 is required (the public override replaces API ports).'

# Resolve relative env paths before invoking Compose from the repository root.
case "$ENV_FILE" in /*) ;; *) ENV_FILE="$PWD/$ENV_FILE" ;; esac
ENV_PARENT=$(dirname -- "$ENV_FILE")
[ -d "$ENV_PARENT" ] || fail "Create the configuration directory first: $ENV_PARENT"
PUBLIC_FILE="$ENV_FILE.public"

# Read only these literal values. Never source/eval deployment env files.
retained_public_value() {
  [ -f "$PUBLIC_FILE" ] || return 0
  awk -v wanted="$1=" 'index($0, wanted) == 1 { value = substr($0, length(wanted) + 1); sub(/\r$/, "", value); count++ }
    END { if (count > 1) exit 1; if (count == 1) print value }' "$PUBLIC_FILE"
}
if [ -z "$INGRESS_SUBNET" ]; then
  INGRESS_SUBNET=$(retained_public_value DAYLIGHT_INGRESS_SUBNET) || fail 'Duplicate ingress subnet entries in public env file.'
fi
if [ -z "$CADDY_IP" ]; then
  CADDY_IP=$(retained_public_value DAYLIGHT_CADDY_IP) || fail 'Duplicate proxy IP entries in public env file.'
fi
INGRESS_SUBNET=${INGRESS_SUBNET:-172.30.255.0/29}
CADDY_IP=${CADDY_IP:-172.30.255.2}
# POSIX awk arithmetic is exact for IPv4 integers. Reserve the network, default
# gateway and broadcast addresses, leaving room for both API and Caddy.
printf '%s\n%s\n' "$INGRESS_SUBNET" "$CADDY_IP" | awk '
  function ip(value, parts, count, i, result) {
    count = split(value, parts, "."); if (count != 4) return -1;
    result = 0;
    for (i = 1; i <= 4; i++) {
      if (parts[i] !~ /^[0-9]+$/ || length(parts[i]) > 3 || parts[i] + 0 > 255 || (length(parts[i]) > 1 && parts[i] ~ /^0/)) return -1;
      result = result * 256 + parts[i];
    }
    return result;
  }
  NR == 1 { count = split($0, cidr, "/"); network = ip(cidr[1]); prefix = cidr[2];
    if (count != 2 || network < 0 || prefix !~ /^[0-9]+$/ || prefix + 0 < 8 || prefix + 0 > 29) { invalid = 1; exit }
    size = 2 ^ (32 - prefix); if (network % size != 0) { invalid = 1; exit }
    last = network + size - 1;
    private = (network >= 167772160 && last <= 184549375) || (network >= 2886729728 && last <= 2887778303) || (network >= 3232235520 && last <= 3232301055);
    if (!private) { invalid = 1; exit }
  }
  NR == 2 { proxy = ip($0); if (proxy <= network + 1 || proxy >= network + size - 1) invalid = 1 }
  NR > 2 { invalid = 1 }
  END { exit (invalid || NR != 2) ? 1 : 0 }
' || fail 'Ingress requires a private IPv4 CIDR (/8 to /29) and a Caddy IPv4 inside it, excluding network/gateway/broadcast. Set --ingress-subnet and --proxy-ip together.'

# Shell values take precedence over --env-file values in Compose; export the
# final selected values so explicit CLI overrides and the retained file agree.
export DAYLIGHT_INGRESS_SUBNET="$INGRESS_SUBNET" DAYLIGHT_CADDY_IP="$CADDY_IP"
export DAYLIGHT_PUBLIC_HOST="$PUBLIC_HOST" DAYLIGHT_ACME_EMAIL="$ACME_EMAIL"

if [ ! -f "$ENV_FILE" ]; then
  printf 'Generating new service credentials in %s (mode 600).\n' "$ENV_FILE"
  umask 077
  while IFS= read -r line; do
    case "$line" in
      POSTGRES_PASSWORD=*) printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)" ;;
      REDIS_PASSWORD=*) printf 'REDIS_PASSWORD=%s\n' "$(openssl rand -hex 32)" ;;
      RABBITMQ_PASSWORD=*) printf 'RABBITMQ_PASSWORD=%s\n' "$(openssl rand -hex 32)" ;;
      MINIO_ROOT_PASSWORD=*) printf 'MINIO_ROOT_PASSWORD=%s\n' "$(openssl rand -hex 32)" ;;
      DAYLIGHT_JWT_SECRET=*) printf 'DAYLIGHT_JWT_SECRET=%s\n' "$(openssl rand -hex 48)" ;;
      DAYLIGHT_BIND_ADDRESS=*) printf 'DAYLIGHT_BIND_ADDRESS=127.0.0.1\n' ;;
      DAYLIGHT_PUBLIC_BASE_URL=*) printf 'DAYLIGHT_PUBLIC_BASE_URL=https://%s\n' "$PUBLIC_HOST" ;;
      DAYLIGHT_ADMIN_EMAILS=*) printf 'DAYLIGHT_ADMIN_EMAILS=\n' ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$ROOT/deploy/compose.env.example" > "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  printf 'Reusing %s; credentials and host ports will not be rewritten.\n' "$ENV_FILE"
fi

# Public values have already been validated; this file contains no service secrets.
umask 077
{
  printf 'DAYLIGHT_PUBLIC_HOST=%s\n' "$PUBLIC_HOST"
  printf 'DAYLIGHT_ACME_EMAIL=%s\n' "$ACME_EMAIL"
  printf 'DAYLIGHT_CADDY_IMAGE=%s\n' "${DAYLIGHT_CADDY_IMAGE:-caddy:2.10.2-alpine}"
  printf 'DAYLIGHT_INGRESS_SUBNET=%s\n' "$INGRESS_SUBNET"
  printf 'DAYLIGHT_CADDY_IP=%s\n' "$CADDY_IP"
} > "$PUBLIC_FILE.tmp"
mv "$PUBLIC_FILE.tmp" "$PUBLIC_FILE"
chmod 600 "$PUBLIC_FILE"

cd "$ROOT"
compose() {
  docker compose --env-file "$ENV_FILE" --env-file "$PUBLIC_FILE" -p "$PROJECT" \
    -f "$ROOT/docker-compose.yml" -f "$ROOT/deploy/public/compose.public.yml" "$@"
}
compose config --quiet
if [ "$CHECK_ONLY" = 1 ]; then
  printf 'Compose configuration valid; no containers were started. Public reachability is unverified.\n'
  exit 0
fi

printf 'Building and starting project %s with HTTPS entry...\n' "$PROJECT"
compose up -d --build --wait --wait-timeout "${DAYLIGHT_WAIT_TIMEOUT:-600}"
BASE_URL="https://$PUBLIC_HOST"
printf 'Checking public HTTPS readiness (DNS and certificate must already be usable)...\n'
if ! curl --proto '=https' --tlsv1.2 --connect-timeout 5 --max-time 20 --fail --silent --show-error \
  --output /dev/null "$BASE_URL/health/ready"; then
  printf '\nContainers have started, but public HTTPS verification failed. Do not distribute a QR code yet.\n' >&2
  printf 'Check domain DNS, TCP 80/443, Caddy certificate logs, and the steps in docs/public-access.md.\n' >&2
  exit 1
fi
printf '\nHTTPS readiness returned HTTP 200: %s\n' "$BASE_URL/health/ready"
printf 'Check the guest page from a phone using mobile data before distributing its QR code.\n'
printf 'Guest campus browsing does not require SMTP. Create an administrator to maintain the catalog.\n'
printf 'Enable system SMTP only when opening self-service registration/password recovery; see docs/public-access.md.\n'
