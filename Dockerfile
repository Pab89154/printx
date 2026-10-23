# PrintX production image with Bambu Studio CLI for Free-plan G-code downloads.
# Pricing stays on Cloud Slicer API; local slicer is only used when admins download G-code.
FROM ubuntu:22.04 AS slicer
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    squashfs-tools \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /slicer-build
COPY scripts/install-slicer.sh /slicer-build/scripts/install-slicer.sh
RUN chmod +x /slicer-build/scripts/install-slicer.sh \
  && PRINTX_SLICER_HOME=/opt/printx-slicer bash /slicer-build/scripts/install-slicer.sh \
  && test -x /opt/printx-slicer/AppRun

# Runtime on 24.04 — recent Bambu Studio AppImages link libwebkit2gtk-4.1
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    xz-utils \
    xvfb \
    libgl1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libgomp1 \
    libx11-6 \
    libxkbcommon0 \
    libdbus-1-3 \
    libstdc++6 \
    libwebkit2gtk-4.1-0 \
    libsoup-3.0-0 \
    libgstreamer1.0-0 \
    libgstreamer-plugins-base1.0-0 \
    libegl1 \
    libwayland-client0 \
    fonts-dejavu-core \
  && curl -fsSL https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.xz \
    | tar -xJ -C /usr/local --strip-components=1 \
  && update-ca-certificates \
  && node -v && npm -v \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build \
  && test -f dist/index.html

COPY --from=slicer /opt/printx-slicer /opt/printx-slicer

# Headless wrapper — Bambu Studio still links GUI stacks.
RUN printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ -z "${DISPLAY:-}" ]]; then' \
  '  exec xvfb-run -a -s "-screen 0 1280x720x24" /opt/printx-slicer/AppRun "$@"' \
  'fi' \
  'exec /opt/printx-slicer/AppRun "$@"' \
  > /opt/printx-slicer/printx-slice \
  && chmod +x /opt/printx-slicer/printx-slice

ENV NODE_ENV=production
ENV PORT=10000
ENV PRINTX_SLICER_HOME=/opt/printx-slicer
ENV PRINTX_SLICER_BIN=/opt/printx-slicer/printx-slice

# Locate profiles flexibly (AppImage layout varies by release).
RUN set -e; \
  PROFILES=""; \
  for cand in \
    /opt/printx-slicer/resources/profiles \
    /opt/printx-slicer/usr/share/BambuStudio/profiles; do \
    if [ -d "$cand/BBL/machine" ]; then PROFILES="$cand"; break; fi; \
  done; \
  if [ -z "$PROFILES" ]; then \
    PROFILES="$(find /opt/printx-slicer -type d -path '*/profiles/BBL/machine' 2>/dev/null | head -n1 | sed 's|/BBL/machine$||' || true)"; \
  fi; \
  if [ -z "$PROFILES" ] || [ ! -d "$PROFILES/BBL/machine" ]; then \
    echo "ERROR: BBL profiles missing after slicer install"; \
    find /opt/printx-slicer -maxdepth 4 -type d 2>/dev/null | head -80; \
    exit 1; \
  fi; \
  echo "$PROFILES" > /etc/printx-slicer-profiles; \
  echo "Profiles at $PROFILES"; \
  /opt/printx-slicer/printx-slice --help >/tmp/bambu-help.txt 2>&1 || true; \
  if grep -q 'cannot open shared object file' /tmp/bambu-help.txt; then \
    echo "ERROR: bambu-studio missing shared libraries:"; \
    cat /tmp/bambu-help.txt; \
    exit 1; \
  fi; \
  head -n 12 /tmp/bambu-help.txt

EXPOSE 10000
CMD ["bash", "scripts/start.sh"]
