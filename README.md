# CapitalForge

Çok oyunculu, ekonomi temalı web oyunu. Kurallar ve ajan ekibi için [CLAUDE.md](CLAUDE.md) dosyasına bakın.

## Başlangıç

```bash
cp .env.example .env
docker compose up -d      # PostgreSQL + Redis
pnpm install
pnpm dev                  # web: http://localhost:3000, sunucu: ws://localhost:2567
```

## Komutlar

| Komut | Ne yapar |
|---|---|
| `pnpm test` | Birim ve özellik testleri (Vitest + fast-check) |
| `pnpm typecheck` | Tüm paketlerde TypeScript denetimi |
| `pnpm sim` | Ekonomi denge simülasyonu |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle migration üret / uygula |

## Yapı

```
apps/web          Next.js istemcisi
apps/server       Fastify + Colyseus oyun sunucusu, Drizzle şeması, defter (ledger)
packages/shared   zod şemaları, mesaj ve oda adları
packages/economy  Saf ekonomi formülleri, para yardımcıları, simülasyon
```
