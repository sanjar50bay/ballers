export type StartOperation = {
  id: string;
  sequence: number;
  leaderVersion: number;
};
export const startKey = (game: string, player: string) =>
  `ballers:start:${game}:${player}`;
export function readStart(game: string, player: string): StartOperation | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(startKey(game, player)) || "null",
    );
    return value &&
      typeof value.id === "string" &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id) &&
      Number.isInteger(value.sequence) &&
      value.sequence >= 0 &&
      Number.isInteger(value.leaderVersion) &&
      value.leaderVersion > 0
      ? value
      : null;
  } catch {
    return null;
  }
}
export function saveStart(
  game: string,
  player: string,
  operation: StartOperation | null,
) {
  try {
    if (operation)
      localStorage.setItem(startKey(game, player), JSON.stringify(operation));
    else localStorage.removeItem(startKey(game, player));
  } catch {
    /* In-memory retry still preserves the operation while this page is open. */
  }
}
