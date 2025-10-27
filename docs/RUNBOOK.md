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
sudo systemctl restart explorertoken-holders-indexer  # Holders RPC indexer
sudo systemctl reload nginx                       # picks up config/asset changes
```

Verify status after restart:

```bash
sudo systemctl status explorertoken-backend --no-pager
sudo journalctl -u explorertoken-backend -n 40 --no-pager
```

---

## Token holders indexer

The holders indexer walks ERC-20 transfers in small batches per token/chain. A lightweight scheduler now triggers a single pass across all tracked tokens, waits `HOLDERS_INDEXER_STEP_MS` between productive batches, and slows down to `HOLDERS_INDEXER_IDLE_MS` when everything is caught up.

### Add or reindex a token

1. Authenticate as an admin (same credentials as the dashboard).
2. Call the reindex endpoint; provide the chain ID, token address, and the block you want to start from. Example:

    ```bash
    curl -X POST https://explorertoken.haswork.dev/api/admin/reindex \
       -H "Content-Type: application/json" \
       -u admin@example.com:changeme \
       -d '{
          "chainId": 1,
          "token": "0x0000000000000000000000000000000000000000",
          "fromBlock": "18000000"
       }'
    ```

    A `202` response means the token is queued. The scheduler will pick it up on the next tick and process `HOLDERS_INDEXER_CHUNK` blocks at a time until the cursor advances past `latestBlock`.

### Tune batch size & cadence

- `HOLDERS_INDEXER_CHUNK` – number of blocks fetched per batch (defaults to 5,000). Lower it if RPCs time out or rate-limit; raise gently for faster catch-up.
- `HOLDERS_INDEXER_STEP_MS` – delay (ms) before the scheduler immediately retries after doing work. Set to ~500–1000 ms to keep backfills moving without hammering RPCs.
- `HOLDERS_INDEXER_IDLE_MS` – delay (ms) when no work was found. Increase to reduce idle polling on quiet networks.
- `HOLDERS_INDEXER_ONCE=true` runs a single pass (useful for smoke tests or cron-driven jobs).

Apply changes by updating `/etc/systemd/system/explorertoken-holders-indexer.service` environment overrides or the `.env` file, then reload the unit:

```bash
sudo systemctl restart explorertoken-holders-indexer
```

### Monitor progress

- Tail the dedicated service:

   ```bash
   sudo journalctl -u explorertoken-holders-indexer -f
   ```

- Each batch emits two structured lines:
   - `{"event":"holders.indexer.progress", ...}` – includes chain, token, block range, and transfer count.
   - `metric holders_batch chain_id=... token=... from_block=... to_block=... transfers=...` – ready for Prometheus-style log scraping.
- Rate-limit and error events show up as `holders.indexer.rate_limit` and `holders.indexer.error`. Investigate spikes by checking RPC quotas and network health.
- A graceful shutdown logs `{"event":"holders.indexer.stop","reason":"sigterm"}`. Anything else suggests the process crashed—review `journalctl` and restart.

---

## Cloudflare & TLS

Daily checks when the stack is fronted by Cloudflare:

1. **DNS + proxying**: Confirm the `A` (and `AAAA` if IPv6 is enabled) record for `explorertoken.haswork.dev` points at the origin server and is proxied (orange cloud).
2. **SSL/TLS mode**: Under Cloudflare ▸ SSL/TLS ▸ Overview, set the mode to **Full**. Avoid "Flexible"—it downgrades traffic to HTTP between Cloudflare and the origin.
3. **Edge certificates**: In SSL/TLS ▸ Edge Certificates, keep **Always Use HTTPS** and **Automatic HTTPS Rewrites** enabled. Verify HTTP traffic is redirected:

   ```bash
   curl -I http://explorertoken.haswork.dev | head -n 1
   ```

   Expected: `HTTP/1.1 301 Moved Permanently` to the `https://` URL.

4. **HTTP/2 + HTTP/3**: Enable both toggles under Network ▸ HTTP/2 and HTTP/3 (QUIC).
5. **WAF rules**: In Security ▸ WAF ▸ Custom rules, apply the baseline protections for `/api/*`:
   - Rule 1: Allow only `GET`, `POST`, and `OPTIONS` to `/api/*`; block other methods.
   - Rule 2: Rate-limit bursts (example threshold 1,000 requests per 5 minutes per IP) with "Managed Challenge" to complement backend rate limiters.
   - Enable the Cloudflare Managed Ruleset with the **API Shield** templates.
6. **TLS health check**: From the origin host, confirm the certificate chain with:

   ```bash
   openssl s_client -connect explorertoken.haswork.dev:443 -servername explorertoken.haswork.dev -quiet <<<"QUIT"
   ```

   Ensure the certificate issuer matches the Cloudflare edge cert, expiry >14 days, and protocol reports TLS 1.2+.

Escalate to the infra team if any toggle drifts or the HTTPS redirect stops working.

---

## Backup & retention

Nightly database backups are orchestrated by `/etc/cron.d/explorertoken-backups`, which calls `/usr/local/bin/explorertoken-nightly-backup` (see `docs/BACKUPS.md`). Dumps land in `/var/backups/explorertoken` as `YYYYMMDD_HHMMSS_explorertoken_db.dump.gz`, and the script prunes anything older than 14 days by default. Validate the job:

```bash
sudo -u explorertoken ls -lh /var/backups/explorertoken | tail
LATEST=$(sudo -u explorertoken ls -1t /var/backups/explorertoken/*_explorertoken_db.dump.gz | head -n1)
sudo -u explorertoken pg_restore --list "$LATEST" | head
```

Escalate to infra if the directory is empty for more than 24 hours.

---

## Restore procedure

1. Notify stakeholders and enable maintenance mode (`npm run admin:maintenance --workspace backend` once implemented).
2. Copy the desired dump to `/tmp/restore.dump.gz` and decompress:

   ```bash
   sudo -u explorertoken cp /var/backups/explorertoken/20251018_021500_explorertoken_db.dump.gz /tmp/restore.dump.gz
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
