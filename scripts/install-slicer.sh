#!/usr/bin/env bash
# Install Bambu Studio AppImage (headless CLI) for PrintX local G-code on Free Cloud Slicer.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SLICER_DIR="${PRINTX_SLICER_HOME:-$ROOT_DIR/.slicer}"
APPIMAGE_URL="${PRINTX_BAMBU_APPIMAGE_URL:-}"
MARKER="$SLICER_DIR/.printx-slicer-ready"

if [[ -f "$MARKER" ]] && [[ -x "$SLICER_DIR/AppRun" || -x "$SLICER_DIR/bambu-studio" ]]; then
  echo "==> Local slicer already installed at $SLICER_DIR"
  exit 0
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "==> Skipping AppImage install (not Linux). On macOS, use installed Bambu Studio."
  exit 0
fi

mkdir -p "$SLICER_DIR"
cd "$SLICER_DIR"

if [[ -z "$APPIMAGE_URL" ]]; then
  echo "==> Resolving latest Bambu Studio Ubuntu AppImage"
  APPIMAGE_URL="$(
    curl -fsSL https://api.github.com/repos/bambulab/BambuStudio/releases/latest \
      | python3 -c 'import sys,json; assets=json.load(sys.stdin).get("assets",[]);
print(next(a["browser_download_url"] for a in assets if "ubuntu" in a["name"].lower() and a["name"].endswith(".AppImage")))'
  )"
fi

echo "==> Downloading $APPIMAGE_URL"
curl -fL --retry 3 -o BambuStudio.AppImage "$APPIMAGE_URL"
chmod +x BambuStudio.AppImage

echo "==> Extracting AppImage (no FUSE required)"
./BambuStudio.AppImage --appimage-extract
# squashfs-root → SLICER_DIR contents
if [[ -d squashfs-root ]]; then
  # Keep extract as the home; AppRun lives inside
  rm -f BambuStudio.AppImage
  # Move contents up if needed
  if [[ -x squashfs-root/AppRun ]]; then
    shopt -s dotglob
    mv squashfs-root/* .
    rmdir squashfs-root 2>/dev/null || rm -rf squashfs-root
  fi
fi

if [[ ! -x AppRun ]]; then
  echo "ERROR: AppRun missing after extract"
  ls -la
  exit 1
fi

# Prefer bundled profiles
if [[ -d resources/profiles/BBL ]]; then
  echo "==> Profiles found at resources/profiles/BBL"
elif [[ -d usr/share/BambuStudio/profiles/BBL ]]; then
  echo "==> Profiles found under usr/share"
fi

touch "$MARKER"
echo "==> Slicer ready. Set PRINTX_SLICER_HOME=$SLICER_DIR"
