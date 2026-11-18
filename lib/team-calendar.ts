export type TeamCalendar = {
  member: boolean;
  can_plan: boolean;
  team_name: string;
  communities: {
    id: string;
    name: string;
    format: number;
    team_count: number;
    capacity: number | null;
    linked: boolean;
  }[];
  games: TeamCalendarGame[];
};
export type TeamCalendarGame = {
  id: string;
  title: string;
  game_date: string;
  start_time: string | null;
  venue: string | null;
  community_id: string;
  community_name: string;
  format: number;
  status: string;
  upcoming: boolean;
  live: boolean;
  attendance_status: string | null;
  going: number;
  invited: number;
};
export type ScheduleDraft = {
  community: string;
  date: string;
  time: string;
  venue: string;
};
export type ScheduleOperation = { id: string; draft: ScheduleDraft };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const memory = new Map<string, ScheduleOperation>();
const key = (team: string, actor: string) =>
  `ballers:team-schedule:${actor}:${team}`;
export function readSchedule(
  team: string,
  actor: string,
): ScheduleOperation | null {
  const k = key(team, actor);
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return memory.get(k) || null;
    const p = JSON.parse(raw);
    if (
      uuid.test(p.id) &&
      uuid.test(p.draft?.community) &&
      /^\d{4}-\d{2}-\d{2}$/.test(p.draft?.date) &&
      /^\d{2}:\d{2}(:\d{2})?$/.test(p.draft?.time) &&
      typeof p.draft?.venue === "string" &&
      p.draft.venue.trim().length > 0 &&
      p.draft.venue.length <= 160
    )
      return p;
  } catch {}
  return memory.get(k) || null;
}
export function saveSchedule(
  team: string,
  actor: string,
  value: ScheduleOperation | null,
) {
  const k = key(team, actor);
  if (value) memory.set(k, value);
  else memory.delete(k);
  try {
    if (value) localStorage.setItem(k, JSON.stringify(value));
    else localStorage.removeItem(k);
  } catch {}
}
