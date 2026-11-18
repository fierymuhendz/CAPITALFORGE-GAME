import { PARAMS } from "./params";
import type { Recipe, RecipeLine } from "./recipes";

export interface BatchIO {
  inputs: RecipeLine[];
  output: RecipeLine;
}

/**
 * Tarif girdi/çıktısı batch ile doğrusal çarpılır (süre değişmez).
 * batches 1..maxBatchesPerJob dışındaysa RangeError (sunucu zod ile zaten reddeder).
 */
export function batchIO(recipe: Recipe, batches: bigint): BatchIO {
  if (batches < 1n || batches > PARAMS.maxBatchesPerJob) {
    throw new RangeError(`batches 1..${PARAMS.maxBatchesPerJob} olmalı: ${batches}`);
  }
  return {
    inputs: recipe.inputs.map((l) => ({ productId: l.productId, qty: l.qty * batches })),
    output: { productId: recipe.output.productId, qty: recipe.output.qty * batches },
  };
}

/** Bitiş tick'i: başlangıç + tarif süresi (batch'ten bağımsız). */
export function completesAtTick(recipe: Recipe, startedTick: bigint): bigint {
  if (startedTick < 0n) throw new RangeError(`tick negatif olamaz: ${startedTick}`);
  return startedTick + recipe.durationTicks;
}
