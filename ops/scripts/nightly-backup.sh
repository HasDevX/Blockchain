#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/var/backups/explorertoken}
RETENTION_DAYS=${RETENTION_DAYS:-14}
PGDATABASE=${PGDATABASE:-explorertoken_db}
PGUSER=${PGUSER:-explorertoken}
PGHOST=${PGHOST:-127.0.0.1}
PGPORT=${PGPORT:-5432}

mkdir -p "$BACKUP_DIR"

STAMP="$(date +"%Y%m%d_%H%M%S")"
DUMP_PATH="$BACKUP_DIR/${STAMP}_${PGDATABASE}.dump"
ARCHIVE_PATH="${DUMP_PATH}.gz"

log() {
  if command -v logger >/dev/null 2>&1; then
    logger --tag explorertoken-backup "$1"
  fi
  echo "[$(date --iso-8601=seconds)] $1"
}

log "Starting pg_dump for ${PGDATABASE}"

pg_dump \
  --format=custom \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  --dbname="$PGDATABASE" \
  --file="$DUMP_PATH"

log "Compressing dump ${DUMP_PATH}"

gzip -f "$DUMP_PATH"

log "Dump written to ${ARCHIVE_PATH}"

if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  log "Pruning backups older than ${RETENTION_DAYS} days"
  mapfile -t _old_backups < <(find "$BACKUP_DIR" -name "*_${PGDATABASE}.dump.gz" -type f -mtime "+${RETENTION_DAYS}" -print)
  for file in "${_old_backups[@]}"; do
    log "Pruning $file"
    rm -f "$file"
  done
else
  log "Skipping prune due to non-numeric RETENTION_DAYS=${RETENTION_DAYS}"
fi

log "Backup workflow complete"
