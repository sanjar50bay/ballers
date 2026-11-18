type Team = { id: string; name: string; player_ids: string[] };
export type PreparationInput = {
  game: { format: number };
  teams: Team[];
  roles: { team_id: string; captain_id: string | null }[];
  participants: { player_id: string; attendance_status: string }[];
  session: { team_a: string; team_b: string } | null;
  control?: { leader_id: string | null };
};

export function gamePreparation(s: PreparationInput) {
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
    ready: playersReady && teamsReady && captainsReady && leaderReady,
  };
}
