/** Aksan ve büyük/küçük harf duyarsız arama (TR ve EN): "sut" → "Süt", "IRMAK" → "ırmak". */
export function fold(s: string): string {
  return s.replace(/İ/g, "i").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Sorgudaki her sözcük metinlerin birleşiminde geçmeli (boş sorgu her şeyi eşler). */
export function matchQuery(q: string, ...texts: Array<string | undefined | null>): boolean {
  const tokens = fold(q).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = fold(texts.filter(Boolean).join(" "));
  return tokens.every((x) => hay.includes(x));
}
