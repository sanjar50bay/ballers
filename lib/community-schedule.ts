export type CommunityDraft = {
  source: string | null;
  date: string;
  time: string;
  venue: string;
  format: number;
  teams: number;
  capacity: number | null;
};
export type CommunityOperation = { id: string; draft: CommunityDraft };
const memory = new Map<string, CommunityOperation>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = (community: string, actor: string) =>
  `ballers:community-schedule:${actor}:${community}`;
export function readCommunityOperation(
  community: string,
  actor: string,
): CommunityOperation | null {
  const k = key(community, actor);
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return memory.get(k) || null;
    const p = JSON.parse(raw),
      d = p.draft;
    if (
      uuid.test(p.id) &&
      (d.source === null || uuid.test(d.source)) &&
      /^\d{4}-\d{2}-\d{2}$/.test(d.date) &&
      /^\d{2}:\d{2}(:\d{2})?$/.test(d.time) &&
      typeof d.venue === "string" &&
      d.venue.trim().length > 0 &&
      d.venue.length <= 160 &&
      Number.isInteger(d.format) &&
      d.format >= 1 &&
      d.format <= 11 &&
      Number.isInteger(d.teams) &&
      d.teams >= 2 &&
      d.teams <= 8 &&
      (d.capacity === null ||
        (Number.isInteger(d.capacity) && d.capacity >= 1 && d.capacity <= 200))
    )
      return p;
  } catch {}
  return memory.get(k) || null;
}
export function saveCommunityOperation(
  community: string,
  actor: string,
  p: CommunityOperation | null,
) {
  const k = key(community, actor);
  if (p) memory.set(k, p);
  else memory.delete(k);
  try {
    if (p) localStorage.setItem(k, JSON.stringify(p));
    else localStorage.removeItem(k);
  } catch {}
}
export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function followingWeek(source: string, today = localDate()) {
  const day = new Date(source + "T12:00:00Z");
  day.setUTCDate(day.getUTCDate() + 7);
  const minimum = new Date(today + "T12:00:00Z").getTime();
  if (day.getTime() < minimum)
    day.setUTCDate(
      day.getUTCDate() +
        7 * Math.ceil((minimum - day.getTime()) / (7 * 86400000)),
    );
  return day.toISOString().slice(0, 10);
}
