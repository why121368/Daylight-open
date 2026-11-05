#!/bin/sh
set -eu

# Optional language assets can be bundled by a deployment image. Each role's
# writable cache is populated before Node starts; existing cached files win.
if [ -d /app/ocr-data ]; then
  cache_dir="${DAYLIGHT_DATA_DIR:-/tmp/daylight-data}/cache/ocr"
  mkdir -p "$cache_dir"
  for language in eng chi_sim; do
    source_file="/app/ocr-data/$language.traineddata"
    target_file="$cache_dir/$language.traineddata"
    if [ -s "$source_file" ] && [ ! -s "$target_file" ]; then
      cp "$source_file" "$target_file"
    fi
  done
fi

exec /usr/local/bin/docker-entrypoint.sh "$@"
