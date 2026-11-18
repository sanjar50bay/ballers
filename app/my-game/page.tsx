"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { t, dateLocale } from "@/lib/i18n";
import { useLocale } from "@/app/components/Language";
import { useApp } from "@/app/components/AppState";
import GameCard from "@/app/components/GameCard";
export default function Page() {
  return (
    <Suspense fallback={<p>…</p>}>
      <MyGames />
    </Suspense>
  );
}
function MyGames() {
  useLocale();
  const { data, session, loading, error, refresh } = useApp();
  const params = useSearchParams(),
    router = useRouter();
  const history = params.get("history") === "1";
  const selected = params.get("game");
  useEffect(() => {
    if (
      selected &&
      [...(data?.games || []), ...(data?.history || [])].some(
        (g) => g.id === selected,
      )
    )
      router.replace(`/games/${encodeURIComponent(selected)}/play`);
  }, [selected, data, router]);
  const games = history ? data?.history : data?.games;
  return (
    <main className="ballers-shell">
      <h1 className="page-title my-5">{t("Мои игры")}</h1>
      <nav className="game-tabs mb-5" aria-label={t("Список игр")}>
        <Link href="/my-game" aria-current={!history ? "page" : undefined}>
          {t("Ближайшие игры")}
        </Link>
        <Link
          href="/my-game?history=1"
          aria-current={history ? "page" : undefined}
        >
          {t("История игр")}
        </Link>
      </nav>
      {error && (
        <p role="alert" className="error-panel">
          {t("Не удалось обновить данные.")}{" "}
          <button onClick={() => void refresh()}>{t("Повторить")}</button>
        </p>
      )}
      {loading ? (
        <p role="status">{t("Загружаем игры…")}</p>
      ) : !session ? (
        <Link href="/" className="neon-button">
          {t("Войти")}
        </Link>
      ) : (
        <>
          {history && (
            <Link className="text-link mb-4" href="/career">
              {t("Мои матчи и статистика →")}
            </Link>
          )}
          {!games?.length && (
            <section className="neon-panel">
              <h2>
                {t(
                  history
                    ? "Здесь появятся сыгранные матчи и завершённые дни."
                    : "Пока нет ближайшей игры",
                )}
              </h2>
              {!history && (
                <Link className="neon-button mt-4" href="/open-games">
                  {t("Найти игру →")}
                </Link>
              )}
            </section>
          )}
          <div className="space-y-4">
            {games?.map((g) =>
              history ? (
                <section key={g.id} className="neon-panel">
                  <h2>{g.title}</h2>
                  <p className="ballers-muted mt-2">
                    {new Date(g.game_date + "T12:00:00").toLocaleDateString(
                      dateLocale(),
                    )}{" "}
                    · {g.match_count} {t("матчей")}
                  </p>
                  <Link
                    className="text-link mt-3"
                    href={`/games/${g.id}/play?tab=matches`}
                  >
                    {t("Результаты матчей →")}
                  </Link>
                </section>
              ) : (
                <GameCard game={g} key={g.id} />
              ),
            )}
          </div>
        </>
      )}
    </main>
  );
}
