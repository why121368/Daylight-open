#!/usr/bin/env sh
# Restore only into a NEW Compose project. Existing projects are always refused.
# Default: restore and verify data only. --activate additionally starts application roles.
set -eu
umask 077
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ACTIVATE=0
if [ "${1:-}" = --activate ]; then ACTIVATE=1; shift; fi
[ "$#" -eq 1 ] || { echo 'Usage: DAYLIGHT_PROJECT=new-project DAYLIGHT_ENV_FILE=/secure/restore.env sh deploy/restore.sh [--activate] BACKUP_DIR' >&2; exit 1; }
[ -n "${DAYLIGHT_PROJECT:-}" ] && [ "$DAYLIGHT_PROJECT" != daylight ] || { echo 'Set a new DAYLIGHT_PROJECT; the default retained project is refused.' >&2; exit 1; }
printf '%s' "$DAYLIGHT_PROJECT" | grep -Eq '^[a-z0-9][a-z0-9_-]*$' || { echo 'Invalid Compose project.' >&2; exit 1; }
for tool in docker sha256sum; do command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }; done
compose() { sh "$ROOT/deploy/stack.sh" "$@"; }
BACKUP=$(CDPATH= cd -- "$1" && pwd)
FORMAT=$(cat "$BACKUP/COMPLETE")
case "$FORMAT" in daylight-compose-backup-v1) FILE_COUNT=4;; daylight-compose-backup-v2) FILE_COUNT=5;; *) echo 'Backup is incomplete or unsupported.' >&2; exit 1;; esac
[ "$(wc -l < "$BACKUP/SHA256SUMS" | tr -d ' ')" = "$FILE_COUNT" ] || { echo 'Unexpected checksum manifest.' >&2; exit 1; }
awk -v version="$FORMAT" '{sub(/\r$/, ""); name=$2; sub(/^\*/, "", name); if (NF != 2 || $1 !~ /^[a-f0-9]+$/ || length($1) != 64 || (name !~ /^(database.dump|minio-data.tar|images.txt|metadata.txt)$/ && !(version == "daylight-compose-backup-v2" && name == "recovery-manifest.json")) || seen[name]++) bad=1} END {exit bad}' "$BACKUP/SHA256SUMS" \
  || { echo 'Invalid checksum entries.' >&2; exit 1; }
(cd "$BACKUP" && sha256sum --check SHA256SUMS)
CONTAINERS=$(docker ps -aq --filter "label=com.docker.compose.project=$DAYLIGHT_PROJECT")
VOLUMES=$(docker volume ls -q --filter "label=com.docker.compose.project=$DAYLIGHT_PROJECT")
[ -z "$CONTAINERS" ] && [ -z "$VOLUMES" ] || { echo 'Restore target already has containers or volumes. Choose another new project; nothing was overwritten.' >&2; exit 1; }
# The cold object-store format must match the backed-up MinIO image.
SOURCE_MINIO=$(awk 'index($0,"minio_image=")==1 {sub(/\r$/, ""); print substr($0,13)}' "$BACKUP/metadata.txt")
TARGET_IMAGES=$(compose config --images)
[ -n "$SOURCE_MINIO" ] && printf '%s\n' "$TARGET_IMAGES" | grep -Fxq -- "$SOURCE_MINIO" || { echo 'Use the same MinIO image as the backup before restoring its volume format.' >&2; exit 1; }
compose up -d --wait --wait-timeout 180 postgres
# MinIO has no service dependencies. Compose create has no --no-deps option.
compose create minio
MINIO_ID=$(compose ps -aq minio)
[ -n "$MINIO_ID" ] || { echo 'Could not create restore object storage.' >&2; exit 1; }
docker cp - "$MINIO_ID:/data" < "$BACKUP/minio-data.tar"
compose exec -T postgres pg_restore --exit-on-error --no-owner --no-acl -U daylight -d daylight < "$BACKUP/database.dump"
compose up -d --wait --wait-timeout 180 minio
if [ "$FORMAT" = daylight-compose-backup-v2 ]; then
  # Only the inventory program runs. Worker/Scheduler and application boot remain stopped.
  compose run -T --rm --no-deps --entrypoint node api scripts/recovery-manifest.mjs verify < "$BACKUP/recovery-manifest.json"
fi
if [ "$ACTIVATE" -eq 1 ]; then compose up -d --wait --wait-timeout 600; fi
compose ps -a
if [ "$ACTIVATE" -eq 1 ]; then
  echo 'Data restored and application roles started in the new project.'
else
  echo 'Data restored in the new project; API, Worker and Scheduler remain stopped.'
  echo 'After recovery review, start the new project with: sh deploy/stack.sh up -d --wait'
fi
