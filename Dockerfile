# cooper in production: the backend, which serves every context on its own port
# (auth 3001, boards 3002, backoffice 3003), each with its built frontend. Its
# SQLite databases live in /app/data, which must be a persistent volume.
FROM oven/bun:1.4.2-alpine
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/newt/package.json packages/newt/
COPY packages/newt-eslint/package.json packages/newt-eslint/
COPY packages/newt-monitor/package.json packages/newt-monitor/
COPY packages/newt-react/package.json packages/newt-react/
COPY packages/newt-react-ui/package.json packages/newt-react-ui/
RUN bun install --frozen-lockfile

COPY . .
RUN bun run cooper:build

ENV NODE_ENV=production
# The monitor's port (3010, with COOPER_MONITOR_KEY) is reached over the container's network only: it is not exposed.
ENV COOPER_MONITOR_HOSTNAME=0.0.0.0
EXPOSE 3001 3002 3003
CMD ["bun", "cooper/backend/index.ts"]
