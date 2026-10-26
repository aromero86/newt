# cooper in production: the backend, which serves every context on its own port
# (auth 3001, boards 3002, backoffice 3003), each with its built frontend. Its
# SQLite databases live in /app/data, which must be a persistent volume.
FROM oven/bun:1.4.2-alpine
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/newt/package.json packages/newt/
COPY packages/newt-eslint/package.json packages/newt-eslint/
RUN bun install --frozen-lockfile

COPY . .
RUN bun run cooper:build

ENV NODE_ENV=production
EXPOSE 3001 3002 3003
CMD ["bun", "cooper/backend/index.ts"]
