# ExplorerToken Setup Guide

> **Chains note:** The public explorer (`/api/chains`) lists 10 known chains. The Admin defaults select 9 APIV2-supported chains; Cronos (25) is visible but unsupported.

## Prerequisites

- Node.js 20.11.1 (see `.nvmrc`) and npm 10+
- PostgreSQL 15 or newer
- Redis 7 or newer
- Git, curl, and build tools (`build-essential` on Ubuntu)
- Nginx and `systemd` (for production deployments)

## Local development

1. **Clone and install**
   ```bash
   git clone https://github.com/HasDevX/Blockchain.git
   cd Blockchain
   npm install
   ```
2. **Configure environment**
   ```bash
   cp backend/.env.example backend/.env
   ```
   Edit `backend/.env` to set database credentials, JWT secret, and admin login values for your local stack.
3. **Run database migrations**
   ```bash
   npm run migrate --workspace backend
   ```
4. **Start development servers** (two terminals)
   ```bash
   npm run dev --workspace backend
   npm run dev --workspace frontend
   ```
   The frontend runs on <http://localhost:5173> and proxies API calls to <http://localhost:4000>.
5. **Quality gates before committing**
   ```bash
   npm run lint
   npm run typecheck
   npm test --workspace backend
   npm run build
   ```

## Single-host deployment (Ubuntu 22.04 LTS)

1. **Prepare the host**
   ```bash
   sudo apt update && sudo apt upgrade -y
   sudo apt install -y build-essential curl git nginx postgresql redis-server
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   sudo timedatectl set-timezone UTC
   sudo ufw allow OpenSSH
   sudo ufw allow 'Nginx Full'
   sudo ufw --force enable
   ```
2. **Create application user and directories**
   ```bash
   sudo useradd --system --home /var/www/explorertoken --shell /usr/sbin/nologin explorertoken || true
   sudo mkdir -p /var/www/explorertoken
   sudo chown -R explorertoken:explorertoken /var/www/explorertoken
   ```
3. **Fetch code and install dependencies**
   ```bash
   cd /var/www/explorertoken
   sudo -u explorertoken git clone https://github.com/HasDevX/Blockchain.git .
   sudo -u explorertoken npm ci
   sudo -u explorertoken npm run build
   ```
4. **Provision PostgreSQL**
   ```bash
   sudo -u postgres psql <<'SQL'
   CREATE USER explorertoken WITH ENCRYPTED PASSWORD 'change-me';
   CREATE DATABASE explorertoken OWNER explorertoken;
   GRANT ALL PRIVILEGES ON DATABASE explorertoken TO explorertoken;
   SQL
   ```
   Connection string to reuse:
   ```
   postgresql://explorertoken:change-me@127.0.0.1:5432/explorertoken
   ```
5. **Secure Redis (localhost only)**
   ```bash
   sudo sed -i "s/^#\?bind .*/bind 127.0.0.1/" /etc/redis/redis.conf
   sudo sed -i "s/^protected-mode no/protected-mode yes/" /etc/redis/redis.conf
   sudo systemctl restart redis-server
   ```
6. **Set backend environment variables and migrate**
   ```bash
   sudo mkdir -p /etc/explorertoken
   sudo tee /etc/explorertoken/backend.env >/dev/null <<'ENV'
   NODE_ENV=production
   PORT=4000
   DATABASE_URL=postgresql://explorertoken:change-me@127.0.0.1:5432/explorertoken
   REDIS_URL=redis://127.0.0.1:6379
   FRONTEND_URL=https://explorertoken.yourdomain.com
   JWT_SECRET=replace-me
   ADMIN_EMAIL=admin@haswork.dev
   ADMIN_PASSWORD=replace-me
   ENV
   sudo chown explorertoken:explorertoken /etc/explorertoken/backend.env
   sudo chmod 640 /etc/explorertoken/backend.env
   ```
   ```bash
   sudo -u explorertoken cp backend/.env.example backend/.env
   sudo -u explorertoken sed -i "s|DATABASE_URL=.*|DATABASE_URL=postgresql://explorertoken:change-me@127.0.0.1:5432/explorertoken|" backend/.env
   sudo -u explorertoken sed -i "s|REDIS_URL=.*|REDIS_URL=redis://127.0.0.1:6379|" backend/.env
   sudo -u explorertoken sed -i "s|FRONTEND_URL=.*|FRONTEND_URL=https://explorertoken.yourdomain.com|" backend/.env
   sudo -u explorertoken npm run migrate --workspace backend
   ```
7. **Configure Nginx**
   ```bash
   sudo cp ops/nginx/explorertoken.conf /etc/nginx/sites-available/explorertoken.conf
   sudo ln -sf /etc/nginx/sites-available/explorertoken.conf /etc/nginx/sites-enabled/explorertoken.conf
   sudo nginx -t && sudo systemctl reload nginx
   ```
8. **Enable systemd services**
   ```bash
   sudo cp ops/systemd/explorertoken-backend.service /etc/systemd/system/
   sudo cp ops/systemd/explorertoken-holders-indexer.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable explorertoken-backend
   sudo systemctl restart explorertoken-backend
   ```
   Start required chain pollers:
   ```bash
   sudo systemctl enable --now explorertoken-chain@137
   sudo systemctl enable --now explorertoken-chain@1
   sudo systemctl enable --now explorertoken-chain@42161
   ```
   Enable the holders indexer:
   ```bash
   sudo systemctl enable --now explorertoken-holders-indexer
   sudo systemctl status explorertoken-holders-indexer --no-pager
   ```

## Acceptance checks

Run these after deployment (adjust hostnames if fronted by a load balancer):

```bash
curl -I https://explorertoken.yourdomain.com/
curl -I https://explorertoken.yourdomain.com/api/chains
curl -I https://explorertoken.yourdomain.com/api/admin/settings
curl -sS https://explorertoken.yourdomain.com/health | jq
```

Expected results:

- `/` → `200 OK` served by Nginx with the built frontend
- `/api/chains` → `200 OK` JSON list of ten chains
- `/api/admin/settings` → `401 Unauthorized` when unauthenticated (or `403 Forbidden` for non-admin tokens)
- `/health` → JSON `{ ok: true, version: <7-12 char git sha>, uptime: <seconds> }`
- After rapid repeated `POST /api/auth/login` attempts, the sixth request returns `429 Too Many Requests` when Redis is connected

## Troubleshooting

- **Backend service down** – Check `sudo systemctl status explorertoken-backend` and `journalctl -u explorertoken-backend -f` for build or environment errors.
- **CORS failures** – Confirm `FRONTEND_URL` matches the exact origin(s) serving the frontend; use comma separation for multiple origins.
- **Redis fallback warnings** – Ensure `redis-server` is running locally and credentials match `REDIS_URL`.
- **Database migrations missing** – Rerun `npm run migrate --workspace backend` after adjusting credentials or restoring backups.
- **Stale frontend assets** – Run `npm run build` after pulling new commits, then reload Nginx.
