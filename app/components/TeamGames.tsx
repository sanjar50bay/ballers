"use client";
import Link from "next/link";
import { dateLocale, t } from "@/lib/i18n";
import type { TeamCalendar } from "@/lib/team-calendar";
import { NetworkError } from "./Network";

export default function TeamGames({
  data,
  teamId,
  captain,
  loading,
  error,
  retry,
  compact = false,
  history = false,
}: {
  data: TeamCalendar | null;
  teamId: string;
  captain: boolean;
  loading: boolean;
  error: string;
  retry: () => void;
  compact?: boolean;
  history?: boolean;
}) {
  const games = data?.games.filter((g) => g.upcoming !== history) || [];
  return (
    <section
      aria-label={t("Игры команды")}
      className={compact ? "network-card" : ""}
    >
      <div className="flex flex-wrap justify-between gap-3 items-center mb-3">
        <h2 className="section-title">
          {t(
            compact
              ? "Ближайшая игра"
              : history
                ? "История игр команды"
                : "Ближайшие игры команды",
          )}
        </h2>
        {captain && !compact && (
          <Link className="text-link" href={`/teams/${teamId}/games/create`}>
            {t("Запланировать игру")}
          </Link>
        )}
      </div>
      <NetworkError error={error} retry={retry} />
      {loading && !data && <p role="status">{t("Загружаем игры команды…")}</p>}
      {data && !data.member && (
        <p className="ballers-muted">
          {t("Участники команды видят здесь приглашения на свои игры.")}
        </p>
      )}
      {data?.member && !games.length && (
        <p className="ballers-muted">
          {t(
            history
              ? "Завершённых игр команды пока нет."
              : "У команды пока нет запланированных игр.",
          )}
        </p>
      )}
      {(compact ? games.slice(0, 1) : games).map((g) => (
        <article
          className={compact ? "team-next-game" : "network-card"}
          key={g.id}
        >
          <p className="eyebrow">
            {new Date(g.game_date + "T12:00:00").toLocaleDateString(
              dateLocale(),
              { day: "numeric", month: "long" },
            )}{" "}
            · {g.start_time?.slice(0, 5) || t("Время уточняется")}
            {g.live ? " · " + t("Матч идёт") : ""}
          </p>
          <h3 className="font-bold mt-2">{g.title}</h3>
          <p>{g.venue || t("Место уточняется")}</p>
          <p className="ballers-muted text-sm my-2">
            {t("Из команды подтвердились: {count}", { count: g.going })}
            {g.invited > 0
              ? " · " + t("Ждём ответа: {count}", { count: g.invited })
              : ""}
          </p>
          <Link
            className="neon-button green"
            href={`/games/${g.id}/play?tab=overview`}
          >
            {t(
              g.upcoming && g.attendance_status === "INVITED"
                ? "Ответить на приглашение"
                : "К игре →",
            )}
          </Link>
        </article>
      ))}
      {!compact && data?.member && (
        <p className="ballers-muted text-sm mt-4">
          {t(
            "Показываем до 20 игр в каждом разделе, к которым у тебя есть доступ.",
          )}
        </p>
      )}
    </section>
  );
}
