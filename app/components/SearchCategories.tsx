"use client";

import Link from "next/link";
import { t } from "@/lib/i18n";
import { useLocale } from "./Language";

export default function SearchCategories({ active }: { active: string }) {
  useLocale();
  return (
    <nav className="search-categories" aria-label={t("Что ищем?")}>
      {[
        ["games", "/open-games", "Игры"],
        ["players", "/discover?kind=players", "Игроки"],
        ["teams", "/discover?kind=teams", "Команды"],
        ["communities", "/discover?kind=communities", "Сообщества"],
      ].map(([key, href, label]) => (
        <Link
          key={key}
          href={href}
          aria-current={key === active ? "page" : undefined}
        >
          {t(label)}
        </Link>
      ))}
    </nav>
  );
}
