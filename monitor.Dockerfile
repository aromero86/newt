# newt-monitor in production: one process, on port 4800, which watches newt
# applications over their monitor endpoints. Its SQLite database lives in /app/data,
# which must be a persistent volume. NEWT_MONITOR_USER, NEWT_MONITOR_PASSWORD and
# NEWT_MONITOR_SECRET come from the environment: without them it does not start.
FROM oven/bun:1.4.2-alpine
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/newt/package.json packages/newt/
COPY packages/newt-eslint/package.json packages/newt-eslint/
COPY packages/newt-graph/package.json packages/newt-graph/
COPY packages/newt-monitor/package.json packages/newt-monitor/
COPY packages/newt-react/package.json packages/newt-react/
COPY packages/newt-react-ui/package.json packages/newt-react-ui/
RUN bun install --frozen-lockfile --production

COPY packages/newt packages/newt
COPY packages/newt-monitor packages/newt-monitor

ENV NODE_ENV=production
ENV NEWT_MONITOR_DATA=/app/data/newt-monitor.db
EXPOSE 4800
CMD ["bun", "packages/newt-monitor/bin/newt-monitor.ts"]
