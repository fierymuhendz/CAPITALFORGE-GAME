# Depo kökünden derlenir:
# docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_GAME_SERVER_URL=ws://SUNUCU:2567 .
FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@10.28.0
COPY . .
ARG NEXT_PUBLIC_GAME_SERVER_URL
ENV NEXT_PUBLIC_GAME_SERVER_URL=$NEXT_PUBLIC_GAME_SERVER_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile --filter @capitalforge/web... \
 && pnpm --filter @capitalforge/web build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
USER node
CMD ["node", "apps/web/server.js"]
