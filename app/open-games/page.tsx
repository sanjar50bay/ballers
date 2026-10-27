"use client";
import { uiError, t as tx } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/app/components/AppState";
import { CitySelect } from "@/app/components/Network";
import { cityKey } from "@/lib/network";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
type Game = {
  join_mode?: string;
  id: string;
  community_id: string;
  title: string;
  city: string | null;
  game_date: string;
  start_time: string | null;
  venue: string | null;
  format: number;
  capacity: number | null;
  going: number;
};
export default function OpenGames() {
  useLocale();
  const { data: home } = useApp();
  const initialCity = useRef(false);
  const [games, setGames] = useState<Game[]>([]);
  const [city, setCity] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => {
    if (home?.profile && !initialCity.current) {
      initialCity.current = true;
      setCity(cityKey(home.profile.city));
    }
  }, [home]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("ballers_open_games");
    if (error) setError(error.message);
    else setGames((data || []) as Game[]);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);
  return (
    <main className="min-h-screen bg-[#050710] text-white p-4">
      <div className="max-w-xl mx-auto py-6">
        <Link href="/" className="text-violet-300">
          {tx("← На главную")}
        </Link>
        <h1 className="text-3xl font-black my-5">{tx("Открытые игры")}</h1>
        <p className="text-gray-400 text-sm mb-5">
          {tx(
            "Менеджер открывает набор в игровом центре. Для вступления нужен профиль BALLERS, постоянная команда не нужна.",
          )}
        </p>
        <CitySelect value={city} onChange={setCity} all id="games-city" />
        {error && (
          <p role="alert" className="text-red-300">
            {uiError(error)}
          </p>
        )}
        {games
          .filter(
            (g) =>
              !city ||
              cityKey(g.city).toLowerCase() === cityKey(city).toLowerCase(),
          )
          .map((g) => (
            <article
              key={g.id}
              className="rounded-3xl bg-[#0d1120] border border-white/10 p-5 mb-4"
            >
              <h2 className="text-xl font-bold">{g.title}</h2>
              <p className="text-gray-400 text-sm mt-2">
                {g.city} · {g.game_date} {g.start_time?.slice(0, 5)} · {g.venue}
              </p>
              <p className="text-sm my-4">
                {g.format}×{g.format} · {g.going}/{g.capacity || "∞"}{" "}
                {tx("игроков")}
              </p>
              <button
                className="bg-violet-600 rounded-xl px-4 py-3 font-bold disabled:opacity-40"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    const { error } = await supabase.rpc(
                      "ballers_join_open_game",
                      { p_game: g.id },
                    );
                    if (error) setError(error.message);
                    else router.push(`/games/${g.id}/play`);
                    setBusy(false);
                  })();
                }}
              >
                {g.join_mode !== "AUTO"
                  ? tx("Подать заявку")
                  : g.capacity !== null && g.going >= g.capacity
                    ? tx("Встать в очередь")
                    : tx("Присоединиться")}
              </button>
            </article>
          ))}
        {!games.length && !error && (
          <p className="text-gray-400">
            {tx(
              "Пока нет опубликованных игр. Войди в аккаунт; менеджер может открыть свою игру для добора.",
            )}
          </p>
        )}
      </div>
    </main>
  );
}
