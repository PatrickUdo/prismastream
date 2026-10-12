# PrismaStream web-app: static SvelteKit SPA served by nginx.
# Build context: repo root. `docker build -f deploy/web.Dockerfile --build-arg VITE_BACKEND_URL=… .`
FROM node:26-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts
COPY . .
ARG VITE_BACKEND_URL=https://backend.prismastream.patrickudo.nl
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
RUN npx svelte-kit sync && npx vite build

FROM nginx:1.29-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/build /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
