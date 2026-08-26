FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV NODE_OPTIONS=--experimental-sqlite
ENV PORT=10000

EXPOSE 10000

CMD ["npm", "start"]
