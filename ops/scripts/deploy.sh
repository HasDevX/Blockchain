#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/srv/explorertoken"
PUBLIC_DIR="/var/www/explorertoken"
SERVICE_NAME="explorertoken-backend"
GIT_REMOTE="${1:-origin}"
GIT_BRANCH="${2:-main}"

# Ensure directories exist before continuing.
mkdir -p "$PUBLIC_DIR"

cd "$REPO_DIR"

echo "==> Fetching latest code (${GIT_REMOTE}/${GIT_BRANCH})"
git fetch "$GIT_REMOTE" "$GIT_BRANCH"
git reset --hard "${GIT_REMOTE}/${GIT_BRANCH}"

echo "==> Installing dependencies"
NODE_ENV=production npm ci

echo "==> Building workspaces"
NODE_ENV=production npm run build --workspaces

echo "==> Running database migrations"
npm run migrate --workspace backend

echo "==> Publishing frontend bundle"
rsync -av --delete frontend/dist/ "$PUBLIC_DIR/"

if command -v systemctl >/dev/null 2>&1; then
  echo "==> Restarting ${SERVICE_NAME}"
  sudo systemctl restart "$SERVICE_NAME"
  sudo systemctl status "$SERVICE_NAME" --no-pager

  echo "==> Restarting per-chain indexers"
  chain_units=$(systemctl list-units --type=service --all 'explorertoken-chain@*.service' --no-legend | awk '{print $1}' || true)

  if [[ -n "$chain_units" ]]; then
    while IFS= read -r unit; do
      [[ -z "$unit" ]] && continue
      sudo systemctl restart "$unit"
      sudo systemctl status "$unit" --no-pager
    done <<<"$chain_units"
  else
    echo "No explorertoken-chain@*.service units found; skipping."
  fi
else
  echo "systemctl not available; restart the backend process manually."
fi

echo "Deployment complete."
