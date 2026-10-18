FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3077 \
    DATA_DIR=/data \
    REQUIRE_PASSWORD=1

# Packages are only needed to import items from screenshots (screenshot-reader.mjs).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js screenshot-reader.mjs ./
COPY public ./public
COPY Textures ./Textures
# Seed data: copied into /data on the first start, when the volume is still empty.
COPY Items ./Items
COPY Data ./Data

# /data is the persistent volume; owned by "node" so a new named volume inherits that owner.
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3077
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3077/healthz || exit 1
CMD ["node", "server.js"]
