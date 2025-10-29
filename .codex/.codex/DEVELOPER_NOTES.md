# Developer Notes (Codex)
## Build
- Backend: `npm ci && npm run build` in `/backend`.
- Frontend: `npm ci && npm run build` in `/frontend`.

## Local Routing
- FE fetch base: `/api`.
- Backend mounts admin router at `/api/admin`.

## Auth
- Login expects `{ email, password }` → returns `{ token, user }`.
- Admin routes require `Authorization: Bearer <token>`.

## DB
- `chain_configs` and `chain_endpoints` exist; `chain_endpoints` holds RPC pool (primary/fallback, qps, min_span, max_span, weight, order_index).
