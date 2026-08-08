# 09 — Restore runbook

How to put the database back. Written from a restore that was actually performed, not from
the manual — every command below was run end to end on 8 August 2026 and the verification
section is the output it produced.

**A backup that has never been restored is not a backup.** Re-run the drill in
[Practising it](#practising-it) whenever the schema changes shape, and at least twice a year.

---

## What is backed up

`scripts/backup.sh`, from cron at 03:00 UTC:

```cron
0 3 * * *  DATABASE_URL="..." BACKUP_REMOTE="..." /srv/tapatshop/scripts/backup.sh >> /var/log/tapatshop-backup.log 2>&1
```

It writes `tapatshop-<timestamp>.sql.gz` to `BACKUP_DIR`, copies it to `BACKUP_REMOTE` with
rclone, and prunes local copies older than `RETAIN_DAYS` (30).

The dump uses `--single-transaction`, so it is a consistent snapshot and does not lock out
checkouts while it runs. It includes routines, triggers and events, which mysqldump omits by
default — finding that out mid-restore is finding out too late.

**What it does not cover:** product images. Those live in S3-compatible storage and are backed
up by that bucket's own versioning, not here.

---

## Restoring

### 1. Stop the app

Do this first. An app writing into a half-restored database produces damage that the restore
was supposed to undo.

```bash
systemctl stop tapatshop
```

### 2. Get the dump

```bash
rclone copy "$BACKUP_REMOTE/tapatshop-20260808T002716Z.sql.gz" /tmp/
gzip -t /tmp/tapatshop-*.sql.gz          # refuse to go further if this fails
```

### 3. Restore into an empty database

Restore beside the existing one rather than over it. If the restore turns out to be bad, the
damaged original is still there — and a damaged original is worth more than nothing.

```bash
mysql -u root -e "CREATE DATABASE tapatshop_restored CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
gzip -dc /tmp/tapatshop-20260808T002716Z.sql.gz | mysql -u tapat -p tapatshop_restored
```

### 4. Verify before cutting over

Four checks, in increasing order of how much they prove. Do not skip to the last one.

**a. The tables arrived.**

```bash
mysql -u tapat -p -N -B -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='tapatshop_restored';"
# 35 at the time of writing
```

**b. The content matches, not just the row counts.** `CHECKSUM TABLE` hashes the rows, so a
value mangled in transit fails here where a count would pass.

```bash
TABLES=$(mysql -u tapat -p -N -B -e \
  "SELECT table_name FROM information_schema.tables
   WHERE table_schema='tapatshop_restored' AND table_type='BASE TABLE' ORDER BY table_name;" | paste -sd, -)

mysql -u tapat -p -N -B tapatshop          -e "CHECKSUM TABLE $TABLES" | sort > /tmp/before.txt
mysql -u tapat -p -N -B tapatshop_restored -e "CHECKSUM TABLE $TABLES" | sort > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt        # silence is the pass
```

Comparing against the live database only works when it is still readable. After a real loss
there is nothing to compare to — which is why the drill below runs this while both exist.

**c. The invariants hold.** This is the first check that knows what the data *means*: it
rebuilds every variant's stock from the movement ledger and compares — invariant I4.

```bash
DATABASE_URL="mysql://tapat:...@localhost:3306/tapatshop_restored" pnpm db:reconcile
# Checked 21 variants against the ledger.
# No drift. stockQty matches sum(movements.delta) everywhere — invariant I4 holds.
```

**d. The application accepts the schema.**

```bash
DATABASE_URL="mysql://tapat:...@localhost:3306/tapatshop_restored" \
  pnpm --filter @tapatshop/db exec prisma migrate status
# Database schema is up to date!
```

A restore that lands an older schema than the deployed code reports a pending migration here.
Apply it with `pnpm db:deploy` **before** starting the app, never after.

### 5. Cut over

```bash
mysql -u root -e "RENAME TABLE ..."       # or repoint DATABASE_URL at tapatshop_restored
systemctl start tapatshop
curl -fsS localhost:3000/api/v1/health/ready | jq
# {"status":"ready","checks":{"mysql":{"ok":true,...},"redis":{"ok":true,...}}}
```

Use `/health/ready`, not `/health`. The latter answers "is the process up" and returns 200
against a database that is completely unreachable — which is exactly how an outage went
unnoticed once already.

### 6. Say what was lost

Backups run nightly, so a restore loses up to 24 hours of orders. Before announcing recovery,
work out which order numbers fall in the gap:

```sql
SELECT MAX(orderNo) FROM orders;      -- last order in the restored data
```

Anything after that was taken and is now absent. Those customers were charged by PayMongo and
have no order — reconcile against the PayMongo dashboard and refund or re-key by hand. This
step is the actual cost of a restore and it is not optional.

---

## Practising it

The drill that produced this document, reproducible on any machine with MySQL installed and
no access to production data:

```bash
# Two throwaway servers: one to back up, one standing in for the clean machine.
mysqld --initialize-insecure --datadir=/tmp/my-src
mysqld --initialize-insecure --datadir=/tmp/my-restore
mysqld --datadir=/tmp/my-src     --port=3307 &
mysqld --datadir=/tmp/my-restore --port=3308 &

# Fill the source, back it up, restore it onto the other one, then run the four checks above.
DATABASE_URL="mysql://tapat:password@127.0.0.1:3307/tapatshop" pnpm db:deploy
DATABASE_URL="mysql://tapat:password@127.0.0.1:3307/tapatshop" pnpm db:seed
DATABASE_URL="mysql://tapat:password@127.0.0.1:3307/tapatshop" ./scripts/backup.sh
```

Last performed: **8 August 2026** — 35 tables, all checksums matched, I4 held, schema current.
