# ExplorerToken

ExplorerToken is a production-oriented, multi-chain token explorer inspired by Polygonscan. It ships as a full-stack TypeScript monorepo with a hardened Express API, a React + Vite frontend, and operational blueprints for running behind Nginx, Redis, and PostgreSQL.

## Highlights

- **End-to-end TypeScript** – shared typings drive the Express API, React frontend, and SWR data hooks.
- **Security baked in** – Helmet CSP, strict CORS, Redis-backed rate limiting with in-memory fallback, and disabled Cronos chain (id 25) per requirements.
- **Ops ready** – Nginx/site config, `systemd` unit, deployment script, runbook, and acceptance testing guide included under `docs/` and `ops/`.

## Repository layout

| Path        | Purpose                                                       |
| ----------- | ------------------------------------------------------------- |
| `backend/`  | Express API, Redis limiter, Postgres migrations, vendor stubs |
| `frontend/` | React 18 + Vite client, Tailwind UI, SWR data hooks           |
| `ops/`      | Nginx vhost, `systemd` service, deployment script             |
| `docs/`     | Setup, deployment playbook, runbook, acceptance checklist     |
| `.github/`  | CI workflow (lint, typecheck, build)                          |
| `.vscode/`  | Remote-friendly tasks for dev servers and migrations          |

## Quick start

1. Install Node.js 20 (`nvm use`) and dependencies:
   ```bash
   npm install
   ```
2. Copy and adjust backend environment variables:
   ```bash
   cp backend/.env.example backend/.env
   ```
3. Apply migrations:
   ```bash
   npm run migrate --workspace backend
   ```
4. Launch dev servers in separate terminals (or via VS Code tasks):
   ```bash
   npm run dev --workspace backend
   npm run dev --workspace frontend
   ```

Detailed instructions live in [`docs/setup.md`](docs/setup.md).

## Key npm scripts

Run from the repository root unless stated otherwise:

| Script                                | Description                                      |
| ------------------------------------- | ------------------------------------------------ |
| `npm run lint`                        | ESLint across frontend and backend               |
| `npm run typecheck`                   | TypeScript `--noEmit` for both workspaces        |
| `npm run build`                       | Builds frontend (Vite) and backend (tsc)         |
| `npm run dev --workspace backend`     | Nodemon-style backend watcher via `ts-node-dev`  |
| `npm run dev --workspace frontend`    | Vite dev server with proxy to backend            |
| `npm run migrate --workspace backend` | Applies SQL migrations from `backend/migrations` |
| `npm test --workspace backend`        | Runs backend API tests with Vitest + Supertest   |

## Operations & deployment

- Provisioning, Nginx, and `systemd` instructions: [`docs/deployment.md`](docs/deployment.md)
- Operational runbook (restart, rollback, Redis actions): [`docs/runbook.md`](docs/runbook.md)
- Server assets ready to copy:
  - [`ops/nginx/explorertoken.conf`](ops/nginx/explorertoken.conf)
  - [`ops/systemd/explorertoken-backend.service`](ops/systemd/explorertoken-backend.service)
	- [`ops/systemd/explorertoken-chain@.service`](ops/systemd/explorertoken-chain@.service)
  - [`ops/scripts/deploy.sh`](ops/scripts/deploy.sh)

When deploying on a Linux host, refresh dependencies and rebuild before bouncing the `systemd` units:

```bash
cd /srv/explorertoken/backend
npm ci
npm run build
sudo systemctl restart explorertoken-backend
sudo systemctl restart "explorertoken-chain@*"
```

Pair the host with Cloudflare (WAF+TLS termination) and managed Postgres/Redis as outlined in the deployment guide.

### Per-chain poller services

Each chain poller runs under a templated unit defined in
[`ops/systemd/explorertoken-chain@.service`](ops/systemd/explorertoken-chain@.service).
Enable the required chains (Polygon, Ethereum mainnet, Arbitrum) with:

```bash
sudo systemctl enable --now explorertoken-chain@137
sudo systemctl enable --now explorertoken-chain@1
sudo systemctl enable --now explorertoken-chain@42161
```

Tail logs for a specific chain to confirm block ingestion:

```bash
sudo journalctl -u explorertoken-chain@137 -f
sudo journalctl -u explorertoken-chain@1 -f
sudo journalctl -u explorertoken-chain@42161 -f
```

Health checks surface from the backend service; curl them locally or through your load balancer:

```bash
curl -fsS http://localhost:4000/health | jq
curl -fsS https://explorertoken.yourdomain.com/health | jq
```

## Frontend snapshot

- Dashboard with chain pill filter (Cronos disabled), health status cards, quick search module, and placeholder “Top tokens” table.
- Token detail page featuring overview stats plus cursor-based holder pagination with reset/back/next controls.
- Admin console protected by token auth middleware and rate-limited endpoints.

## Backend snapshot

- `/health` exposes build metadata for uptime checks.
- `/api/chains`, `/api/tokens/:chainId/:address`, `/api/tokens/:chainId/:address/holders` supply the frontend via SWR.
- Middleware stack: Helmet CSP, strict CORS, JSON body parsing, rate limiting (Redis store with memory fallback), structured error handling.
- Migration runner seeds schema for admin users, chain settings, and job checkpoints.

## Database schema

```mermaid
erDiagram
	blocks ||--o{ transactions : contains
	transactions ||--o{ receipts : produces
	transactions ||--o{ logs : emits
	logs ||--o{ token_transfers : decodes

	blocks {
		int chain_id PK
		bigint number PK
		bytea hash UNIQUE
		bytea parent_hash
		timestamptz timestamp
	}

	transactions {
		int chain_id PK
		bytea hash PK
		bigint block_number FK
		bytea from
		bytea to
		numeric value
		numeric nonce
		numeric gas
		numeric gas_price
		bytea input
	}

	receipts {
		int chain_id PK
		bytea tx_hash PK FK
		boolean status
		numeric gas_used
		numeric effective_gas_price
		bytea contract_address
	}

	logs {
		int chain_id PK
		bytea tx_hash PK FK
		int log_index PK
		bytea address
		bytea topic0
		bytea topic1
		bytea topic2
		bytea topic3
		bytea data
	}

	token_transfers {
		int chain_id PK
		bytea tx_hash PK FK
		int log_index PK FK
		bytea token
		bytea from
		bytea to
		numeric value
	}
```

## Documentation & acceptance

- Local setup: [`docs/setup.md`](docs/setup.md)
- Deployment playbook: [`docs/deployment.md`](docs/deployment.md)
- Ops runbook: [`docs/runbook.md`](docs/runbook.md)
- Release acceptance checklist: [`docs/acceptance.md`](docs/acceptance.md)

See [`docs/acceptance.md`](docs/acceptance.md) for the sign-off steps covering automated checks, manual walkthroughs, and production smoke tests.

## Tooling & environment

- `.nvmrc` pins Node 20.11.1; GitHub Actions mirrors this version.
- ESLint + Prettier share a consistent code style across the repo.
- `.vscode/tasks.json` exposes Remote-SSH friendly tasks for dev servers and migrations.

## Contributing

1. Run the quality gates (`lint`, `typecheck`, `build`, backend tests`).
2. Ensure Cronos chain stays disabled in sample data.
3. Submit PRs against `main`; CI will validate automatically.
