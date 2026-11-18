# Depo kökünden derlenir: docker build -f apps/server/Dockerfile .
FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter @capitalforge/server...
ENV NODE_ENV=production PORT=2567
EXPOSE 2567
USER node
CMD ["pnpm", "--filter", "@capitalforge/server", "start"]
