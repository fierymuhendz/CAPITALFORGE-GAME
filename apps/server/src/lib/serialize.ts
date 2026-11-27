/** bigint → metin, Date → ISO (JSON yanıtları için) */
export const m = (v: bigint | number | null | undefined): string => (v === null || v === undefined ? "0" : v.toString());
export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
