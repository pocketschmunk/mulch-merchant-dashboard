FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
COPY fee-service/package.json ./fee-service/package.json
RUN pnpm install --frozen-lockfile
COPY client ./client
COPY server ./server
COPY fee-service/src ./fee-service/src
COPY fee-service/migrations ./fee-service/migrations
COPY tools ./tools
RUN pnpm build
USER node
EXPOSE 3000
CMD ["node", "server/src/start.js"]
