"use client";

import Link from "next/link";
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
  const steps = [
    {
      name: "Игроки подтвердились",
      done: p.playersReady,
      detail: t("{count} из {needed} для старта", {
        count: p.going,
        needed: p.needed,
      }),
      href: path + "?tab=participants",
      action: "Пригласить игроков",
    },
    {
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
      name: "Капитаны сохранены",
      done: p.captainsReady,
      detail: t("Для двух команд следующего матча"),
      href: path + "?tab=matches#game-captains",
      action: "Назначить капитанов",
    },
    {
      name: "Ведущий назначен",
      done: p.leaderReady,
      detail: t("Один человек управляет матчем"),
      action: "Назначить ведущего",
    },
  ];
  return (
    <section
      className="neon-panel mb-4 game-preparation"
      aria-label={t("Подготовка игры")}
    >
      <h2>{t(p.ready ? "Можно начинать" : "Подготовка игры")}</h2>
      <p className="ballers-muted mt-1">
        {t(
          p.ready
            ? "Все условия для следующего матча выполнены."
            : "Пройди эти шаги перед стартом матча.",
        )}
      </p>
      <details open={!p.ready} className="mt-3">
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
                {!step.done &&
                  snapshot.manager &&
                  (step.href ? (
                    <Link
                      className="inline-block py-2 text-[#73d4ff] underline"
                      href={step.href}
                    >
                      {t(step.action)}
                    </Link>
                  ) : (
                    <button
                      className="py-2 text-[#73d4ff] underline"
                      onClick={revealLeader}
                    >
                      {t(step.action)}
                    </button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      </details>
      {snapshot.control?.is_leader && !pending ? (
        <button
          className="neon-button mt-4 w-full"
          disabled={busy || !p.ready}
          onClick={start}
        >
          {t(hasMatches ? "Начать следующий матч" : "Начать первый матч")}
        </button>
      ) : (
        <p className="ballers-muted text-sm mt-4">
          {t("Матч запускает назначенный ведущий.")}
        </p>
      )}
      {!p.ready && snapshot.control?.is_leader && !snapshot.manager && (
        <p className="text-sm mt-2">
          {t("Попроси организатора завершить подготовку.")}
        </p>
      )}
    </section>
  );
}
