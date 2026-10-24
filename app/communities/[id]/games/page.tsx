"use client";
import { uiError, t as tx } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import BottomNav from "@/app/components/BottomNav";
type G = {
  id: string;
  title: string;
  game_date: string;
  start_time: string | null;
  status: string;
};
export default function Games() {
  useLocale();
  const { id } = useParams<{ id: string }>();
  const [games, setGames] = useState<G[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error } = await supabase
        .from("game_days")
        .select("id,title,game_date,start_time,status")
        .eq("community_id", id)
        .order("game_date", { ascending: false });
      if (active) {
        setGames(data || []);
        setError(error?.message || "");
        setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <main className="min-h-screen bg-[#02030a] text-white pb-32">
      <div className="max-w-md mx-auto px-4 py-6 space-y-5">
        <Link
          className="block min-h-11 py-3 text-violet-300"
          href={`/communities/${id}`}
        >
          {tx("← Сообщество")}
        </Link>
        <h1 className="text-3xl font-bold">{tx("Игровые дни")}</h1>
        {loading && <p>{tx("Загрузка…")}</p>}
        {error && (
          <p role="alert" className="text-orange-300">
            {uiError(error)}
          </p>
        )}
        {!loading && !error && !games.length && (
          <p>{tx("Игровых дней пока нет.")}</p>
        )}
        {games.map((g) => (
          <Link
            href={`/communities/${id}/game-days/${g.id}`}
            key={g.id}
            className="block min-h-11 rounded-xl border border-violet-700/50 p-5 bg-[#0d1120]"
          >
            <h2 className="font-bold text-xl">{g.title}</h2>
            <p className="text-gray-300 mt-2">
              {g.game_date} · {g.start_time?.slice(0, 5)} ·{" "}
              {g.status === "COMPLETED" ? tx("Завершён") : tx("Открыт")}
            </p>
          </Link>
        ))}
      </div>
      <BottomNav />
    </main>
  );
}
