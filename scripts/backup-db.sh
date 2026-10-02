#!/usr/bin/env bash
# Daily Postgres backup for the docker-compose deployment.
#
#   scripts/backup-db.sh                # dump into ./backups, keep 14 days
#   BACKUP_DIR=/srv/backups KEEP_DAYS=30 scripts/backup-db.sh
#
# A backup on the same disk as the database isn't a backup: set BACKUP_COPY to a
# command that copies the file elsewhere; it gets the file path as its argument.
#   BACKUP_COPY='rclone copy --quiet "$1" remote:jobtracker'   (or scp, aws s3 cp, ...)
#
# Cron, from the repo folder, every night at 03:15:
#   15 3 * * * cd /path/to/JobOffers && scripts/backup-db.sh >> backups/backup.log 2>&1
#
# Test a restore now and then, into a scratch database:
#   docker compose exec -T db createdb -U jobtracker restore_test
#   gunzip -c backups/<file>.sql.gz | docker compose exec -T db psql -q -U jobtracker restore_test
#   docker compose exec -T db psql -U jobtracker restore_test -c 'select count(*) from job'
#   docker compose exec -T db dropdb -U jobtracker restore_test
set -euo pipefail  # pipefail: a failed pg_dump must fail the script, not just gzip

BACKUP_DIR=${BACKUP_DIR:-backups}
KEEP_DAYS=${KEEP_DAYS:-14}
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/jobtracker-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

# Written under a temporary name first, so a failed dump never looks like a good backup
docker compose exec -T db pg_dump -U jobtracker --no-owner jobtracker | gzip > "$file.part"
mv "$file.part" "$file"
echo "$(date -u +%FT%TZ) wrote $file ($(du -h "$file" | cut -f1))"

if [ -n "${BACKUP_COPY:-}" ]; then
  sh -c "$BACKUP_COPY" backup-copy "$file"
fi

find "$BACKUP_DIR" -name 'jobtracker-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
