"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { scheduledStart } from "@/lib/game-schedule";
import { t } from "@/lib/i18n";
import { gamePreparation, type PreparationInput } from "@/lib/game-preparation";

export default function GamePreparation({
  snapshot,
  path,
  busy,
  pending,
  start,
  revealLeader,
  hasMatches,
}: {
  snapshot: PreparationInput & {
    manager: boolean;
    control?: PreparationInput["control"] & { is_leader: boolean };
  };
  path: string;
  busy: boolean;
  pending: boolean;
  start: () => void;
  revealLeader: () => void;
  hasMatches: boolean;
}) {
  const p = gamePreparation(snapshot);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, []);
  const startsAt = scheduledStart(snapshot.game);
  const timeReady = startsAt !== null && now >= startsAt;
  const steps = [
    {
      key: "players",
      name: "Игроки подтвердились",
      done: p.playersReady,
      detail: t("{count} игроков · для старта нужно {needed}", {
        count: p.going,
        needed: p.needed,
      }),
      href: path + "?tab=participants",
      action: "Пригласить игроков",
    },
    {
      key: "teams",
      name: "Составы заполнены",
      done: p.teamsReady,
      detail:
        p.teams.length === 2
          ? p.teams
              .map(
                (team) =>
                  `${team.name}: ${team.player_ids.length}/${snapshot.game.format}`,
              )
              .join(" · ")
          : t("Сначала создайте команды"),
      href: path + "?tab=participants",
      action: "Собрать составы",
    },
    {
      key: "captains",
      name: "Капитаны сохранены",
      done: p.captainsReady,
      detail: t("Для двух команд следующего матча"),
      href: path + "?tab=matches#game-captains",
      action: "Назначить капитанов",
    },
    {
      key: "leader",
      name: "Ведущий назначен",
      done: p.leaderReady,
      detail: t("Один человек управляет матчем"),
      action: "Назначить ведущего",
    },
  ];
  const next = steps.find((step) => step.key === p.nextStep);
  return (
    <section
      className="neon-panel mb-4 game-preparation"
      aria-label={t("Подготовка игры")}
    >
      <h2>{t(p.ready && timeReady ? "Можно начинать" : "Подготовка игры")}</h2>
      {!timeReady && (
        <p id="start-time-reason" className="start-time-reason">
          {startsAt === null
            ? t("Начать матч можно после указания даты и времени игры.")
            : t(
                "Старт доступен {date} в {time} · время Казахстана. Пока можно собрать составы.",
                {
                  date: snapshot.game.game_date || "",
                  time: snapshot.game.start_time?.slice(0, 5) || "00:00",
                },
              )}
        </p>
      )}
      {p.ready && timeReady && (
        <p className="ballers-muted mt-1">
          {t("Все условия для следующего матча выполнены.")}
        </p>
      )}
      {snapshot.manager && (
        <>
          <dl className="preparation-counts" aria-label={t("Ответы игроков")}>
            {[
              [t("Идут"), p.going],
              [t("Без ответа"), p.invited],
              [t("Под вопросом"), p.maybe],
              [t("Не идут"), p.declined],
              ...(p.reserved ? [[t("В резерве"), p.reserved]] : []),
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="preparation-shortfall">
            {t(
              p.missing
                ? "Для двух составов не хватает: {count}"
                : "На два состава хватает игроков",
              { count: p.missing },
            )}
          </p>
          <div className="preparation-plan">
            <strong>{t("Время и место")}</strong>
            <p>
              {snapshot.game.game_date || t("Дата уточняется")} ·{" "}
              {snapshot.game.start_time?.slice(0, 5) || t("Время уточняется")}
            </p>
            <p>{snapshot.game.venue?.trim() || t("Место уточняется")}</p>
            <small>
              {t(
                !p.dateSpecified || !p.timeSpecified || !p.venueSpecified
                  ? "Уточни недостающие данные с участниками до игры."
                  : "Место указано организатором. Бронь поля здесь не подтверждается.",
              )}
            </small>
          </div>
        </>
      )}
      {next && (
        <div className="preparation-next">
          <p className="preparation-next-label">{t("Следующий шаг")}</p>
          <h3>{t(next.action)}</h3>
          <p>{next.detail}</p>
          {snapshot.manager ? (
            next.href ? (
              <Link className="neon-button mt-3" href={next.href}>
                {t(next.action)}
              </Link>
            ) : (
              <button
                type="button"
                className="neon-button mt-3"
                disabled={busy}
                onClick={revealLeader}
              >
                {t(next.action)}
              </button>
            )
          ) : (
            <p className="ballers-muted mt-2">
              {t("Попроси организатора завершить подготовку.")}
            </p>
          )}
        </div>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer py-2">
          {t("Шаги подготовки: {count}/4", {
            count: steps.filter((step) => step.done).length,
          })}
        </summary>
        <ul className="mt-3 space-y-3">
          {steps.map((step) => (
            <li key={step.name} className="flex items-start gap-3">
              <span
                aria-label={t(step.done ? "Готово" : "Осталось")}
                className={step.done ? "text-emerald-300" : "text-amber-300"}
              >
                {step.done ? "✓" : "○"}
              </span>
              <div className="min-w-0 flex-1">
                <strong>{t(step.name)}</strong>
                <p className="ballers-muted text-sm">{step.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </details>
      {snapshot.control?.is_leader && !pending ? (
        <button
          className="neon-button mt-4 w-full"
          disabled={busy || !p.ready || !timeReady}
          aria-describedby={!timeReady ? "start-time-reason" : undefined}
          onClick={start}
        >
          {t(hasMatches ? "Начать следующий матч" : "Начать первый матч")}
        </button>
      ) : (
        <p className="ballers-muted text-sm mt-4">
          {t("Матч запускает назначенный ведущий.")}
        </p>
      )}
    </section>
  );
}
