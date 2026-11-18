# Depo kökünden derlenir: docker build -f apps/server/Dockerfile .
FROM node:22-alpine
WORKDIR /app
RUN npm install -g pnpm@10.28.0
COPY . .
RUN pnpm install --frozen-lockfile --filter @capitalforge/server... \
 && chown -R node:node /app
ENV NODE_ENV=production PORT=2567
WORKDIR /app/apps/server
EXPOSE 2567
USER node
# Çalışma anında pnpm gerekmez: doğrudan yerel ikili dosyalar kullanılır.
CMD ["node_modules/.bin/tsx", "src/index.ts"]
