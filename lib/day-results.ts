export type DayMatch = {
  id: string;
  sequence: number;
  team_a: string;
  team_b: string;
  score_a: number;
  score_b: number;
  status: string;
  is_test: boolean;
};
export type DayEvent = {
  id: string;
  match_id: string;
  kind: string;
  player_id: string;
  assist_id: string | null;
  voided: boolean;
  elapsed_seconds: number;
};
export type DayTeam = { id: string; name: string };
export type DayRoster = {
  match_id: string;
  player_id: string;
  team_id: string;
};
export function dayResults(
  matches: DayMatch[],
  events: DayEvent[],
  teams: DayTeam[],
  rosters: DayRoster[],
  test = false,
) {
  const confirmed = matches.filter(
      (m) => m.status === "VERIFIED" && m.is_test === test,
    ),
    ids = new Set(confirmed.map((m) => m.id));
  const table = teams.map((t) => ({
    ...t,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    points: 0,
  }));
  for (const m of confirmed) {
    for (const [id, gf, ga] of [
      [m.team_a, m.score_a, m.score_b],
      [m.team_b, m.score_b, m.score_a],
    ] as [string, number, number][]) {
      const t = table.find((t) => t.id === id);
      if (!t) continue;
      t.played++;
      t.gf += gf;
      t.ga += ga;
      if (gf > ga) {
        t.wins++;
        t.points += 3;
      } else if (gf === ga) {
        t.draws++;
        t.points++;
      } else t.losses++;
    }
  }
  table.sort(
    (a, b) =>
      b.points - a.points ||
      b.gf - b.ga - (a.gf - a.ga) ||
      b.gf - a.gf ||
      a.name.localeCompare(b.name),
  );
  const scorers = new Map<
    string,
    {
      id: string;
      goals: number;
      assists: number;
      saves: number;
      yellow: number;
      red: number;
      team_ids: string[];
    }
  >();
  const row = (id: string) => {
    if (!scorers.has(id))
      scorers.set(id, {
        id,
        goals: 0,
        assists: 0,
        saves: 0,
        yellow: 0,
        red: 0,
        team_ids: [
          ...new Set(
            rosters
              .filter((r) => r.player_id === id && ids.has(r.match_id))
              .map((r) => r.team_id),
          ),
        ],
      });
    return scorers.get(id)!;
  };
  for (const e of events.filter((e) => ids.has(e.match_id) && !e.voided)) {
    const r = row(e.player_id);
    if (e.kind === "GOAL") {
      r.goals++;
      if (e.assist_id) row(e.assist_id).assists++;
    } else if (e.kind === "SAVE") r.saves++;
    else if (e.kind === "YELLOW") r.yellow++;
    else if (e.kind === "RED") r.red++;
  }
  return {
    table,
    scorers: [...scorers.values()].sort(
      (a, b) =>
        b.goals - a.goals || b.assists - a.assists || a.id.localeCompare(b.id),
    ),
    confirmed: confirmed.length,
    pending: matches.filter(
      (m) => m.is_test === test && ["PENDING", "DISPUTED"].includes(m.status),
    ).length,
  };
}
