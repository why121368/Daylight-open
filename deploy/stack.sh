#!/usr/bin/env sh
# Shared wrapper for a retained Compose stack. Never sources deployment env files.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${DAYLIGHT_ENV_FILE:-$ROOT/deploy/compose.env}
PROJECT=${DAYLIGHT_PROJECT:-daylight}
case "$ENV_FILE" in /*) ;; *) ENV_FILE="$PWD/$ENV_FILE" ;; esac
for OVERRIDE in "${DAYLIGHT_COMPOSE_OVERRIDE_2:-}" "${DAYLIGHT_COMPOSE_OVERRIDE:-}"; do
  [ -n "$OVERRIDE" ] || continue
  case "$OVERRIDE" in /*) ;; *) OVERRIDE="$PWD/$OVERRIDE" ;; esac
  [ -f "$OVERRIDE" ] || { echo 'Compose overrides must name existing files.' >&2; exit 1; }
  set -- -f "$OVERRIDE" "$@"
done
[ -f "$ENV_FILE" ] || { echo 'Set DAYLIGHT_ENV_FILE to an existing deployment environment file.' >&2; exit 1; }
printf '%s' "$PROJECT" | grep -Eq '^[a-z0-9][a-z0-9_-]*$' || { echo 'Invalid Compose project name.' >&2; exit 1; }
cd "$ROOT"
if [ -f "$ENV_FILE.public" ]; then
  set -- --env-file "$ENV_FILE.public" -f "$ROOT/deploy/public/compose.public.yml" "$@"
fi
exec docker compose --env-file "$ENV_FILE" -p "$PROJECT" -f "$ROOT/docker-compose.yml" "$@"
