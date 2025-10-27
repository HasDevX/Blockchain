# ExplorerToken runbook

Reference playbook for keeping the ExplorerToken stack healthy in production. Commands assume the app lives in `/var/www/haswork.dev` and systemd/nginx run on the same host.

---

## Deploy

```bash
cd /var/www/haswork.dev
sudo -u explorertoken git pull origin main
sudo -u explorertoken npm ci
sudo -u explorertoken npm run build
sudo systemctl restart explorertoken-backend
sudo nginx -t && sudo systemctl reload nginx
```

> Tip: migrations are part of the backend build step. If a manual rerun is needed, execute `sudo -u explorertoken npm run migrate --workspace backend`.

---

## Restart

Restart only what you need:

```bash
sudo systemctl restart explorertoken-backend      # Node API
sudo systemctl reload nginx                       # picks up config/asset changes
```

Verify status after restart:

```bash
sudo systemctl status explorertoken-backend --no-pager
sudo journalctl -u explorertoken-backend -n 40 --no-pager
```

---

## Backup & retention

Daily database backups are controlled by `/etc/cron.d/explorertoken-backups` (see `docs/BACKUPS.md`). Dumps land in `/var/backups/explorertoken` as `YYYYMMDD_explorertoken.dump.gz` and the retention prune runs at 04:15, keeping the most recent 14 files. Validate the job:

```bash
sudo -u explorertoken ls -lh /var/backups/explorertoken | tail
sudo -u explorertoken pg_restore --list /var/backups/explorertoken/$(date +"%Y%m%d")_explorertoken.dump.gz | head
```

Escalate to infra if the directory is empty for more than 24 hours.

---

## Restore procedure

1. Notify stakeholders and enable maintenance mode (`npm run admin:maintenance --workspace backend` once implemented).
2. Copy the desired dump to `/tmp/restore.dump.gz` and decompress:

   ```bash
   sudo -u explorertoken cp /var/backups/explorertoken/20251018_explorertoken.dump.gz /tmp/restore.dump.gz
   sudo -u explorertoken gunzip -f /tmp/restore.dump.gz
   ```

3. Restore into the primary database:

   ```bash
   sudo -u explorertoken pg_restore \
     --clean --if-exists \
     --dbname=explorertoken_db \
     /tmp/restore.dump
   ```

4. Restart the backend service (`sudo systemctl restart explorertoken-backend`).
5. Run health checks (`curl -sS http://127.0.0.1:4000/health`) and a smoke test via `/api/auth/login`.
6. Disable maintenance mode and send the post-mortem summary.

Record the restore in the ops log, including dump name and verification steps. Monthly restores must also verify the cold storage snapshot according to compliance policy.

---

## Logs

- Tail structured backend logs:

   ```bash
   sudo journalctl -u explorertoken-backend -f
   ```

- Inspect Nginx access & error logs:

   ```bash
   sudo tail -n 200 /var/log/nginx/access.log
   sudo tail -n 200 /var/log/nginx/error.log
   ```

Archive logs with `journalctl -u explorertoken-backend --since "2025-01-01" --until now > backend.log` when handing over to engineering.

---

## Rate-limit smoke test

Confirm Redis-backed limiter is active by bursting login requests against the backend service port (bypass CDN caching):

```bash
for i in $(seq 1 8); do
   curl -sf -X POST http://127.0.0.1:4000/api/auth/login \
      -H 'Content-Type: application/json' \
      -d '{"email":"ops@example.com","password":"invalid"}' \
      -o /dev/null -w "#%{http_code}\n"

```

Expected result: first few attempts return `401`, the sixth or seventh returns `429`. If every response is `401`, inspect Redis connectivity (`redis-cli -u redis://127.0.0.1:6379 ping`).

---

## Curl checks

Run these from the host (adjust domain if fronted by CDN/LB):

```bash
curl -I http://127.0.0.1/                      # static frontend alive
curl -I http://127.0.0.1/api/chains           # chain catalogue
curl -I http://127.0.0.1/api/admin/settings   # should be 401 without token
curl -sS http://127.0.0.1:4000/health         # backend health direct
curl -sS http://127.0.0.1/api/health          # nginx proxy path
```

Health responses must resemble:

```json
{ "ok": true, "version": "abc1234", "uptime": 12345 }
```

Investigate immediately if:

- `/api/chains` stops returning the 9 supported networks + Cronos (unsupported)
- `/api/health` diverges from the direct backend health response
- Any curl emits 5xx responses or stalls >2s

---

Keep this runbook synced with production changes. For deeper incidents (database, migrations, infrastructure) escalate to the on-call backend engineer.
