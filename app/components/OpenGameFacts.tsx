"use client";

import { dateLocale, t } from "@/lib/i18n";
import { cityLabel } from "@/lib/network";

export type OpenGame = {
  id: string;
  title: string;
  city: string | null;
  game_date: string;
  start_time: string | null;
  venue: string | null;
  format: number;
  capacity: number | null;
  going: number;
  join_mode?: string;
};

export default function OpenGameFacts({ game: g }: { game: OpenGame }) {
  return (
    <>
      <p className="ballers-muted mt-2">
        {new Date(g.game_date + "T12:00:00").toLocaleDateString(dateLocale(), {
          day: "numeric",
          month: "long",
        })}
        {g.start_time
          ? ` · ${g.start_time.slice(0, 5)}`
          : ` · ${t("Время уточняется")}`}
      </p>
      <p className="ballers-muted mt-2">
        {cityLabel(g.city)} · {g.venue || t("Площадка уточняется")}
      </p>
      <p className="text-sm my-4">
        {g.format}×{g.format} · {g.going}/{g.capacity ?? "∞"} {t("игроков")}
        {g.capacity !== null && (
          <>
            {" "}
            ·{" "}
            {g.going >= g.capacity
              ? t("Резерв")
              : t("Свободных мест: {count}", { count: g.capacity - g.going })}
          </>
        )}
      </p>
    </>
  );
}
