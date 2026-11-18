import { PARAMS, executeAgainstPool, poolMaxOrder, volumeAllowed } from "@capitalforge/economy";
import type { OrderErrorCode, OrderResult, PlaceOrder } from "@capitalforge/shared";
import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { currentTick } from "../actions/run";
import type { Db } from "../db/client";
import { accounts, inventories, products, trades } from "../db/schema";
import { applyTransfer } from "../ledger/transfer";

class TradeError extends Error {
  constructor(readonly code: OrderErrorCode) {
    super(code);
  }
}

/**
 * Tek transaction'da ticaret. Kilit sırası sabittir (deadlock önleme):
 * products → oyuncu hesabı → inventories. (Idempotency satırı, ürün kilidinden SONRA oluşturulur:
 * trades→products FK'sı ürün satırında KEY SHARE kilidi alır ve iki eşzamanlı işlemde
 * FOR UPDATE yükseltmesi karşılıklı beklemeye yol açardı.) Ürün satırının FOR UPDATE kilidi aynı ürün
 * üzerindeki tüm ticareti serileştirir; tamamlama, üretim başlatma ve ödenek ürün satırını yalnızca
 * FOR KEY SHARE ile ve her zaman en önce aldığı için bu kilitle aynı sırada kalır.
 *
 * Fiyat, miktar, bakiye istemciden alınmaz; fiyat kilitli ürün satırından okunur, tutarlar
 * packages/economy quoteTrade ile hesaplanır. İş hataları transaction'ı geri alır ve
 * OrderResult { ok:false } olarak döner; beklenmeyen hatalar INTERNAL olur (ayrıntı sızdırılmaz).
 */
