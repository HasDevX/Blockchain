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

git clone https://github.com/HasDevX/Blockchain.git explorertoken

cd explorertoken- Redis 7+- PostgreSQL 15+

nvm use

npm ci- Nginx (for reverse proxying on the VPS)- Redis 7+

```

- systemd (or compatible init) on the VPS- Optional: `pnpm` or `docker` if you prefer containers for backing services

## 2. Configure environment variables



Copy the backend sample env file and adjust values for your environment:

## 1. Clone and install dependencies## 1. Clone and install

```bash

cp backend/.env.example backend/.env

```

```bash```bash

Key variables:

git clone https://github.com/HasDevX/Blockchain.git explorertokengit clone git@github.com:your-org/explorer-token.git

- `PORT`: Backend listen port (default `4000`)

- `DATABASE_URL`: Postgres connection string (e.g. `postgresql://explorer:change-me@localhost:5432/explorer`)cd explorertokencd explorer-token

- `REDIS_URL`: Redis connection string. Leave blank to fall back to in-memory rate limiting.

- `FRONTEND_URL`: Comma-separated list of allowed browser origins (e.g. `http://localhost:5173`).nvm usenvm use



## 3. Provision Postgres and Redis locallynpm cinpm install



```bash```createdb explorer

# PostgreSQL

createdb explorerpsql -c "create user explorer with encrypted password 'change-me';"

psql -c "create user explorer with encrypted password 'change-me';"

psql -c "grant all privileges on database explorer to explorer;"## 2. Configure environment variablespsql -c "grant all privileges on database explorer to explorer;"



# Redis (development)

redis-server --port 6379

```Copy the backend sample env file and adjust values for your environment:# Redis



## 4. Run database migrationsredis-server --port 6379



```bash```bash```

npm run migrate --workspace backend

```cp backend/.env.example backend/.env## 1. Clone and install dependencies



The SQL migrations create admin user tables, chain metadata, and housekeeping checkpoints.``````bash



## 5. Start development serversgit clone https://github.com/HasDevX/Blockchain.git explorertoken



Use separate terminals (or the bundled VS Code tasks):Key variables:cd explorertoken



```bashnvm use

npm run dev --workspace backend

npm run dev --workspace frontend- `PORT`: Backend listen port (default `4000`)npm ci

```

- `DATABASE_URL`: Postgres connection string (e.g. `postgresql://explorer:change-me@localhost:5432/explorer`)```

The Vite dev server proxies API requests to `http://localhost:4000`.

- `REDIS_URL`: Redis connection string. Leave blank to fall back to in-memory rate limiting.Update `backend/.env` based on `.env.example`:

## 6. Quality gates before committing

- `FRONTEND_URL`: Comma-separated list of allowed browser origins (e.g. `http://localhost:5173`).

```bash

npm run lint```bash

npm run typecheck

npm test --workspace backend## 3. Provision Postgres and Redis locallycp backend/.env.example backend/.env

npm run build

``````



## 7. Deploying to a VPS```bash



1. Copy `ops/nginx/explorertoken.conf` to `/etc/nginx/sites-available/`, update `server_name`, `root`, and any proxy IP allow-lists. Symlink into `sites-enabled` and reload Nginx.# PostgreSQLAdjust connection strings or API keys as needed.

2. Copy `ops/systemd/explorertoken-backend.service` to `/etc/systemd/system/`, adjust `WorkingDirectory`/`ExecStart` if needed, then run:

   ```bashcreatedb explorer## 2. Configure environment variables

   sudo systemctl daemon-reload

   sudo systemctl enable explorertoken-backendpsql -c "create user explorer with encrypted password 'change-me';"Copy the backend sample env file and adjust values for your environment:

   sudo systemctl start explorertoken-backend

   ```psql -c "grant all privileges on database explorer to explorer;"```bash

3. Place environment variables in `/etc/explorertoken/backend.env` (sample values are in `docs/deployment.md`).

4. Use `ops/scripts/deploy.sh` for repeatable deployments after updating the repository path and remote/branch if necessary.cp backend/.env.example backend/.env



## 8. Acceptance checks# Redis (development)```



Run the following from the VPS:redis-server --port 6379Key variables:



```bash```- `PORT`: Backend listen port (default `4000`)

curl -I http://127.0.0.1/

curl -I http://127.0.0.1/api/chains- `DATABASE_URL`: Postgres connection string (e.g. `postgresql://explorer:change-me@localhost:5432/explorer`)

curl -I http://127.0.0.1/api/admin/settings

curl -sS http://127.0.0.1:4000/health## 4. Run database migrations- `REDIS_URL`: Redis connection string. Leave blank to fall back to in-memory rate limiting.

```

- `FRONTEND_URL`: Comma-separated list of allowed browser origins (e.g. `http://localhost:5173`).

Expected results:

```bash## 3. Database migrations

- `/` returns `200` (served by Nginx)

- `/api/chains` returns `200`npm run migrate --workspace backend

- `/api/admin/settings` returns `401` when unauthenticated and `403` for non-admin tokens

- `/health` returns JSON `{ ok: true, version: <git sha>, uptime: <seconds>, services: {...} }```````bash

- After Redis is configured, bursting `POST /api/auth/login` should eventually return `429`

npm run migrate --workspace backend

## 9. Troubleshooting

The SQL migrations create admin user tables, chain metadata, and housekeeping checkpoints.## 3. Provision Postgres and Redis locally

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
