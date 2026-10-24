"use client";
import { uiError, t as tx } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import BottomNav from "@/app/components/BottomNav";
import PlayerStats from "@/app/components/PlayerStats";
type M = {
  id: string;
  game_id: string;
  title: string;
  date: string;
  sequence: number;
  score_a: number;
  score_b: number;
  status: string;
  is_test: boolean;
  team_a: string;
  team_b: string;
};
type Career = { player_id: string; matches: M[] };
export default function CareerPage() {
  useLocale();
  const [data, setData] = useState<Career | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (active) {
          setError(tx("Сначала войди через Google на главной странице."));
          setLoading(false);
        }
        return;
      }
      const { data: d, error: e } = await supabase.rpc("ballers_my_career");
      if (active) {
        setData(d as Career);
        setError(e?.message || "");
        setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const status: Record<string, string> = {
    LIVE: tx("Идёт матч"),
    PAUSED: tx("Пауза"),
    PENDING: tx("Ожидает подтверждения"),
    DISPUTED: tx("Спор"),
    VERIFIED: tx("Подтверждён"),
    CANCELLED: tx("Отменён"),
  };
  return (
    <main className="min-h-screen bg-[#02030a] text-white pb-32">
      <div className="max-w-md mx-auto px-4 py-6">
        <h1 className="text-3xl font-bold mb-4">{tx("Моя карьера")}</h1>
        {loading && <p>{tx("Загрузка…")}</p>}
        {error && (
          <p role="alert" className="text-orange-300 break-words">
            {error.includes("PGRST202")
              ? tx("Для истории нужна миграция 003.")
              : uiError(error)}
          </p>
        )}
        {data?.player_id && (
          <>
            <PlayerStats playerId={data.player_id} />
            <Link
              href={`/players/${data.player_id}`}
              className="block min-h-11 py-3 text-violet-300"
            >
              {tx("Мой Baller ID →")}
            </Link>
            <h2 className="text-xl font-bold my-5">{tx("История матчей")}</h2>
            <p className="text-sm text-gray-300 mb-4">
              {tx(
                "Матчи, в которых ты был в заявке. Неподтверждённые и тестовые результаты не входят в реальные показатели.",
              )}
            </p>
            {data.matches.length === 0 && (
              <p className="text-gray-300">
                {tx("Матчей в твоей истории пока нет.")}
              </p>
            )}
            <div className="space-y-3">
              {data.matches.map((m) => (
                <Link
                  href={`/games/${m.game_id}/play`}
                  key={m.id}
                  className="block rounded-xl border border-white/20 bg-[#0d1120] p-4 min-h-11 focus-visible:outline-2 focus-visible:outline-violet-400"
                >
                  <p className="font-bold">
                    {m.team_a} {m.score_a}:{m.score_b} {m.team_b}
                  </p>
                  <p className="text-gray-300 mt-2">
                    {m.title} · {m.date} · #{m.sequence}
                  </p>
                  <p
                    className={
                      m.is_test ? "text-amber-300 mt-2" : "text-violet-300 mt-2"
                    }
                  >
                    {tx(status[m.status] || "Ожидает подтверждения")}
                    {m.is_test ? tx(" · Тестовый") : ""}
                  </p>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
      <BottomNav />
    </main>
  );
}
