import Link from "next/link";
import Icon from "./Icon";
import type { GameDay } from "./AppState";
export function attendanceLabel(g: GameDay) {
  return g.status !== "OPEN"
    ? "День завершён"
    : g.live
      ? "● Матч идёт"
      : {
          GOING: "● Ты идёшь",
          MAYBE: "● Под вопросом",
          DECLINED: "Ты не идёшь",
          INVITED: "Приглашение",
        }[g.attendance_status || ""] || "Можно присоединиться";
}
export default function GameCard({
  game,
  compact = false,
}: {
  game: GameDay;
  compact?: boolean;
}) {
  const date = new Date(`${game.game_date}T12:00:00`);
  return (
    <section className="game-card">
      <div className="game-card-top">
        <strong className="game-time">
          {game.start_time?.slice(0, 5) || "—:—"}
        </strong>
        <div className="game-date">
          {date.toLocaleDateString("ru-RU", { weekday: "long" })}
          <br />
          <b>
            {date.toLocaleDateString("ru-RU", {
              day: "numeric",
              month: "long",
            })}
          </b>
        </div>
      </div>
      <h3>{game.title}</h3>
      <p className="venue">
        <Icon name="pin" size={16} /> {game.venue || "Место уточняется"}
      </p>
      <div className="game-card-footer">
        <span>
          {game.format}×{game.format} ·{" "}
          {compact
            ? `${game.team_count} команды`
            : `${game.going}/${game.capacity ?? "∞"} игроков`}
        </span>
        {compact ? (
          <span className="status-chip">{attendanceLabel(game)}</span>
        ) : (
          <Link href={`/my-game?game=${game.id}`} className="neon-button">
            К игре →
          </Link>
        )}
      </div>
    </section>
  );
}
