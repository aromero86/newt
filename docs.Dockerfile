# The docs site: VitePress built, then served by nginx on port 80.
FROM oven/bun:1.4.2-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/newt/package.json packages/newt/
COPY packages/newt-eslint/package.json packages/newt-eslint/
RUN bun install --frozen-lockfile --linker hoisted

COPY . .
RUN bun run docs:build

FROM nginx:1.27-alpine
COPY --from=build /app/web/.vitepress/dist /usr/share/nginx/html
