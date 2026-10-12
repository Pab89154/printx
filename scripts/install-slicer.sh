#!/usr/bin/env bash
# Install Bambu Studio AppImage (headless CLI) for PrintX local G-code on Free Cloud Slicer.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SLICER_DIR="${PRINTX_SLICER_HOME:-$ROOT_DIR/.slicer}"
# Pin URL so builds don't depend on GitHub API / python.
APPIMAGE_URL="${PRINTX_BAMBU_APPIMAGE_URL:-https://github.com/bambulab/BambuStudio/releases/download/v02.08.02.61/BambuStudio_ubuntu22.04-v02.08.02.61-20260820225108.AppImage}"
MARKER="$SLICER_DIR/.printx-slicer-ready"

log() { echo "==> $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

if [[ -f "$MARKER" ]] && [[ -x "$SLICER_DIR/AppRun" || -x "$SLICER_DIR/bambu-studio" ]]; then
  log "Local slicer already installed at $SLICER_DIR"
  exit 0
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  log "Skipping AppImage install (not Linux). On macOS, use installed Bambu Studio."
  exit 0
fi

mkdir -p "$SLICER_DIR"
cd "$SLICER_DIR"
rm -rf squashfs-root AppRun usr resources bin lib 2>/dev/null || true

log "Downloading Bambu Studio AppImage"
log "$APPIMAGE_URL"
curl -fL --retry 5 --retry-delay 2 --connect-timeout 30 \
  -o BambuStudio.AppImage "$APPIMAGE_URL" \
  || fail "download failed (network / disk / URL)"
chmod +x BambuStudio.AppImage
ls -lh BambuStudio.AppImage

extract_ok=0
log "Extracting AppImage (no FUSE)"
# Method 1: built-in extract
if ./BambuStudio.AppImage --appimage-extract >extract.log 2>&1; then
  extract_ok=1
else
  log "AppImage --appimage-extract failed; trying APPIMAGE_EXTRACT_AND_RUN / unsquashfs"
  cat extract.log || true
  if APPIMAGE_EXTRACT_AND_RUN=1 ./BambuStudio.AppImage --appimage-extract >extract2.log 2>&1; then
    extract_ok=1
  elif command -v unsquashfs >/dev/null 2>&1; then
    # Method 2: squashfs tools (offset from runtime)
    offset="$(./BambuStudio.AppImage --appimage-offset 2>/dev/null || true)"
    if [[ -n "${offset:-}" ]]; then
      unsquashfs -o "$offset" -d squashfs-root BambuStudio.AppImage \
        && extract_ok=1
    else
      # Many AppImages put squashfs after ELF; try common helper
      if command -v python3 >/dev/null 2>&1; then
        offset="$(python3 - <<'PY'
import struct,sys
p='BambuStudio.AppImage'
with open(p,'rb') as f:
  data=f.read(1024*1024)
# Look for squashfs magic
idx=data.find(b'hsqs')
if idx<0:
  # full file scan (slow but reliable for ~230MB)
  f=open(p,'rb'); blob=f.read(); f.close()
  idx=blob.find(b'hsqs')
print(idx if idx>=0 else '')
PY
)"
        if [[ -n "${offset:-}" ]]; then
          unsquashfs -o "$offset" -d squashfs-root BambuStudio.AppImage \
            && extract_ok=1
        fi
      fi
    fi
  fi
fi

[[ "$extract_ok" == "1" ]] || fail "could not extract AppImage (need libfuse/unsquashfs or executable extract). See extract.log"

if [[ -d squashfs-root ]]; then
  shopt -s dotglob nullglob
  # Flatten extract into SLICER_DIR
  if [[ -x squashfs-root/AppRun ]]; then
    mv squashfs-root/* .
    rm -rf squashfs-root
  else
    fail "squashfs-root/AppRun missing after extract"
  fi
fi

[[ -x AppRun ]] || fail "AppRun missing after extract; contents: $(ls -la | head)"

# Drop unused vendor packs to shrink deploy size (keep printers we slice for).
PROFILES=""
for cand in \
  "resources/profiles" \
  "usr/share/BambuStudio/profiles"; do
  if [[ -d "$cand/BBL" ]]; then PROFILES="$cand"; break; fi
done
if [[ -n "$PROFILES" ]]; then
  log "Trimming profiles under $PROFILES (keep BBL, Creality, Anycubic)"
  shopt -s nullglob
  for d in "$PROFILES"/*/; do
    name="$(basename "$d")"
    case "$name" in
      BBL|Creality|Anycubic) ;;
      *) rm -rf "$d" ;;
    esac
  done
  # Drop heavy cover art / bed models we don't need for CLI
  find "$PROFILES" -type f \( -name '*.png' -o -name '*_cover.*' -o -name '*buildplate*' \) -delete 2>/dev/null || true
fi

rm -f BambuStudio.AppImage extract.log extract2.log
touch "$MARKER"
log "Slicer ready at $SLICER_DIR"
if [[ -d resources/profiles/BBL ]]; then
  log "Profiles: resources/profiles/BBL"
elif [[ -d usr/share/BambuStudio/profiles/BBL ]]; then
  log "Profiles: usr/share/BambuStudio/profiles/BBL"
fi
