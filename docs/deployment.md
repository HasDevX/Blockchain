# ExplorerToken deployment playbook

This guide documents a reference production deployment for ExplorerToken.

## Target topology

- **CDN/WAF**: Cloudflare (recommended) terminates TLS, caches static assets, and shields the origin.
- **Reverse proxy**: Nginx on the application host, serving the built frontend and proxying API calls.
- **Application host**: Ubuntu 22.04 LTS box running the Node.js backend under `systemd` with PM2-free supervision.
- **Data services**: Managed PostgreSQL and Redis (e.g., Azure Flexible Server, AWS RDS + Elasticache) or self-hosted equivalents.

## 1. Provision the host

1. Install Node.js 20 and npm 10.
2. Install Nginx (`apt install nginx`).
3. Create a dedicated system user:
   ```bash
   sudo adduser --system --group --home /srv/explorertoken explorer
   ```
4. Ensure PostgreSQL and Redis connection strings are reachable from the host.

## 2. Checkout the code

```bash
sudo mkdir -p /srv/explorertoken
sudo chown explorer:explorer /srv/explorertoken
sudo -u explorer git clone git@github.com:your-org/explorer-token.git /srv/explorertoken
```

## 3. Environment configuration

Create an environment file consumed by `systemd`:

```bash
sudo mkdir -p /etc/explorertoken
sudo tee /etc/explorertoken/backend.env <<'EOF'
PORT=4000
NODE_ENV=production
DATABASE_URL=postgresql://explorer:change-me@db-host:5432/explorer
REDIS_URL=redis://cache-host:6379
FRONTEND_URL=https://explorer.yourdomain.com
ETHERSCAN_API_KEY=
# Public RPC defaults – replace with private endpoints in production
RPC_1=https://cloudflare-eth.com
RPC_10=https://mainnet.optimism.io
RPC_56=https://bsc-dataseed.binance.org
RPC_137=https://polygon-rpc.com
RPC_42161=https://arb1.arbitrum.io/rpc
RPC_43114=https://api.avax.network/ext/bc/C/rpc
RPC_8453=https://mainnet.base.org
RPC_324=https://mainnet.era.zksync.io
RPC_5000=https://rpc.mantle.xyz
EOF
```

## 4. Install dependencies

```bash
sudo -u explorer bash -lc 'cd /srv/explorertoken && npm ci'
```

## 5. Build artifacts and run migrations

```bash
sudo -u explorer bash -lc 'cd /srv/explorertoken && npm run build --workspaces'
sudo -u explorer bash -lc 'cd /srv/explorertoken && npm run migrate --workspace backend'
```

## 6. Configure systemd

Copy the unit files and enable them:

```bash
sudo cp /srv/explorertoken/ops/systemd/explorertoken-backend.service /etc/systemd/system/
sudo cp /srv/explorertoken/ops/systemd/explorertoken-holders-indexer.service /etc/systemd/system/
sudo cp /srv/explorertoken/ops/systemd/explorertoken-chain@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable explorertoken-backend.service
sudo systemctl start explorertoken-backend.service
sudo systemctl enable explorertoken-holders-indexer.service
sudo systemctl start explorertoken-holders-indexer.service
```

Instantiate the chain poller once per supported network. The unit template injects the chain ID from the instance suffix, so add one unit per chain you want to track (replace the sample IDs with your shortlist):

```bash
sudo systemctl enable --now explorertoken-chain@1.service
sudo systemctl enable --now explorertoken-chain@10.service
sudo systemctl enable --now explorertoken-chain@137.service
```

## 7. Configure Nginx

1. Copy the provided config:
   ```bash
   sudo cp /srv/explorertoken/ops/nginx/explorertoken.conf /etc/nginx/sites-available/
   sudo ln -s /etc/nginx/sites-available/explorertoken.conf /etc/nginx/sites-enabled/
   ```
2. Replace `explorertoken.yourdomain.com` with your real hostname and point `root` to the directory containing the built frontend (default `/var/www/explorertoken`).
3. Test and reload:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

If TLS is terminated on Nginx instead of Cloudflare, add the `listen 443 ssl` stanza with certificates.

## 8. Deployments

Use the shipping script to redeploy quickly after merging into `main`:

```bash
sudo chmod +x /srv/explorertoken/ops/scripts/deploy.sh
sudo /srv/explorertoken/ops/scripts/deploy.sh origin main
```

The script performs:

1. `git fetch --all && git reset --hard` to the target ref
2. `npm ci`
3. `npm run build --workspaces`
4. `npm run migrate --workspace backend`
5. `rsync` of `frontend/dist` into `/var/www/explorertoken`
6. `systemctl restart explorertoken-backend`
7. `systemctl restart explorertoken-chain@*.service` for each active chain instance

Monitor logs with:

```bash
journalctl -u explorertoken-backend -f
```

## 9. Cloudflare hardening

1. **DNS**: Create `A` (and `AAAA` if IPv6 is available) records for the production hostname pointing at the origin. Keep the proxy toggle orange so Cloudflare sits in front of the server.
2. **SSL/TLS ▸ Overview**: Set the mode to **Full**. This keeps end-to-end HTTPS without requiring origin certificates Cloudflare can validate.
3. **SSL/TLS ▸ Edge Certificates**: Enable **Always Use HTTPS** and **Automatic HTTPS Rewrites**. Verify with `curl -I http://<host>` that a `301` upgrade is returned.
4. **Network**: Toggle **HTTP/2** and **HTTP/3 (QUIC)** on to maximize client performance.
5. **Security ▸ WAF**:
   - Enable the Cloudflare Managed Ruleset.
   - Add a custom rule that blocks HTTP methods other than `GET`, `POST`, or `OPTIONS` on `/api/*`.
   - Add a rate limit rule (e.g. 1,000 requests per 5 minutes per IP) targeting `/api/*` that issues a Managed Challenge.
6. **Firewall ▸ Tools**: Import the Cloudflare IP ranges into Nginx via `set_real_ip_from` and drop other inbound traffic at the origin security group if available.

Document the applied rule IDs in the ops diary so future audits can confirm they remain enabled after configuration changes.

## 10. Nightly backups

Install the helper script and cron job for logical dumps:

```bash
sudo install -m 750 ops/scripts/nightly-backup.sh /usr/local/bin/explorertoken-nightly-backup
echo '30 2 * * * explorertoken /usr/local/bin/explorertoken-nightly-backup' | sudo tee /etc/cron.d/explorertoken-backups
```

Ensure `/var/backups/explorertoken` is owned by `explorertoken` and that `/var/lib/explorertoken/.pgpass` stores the credentials (`chmod 600`). Adjust environment variables (`PGHOST`, `PGPORT`, `RETENTION_DAYS`, etc.) in the cron file if your topology differs. Refer to `docs/BACKUPS.md` for verification and restore drills.

## 11. Rollback plan

- Keep the previous build artefact zipped under `/srv/explorertoken/releases` (adjust deploy script if necessary).
- Roll back by checking out the prior tag/commit and rerunning the deploy script.
- If migrations are irreversible, leverage Postgres point-in-time recovery snapshots.
