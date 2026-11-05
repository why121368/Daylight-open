#!/usr/bin/env sh
# Consistent single-node backup: pause writers, dump PG and copy stopped MinIO data.
# Usage: DAYLIGHT_ENV_FILE=/secure/compose.env DAYLIGHT_PROJECT=daylight sh deploy/backup.sh /secure/backups
set -eu
umask 077
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
[ "$#" -eq 1 ] || { echo 'Usage: sh deploy/backup.sh /secure/backups' >&2; exit 1; }
for tool in docker sha256sum mktemp; do command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }; done
compose() { sh "$ROOT/deploy/stack.sh" "$@"; }
# Check the retained Compose version before pausing any service.
UP_HELP=$(compose up --help)
for flag in --no-deps --no-recreate --wait --wait-timeout; do
  printf '%s\n' "$UP_HELP" | grep -q -- "$flag" || { echo "Compose up must support $flag before backup." >&2; exit 1; }
done
mkdir -p -- "$1"
PARENT=$(CDPATH= cd -- "$1" && pwd)
DIRECTORY=$(mktemp -d "$PARENT/daylight-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
RUNNING=$(compose ps --status running --services)
printf '%s\n' "$RUNNING" | grep -qx postgres || { echo 'PostgreSQL must be running.' >&2; exit 1; }
printf '%s\n' "$RUNNING" | grep -qx minio || { echo 'MinIO must be running.' >&2; exit 1; }
WRITERS=
for role in api scheduler worker; do
  if printf '%s\n' "$RUNNING" | grep -qx "$role"; then WRITERS="$WRITERS $role"; fi
done
finish() {
  code=$1
  trap - 0 1 2 15
  # The list contains only fixed service names selected above. Start never recreates volumes.
  if ! compose up -d --no-deps --no-recreate --wait --wait-timeout 180 minio; then echo 'Failed to resume object storage; inspect the retained stack.' >&2; code=1; fi
  if [ -n "$WRITERS" ] && ! compose up -d --no-deps --no-recreate --wait --wait-timeout 180 $WRITERS; then echo 'Failed to resume application roles; inspect the retained stack.' >&2; code=1; fi
  if [ "$code" -eq 0 ]; then echo "Backup complete: $DIRECTORY"; else echo "Backup failed; incomplete files retained at $DIRECTORY" >&2; fi
  exit "$code"
}
trap 'finish $?' 0
trap 'exit 130' 1 2 15
echo 'Pausing application writers and MinIO; the site will be unavailable during the backup.'
if [ -n "$WRITERS" ]; then compose stop -t 90 $WRITERS; fi
# Let all in-flight application work finish while its object store is still available.
# This one-off command imports no application boot code and only reads PG/S3.
compose run -T --rm --no-deps --entrypoint node api scripts/recovery-manifest.mjs capture > "$DIRECTORY/recovery-manifest.json"
compose stop -t 90 minio
compose exec -T postgres pg_dump -U daylight -d daylight --format=custom --no-owner --no-acl > "$DIRECTORY/database.dump"
MINIO_ID=$(compose ps -aq minio)
[ -n "$MINIO_ID" ] || { echo 'Missing MinIO container.' >&2; exit 1; }
docker cp "$MINIO_ID:/data/." - > "$DIRECTORY/minio-data.tar"
compose config --images > "$DIRECTORY/images.txt"
{
  printf 'format=daylight-compose-backup-v2\n'
  printf 'created_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'project=%s\n' "${DAYLIGHT_PROJECT:-daylight}"
  printf 'minio_image=%s\n' "$(docker inspect "$MINIO_ID" --format '{{.Config.Image}}')"
  printf 'postgres_major=17\nobject_store=cold-minio-volume\nwriters_paused=true\n'
} > "$DIRECTORY/metadata.txt"
[ -s "$DIRECTORY/database.dump" ] && [ -s "$DIRECTORY/minio-data.tar" ] || { echo 'Empty backup payload.' >&2; exit 1; }
(cd "$DIRECTORY" && sha256sum database.dump minio-data.tar images.txt metadata.txt recovery-manifest.json > SHA256SUMS)
# This marker is written only after every payload and checksum is complete.
printf 'daylight-compose-backup-v2\n' > "$DIRECTORY/COMPLETE"
