// All currently supported cities are in Kazakhstan (UTC+5, no DST).
// This controls presentation only; migration014 enforces the actual server clock.
export function scheduledStart(game: {
  game_date?: string;
  start_time?: string | null;
}) {
  if (!game.game_date) return null;
  const source = game.start_time || "00:00";
  const time = source.length === 5 ? source + ":00" : source.slice(0, 8);
  const value = Date.parse(`${game.game_date}T${time}+05:00`);
  return Number.isFinite(value) ? value : null;
}
