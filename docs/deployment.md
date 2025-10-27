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

Copy the unit file and enable it:

```bash
sudo cp /srv/explorertoken/ops/systemd/explorertoken-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable explorertoken-backend.service
sudo systemctl start explorertoken-backend.service
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

Monitor logs with:

```bash
journalctl -u explorertoken-backend -f
```

## 9. Cloudflare hardening

- Enable proxying for the production DNS record.
- Lock down Nginx with an allow-list of Cloudflare IP ranges in `set_real_ip_from`.
- Configure a firewall rule to rate-limit `/api/auth/login` if desired (stacked with backend rate limiters).

## 10. Rollback plan

- Keep the previous build artefact zipped under `/srv/explorertoken/releases` (adjust deploy script if necessary).
- Roll back by checking out the prior tag/commit and rerunning the deploy script.
- If migrations are irreversible, leverage Postgres point-in-time recovery snapshots.
