#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${PRINTX_SLICER_HOME:-}" ]]; then
  if [[ -x /opt/printx-slicer/AppRun ]]; then
    export PRINTX_SLICER_HOME=/opt/printx-slicer
  elif [[ -x "$ROOT_DIR/.slicer/AppRun" ]]; then
    export PRINTX_SLICER_HOME="$ROOT_DIR/.slicer"
  fi
fi

if [[ -z "${PRINTX_SLICER_BIN:-}" ]]; then
  if [[ -x /opt/printx-slicer/printx-slice ]]; then
    export PRINTX_SLICER_BIN=/opt/printx-slicer/printx-slice
  elif [[ -n "${PRINTX_SLICER_HOME:-}" && -x "$PRINTX_SLICER_HOME/printx-slice" ]]; then
    export PRINTX_SLICER_BIN="$PRINTX_SLICER_HOME/printx-slice"
  elif [[ -n "${PRINTX_SLICER_HOME:-}" && -x "$PRINTX_SLICER_HOME/AppRun" ]]; then
    export PRINTX_SLICER_BIN="$PRINTX_SLICER_HOME/AppRun"
  fi
fi

if [[ -z "${PRINTX_SLICER_PROFILES:-}" && -f /etc/printx-slicer-profiles ]]; then
  export PRINTX_SLICER_PROFILES="$(cat /etc/printx-slicer-profiles)"
fi

if [[ -z "${PRINTX_SLICER_PROFILES:-}" && -n "${PRINTX_SLICER_HOME:-}" ]]; then
  for cand in \
    "$PRINTX_SLICER_HOME/resources/profiles" \
    "$PRINTX_SLICER_HOME/usr/share/BambuStudio/profiles" \
    "/Applications/BambuStudio.app/Contents/Resources/profiles"; do
    if [[ -d "$cand/BBL/machine" ]]; then
      export PRINTX_SLICER_PROFILES="$cand"
      break
    fi
  done
fi

if [[ -z "${PRINTX_BAMBU_PROFILE_ROOT:-}" && -n "${PRINTX_SLICER_PROFILES:-}" ]]; then
  export PRINTX_BAMBU_PROFILE_ROOT="$PRINTX_SLICER_PROFILES/BBL"
fi

if [[ -n "${PRINTX_SLICER_BIN:-}${PRINTX_SLICER_HOME:-}" ]]; then
  echo "[printx] slicer bin=${PRINTX_SLICER_BIN:-none} home=${PRINTX_SLICER_HOME:-none} profiles=${PRINTX_SLICER_PROFILES:-none}"
else
  echo "[printx] WARNING: no local slicer — Free Cloud Slicer G-code downloads will fail"
fi

exec node --import tsx server/production.ts
