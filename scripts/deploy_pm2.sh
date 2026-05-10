#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]}"
SCRIPT_DIR="${SCRIPT_PATH%/*}"
if [ "$SCRIPT_DIR" = "$SCRIPT_PATH" ]; then
  SCRIPT_DIR="."
fi

ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="${PM2_APP_NAME:-mms-dashboard-api}"
BRANCH="${DEPLOY_BRANCH:-main}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:5005/api/health}"

echo "==> Deploying MMS Dashboard"
echo "    root: $ROOT_DIR"
echo "    branch: $BRANCH"
echo "    pm2 app: $APP_NAME"

cd "$ROOT_DIR"

echo
echo "==> Update source code"
git fetch origin "$BRANCH"
git switch "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo
echo "==> Install backend dependencies"
cd "$ROOT_DIR/backend"
npm ci --omit=dev
npm run prisma:generate

echo
echo "==> Build frontend"
cd "$ROOT_DIR/fontend"
npm ci
npm run build

echo
echo "==> Restart PM2"
cd "$ROOT_DIR"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start ecosystem.config.js
fi
pm2 save

echo
echo "==> Verify health endpoint"
curl -fsS "$HEALTH_URL"
echo
echo "Deploy completed successfully."
