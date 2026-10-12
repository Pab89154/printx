#!/usr/bin/env bash
set -euo pipefail

echo "==> PrintX Render build"
echo "Node: $(node -v)"
echo "NPM: $(npm -v)"
echo "PWD: $(pwd)"
echo "OS: $(uname -a)"

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
  # Native Node hosts on Render often cannot extract the AppImage (no FUSE / libs).
  # Docker runtime (render.yaml + Dockerfile) bakes the slicer in at image build time.
  echo "WARNING: local slicer install failed on this host."
  echo "If this service is still Environment=Node, switch it to Docker (see render.yaml)"
  echo "so Free Cloud Slicer G-code downloads work. Continuing so the site can boot."
fi

echo "==> Build complete"
