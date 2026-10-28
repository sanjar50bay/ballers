"use client";
import { t as tx, dateLocale } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";
import Link from "next/link";
import Icon from "./Icon";
import type { GameDay } from "./AppState";
export function attendanceLabel(g: GameDay) {
  return g.status !== "OPEN"
    ? tx("День завершён")
    : g.queued
      ? tx(
          g.place_offered
            ? "Место предложено — подтверди участие"
            : "Ты в резерве",
        )
      : g.request_status === "PENDING"
        ? tx("Заявка ожидает решения")
        : g.live
          ? tx("● Матч идёт")
          : {
              GOING: tx("● Ты идёшь"),
              MAYBE: tx("● Под вопросом"),
              DECLINED: tx("Ты не идёшь"),
              INVITED: tx("Приглашение"),
            }[g.attendance_status || ""] || tx("Можно присоединиться");
}
export default function GameCard({
  game,
  compact = false,
}: {
  game: GameDay;
  compact?: boolean;
}) {
  useLocale();

  const date = new Date(`${game.game_date}T12:00:00`);
  return (
    <section className="game-card">
      <div className="game-card-top">
        <strong className="game-time">
          {game.start_time?.slice(0, 5) || "—:—"}
        </strong>
        <div className="game-date">
          {date.toLocaleDateString(dateLocale(), { weekday: "long" })}
          <br />
          <b>
            {date.toLocaleDateString(dateLocale(), {
              day: "numeric",
              month: "long",
            })}
          </b>
        </div>
      </div>
      <h3>{game.title}</h3>
      <p className="venue">
        <Icon name="pin" size={16} /> {game.venue || tx("Место уточняется")}
      </p>
      <div className="game-card-footer">
        <span>
          {game.format}×{game.format} ·{" "}
          {compact
            ? `${game.team_count} ${tx("команды")}`
            : `${game.going}/${game.capacity ?? "∞"} ${tx("игроков")}`}
        </span>
        {compact ? (
          <span className="status-chip">{attendanceLabel(game)}</span>
        ) : (
          <Link href={`/my-game?game=${game.id}`} className="neon-button">
            {tx("К игре →")}
          </Link>
        )}
      </div>
    </section>
  );
}
