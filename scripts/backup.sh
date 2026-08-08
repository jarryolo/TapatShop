#!/usr/bin/env bash
#
# Nightly database backup — P5-05.
#
# Runs from cron on the app server, writes a compressed dump locally, copies it off the box,
# and prunes old ones. See docs/09-runbook-restore.md for how to put one back.
#
#   0 3 * * *  /srv/tapatshop/scripts/backup.sh >> /var/log/tapatshop-backup.log 2>&1
#
# A backup that has never been restored is not a backup. The restore is a documented,
# performed procedure, not an assumption — that is why the build plan bolds it.

set -euo pipefail

# ─────────────────────────────  configuration  ─────────────────────────────

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tapatshop}"
# Off-server target: an rclone remote (S3, B2, Drive). Empty means local only, which is not a
# backup — a disk that dies takes the database and its backups together.
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"

# ─────────────────────────────  parse DATABASE_URL  ─────────────────────────────
#
# mysql://user:pass@host:port/database. Parsed here rather than duplicated as four more env
# vars, so there is one place credentials live and it is the same one the app reads.

proto_removed="${DATABASE_URL#*://}"
credentials="${proto_removed%%@*}"
location="${proto_removed#*@}"

DB_USER="${credentials%%:*}"
DB_PASS="${credentials#*:}"
host_port="${location%%/*}"
DB_HOST="${host_port%%:*}"
DB_PORT="${host_port#*:}"
[ "$DB_PORT" = "$DB_HOST" ] && DB_PORT=3306
DB_NAME="${location#*/}"
DB_NAME="${DB_NAME%%\?*}"

# Percent-decode, since a password with a @ or / in it has to be encoded in the URL.
DB_PASS="$(printf '%b' "${DB_PASS//%/\\x}")"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
outfile="${BACKUP_DIR}/tapatshop-${stamp}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] ${stamp} — dumping ${DB_NAME} from ${DB_HOST}:${DB_PORT}"

# ─────────────────────────────  dump  ─────────────────────────────
#
# The flags are the point of this script; each one is here for a reason:
#
#   --single-transaction  a consistent snapshot without locking the whole database. Without it
#                         a nightly backup either blocks checkouts or captures a torn state
#                         where an order exists and its items do not.
#   --routines --triggers --events
#                         schema-only objects mysqldump otherwise silently omits. Discovering
#                         that during a restore is discovering it too late.
#   --hex-blob            binary columns survive the round trip through a text file.
#   --set-gtid-purged=OFF the dump carries no replication identity. Left on, restoring into a
#                         fresh server fails outright or poisons its GTID state.
#   --no-tablespaces      avoids needing the PROCESS privilege, so the backup user does not
#                         have to be near-root.
#   --column-statistics=0 is deliberately NOT set: it is a MySQL 8 client flag against older
#                         servers, and this dumps 8.x.
#
# MYSQL_PWD rather than -p: the password would otherwise be visible in `ps` to every user on
# the box for the whole duration of the dump.

MYSQL_PWD="$DB_PASS" mysqldump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --user="$DB_USER" \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --hex-blob \
  --set-gtid-purged=OFF \
  --no-tablespaces \
  --default-character-set=utf8mb4 \
  "$DB_NAME" \
  | gzip -9 > "$outfile"

# ─────────────────────────────  prove it is not empty  ─────────────────────────────
#
# gzip writing a valid empty archive is exactly how a backup silently becomes nothing: a
# failed dump still produces a file, and the cron job still exits 0.

if ! gzip -t "$outfile" 2>/dev/null; then
  echo "[backup] FAILED — ${outfile} is not a valid gzip" >&2
  rm -f "$outfile"
  exit 1
fi

tables="$(gzip -dc "$outfile" | grep -c '^CREATE TABLE' || true)"
size="$(wc -c < "$outfile")"

if [ "$tables" -lt 10 ]; then
  echo "[backup] FAILED — only ${tables} tables in the dump, expected the full schema" >&2
  rm -f "$outfile"
  exit 1
fi

echo "[backup] wrote ${outfile} (${size} bytes, ${tables} tables)"

# ─────────────────────────────  off the server  ─────────────────────────────

if [ -n "$BACKUP_REMOTE" ]; then
  echo "[backup] copying to ${BACKUP_REMOTE}"
  rclone copy "$outfile" "$BACKUP_REMOTE" --no-traverse
  echo "[backup] copied"
else
  echo "[backup] WARNING: BACKUP_REMOTE is unset — this copy exists only on this server," >&2
  echo "[backup]          which means it dies with the disk it is protecting." >&2
fi

# ─────────────────────────────  prune  ─────────────────────────────
#
# Local only. Remote retention belongs to the remote's own lifecycle policy, where a
# compromised app server cannot reach it — an attacker who can delete the backups is most of
# the way to a ransom.

find "$BACKUP_DIR" -name 'tapatshop-*.sql.gz' -mtime "+${RETAIN_DAYS}" -delete
echo "[backup] done"
