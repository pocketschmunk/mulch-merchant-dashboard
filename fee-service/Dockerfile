FROM node:22.23.0-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY src ./src
COPY tools ./tools
COPY migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
