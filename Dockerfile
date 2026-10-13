# PrintX production image — Node only.
# Pricing uses Cloud Slicer API; local Bambu is not baked in (AppImage broke Render builds
# and freezes the free-tier web process when used for quotes).
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    xz-utils \
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

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000
CMD ["bash", "scripts/start.sh"]
