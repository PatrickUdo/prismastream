# PrismaStream sync-server. Node 26 draait TypeScript direct (type stripping), geen build-stap nodig.
FROM node:26-alpine
ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/data/prismastream-sync.db
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/v1/health || exit 1
CMD ["node", "src/main.ts"]