export async function executeTrade(db: Db, playerId: string, order: PlaceOrder): Promise<OrderResult> {
  const fail = (error: OrderErrorCode): OrderResult => ({ ok: false, error, idempotencyKey: order.idempotencyKey });
  try {
    return await db.transaction(async (tx) => {
      const quantity = BigInt(order.quantity);

      // 1. Ürün satırı (kilit sırasının ilki)
      const [product] = await tx.select().from(products).where(eq(products.id, order.productId)).for("update");
      if (!product) throw new TradeError("UNKNOWN_PRODUCT");

      const tick = await currentTick(tx);

      // 2. Idempotency: satırı rezerve et
      const claimed = await tx
        .insert(trades)
        .values({
          playerId,
          clientKey: order.idempotencyKey,
          side: order.side,
          productId: order.productId,
          quantity,
          unitPrice: 0n,
          gross: 0n,
          tax: 0n,
          tick,
        })
        .onConflictDoNothing({ target: [trades.playerId, trades.clientKey] })
        .returning({ id: trades.id });

      if (claimed.length === 0) {
        const [prev] = await tx
          .select()
          .from(trades)
          .where(and(eq(trades.playerId, playerId), eq(trades.clientKey, order.idempotencyKey)));
        if (!prev) throw new TradeError("INTERNAL");
        if (prev.side !== order.side || prev.productId !== order.productId || prev.quantity !== quantity) {
          throw new TradeError("IDEMPOTENCY_MISMATCH");
        }
        const [wallet] = await tx
          .select({ balance: accounts.balance })
          .from(accounts)
          .where(and(eq(accounts.playerId, playerId), eq(accounts.kind, "player")));
        return {
          ok: true,
          duplicate: true,
          idempotencyKey: order.idempotencyKey,
          tradeId: prev.id,
          side: prev.side,
          productId: prev.productId,
          quantity: prev.quantity.toString(),
          unitPrice: prev.unitPrice.toString(),
          gross: prev.gross.toString(),
          tax: prev.tax.toString(),
          balance: (wallet?.balance ?? 0n).toString(),
        } satisfies OrderResult;
      }
      const tradeId = claimed[0]!.id;

      // 3. Oyuncu hesabı
      const [wallet] = await tx
        .select({ id: accounts.id, balance: accounts.balance })
        .from(accounts)
        .where(and(eq(accounts.playerId, playerId), eq(accounts.kind, "player")))
        .for("update");
      if (!wallet) throw new TradeError("UNAUTHORIZED");


      // 4. Ortak havuz (kilitli ürün satırından) ve teklif: formül packages/economy'de
      const pool = { units: product.poolUnits, value: product.poolValue };
      if (quantity > poolMaxOrder(pool)) throw new TradeError("ORDER_TOO_LARGE");
      const quote = executeAgainstPool(order.side, pool, quantity);

      // 5. Ön kontroller (CHECK kısıtları ikinci savunma)
      if (order.side === "buy") {
        if (wallet.balance + quote.playerDelta < 0n) throw new TradeError("INSUFFICIENT_FUNDS");
      } else {
        const [inv] = await tx
          .select({ quantity: inventories.quantity })
          .from(inventories)
          .where(and(eq(inventories.playerId, playerId), eq(inventories.productId, order.productId)))
          .for("update");
        if (!inv || inv.quantity < quantity) throw new TradeError("INSUFFICIENT_INVENTORY");
      }

      // 5b. Hacim sınırı (çok tick'li fiyat şişirmeye karşı): son volumeWindowTicks içindeki alım+satım.
      // Cüzdan kilidi aynı oyuncunun emirlerini sıraya koyar; READ COMMITTED'da bu sorgu
      // kilitten sonra çalıştığı için önceki emirlerin commit edilmiş satırlarını görür.
      const [vol] = await tx
        .select({ used: sql<string>`coalesce(sum(${trades.quantity}), 0)` })
        .from(trades)
        .where(
          and(
            eq(trades.playerId, playerId),
            eq(trades.productId, order.productId),
            gt(trades.tick, tick - PARAMS.volumeWindowTicks),
            ne(trades.id, tradeId),
          ),
        );
      if (!volumeAllowed(BigInt(vol?.used ?? "0"), quantity)) throw new TradeError("VOLUME_LIMIT");

      const sys = await tx
        .select({ id: accounts.id, code: accounts.code })
        .from(accounts)
        .where(inArray(accounts.code, ["system:market", "system:tax"]));
      const market = sys.find((a) => a.code === "system:market");
      const tax = sys.find((a) => a.code === "system:tax");
      if (!market || !tax) throw new Error("sistem hesapları yok (seed uygulanmamış)");

      // 6. Defter: alımda oyuncu −(gross+tax); satımda market −gross, oyuncu +(gross−tax). Toplam 0.
      const legs =
        order.side === "buy"
          ? [
              { accountId: wallet.id, amount: quote.playerDelta },
              { accountId: market.id, amount: quote.gross },
              { accountId: tax.id, amount: quote.tax },
            ]
          : [
              { accountId: market.id, amount: -quote.gross },
              { accountId: wallet.id, amount: quote.playerDelta },
              { accountId: tax.id, amount: quote.tax },
            ];
      const transfer = await applyTransfer(
        tx,
        `trade:${playerId}:${order.idempotencyKey}`,
        `trade:${order.side}:${order.productId}`,
        legs.filter((l) => l.amount !== 0n),
      );
      // trades satırı benzersiz olduğundan buraya ulaşılmamalı; ulaşılırsa envanter iki kez işlenmesin.
      if (transfer.status === "duplicate") throw new Error("Beklenmeyen yinelenen transfer");

      // 7. Envanter ve havuz (pool_units/pool_value/price aynı satırda, ürün kilidi altında)
      if (order.side === "buy") {
        await tx
          .insert(inventories)
          .values({ playerId, productId: order.productId, quantity })
          .onConflictDoUpdate({
            target: [inventories.playerId, inventories.productId],
            set: { quantity: sql`${inventories.quantity} + ${quantity}` },
          });
      } else {
        await tx
          .update(inventories)
          .set({ quantity: sql`${inventories.quantity} - ${quantity}` })
          .where(and(eq(inventories.playerId, playerId), eq(inventories.productId, order.productId)));
      }
      await tx
        .update(products)
        .set({ poolUnits: quote.newPool.units, poolValue: quote.newPool.value, price: quote.newPrice })
        .where(eq(products.id, order.productId));

      // 8. Rezerve edilen trade satırını doldur
      await tx
        .update(trades)
        .set({ unitPrice: quote.unitPrice, gross: quote.gross, tax: quote.tax, transferId: transfer.transferId })
        .where(eq(trades.id, tradeId));

      return {
        ok: true,
        duplicate: false,
        idempotencyKey: order.idempotencyKey,
        tradeId,
        side: order.side,
        productId: order.productId,
        quantity: quantity.toString(),
        unitPrice: quote.unitPrice.toString(),
        gross: quote.gross.toString(),
        tax: quote.tax.toString(),
        balance: (wallet.balance + quote.playerDelta).toString(),
      } satisfies OrderResult;
    });
  } catch (err) {
    if (err instanceof TradeError) return fail(err.code);
    console.error("executeTrade hatası", err);
    return fail("INTERNAL");
  }
}
