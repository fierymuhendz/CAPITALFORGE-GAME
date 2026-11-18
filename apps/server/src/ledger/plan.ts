import type { Money } from "@capitalforge/economy";

export interface Leg {
  accountId: string;
  amount: Money;
}

/**
 * Bir transferin bacaklarını doğrular: en az iki bacak, sıfır tutar yok, toplam sıfır.
 * Veritabanına dokunmaz, bu yüzden birim testle denetlenebilir.
 */
export function validateLegs(legs: readonly Leg[]): void {
  if (legs.length < 2) throw new Error("Transfer en az iki bacaklı olmalı");
  let sum = 0n;
  for (const leg of legs) {
    if (leg.amount === 0n) throw new Error("Sıfır tutarlı bacak olamaz");
    sum += leg.amount;
  }
  if (sum !== 0n) throw new Error(`Defter dengesiz: toplam ${sum}`);
}

/** Kilitleri her zaman aynı sırada almak için hesap kimliklerini sıralar (deadlock önleme). */
export function lockOrder(legs: readonly Leg[]): string[] {
  return [...new Set(legs.map((l) => l.accountId))].sort();
}
