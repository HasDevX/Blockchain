# ExplorerToken setup guide

This document walks through local development requirements for the ExplorerToken monorepo.

## Prerequisites

- Node.js 20.11 (see `.nvmrc`)
- npm 10+
- PostgreSQL 15+
- Redis 7+
- Optional: `pnpm` or `docker` if you prefer containers for backing services

## 1. Clone and install

```bash
git clone git@github.com:your-org/explorer-token.git
cd explorer-token
nvm use
npm install
```

## 2. Bootstrap backing services

```bash
# Postgres
createdb explorer
psql -c "create user explorer with encrypted password 'change-me';"
psql -c "grant all privileges on database explorer to explorer;"

# Redis
redis-server --port 6379
```

Update `backend/.env` based on `.env.example`:

```bash
cp backend/.env.example backend/.env
```

Adjust connection strings or API keys as needed.

## 3. Database migrations

```bash
npm run migrate --workspace backend
```

The migration runner will create tables for admin users, chain configuration, and housekeeping checkpoints.

## 4. Development servers

Run the backend and frontend in parallel terminals (or use the VS Code tasks provided under `.vscode/tasks.json`).

```bash
npm run dev --workspace backend
npm run dev --workspace frontend
```

The Vite dev server runs on <http://localhost:5173>, proxying API calls to the Express backend.

## 5. Quality gates

Before pushing changes, run the configured npm scripts from the repository root:

```bash
npm run lint
npm run typecheck
npm run build
npm test --workspace backend
```

(Frontend tests are not yet scaffolded; backend tests rely on `vitest` and `supertest`.)

## 6. Troubleshooting tips

- **CORS errors**: make sure `FRONTEND_URL` in the backend `.env` matches the origin you are using.
- **Redis unavailable**: the rate limiter falls back to an in-memory store automatically; warnings appear in the backend logs.
- **Etherscan data**: seed `ETHERSCAN_API_KEY` to enable live metadata; otherwise the vendor stub returns placeholder data.
