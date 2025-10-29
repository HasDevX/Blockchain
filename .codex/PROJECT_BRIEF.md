# ExplorerToken — Project Brief (Codex)
Self-hosted, low-cost EVM token explorer for ~10 chains. Admin Dashboard manages RPC pools, throttling, (re)index jobs, and worker status.

## Stack & Conventions
- Backend: Node/Express (TypeScript), port 4000. `npm ci && npm run build`.
- Frontend: React + Vite + Tailwind. `npm ci && npm run build`.
- DB/Cache: Postgres + Redis.
- Workers: per-chain pollers (`explorertoken-chain@<chainId>`) hot-reload config ~30s.
- Nginx proxies `/api` → `127.0.0.1:4000` (no trailing slash).
- **FE must use relative `/api`** (never hardcode domain). Attach `Authorization: Bearer <token>` for `/api/admin/*`.

## Infra notes
- VPS IP: 159.198.70.88. Domain `haswork.dev` is just an A record to serve FE; API stays at `127.0.0.1:4000`.
- Systemd services (VPS): `explorertoken-backend`, `explorertoken-chain@<id>`.

## Working Agreement (for Codex)
- Small PRs, green TS/ESLint, keep build passing.
- Provide acceptance notes + simple curls for each change.
- Avoid changing infra; don’t commit secrets.
