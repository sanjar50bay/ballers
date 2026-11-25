"use client";
import { uiError, t as tx } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useApp } from "@/app/components/AppState";
import { CitySelect } from "@/app/components/Network";
import { cityKey, cityLabel } from "@/lib/network";
import { useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import SearchCategories from "@/app/components/SearchCategories";
import SignIn from "@/app/components/SignIn";
import OpenGameFacts, { type OpenGame } from "@/app/components/OpenGameFacts";
export default function OpenGames() {
  return (
    <Suspense fallback={<p role="status">{tx("Загружаем…")}</p>}>
      <OpenGamesContent />
    </Suspense>
  );
}
function OpenGamesContent() {
  useLocale();
  const query = useSearchParams();
  const selected = /^[a-f0-9-]{36}$/i.test(query.get("game") || "")
    ? query.get("game")
    : null;
  const { data: home, session, loading: authLoading } = useApp();
  const initialCity = useRef(!!query.get("city") || !!selected);
  const [games, setGames] = useState<OpenGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState(query.get("city") || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const joinLock = useRef(false);
  const loadSequence = useRef(0);
  const router = useRouter();
  useEffect(() => {
    if (!selected || !home?.profile) return;
    try {
      if (
        localStorage.getItem("ballers:network-return") ===
        `/open-games?game=${selected}`
      )
        localStorage.removeItem("ballers:network-return");
    } catch {}
  }, [selected, home?.profile]);
  useEffect(() => {
    if (home?.profile && !initialCity.current) {
      initialCity.current = true;
      setCity(cityKey(home.profile.city));
    }
  }, [home]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const { data, error } = session
        ? await supabase.rpc("ballers_open_games")
        : await supabase.rpc("ballers_public_open_games", {
            p_city: city,
            p_limit: 24,
            p_game: selected,
          });
      if (sequence !== loadSequence.current) return;
      if (error) setError(error.message);
      else setGames(Array.isArray(data) ? (data as OpenGame[]) : []);
    } catch {
      if (sequence === loadSequence.current) setError("NETWORK_ERROR");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [session, city, selected]);
  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);
  const visibleGames = games.filter(
    (g) =>
      (!selected || g.id === selected) &&
      (!city || cityKey(g.city).toLowerCase() === cityKey(city).toLowerCase()),
  );
  return (
    <main className="ballers-shell">
      <div>
        <h1 className="page-title">{tx("Открытые игры")}</h1>
        <SearchCategories active="games" />
        <p className="text-gray-400 text-sm mb-5">
          {tx("Выбери игру. Команда не нужна.")}
        </p>
        <details className="open-games-help">
          <summary>{tx("Что такое открытые игры?")}</summary>
          <p>
            {tx(
              "Это игры с добором игроков. Можно вступить сразу или подать заявку — способ входа выбирает организатор. При нехватке мест доступен резерв.",
            )}
          </p>
          <p>
            {tx(
              "Организатору: игровой день → Матчи → Настройки организатора → Правила новых матчей. Включи «Открыть добор в списке публичных игр» и нажми «Сохранить правила».",
            )}
          </p>
        </details>
        <div data-coach="game-city">
          <CitySelect
            value={city}
            onChange={(value) => {
              initialCity.current = true;
              setCity(value);
              if (selected)
                router.replace(`/open-games?city=${encodeURIComponent(value)}`);
            }}
            all
            id="games-city"
          />
        </div>
        {selected && (
          <Link className="text-link mb-4" href="/open-games">
            {tx("Все открытые игры →")}
          </Link>
        )}
        {error && (
          <p role="alert" className="text-red-300">
            {uiError(error)}
          </p>
        )}
        {loading && <p role="status">{tx("Загружаем…")}</p>}
        {!loading &&
          !error &&
          visibleGames.map((g) => (
            <article
              key={g.id}
              className="rounded-3xl bg-[#0d1120] border border-white/10 p-5 mb-4"
            >
              <h2 className="text-xl font-bold">{g.title}</h2>
              <OpenGameFacts game={g} />
              {!session ? (
                selected === g.id ? (
                  <section
                    id="signin"
                    className="mt-4"
                    aria-label={tx("Вход для участия")}
                  >
                    <h3 className="font-bold mb-3">
                      {tx("Войди, чтобы записаться на эту игру")}
                    </h3>
                    <SignIn returnTo={`/open-games?game=${g.id}`} />
                  </section>
                ) : (
                  <Link
                    className="neon-button"
                    href={`/open-games?game=${g.id}#signin`}
                  >
                    {tx("Войти и записаться")}
                  </Link>
                )
              ) : home && !home.profile ? (
                <button
                  className="neon-button"
                  onClick={() => {
                    try {
                      localStorage.setItem(
                        "ballers:network-return",
                        `/open-games?game=${g.id}`,
                      );
                    } catch {}
                    router.push("/onboarding");
                  }}
                >
                  {tx("Создать профиль и вернуться к игре")}
                </button>
              ) : (
                <button
                  className="bg-violet-600 rounded-xl px-4 py-3 font-bold disabled:opacity-40"
                  data-coach="join-game"
                  disabled={busy || authLoading || !home?.profile}
                  onClick={() => {
                    void (async () => {
                      if (joinLock.current) return;
                      joinLock.current = true;
                      setBusy(true);
                      setError("");
                      try {
                        const { error } = await supabase.rpc(
                          "ballers_join_open_game",
                          { p_game: g.id },
                        );
                        if (error) setError(error.message);
                        else router.push(`/games/${g.id}/play`);
                      } catch {
                        setError("NETWORK_ERROR");
                      } finally {
                        joinLock.current = false;
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  {g.join_mode !== "AUTO"
                    ? tx("Подать заявку")
                    : g.capacity !== null && g.going >= g.capacity
                      ? tx("Встать в очередь")
                      : tx("Присоединиться")}
                </button>
              )}
            </article>
          ))}
        {!loading && !visibleGames.length && !error && (
          <p className="text-gray-400">
            {selected
              ? tx("Эта игра больше не принимает заявки в открытом каталоге.")
              : city
                ? tx("В городе {city} пока нет игр с открытым набором.", {
                    city: cityLabel(city),
                  })
                : tx("Пока нет игр с открытым набором.")}
          </p>
        )}
        {error && (
          <button className="text-link" onClick={() => void load()}>
            {tx("Повторить загрузку")}
          </button>
        )}
      </div>
    </main>
  );
}
