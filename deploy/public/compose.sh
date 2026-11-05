#!/usr/bin/env sh
# Consistent Compose wrapper for the retained public project after up.sh has run.
# DAYLIGHT_ENV_FILE=/opt/daylight/compose.env DAYLIGHT_PROJECT=daylight \
#   sh deploy/public/compose.sh ps
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
ENV_FILE=${DAYLIGHT_ENV_FILE:-$ROOT/deploy/compose.env}
PROJECT=${DAYLIGHT_PROJECT:-daylight}
[ -f "$ENV_FILE" ] && [ -f "$ENV_FILE.public" ] || {
  printf '%s\n' 'Run deploy/public/up.sh first, or set DAYLIGHT_ENV_FILE to the existing configuration.' >&2
  exit 1
}
case "$ENV_FILE" in /*) ;; *) ENV_FILE="$PWD/$ENV_FILE" ;; esac
cd "$ROOT"
exec docker compose --env-file "$ENV_FILE" --env-file "$ENV_FILE.public" -p "$PROJECT" \
  -f "$ROOT/docker-compose.yml" -f "$ROOT/deploy/public/compose.public.yml" "$@"
