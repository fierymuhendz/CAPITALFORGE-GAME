/**
 * Basit denge simülasyonu: tek ürün, N oyuncu, T tick.
 * Çıktı: fiyat, toplam para arzı, vergiyle yutulan para.
 * ekonomi-tasarimci bu dosyayı genişletir ve sonuçları docs/economy/ altına yazar.
 */
import { createRng, nextPrice, transactionTax, formatMoney } from "../src/index";

const PLAYERS = Number(process.env.SIM_PLAYERS ?? 200);
const TICKS = Number(process.env.SIM_TICKS ?? 365);
const rng = createRng(Number(process.env.SIM_SEED ?? 42));

let price = 10_000n; // 100,00 TL
const balances = Array.from({ length: PLAYERS }, () => 1_000_000n);
const startSupply = balances.reduce((a, b) => a + b, 0n);
let taxSink = 0n;

for (let t = 0; t < TICKS; t++) {
  let demand = 0n;
  let supply = 0n;
  for (let i = 0; i < PLAYERS; i++) {
    const qty = BigInt(Math.floor(rng() * 5));
    const gross = price * qty;
    if (rng() < 0.5) {
      const tax = transactionTax(gross);
      if (balances[i]! >= gross + tax) {
        balances[i]! -= gross + tax;
        taxSink += tax;
        demand += qty;
      }
    } else {
      const tax = transactionTax(gross);
      balances[i]! += gross - tax;
      taxSink += tax;
      supply += qty;
    }
  }
  price = nextPrice(price, demand, supply);
}

const endSupply = balances.reduce((a, b) => a + b, 0n);
console.table({
  oyuncu: PLAYERS,
  tick: TICKS,
  sonFiyat: formatMoney(price),
  baslangicParaArzi: formatMoney(startSupply),
  bitisParaArzi: formatMoney(endSupply),
  vergiYutagi: formatMoney(taxSink),
});
