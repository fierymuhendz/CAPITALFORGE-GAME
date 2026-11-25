"use client";
import { useApp } from "@/lib/app";
import { useT } from "@/lib/i18n";
import { Seg } from "@/ui/Tabs";
import { Icon } from "@/ui/icons";

export function LangSwitch() {
  const { locale, t } = useT();
  const { setLocale } = useApp();
  return <Seg label={t("account.language")} value={locale} onChange={(l) => void setLocale(l)} items={[{ id: "tr", label: "TR" }, { id: "en", label: "EN" }]} />;
}

export function ThemeToggle() {
  const { theme, setTheme } = useApp();
  const { t } = useT();
  return (
    <button type="button" className="btn ghost icon sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? t("account.themeLight") : t("account.themeDark")}>
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}

export function Brand() {
  return <span className="brand"><span className="mark" aria-hidden="true">CF</span>Capital Forge</span>;
}
