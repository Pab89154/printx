#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
if [[ -z "${PRINTX_SLICER_HOME:-}" && -x "$ROOT_DIR/.slicer/AppRun" ]]; then
  export PRINTX_SLICER_HOME="$ROOT_DIR/.slicer"
fi
if [[ -z "${PRINTX_SLICER_PROFILES:-}" ]]; then
  for cand in \
    "${PRINTX_SLICER_HOME:+$PRINTX_SLICER_HOME/resources/profiles}" \
    "${PRINTX_SLICER_HOME:+$PRINTX_SLICER_HOME/usr/share/BambuStudio/profiles}" \
    "/Applications/BambuStudio.app/Contents/Resources/profiles"; do
    if [[ -n "${cand:-}" && -d "$cand/BBL/machine" ]]; then
      export PRINTX_SLICER_PROFILES="$cand"
      break
    fi
  done
fi
# Back-compat for older env
if [[ -z "${PRINTX_BAMBU_PROFILE_ROOT:-}" && -n "${PRINTX_SLICER_PROFILES:-}" ]]; then
  export PRINTX_BAMBU_PROFILE_ROOT="$PRINTX_SLICER_PROFILES/BBL"
fi
exec node --import tsx server/production.ts
