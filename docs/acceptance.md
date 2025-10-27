# ExplorerToken acceptance checklist

Run this checklist before sign-off on a release. All commands are run from the repository root unless noted.

## 1. Automated checks

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm test --workspace backend`

## 2. Backend verification

1. Start the API (`npm run dev --workspace backend`) with Redis and Postgres available.
2. Hit `GET http://localhost:4000/health` – expect `{ "ok": true, "version": ... }`.
3. Hit `GET http://localhost:4000/api/chains` – Cronos (`id: 25`) should return `supported: false`.
4. Exercise rate limiting by performing >5 POSTs to `/api/auth/login` within a minute; expect HTTP `429`.
5. Confirm Redis absence fallback by stopping Redis – backend should still respond with in-memory limiter warnings.

## 3. Frontend walkthrough

1. Start Vite (`npm run dev --workspace frontend`) and browse to <http://localhost:5173>.
2. Ensure the top nav search works with inputs:
   - `0x0000000000000000000000000000000000001010`
   - `137:0x0000000000000000000000000000000000001010`
3. Verify the chain pill filter lists 10 chains with Cronos disabled and labelled “Unsupported”.
4. On the dashboard page, confirm system status cards show health data, the quick search module submits, and the “Top tokens” table renders.
5. Navigate to a token detail view and paginate holders forward/backward; the cursor history should allow `Prev`, `Next`, and `Reset` states without console errors.
6. Sign in via the admin page using token `admin-dev-token` in the browser dev tools (`localStorage.setItem('explorerToken', 'admin-dev-token')`) or by posting to `/api/auth/login` once implemented; confirm settings render.

## 4. Production smoke test

With the production deployment live:

1. `curl -I https://explorer.yourdomain.com/health` returns `200 OK` from Nginx.
2. Browse the frontend over HTTPS – assets must be served with CSP-compliant headers (verify in dev tools).
3. Confirm the `explorertoken-backend` systemd service is active: `systemctl status explorertoken-backend`.
4. Check logs for warnings or errors after deployment.

Sign off once every checkbox passes.
