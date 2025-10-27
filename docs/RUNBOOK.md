# ExplorerToken runbook

This document captures the quick responses for common operational scenarios.

## Restarting services

```bash
sudo systemctl restart explorertoken-backend
sudo systemctl reload nginx
```

Verify status:

```bash
sudo systemctl status explorertoken-backend --no-pager
journalctl -u explorertoken-backend -f
```

## Deploying a new build

Run the shipping script from the host:

```bash
sudo /srv/explorertoken/ops/scripts/deploy.sh origin main
```

## Database migrations

```bash
npm run migrate --workspace backend
```

If a migration needs to be re-run, adjust the migration table `schema_migrations` accordingly.

## Clearing Redis-backed rate limits

```bash
redis-cli -u "$REDIS_URL" KEYS "rl:*" | xargs redis-cli -u "$REDIS_URL" DEL
```

The backend automatically falls back to an in-memory limiter with warning logs when Redis is unavailable.

## Rotating the admin API token

1. Update the token validation logic in `backend/src/middleware/auth.ts` (replace `admin-dev-token`).
2. Redeploy the backend.
3. Invalidate old sessions by clearing tokens in the frontend storage.

## Investigating elevated error rates

1. Check the health endpoint: `curl https://explorer.yourdomain.com/health`.
2. Inspect backend logs for stack traces (`journalctl -u explorertoken-backend`).
3. Validate upstream dependencies:
   - PostgreSQL connectivity (`psql $DATABASE_URL -c 'select 1;'`)
   - Redis availability (`redis-cli -u $REDIS_URL ping`)
4. Ensure Cloudflare / load balancer health checks are green.

## Emergency rollback

1. `git checkout` the last known good tag in `/srv/explorertoken`.
2. Re-run the deploy script.
3. If database migrations introduced the regression, restore from the most recent snapshot.
