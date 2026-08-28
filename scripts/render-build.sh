#!/usr/bin/env bash
set -euo pipefail

echo "==> PrintX Render build"
echo "Node: $(node -v)"
echo "NPM: $(npm -v)"
echo "PWD: $(pwd)"

npm ci

echo "==> Building frontend with Vite"
npm run build

if [ ! -f dist/index.html ]; then
  echo "ERROR: dist/index.html missing after build"
  exit 1
fi

echo "==> Build complete"
