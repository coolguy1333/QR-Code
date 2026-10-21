# QR Studio — runs as a WebManager app (see webmanager.json)
FROM node:22-slim

# Fonts are needed to draw frame text ("SCAN ME") when rendering PNG/JPG on the server.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY public ./public
COPY src ./src

# /data is the only writable, persistent location (database, uploaded files, secret key).
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
