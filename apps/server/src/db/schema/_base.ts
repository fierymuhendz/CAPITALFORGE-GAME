import { pgSchema } from "drizzle-orm/pg-core";

/** Oyunun tüm tabloları `cf` şemasında (eski oyunun public tablolarından bağımsız). */
export const cf = pgSchema("cf");
