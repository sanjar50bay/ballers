import type { GameDay } from "@/app/components/AppState";

export function nextPlayerGame(games: GameDay[]) {
  const open = games.filter((g) => g.status === "OPEN");
  const available = open.filter((g) => g.attendance_status !== "DECLINED");
  return [...(available.length ? available : open)].sort(
    (a, b) =>
      Number(b.live) - Number(a.live) ||
      a.game_date.localeCompare(b.game_date) ||
      (a.start_time || "99:99").localeCompare(b.start_time || "99:99") ||
      a.id.localeCompare(b.id),
  )[0];
}

export function playersNeeded(game: Pick<GameDay, "format" | "going">) {
  return Math.max(0, game.format * 2 - game.going);
}
