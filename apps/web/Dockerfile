# Depo kökünden derlenir:
# Üretimde göreli adres kullanılır (Caddy /ws önekini sunucuya yönlendirir):
# docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_GAME_SERVER_URL=/ws .
FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@10.28.0
COPY . .
ARG NEXT_PUBLIC_GAME_SERVER_URL
# /api yönlendirmesi build sırasında sabitlenir; compose ağındaki sunucu servisi
ARG GAME_SERVER_HTTP_URL=http://server:2567
ENV NEXT_PUBLIC_GAME_SERVER_URL=$NEXT_PUBLIC_GAME_SERVER_URL GAME_SERVER_HTTP_URL=$GAME_SERVER_HTTP_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile --filter @capitalforge/web... \
 && pnpm --filter @capitalforge/web build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
USER node
CMD ["node", "apps/web/server.js"]
