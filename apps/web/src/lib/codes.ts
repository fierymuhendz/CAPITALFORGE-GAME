import type { I18n } from "./i18n";

/** Sunucudan gelen kod → çeviri (önce özel önek, sonra errors.<KOD>, yoksa kodun kendisi). */
export function codeText(i: I18n, prefix: string, code: string): string {
  if (i.has(`${prefix}.${code}`)) return i.t(`${prefix}.${code}`);
  if (i.has(`errors.${code}`)) return i.t(`errors.${code}`);
  return code;
}
