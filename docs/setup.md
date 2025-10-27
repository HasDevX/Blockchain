# ExplorerToken setup guide# ExplorerToken setup guide# ExplorerToken setup guide



This doc covers local development and single-host deployment for ExplorerToken.



## PrerequisitesThis doc covers local development and single-host deployment for ExplorerToken.This document walks through local development requirements for the ExplorerToken monorepo.



- Node.js 20.11.1 (see `.nvmrc`) and npm ≥ 10

- PostgreSQL 15+

- Redis 7+## Prerequisites## Prerequisites

- Nginx (for reverse proxying on the VPS)

- systemd (or compatible init) on the VPS



## 1. Clone and install dependencies- Node.js 20.11.1 (see `.nvmrc`) and npm ≥ 10- Node.js 20.11 (see `.nvmrc`)



```bash- PostgreSQL 15+- npm 10+


# ExplorerToken server setup

The instructions below walk through provisioning a single Ubuntu VPS for ExplorerToken. They assume Ubuntu 22.04 LTS, systemd, and Nginx. Adapt usernames, domains, or paths if your environment differs.

---

## 1. Bootstrap the host

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential curl git nginx postgresql redis-server

# Install Node.js 20 (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

sudo timedatectl set-timezone UTC
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

Create the deployment user and root directory:

```bash
sudo useradd --system --home /var/www/haswork.dev --shell /usr/sbin/nologin explorertoken || true
sudo mkdir -p /var/www/haswork.dev
sudo chown -R explorertoken:explorertoken /var/www/haswork.dev
```

---

## 2. Fetch the code and build

```bash
cd /var/www/haswork.dev
sudo -u explorertoken git clone https://github.com/HasDevX/Blockchain.git .
sudo -u explorertoken npm ci
sudo -u explorertoken npm run build
```

The build script compiles the backend into `backend/dist` and produces the frontend under `frontend/dist`, which Nginx serves.

---

## 3. Provision PostgreSQL

```bash
sudo -u postgres psql <<'SQL'
CREATE USER explorertoken WITH ENCRYPTED PASSWORD 'change-me';
CREATE DATABASE explorertoken OWNER explorertoken;
GRANT ALL PRIVILEGES ON DATABASE explorertoken TO explorertoken;
SQL
```

Connection string for later use:

```
postgresql://explorertoken:change-me@127.0.0.1:5432/explorertoken
```

---

## 4. Secure Redis

Keep Redis bound to localhost and restart it:

```bash
sudo sed -i "s/^#\?bind .*/bind 127.0.0.1/" /etc/redis/redis.conf
sudo sed -i "s/^protected-mode no/protected-mode yes/" /etc/redis/redis.conf
sudo systemctl restart redis-server
```

---

## 5. Configure backend environment

```bash
sudo mkdir -p /etc/explorertoken
sudo tee /etc/explorertoken/backend.env >/dev/null <<'ENV'
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://explorertoken:change-me@127.0.0.1:5432/explorertoken
REDIS_URL=redis://127.0.0.1:6379
FRONTEND_URL=https://haswork.dev
GIT_SHA=
ENV
sudo chown explorertoken:explorertoken /etc/explorertoken/backend.env
sudo chmod 640 /etc/explorertoken/backend.env

sudo -u explorertoken cp backend/.env.example backend/.env
sudo -u explorertoken sed -i "s|DATABASE_URL=.*|DATABASE_URL=postgresql://explorertoken:change-me@127.0.0.1:5432/explorertoken|" backend/.env
sudo -u explorertoken sed -i "s|REDIS_URL=.*|REDIS_URL=redis://127.0.0.1:6379|" backend/.env
sudo -u explorertoken sed -i "s|FRONTEND_URL=.*|FRONTEND_URL=https://haswork.dev|" backend/.env

sudo -u explorertoken npm run migrate --workspace backend
```

---

## 6. Install Nginx virtual host

```bash
sudo cp ops/nginx/explorertoken.conf /etc/nginx/sites-available/haswork.dev
sudo ln -sf /etc/nginx/sites-available/haswork.dev /etc/nginx/sites-enabled/haswork.dev
sudo nginx -t && sudo systemctl reload nginx
```

The supplied config serves the frontend from `/var/www/haswork.dev/frontend/dist` and proxies `/api` + `/health` to the backend on port 4000.

---

## 7. Enable the backend service

```bash
sudo cp ops/systemd/explorertoken-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable explorertoken-backend
sudo systemctl restart explorertoken-backend
```

Verify status and logs:

```bash
sudo systemctl status explorertoken-backend --no-pager
sudo journalctl -u explorertoken-backend -f
```

---

## 8. Acceptance checks

Run these from the VPS (adjust hostnames if fronted by a load balancer):

```bash
curl -I http://127.0.0.1/
curl -I http://127.0.0.1/api/chains
curl -I http://127.0.0.1/api/admin/settings
curl -sS http://127.0.0.1:4000/health
```

Expected responses:

- `/` → `200 OK` from Nginx
- `/api/chains` → `200 OK` JSON listing ten chains
- `/api/admin/settings` → `401 Unauthorized` (or `403 Forbidden` for non-admin tokens)
- `/health` → JSON `{ ok: true, version: <7-12 char git sha>, uptime: <seconds> }`
- With Redis connected, the sixth rapid `POST /api/auth/login` should return `429 Too Many Requests`

---

## 9. Troubleshooting

- **Backend won’t start:** check `journalctl -u explorertoken-backend` and confirm `npm run build` was executed after the latest pull.
- **CORS complaints:** ensure `FRONTEND_URL` in `/etc/explorertoken/backend.env` matches the production origin (comma-separated to allow multiple).
- **Redis fallback warning:** if logs mention `redis fallback limiter`, verify `redis-server` is running, reachable on 127.0.0.1, and credentials are correct.
- **Missing assets:** rerun `npm run build` to regenerate `frontend/dist`.

Future deployments can reuse this host by running `git pull`, `npm ci`, `npm run build`, and restarting the service.
- **CORS errors**: verify `FRONTEND_URL` matches the origin you load the frontend from.

- **Redis warnings**: the backend logs `memory_fallback` if Redis is unavailable; check service reachability and credentials.```bash

