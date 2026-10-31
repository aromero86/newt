# The docs site: VitePress built, then served by nginx on port 80.
FROM oven/bun:1.4.2-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/newt/package.json packages/newt/
COPY packages/newt-eslint/package.json packages/newt-eslint/
COPY packages/newt-monitor/package.json packages/newt-monitor/
COPY packages/newt-react/package.json packages/newt-react/
COPY packages/newt-react-ui/package.json packages/newt-react-ui/
RUN bun install --frozen-lockfile --linker hoisted

COPY . .
RUN bun run docs:build

FROM nginx:1.27-alpine
COPY --from=build /app/web/.vitepress/dist /usr/share/nginx/html
