# PrintX production image with Bambu Studio CLI for Free-plan G-code.
# Final runtime is Ubuntu 22.04 to match the pinned Bambu AppImage ABI.
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

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
# Node 22 + libs Bambu Studio / AppRun need for headless CLI slicing.
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
    libwebkit2gtk-4.0-37 \
    libgstreamer1.0-0 \
    libgstreamer-plugins-base1.0-0 \
    libegl1 \
    libwayland-client0 \
    fonts-dejavu-core \
  && curl -fsSL https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-x64.tar.xz \
    | tar -xJ -C /usr/local --strip-components=1 \
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

# Resolve profile pack location written by the AppImage extract.
RUN set -e; \
  if [ -d /opt/printx-slicer/resources/profiles/BBL ]; then \
    echo "/opt/printx-slicer/resources/profiles" > /etc/printx-slicer-profiles; \
  elif [ -d /opt/printx-slicer/usr/share/BambuStudio/profiles/BBL ]; then \
    echo "/opt/printx-slicer/usr/share/BambuStudio/profiles" > /etc/printx-slicer-profiles; \
  else \
    echo "ERROR: BBL profiles missing after slicer install"; ls -la /opt/printx-slicer; exit 1; \
  fi; \
  PROFILES="$(cat /etc/printx-slicer-profiles)"; \
  echo "Profiles at $PROFILES"; \
  /opt/printx-slicer/printx-slice --help >/tmp/bambu-help.txt 2>&1 || true; \
  head -n 12 /tmp/bambu-help.txt

EXPOSE 10000
CMD ["bash", "scripts/start.sh"]
