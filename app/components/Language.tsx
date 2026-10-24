"use client";
import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  getLocale,
  serverLocale,
  setLocale,
  subscribeLocale,
  languageKey,
  t as tx,
  type Locale,
} from "@/lib/i18n";
export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, serverLocale);
}
export default function LanguageBar() {
  const locale = useLocale();
  const path = usePathname();
  useEffect(() => {
    try {
      const saved = localStorage.getItem(languageKey);
      if (saved === "kk" || saved === "ru") setLocale(saved);
    } catch {}
  }, []);
  return (
    <div className="language-bar">
      <div>
        <label htmlFor="interface-language">{tx("Язык интерфейса")}</label>
        <select
          id="interface-language"
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
        >
          <option value="ru" lang="ru">
            Русский
          </option>
          <option value="kk" lang="kk">
            Қазақша
          </option>
        </select>
        <span className="sr-only" aria-live="polite" key={path}>
          {locale === "kk" ? "Қазақша" : "Русский"}
        </span>
      </div>
    </div>
  );
}