- **Auth token rotation**: update `backend/src/middleware/auth.ts` with a new bearer token for production access.

## 5. Start development servers# PostgreSQL

createdb explorer

Use separate terminals (or the bundled VS Code tasks):psql -c "create user explorer with encrypted password 'change-me';"

psql -c "grant all privileges on database explorer to explorer;"

```bash

npm run dev --workspace backend# Redis (development)

npm run dev --workspace frontendredis-server --port 6379

``````



The Vite dev server proxies API requests to `http://localhost:4000`.The migration runner will create tables for admin users, chain configuration, and housekeeping checkpoints.



## 6. Quality gates before committing## 4. Development servers



```bashRun the backend and frontend in parallel terminals (or use the VS Code tasks provided under `.vscode/tasks.json`).

npm run lint## 5. Start development servers

npm run typecheckUse separate terminals (or the bundled VS Code tasks):

npm test --workspace backend```bash

npm run buildnpm run dev --workspace backend

```npm run dev --workspace frontend

```

## 7. Deploying to a VPS```bash

npm run dev --workspace backend

1. Copy `ops/nginx/explorertoken.conf` to `/etc/nginx/sites-available/`, update `server_name`, `root`, and any proxy IP allow-lists. Symlink into `sites-enabled` and reload Nginx.npm run dev --workspace frontend

2. Copy `ops/systemd/explorertoken-backend.service` to `/etc/systemd/system/`, adjust `WorkingDirectory`/`ExecStart` if needed, then run:```

   ```bash

   sudo systemctl daemon-reloadThe Vite dev server runs on <http://localhost:5173>, proxying API calls to the Express backend.

   sudo systemctl enable explorertoken-backend

   sudo systemctl start explorertoken-backend## 5. Quality gates

   ```## 6. Quality gates before committing

3. Place environment variables in `/etc/explorertoken/backend.env` (sample values are in `docs/deployment.md`).```bash

4. Use `ops/scripts/deploy.sh` for repeatable deployments after updating the repository path and remote/branch if necessary.npm run lint

npm run typecheck

## 8. Acceptance checksnpm test --workspace backend

npm run build

Run the following from the VPS:```

Before pushing changes, run the configured npm scripts from the repository root:

```bash## 9. Troubleshooting

curl -I http://127.0.0.1/- **CORS errors**: verify `FRONTEND_URL` matches the origin you load the frontend from.

curl -I http://127.0.0.1/api/chains- **Redis warnings**: the backend logs `memory_fallback` if Redis is unavailable; check service reachability and credentials.

curl -I http://127.0.0.1/api/admin/settings- **Auth token rotation**: update `backend/src/middleware/auth.ts` with a new bearer token for production access.

curl -sS http://127.0.0.1:4000/healthnpm run typecheck

```npm run build

npm test --workspace backend

Expected results:```



- `/` returns `200` (served by Nginx)(Frontend tests are not yet scaffolded; backend tests rely on `vitest` and `supertest`.)

- `/api/chains` returns `200`

- `/api/admin/settings` returns `401` when unauthenticated and `403` for non-admin tokens## 6. Troubleshooting tips

- `/health` returns JSON `{ ok: true, version: <git sha>, uptime: <seconds>, services: {...} }`

- After Redis is configured, bursting `POST /api/auth/login` should eventually return `429`- **CORS errors**: make sure `FRONTEND_URL` in the backend `.env` matches the origin you are using.

- **Redis unavailable**: the rate limiter falls back to an in-memory store automatically; warnings appear in the backend logs.

## 9. Troubleshooting- **Etherscan data**: seed `ETHERSCAN_API_KEY` to enable live metadata; otherwise the vendor stub returns placeholder data.


- **CORS errors**: verify `FRONTEND_URL` matches the origin you load the frontend from.
- **Redis warnings**: the backend logs `memory_fallback` if Redis is unavailable; check service reachability and credentials.
- **Auth token rotation**: update `backend/src/middleware/auth.ts` with a new bearer token for production access.
