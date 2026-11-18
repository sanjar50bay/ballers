type Team = { id: string; name: string; player_ids: string[] };
export type PreparationInput = {
  game: {
    format: number;
    game_date?: string;
    start_time?: string | null;
    venue?: string | null;
  };
  teams: Team[];
  roles: { team_id: string; captain_id: string | null }[];
  participants: { player_id: string; attendance_status: string }[];
  waitlist?: { player_id: string }[];
  session: { team_a: string; team_b: string } | null;
  control?: { leader_id: string | null };
};

export function gamePreparation(s: PreparationInput) {
  const waiting = new Set(s.waitlist?.map((p) => p.player_id) || []);
  const going = new Set(
    s.participants
      .filter((p) => p.attendance_status === "GOING")
      .map((p) => p.player_id),
  );
  const pair = s.session
    ? [
        s.teams.find((t) => t.id === s.session!.team_a),
        s.teams.find((t) => t.id === s.session!.team_b),
      ]
    : s.teams.slice(0, 2);
  const validPair =
    pair.length === 2 && pair.every(Boolean) && pair[0]!.id !== pair[1]!.id;
  const teams = pair.filter((t): t is Team => !!t);
  const playersReady = going.size >= s.game.format * 2;
  const teamsReady =
    validPair &&
    new Set(teams.flatMap((t) => t.player_ids)).size ===
      teams.reduce((count, t) => count + t.player_ids.length, 0) &&
    teams.every(
      (t) =>
        t.player_ids.length >= s.game.format &&
        t.player_ids.every((id) => going.has(id)),
    );
  const captainsReady =
    validPair &&
    teams.every((t) => {
      const captain = s.roles.find((r) => r.team_id === t.id)?.captain_id;
      return !!captain && t.player_ids.includes(captain) && going.has(captain);
    });
  const leaderReady = !!s.control?.leader_id;
  return {
    going: going.size,
    needed: s.game.format * 2,
    teams,
    playersReady,
    teamsReady,
    captainsReady,
    leaderReady,
    missing: Math.max(0, s.game.format * 2 - going.size),
    invited: s.participants.filter((p) => p.attendance_status === "INVITED")
      .length,
    maybe: s.participants.filter(
      (p) => p.attendance_status === "MAYBE" && !waiting.has(p.player_id),
    ).length,
    reserved: waiting.size,
    declined: s.participants.filter((p) => p.attendance_status === "DECLINED")
      .length,
    dateSpecified: !!s.game.game_date?.trim(),
    timeSpecified: !!s.game.start_time?.trim(),
    venueSpecified: !!s.game.venue?.trim(),
    nextStep: !playersReady
      ? "players"
      : !teamsReady
        ? "teams"
        : !captainsReady
          ? "captains"
          : !leaderReady
            ? "leader"
            : null,
    ready: playersReady && teamsReady && captainsReady && leaderReady,
  };
}
