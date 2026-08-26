#!/usr/bin/env bash
set -euo pipefail

echo "==> PrintX Render build"
echo "Node: $(node -v)"
echo "NPM: $(npm -v)"
echo "PWD: $(pwd)"

npm ci

if [ -f dist/index.html ]; then
  echo "==> dist/index.html found — skipping Vite build"
else
  echo "==> Building frontend with Vite"
  npm run build
fi

if [ ! -f dist/index.html ]; then
  echo "ERROR: dist/index.html missing after build"
  exit 1
fi

echo "==> Build complete"
