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

echo "==> Installing local slicer (Bambu Studio AppImage) for Free-plan G-code"
if bash scripts/install-slicer.sh; then
  echo "==> Local slicer install OK"
else
  echo "WARNING: local slicer install failed — G-code download needs Bambu Studio on the host"
fi

echo "==> Build complete"
