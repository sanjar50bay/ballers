"use client";
import { t as tx, dateLocale } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";
import GameAttendanceActions from "./GameAttendanceActions";
import { playersNeeded } from "@/lib/player-home";
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
  featured = false,
}: {
  game: GameDay;
  compact?: boolean;
  featured?: boolean;
}) {
  useLocale();

  const date = new Date(`${game.game_date}T12:00:00`);
  return (
    <section
      className={"game-card" + (featured ? " next-game-card" : "")}
      aria-label={featured ? tx("Твоя ближайшая игра") : undefined}
    >
      {featured && (
        <p className="next-game-status" role="status">
          {attendanceLabel(game)}
        </p>
      )}
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
      {featured && !game.live && (
        <p className="next-game-readiness">
          {playersNeeded(game) > 0
            ? tx("До двух составов не хватает: {count}", {
                count: playersNeeded(game),
              })
            : tx("На два состава хватает игроков")}
        </p>
      )}
      {featured && (
        <p className="next-game-count">
          {game.format}×{game.format} · {game.going}/{game.capacity ?? "∞"}{" "}
          {tx("игроков")}
        </p>
      )}
      {featured && <GameAttendanceActions key={game.id} game={game} />}
      <div className="game-card-footer">
        {!featured && (
          <span>
            {game.format}×{game.format} ·{" "}
            {compact
              ? `${game.team_count} ${tx("команды")}`
              : `${game.going}/${game.capacity ?? "∞"} ${tx("игроков")}`}
          </span>
        )}
        {compact ? (
          <span className="status-chip">{attendanceLabel(game)}</span>
        ) : (
          <Link href={`/games/${game.id}/play`} className="neon-button">
            {tx(
              featured
                ? game.live
                  ? "Открыть матч →"
                  : "Открыть игру →"
                : "К игре →",
            )}
          </Link>
        )}
      </div>
      {featured && (
        <Link
          className="next-game-roster"
          href={`/games/${game.id}/play?tab=participants`}
        >
          {tx("Кто играет →")}
        </Link>
      )}
    </section>
  );
}
