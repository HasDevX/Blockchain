# Database backups & hardening

This guide covers the backup scheme for the ExplorerToken PostgreSQL database and gives a light-weight example of pairing those backups with automated retention and a `fail2ban` jail for the API host.

---

## Postgres backup cadence

We schedule logical dumps with `pg_dump` so that every environment has portable `.sql.gz` artifacts. Backups run under the `explorertoken` system user and land in `/var/backups/explorertoken`.

### Cron job (daily full dump)

Ship the helper script that wraps `pg_dump` and pruning logic:

```bash
sudo install -m 750 ops/scripts/nightly-backup.sh /usr/local/bin/explorertoken-nightly-backup
```

> The script relies on `.pgpass` for authentication (see below). Override the defaults with environment variables if the database host, port, or name differs.

Create `/etc/cron.d/explorertoken-backups`:

```
# m h dom mon dow user         command
30 2 * * * explorertoken PGDATABASE=explorertoken_db PGUSER=explorertoken /usr/local/bin/explorertoken-nightly-backup
```

Key points:

- Run after 02:00 local time to stay clear of traffic peaks.
- The wrapper script emits `.dump.gz` files named `YYYYMMDD_HHMMSS_<database>.dump.gz` in `/var/backups/explorertoken`.
- Adjust the schedule or prepend `BACKUP_DIR=/mnt/backups`, `PGHOST=...`, `RETENTION_DAYS=30`, etc., as needed.

### Retention policy

Retention is handled inside the helper script (default 14 days via `RETENTION_DAYS`). To change the window, either export a different value in the cron entry or edit the script.

For monthly “golden” snapshots, run the dump job on the first day of the month and copy the artifact to cold storage (S3/Glacier).

### Permissions & verification

- Restrict the backup directory to `750` so only the service user and backup group can read it.
- Store the database password in `/var/lib/explorertoken/.pgpass` with `600` permissions to avoid exposing credentials in process listings. Example entry:

  ```
  127.0.0.1:5432:explorertoken_db:explorertoken:super-secret-password
  ```

- Use `pg_restore --list` on a random dump each week to confirm it can be read.

---

## Optional: fail2ban jail for the API host

Rate limiting protects `/api/auth/login`, but pairing it with `fail2ban` blocks persistent attackers at the network layer.

### Jail configuration

1. Create `/etc/fail2ban/jail.d/explorertoken-api.conf`:

   ```ini
   [explorertoken-api]
   enabled  = true
   filter   = explorertoken-api
   port     = 443,80
   logpath  = /var/log/nginx/access.log
   maxretry = 10
   findtime = 600
   bantime  = 3600
   action   = iptables-allports
   ```

2. Add a simple filter at `/etc/fail2ban/filter.d/explorertoken-api.conf` to match repeated `429` or `401` responses from the login endpoint:

   ```ini
   [Definition]
   failregex = ^<HOST> - - .*"POST /api/auth/login HTTP/1\.." (401|429)
   ignoreregex =
   ```

Reload fail2ban and confirm with `fail2ban-client status explorertoken-api`. Tune the `maxretry` threshold to align with customer support expectations.

---

## Restore checklist

1. Copy the desired dump back to the host and decompress it.
2. Put the application into maintenance mode.
3. Run `pg_restore --clean --if-exists --dbname=explorertoken_db <dumpfile>`.
4. Exit maintenance mode after health checks pass.

Document successful restores in the ops diary so the rotation stays validated.
