"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { countLabel } from "@/lib/display";
import type { Stats } from "./AppState";
export default function PlayerStats({
  playerId,
  compact = false,
}: {
  playerId: string;
  compact?: boolean;
}) {
  const [stats, setStats] = useState<Stats | null>(null),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("ballers_player_stats", {
      p_player: playerId,
    });
    if (error) setError("Статистика временно недоступна");
    else {
      setStats(data as Stats);
      setError("");
    }
  }, [playerId]);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
    };
  }, [load]);
  const body = (
    <>
      {stats ? (
        <>
          <div className="stats-grid">
            {[
              ["В заявках", stats.matches],
              ["Голы", stats.goals],
              ["Ассисты", stats.assists],
              ["Сейвы", stats.saves],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <b>{value}</b>
                <p>{label}</p>
              </div>
            ))}
          </div>
          <p className="ballers-muted mt-4">
            Матчи в заявке, не минуты на поле. Рейтинг силы пока не определён.
          </p>
          {stats.test_matches > 0 && (
            <p className="text-sm text-amber-300 mt-2">
              В тестах:{" "}
              {countLabel(stats.test_matches, "матч", "матча", "матчей")} ·{" "}
              {countLabel(stats.test_goals, "гол", "гола", "голов")}. Не входят
              в реальные показатели.
            </p>
          )}
        </>
      ) : (
        <p className="ballers-muted">{error || "Загружаем статистику…"}</p>
      )}
      {compact && (
        <Link className="text-link mt-2" href="/career">
          Вся история матчей →
        </Link>
      )}
    </>
  );
  return compact ? (
    <details className="stats-disclosure">
      <summary>
        <b>{stats?.goals ?? "—"}</b> голов · <b>{stats?.assists ?? "—"}</b>{" "}
        ассистов<span>↓</span>
      </summary>
      {body}
    </details>
  ) : (
    <section className="neon-panel my-5">
      <h2 className="font-bold mb-4 text-xl">Подтверждённая статистика</h2>
      {body}
    </section>
  );
}
