#!/usr/bin/env bash
# Rebuild and restart production. Run from anywhere: /opt/music-app/deploy/deploy.sh
# Checks and the build run before the restart, so a broken build never takes the site down.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing dependencies"
npm install --no-audit --no-fund

echo "==> Type-checking and linting"
npx tsc --noEmit
npx eslint src

echo "==> Building"
NODE_ENV=production npm run build

echo "==> Restarting"
systemctl restart music-app

for i in $(seq 1 30); do
  if curl -fsS -o /dev/null http://localhost:3000/login; then
    echo "==> Up and serving (commit $(git rev-parse --short HEAD))"
    exit 0
  fi
  sleep 1
done
echo "!! Service didn't come up — check: journalctl -u music-app -n 50" >&2
exit 1
