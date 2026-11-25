"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { useLocale } from "./Language";
import { CitySelect } from "./Network";
import OpenGameFacts, { type OpenGame } from "./OpenGameFacts";

export default function PublicGamesPreview() {
  useLocale();
  const [city, setCity] = useState("Astana");
  const [games, setGames] = useState<OpenGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const { data, error } = await supabase.rpc(
          "ballers_public_open_games",
          {
            p_city: city,
            p_limit: 3,
          },
        );
        if (!active) return;
        setError(!!error || !Array.isArray(data));
        setGames(error || !Array.isArray(data) ? [] : (data as OpenGame[]));
      } catch {
        if (active) {
          setError(true);
          setGames([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [city, retry]);
  return (
    <section
      className="public-games-preview"
      aria-labelledby="public-games-title"
    >
      <h2 id="public-games-title">{t("Ближайшие открытые игры")}</h2>
      <CitySelect value={city} onChange={setCity} id="preview-city" />
      {loading ? (
        <p role="status">{t("Загружаем…")}</p>
      ) : error ? (
        <div role="alert">
          <p>{t("Не удалось загрузить игры.")}</p>
          <button className="text-link" onClick={() => setRetry(retry + 1)}>
            {t("Повторить загрузку")}
          </button>
        </div>
      ) : games.length ? (
        games.map((g) => (
          <Link
            className="public-game-preview-card"
            href={`/open-games?game=${g.id}`}
            key={g.id}
          >
            <h3>{g.title}</h3>
            <OpenGameFacts game={g} />
            <span className="text-link">{t("Выбрать игру →")}</span>
          </Link>
        ))
      ) : (
        <p>{t("В этом городе пока нет игр с открытым набором.")}</p>
      )}
      <Link
        className="google"
        href={`/open-games?city=${encodeURIComponent(city)}`}
      >
        {t("Посмотреть игры →")}
      </Link>
      <p className="public-games-caption">
        {t("Смотри без регистрации. Войди, когда выберешь игру.")}
      </p>
    </section>
  );
}
