"use client";
import { t as tx, dateLocale, uiError, positionLabel } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Avatar from "@/app/components/Avatar";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  teamAction,
  setAttendance,
  preMatchError,
  type TeamAction,
} from "@/lib/pre-match";

type GameDay = {
  id: string;
  community_id: string;
  title: string;
  game_date: string;
  start_time: string | null;
  venue: string | null;
  format: number;
  team_count: number;
  capacity: number | null;
  status: string;
  roster_version: number;
};

type Player = {
  id: string;
  baller_id?: number;
  first_name: string;
  last_name: string | null;
  display_name?: string | null;
  primary_position: string;
  avatar_url: string | null;
};

type Participant = {
  id: string;
  attendance_status: string;
  participant_type: string;
  player_profiles: Player | null;
};

type CommunityMember = {
  id: string;
  role: string;
  member_status?: string;
  player_profiles: Player | null;
};

type TeamPlayer = {
  id: string;
  player_id: string;
  is_core: boolean;
  player_profiles: Player | null;
};

type TeamMode = "RANDOM" | "FIXED" | "CORE_PLUS_FILL";

type TeamColor =
  "BLUE" | "RED" | "YELLOW" | "GREEN" | "ORANGE" | "WHITE" | "BLACK" | "PURPLE";

const TEAM_COLOR_OPTIONS: { value: TeamColor; label: string }[] = [
  { value: "BLUE", label: "Blue" },
  { value: "RED", label: "Red" },
  { value: "YELLOW", label: "Yellow" },
  { value: "GREEN", label: "Green" },
  { value: "ORANGE", label: "Orange" },
  { value: "WHITE", label: "White" },
  { value: "BLACK", label: "Black" },
  { value: "PURPLE", label: "Purple" },
];

type GameTeam = {
  id: string;
  name: string;
  color_key: string;
  sort_order: number;
  team_mode: TeamMode;
  game_day_team_players: TeamPlayer[];
};

export default function GameDayPage() {
  useLocale();

  const params = useParams();
  const router = useRouter();

  const communityId = params.id as string;
  const gameId = params.gameId as string;

  const [game, setGame] = useState<GameDay | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [communityMembers, setCommunityMembers] = useState<CommunityMember[]>(
    [],
  );
  const [teams, setTeams] = useState<GameTeam[]>([]);

  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [myStatus, setMyStatus] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [invitingSelected, setInvitingSelected] = useState(false);
  const [creatingGuestInvite, setCreatingGuestInvite] = useState(false);
  const [updatingParticipantId, setUpdatingParticipantId] = useState<
    string | null
  >(null);

  const [addingToCommunity, setAddingToCommunity] = useState<string | null>(
    null,
  );

  const [buildingTeams, setBuildingTeams] = useState(false);
  const [assigningPlayerId, setAssigningPlayerId] = useState<string | null>(
    null,
  );
  const [randomizing, setRandomizing] = useState(false);
  const [resettingTeams, setResettingTeams] = useState(false);
  const [updatingTeamId, setUpdatingTeamId] = useState<string | null>(null);
  const [playersOpen, setPlayersOpen] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [expandedTeamIds, setExpandedTeamIds] = useState<string[]>([]);

  const loadTeams = useCallback(async () => {
    const { data, error } = await supabase
      .from("game_day_teams")
      .select(
        `
        id,
        name,
        color_key,
        sort_order,
        team_mode,
        game_day_team_players!game_day_team_players_team_id_fkey (
          id,
          player_id,
          is_core,
          player_profiles (
            id,
            baller_id,
            first_name,
            last_name,
            display_name,
            primary_position,
            avatar_url
          )
        )
      `,
      )
      .eq("game_day_id", gameId)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error(
        "Teams error:",
        JSON.stringify({
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        }),
      );
      setTeamsError(error.message);
      return;
    }

    setTeamsError(null);
    setTeams((data || []) as unknown as GameTeam[]);
  }, [gameId]);

  const loadGame = useCallback(async () => {
    setMyRole(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/");
      return;
    }

    const { data: profile } = await supabase
      .from("player_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!profile) {
      router.push("/onboarding");
      return;
    }

    setMyPlayerId(profile.id);

    const { data: gameData, error: gameError } = await supabase
      .from("game_days")
      .select("*")
      .eq("id", gameId)
      .eq("community_id", communityId)
      .single();

    if (gameError || !gameData) {
      console.error(gameError);
      setLoading(false);
      return;
    }

    setGame(gameData);

    const { data: participantData, error: participantError } = await supabase
      .from("game_participants")
      .select(
        `
        id,
        attendance_status,
        participant_type,
        player_profiles (
          id,
          baller_id,
          first_name,
          last_name,
          display_name,
          primary_position,
          avatar_url
        )
      `,
      )
      .eq("game_day_id", gameId);

    if (participantError) {
      console.error(participantError);
    }

    const { data: waiting } = await supabase
      .from("ballers_waitlist")
      .select("player_id")
      .eq("game_day_id", gameId);
    const waitingIds = new Set(
      (waiting || []).map((item) => item.player_id as string),
    );
    const cleanParticipants = (
      (participantData || []) as unknown as Participant[]
    ).map((item) =>
      waitingIds.has(item.player_profiles?.id || "")
        ? { ...item, attendance_status: "WAITING" }
        : item,
    );

    setParticipants(cleanParticipants);

    const mine = cleanParticipants.find(
      (item) => item.player_profiles?.id === profile.id,
    );

    setMyStatus(mine?.attendance_status ?? null);

    const { data: memberData, error: memberError } = await supabase
      .from("community_members")
      .select(
        `
        id,
        role,
        member_status,
        player_profiles (
          id,
          baller_id,
          first_name,
          last_name,
          display_name,
          primary_position,
          avatar_url
        )
      `,
      )
      .eq("community_id", communityId);

    if (memberError) {
      console.error(memberError);
    }

    const cleanMembers = (memberData || []) as unknown as CommunityMember[];

    setCommunityMembers(cleanMembers);

    const myMembership = cleanMembers.find(
      (member) => member.player_profiles?.id === profile.id,
    );

    setMyRole(myMembership?.role ?? null);

    await loadTeams();

    setLoading(false);
  }, [gameId, communityId, router, loadTeams]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadGame();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadGame]);

  const updateAttendance = async (status: "GOING" | "MAYBE" | "DECLINED") => {
    if (!myPlayerId) return;
    setUpdating(true);
    try {
      const { error } = await setAttendance(gameId, myPlayerId, status);
      if (error) alert(preMatchError(error));
      await loadGame();
    } finally {
      setUpdating(false);
    }
  };

  const toggleSelectedMember = (playerId: string) => {
    setSelectedMemberIds((current) =>
      current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : [...current, playerId],
    );
  };

  const inviteSelectedMembers = async () => {
    if (selectedMemberIds.length === 0) return;

    const existingPlayerIds = new Set(
      participants
        .map((item) => item.player_profiles?.id)
        .filter((id): id is string => Boolean(id)),
    );

    const rows = selectedMemberIds
      .filter((playerId) => !existingPlayerIds.has(playerId))
      .map((playerId) => ({
        game_day_id: gameId,
        player_id: playerId,
        attendance_status: "INVITED",
        participant_type: "MEMBER",
      }));

    if (rows.length === 0) {
      setSelectedMemberIds([]);
      setInviteOpen(false);
      return;
    }

    setInvitingSelected(true);

    const { error } = await supabase.from("game_participants").insert(rows);

    if (error) {
      alert(uiError(error.message));
      setInvitingSelected(false);
      return;
    }

    setSelectedMemberIds([]);
    setInviteOpen(false);
    await loadGame();
    setInvitingSelected(false);
  };

  const updateParticipantAttendance = async (
    participant: Participant,
    status: "INVITED" | "GOING" | "MAYBE" | "DECLINED",
  ) => {
    const playerId = participant.player_profiles?.id;
    if (!playerId) return;
    setUpdatingParticipantId(participant.id);
    try {
      const { error } = await setAttendance(gameId, playerId, status);
      if (error) alert(preMatchError(error));
      await loadGame();
    } finally {
      setUpdatingParticipantId(null);
    }
  };

  const createGuestInvite = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !game) return;

    setCreatingGuestInvite(true);

    const { data, error } = await supabase
      .from("invites")
      .insert({
        invite_type: "GAME_GUEST",
        community_id: game.community_id,
        game_day_id: game.id,
        created_by: user.id,
      })
      .select("token")
      .single();

    if (error || !data) {
      alert(
        error?.message ? uiError(error.message) : tx("Could not create invite"),
      );
      setCreatingGuestInvite(false);
      return;
    }

    const inviteUrl = `${window.location.origin}/join/${data.token}`;

    try {
      await navigator.clipboard.writeText(inviteUrl);
      alert(tx("Гостевое приглашение скопировано:") + "\n\n" + inviteUrl);
    } catch {
      alert(tx("Гостевое приглашение:") + "\n\n" + inviteUrl);
    }

    setCreatingGuestInvite(false);
  };

  const addGuestToCommunity = async (playerId: string, playerName: string) => {
    const confirmed = window.confirm(
      tx("Добавить {name} в сообщество как постоянного участника?", {
        name: playerName,
      }),
    );

    if (!confirmed) return;

    setAddingToCommunity(playerId);

    const { error } = await supabase.rpc("add_player_to_community", {
      target_community_id: communityId,
      target_player_id: playerId,
    });

    if (error) {
      alert(uiError(error.message));
      setAddingToCommunity(null);
      return;
    }

    await loadGame();

    setAddingToCommunity(null);

    alert(tx("{name} теперь участник сообщества", { name: playerName }));
  };

  // ------------------------------------------------
  // TEAMS
  // ------------------------------------------------

  const runTeamAction = async (
    action: TeamAction,
    payload: Record<string, unknown> = {},
  ) => {
    if (!game) return null;
    const { data, error } = await teamAction(
      gameId,
      game.roster_version,
      action,
      payload,
    );
    if (error) alert(preMatchError(error));
    await loadGame();
    return error ? null : data;
  };

  const buildTeams = async () => {
    setBuildingTeams(true);
    try {
      await runTeamAction("BUILD");
    } finally {
      setBuildingTeams(false);
    }
  };

  const updateTeamMode = async (teamId: string, mode: TeamMode) => {
    setUpdatingTeamId(teamId);
    try {
      await runTeamAction("UPDATE_TEAM", { team_id: teamId, team_mode: mode });
    } finally {
      setUpdatingTeamId(null);
    }
  };

  const updateTeamName = async (teamId: string, name: string) => {
    if (!name.trim()) {
      alert(tx("Team name cannot be empty."));
      return;
    }
    setUpdatingTeamId(teamId);
    try {
      await runTeamAction("UPDATE_TEAM", {
        team_id: teamId,
        name: name.trim(),
      });
    } finally {
      setUpdatingTeamId(null);
    }
  };

  const updateTeamColor = async (teamId: string, color: TeamColor) => {
    setUpdatingTeamId(teamId);
    try {
      await runTeamAction("UPDATE_TEAM", { team_id: teamId, color_key: color });
    } finally {
      setUpdatingTeamId(null);
    }
  };

  const resetTeams = async () => {
    if (!teams.some((team) => team.game_day_team_players.length)) return;
    if (
      !window.confirm(
        tx(
          "Reset today's assignments? Attendance, team names, colors and modes will stay unchanged.",
        ),
      )
    )
      return;
    setResettingTeams(true);
    try {
      await runTeamAction("RESET");
    } finally {
      setResettingTeams(false);
    }
  };

  const toggleTeamExpanded = (teamId: string) => {
    setExpandedTeamIds((current) =>
      current.includes(teamId)
        ? current.filter((id) => id !== teamId)
        : [...current, teamId],
    );
  };

  const assignPlayerToTeam = async (
    playerId: string,
    teamId: string | null,
  ) => {
    setAssigningPlayerId(playerId);
    try {
      await runTeamAction("ASSIGN", { player_id: playerId, team_id: teamId });
    } finally {
      setAssigningPlayerId(null);
    }
  };

  const toggleCorePlayer = async (player: TeamPlayer) => {
    setAssigningPlayerId(player.player_id);
    try {
      await runTeamAction("CORE", {
        assignment_id: player.id,
        is_core: !player.is_core,
      });
    } finally {
      setAssigningPlayerId(null);
    }
  };

  const randomizeTeams = async () => {
    setRandomizing(true);
    try {
      const result = await runTeamAction("RANDOMIZE");
      if (result && result.unassigned > 0)
        alert(
          tx(
            "В пуле осталось {count} игроков. Защищённые составы мешают равномерному распределению. Измени их или используй добор к основе.",
            { count: result.unassigned },
          ),
        );
    } finally {
      setRandomizing(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#02030a] text-white flex items-center justify-center">
        <p className="text-violet-400 animate-pulse">
          {tx("Loading Game Day...")}
        </p>
      </main>
    );
  }

  if (!game) {
    return (
      <main className="min-h-screen bg-[#02030a] text-white flex items-center justify-center">
        {tx("Game Day not found")}
      </main>
    );
  }

  const goingPlayers = participants.filter(
    (p) => p.attendance_status === "GOING",
  );

  const maybePlayers = participants.filter(
    (p) => p.attendance_status === "MAYBE",
  );

  const invitedPlayers = participants.filter(
    (p) => p.attendance_status === "INVITED",
  );

  const declinedPlayers = participants.filter(
    (p) => p.attendance_status === "DECLINED",
  );

  const capacity = game.capacity ?? 0;
  const remaining = Math.max(capacity - goingPlayers.length, 0);

  const filledPercent =
    capacity > 0 ? Math.min((goingPlayers.length / capacity) * 100, 100) : 0;

  const canManage = myRole === "OWNER" || myRole === "MANAGER";

  const communityPlayerIds = new Set(
    communityMembers
      .map((member) => member.player_profiles?.id)
      .filter((id): id is string => Boolean(id)),
  );

  const assignedPlayerIds = new Set(
    teams.flatMap((team) =>
      (team.game_day_team_players || []).map((item) => item.player_id),
    ),
  );

  const unassignedGoingPlayers = goingPlayers.filter(
    (participant) =>
      participant.player_profiles &&
      !assignedPlayerIds.has(participant.player_profiles.id),
  );

  const getPlayerStatus = (playerId: string) => {
    return participants.find((item) => item.player_profiles?.id === playerId)
      ?.attendance_status;
  };

  const participantPlayerIds = new Set(
    participants
      .map((item) => item.player_profiles?.id)
      .filter((id): id is string => Boolean(id)),
  );

  const availableCommunityMembers = communityMembers.filter(
    (member) =>
      member.player_profiles &&
      !participantPlayerIds.has(member.player_profiles.id),
  );

  const availableCommunityPlayerIds = availableCommunityMembers
    .map((member) => member.player_profiles?.id)
    .filter((id): id is string => Boolean(id));

  const allAvailableSelected =
    availableCommunityPlayerIds.length > 0 &&
    availableCommunityPlayerIds.every((id) => selectedMemberIds.includes(id));

  const assignedCount = assignedPlayerIds.size;
  const poolCount = unassignedGoingPlayers.length;
  const maxTeamRosterSize =
    teams.length > 0 ? Math.ceil(goingPlayers.length / teams.length) : 0;

  const playerTeamById = new Map<string, GameTeam>();
  teams.forEach((team) => {
    (team.game_day_team_players || []).forEach((item) => {
      playerTeamById.set(item.player_id, team);
    });
  });

  const statusOrder: Record<string, number> = {
    GOING: 0,
    MAYBE: 1,
    INVITED: 2,
    DECLINED: 3,
  };

  const sortedParticipants = [...participants].sort((a, b) => {
    const statusDiff =
      (statusOrder[a.attendance_status] ?? 99) -
      (statusOrder[b.attendance_status] ?? 99);

    if (statusDiff !== 0) return statusDiff;

    const aName = a.player_profiles ? getPlayerName(a.player_profiles) : "";
    const bName = b.player_profiles ? getPlayerName(b.player_profiles) : "";
    return aName.localeCompare(bName);
  });

  return (
    <main className="min-h-screen bg-[#02030a] text-white pb-24">
      <div className="max-w-md mx-auto px-4 pt-6">
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={() => router.back()}
            className="w-10 h-10 rounded-full border border-violet-900/50 bg-[#090b14]
            flex items-center justify-center cursor-pointer"
          >
            ←
          </button>

          <p className="font-bold">{tx("Game Day")}</p>

          <div className="w-10" />
        </div>

        {/* HERO */}

        <section
          className="relative overflow-hidden rounded-[26px]
          border border-violet-500/60
          bg-gradient-to-br from-[#180b36] via-[#080b1b] to-[#07172d]
          p-5 mb-6
          shadow-[0_0_35px_rgba(124,58,237,0.22)]"
        >
          <div className="absolute -right-12 -top-16 w-52 h-52 rounded-full bg-violet-600/25 blur-3xl" />

          <div className="relative flex gap-4">
            <div
              className="w-[72px] h-[92px] rounded-2xl
              border border-violet-500/60 bg-[#11152d]/80
              flex flex-col items-center justify-center shrink-0"
            >
              <span className="text-xs text-violet-300">
                {formatMonth(game.game_date)}
              </span>

              <span className="text-3xl font-black">
                {formatDay(game.game_date)}
              </span>

              <span className="text-xs text-gray-500">
                {formatWeekday(game.game_date)}
              </span>
            </div>

            <div>
              <p className="text-violet-400 text-xs uppercase font-bold">
                {tx("Upcoming Game")}
              </p>

              <h1 className="text-2xl font-black mt-1">{game.title}</h1>

              <p className="text-gray-300 mt-3">
                {game.start_time?.slice(0, 5) || tx("Time TBD")}
              </p>

              {game.venue && (
                <p className="text-gray-500 text-sm mt-1">◉ {game.venue}</p>
              )}
            </div>
          </div>

          <div className="flex gap-2 mt-5">
            <BluePill>
              {game.format}×{game.format}
            </BluePill>
            <BluePill>
              {game.team_count} {tx("команды")}
            </BluePill>
            <BluePill>
              {goingPlayers.length}/{capacity}
            </BluePill>
          </div>
        </section>

        <Link
          href={`/games/${gameId}/play`}
          className="block mb-6 rounded-2xl border border-violet-500 bg-violet-600 py-4 px-5 font-black text-center"
        >
          {tx("Счёт, очередь и матчи →")}
        </Link>
        <p className="role-context mb-4">
          {tx(
            canManage
              ? "Ты организатор этого игрового дня"
              : "Ты игрок: управляешь только своим участием",
          )}
        </p>
        {/* STATUS */}

        <section className="mb-7">
          <h2 className="text-xl font-black mb-3">
            {tx("Will you attend?")}
            {myStatus === "WAITING" && (
              <span className="text-sm text-amber-300">
                {tx("· Вы в очереди ожидания")}
              </span>
            )}
          </h2>

          <div className="grid grid-cols-3 gap-3">
            <StatusButton
              active={myStatus === "GOING"}
              icon="✓"
              title={tx("Going")}
              type="green"
              disabled={updating}
              onClick={() => updateAttendance("GOING")}
            />

            <StatusButton
              active={myStatus === "MAYBE"}
              icon="?"
              title={tx("Maybe")}
              type="purple"
              disabled={updating}
              onClick={() => updateAttendance("MAYBE")}
            />

            <StatusButton
              active={myStatus === "DECLINED"}
              icon="×"
              title={tx("Out")}
              type="red"
              disabled={updating}
              onClick={() => updateAttendance("DECLINED")}
            />
          </div>
        </section>

        {/* CAPACITY */}

        <section className="rounded-[22px] border border-white/5 bg-[#080b14] p-5 mb-7">
          <div className="flex justify-between">
            <div>
              <p className="font-bold">{tx("Player slots")}</p>
              <p className="text-xs text-gray-500 mt-1">
                {remaining}
                {tx("spots remaining")}
              </p>
            </div>

            <p className="font-bold">
              {goingPlayers.length}/{capacity}
            </p>
          </div>

          <div className="h-3 bg-[#151824] rounded-full overflow-hidden mt-4">
            <div
              className="h-full bg-gradient-to-r from-emerald-400 to-green-300"
              style={{ width: `${filledPercent}%` }}
            />
          </div>
        </section>

        {/* TEAMS */}

        <section className="mb-8">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2 className="text-xl font-black">{tx("Teams")}</h2>
              <p className="text-xs text-gray-500 mt-1">
                {tx("Build, protect and randomize your squads")}
              </p>
            </div>

            {teams.length > 0 && canManage && (
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={resetTeams}
                  disabled={resettingTeams || assignedCount === 0}
                  className="text-xs font-black text-gray-300
                  border border-white/10 bg-white/5
                  px-3 py-2 rounded-xl cursor-pointer
                  disabled:opacity-35 disabled:cursor-not-allowed"
                >
                  {resettingTeams ? tx("Resetting...") : tx("Reset")}
                </button>

                <button
                  onClick={randomizeTeams}
                  disabled={randomizing}
                  className="text-xs font-black text-violet-200
                  border border-violet-500/50 bg-violet-500/10
                  px-3 py-2 rounded-xl cursor-pointer
                  shadow-[0_0_16px_rgba(124,58,237,0.2)]"
                >
                  {randomizing ? tx("Generating...") : tx("⚡ Randomize")}
                </button>
              </div>
            )}
          </div>

          {teams.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-4">
              <TeamStat label={tx("Going")} value={goingPlayers.length} />
              <TeamStat label={tx("Assigned")} value={assignedCount} />
              <TeamStat label={tx("Pool")} value={poolCount} />
            </div>
          )}

          {teamsError ? (
            <div
              role="alert"
              className="rounded-2xl border border-red-500/40 bg-red-950/20 p-4"
            >
              <p className="font-bold text-red-300">
                {tx("Could not load teams")}
              </p>
              <p className="text-sm text-gray-300 mt-2 break-words">
                {uiError(teamsError)}
              </p>
              <button
                onClick={() => {
                  void loadGame();
                }}
                className="mt-3 rounded-xl border border-white/20 px-4 py-2 cursor-pointer"
              >
                {tx("Retry loading")}
              </button>
            </div>
          ) : teams.length === 0 ? (
            <div
              className="rounded-[24px]
              border border-violet-800/40
              bg-gradient-to-br from-[#120b25] to-[#070910]
              p-5"
            >
              <p className="font-bold">
                {tx("Teams haven't been created yet.")}
              </p>

              <p className="text-sm text-gray-500 mt-1">
                {game.team_count} {tx("teams ·")} {game.format}×{game.format}
              </p>

              {canManage && (
                <button
                  onClick={buildTeams}
                  disabled={buildingTeams}
                  className="w-full mt-5 py-3.5 rounded-xl
                  bg-gradient-to-r from-violet-600 to-purple-600
                  font-black cursor-pointer
                  shadow-[0_0_24px_rgba(124,58,237,0.3)]"
                >
                  {buildingTeams ? tx("Building...") : tx("Build Teams")}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {teams.map((team) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  format={game.format}
                  maxRosterSize={maxTeamRosterSize}
                  canManage={canManage}
                  assigningPlayerId={assigningPlayerId}
                  updatingTeamId={updatingTeamId}
                  expanded={expandedTeamIds.includes(team.id)}
                  usedColors={teams
                    .filter((item) => item.id !== team.id)
                    .map((item) => item.color_key)}
                  onToggleExpanded={() => toggleTeamExpanded(team.id)}
                  onModeChange={updateTeamMode}
                  onNameChange={updateTeamName}
                  onColorChange={updateTeamColor}
                  onToggleCore={toggleCorePlayer}
                  onUnassign={(playerId) => assignPlayerToTeam(playerId, null)}
                />
              ))}
            </div>
          )}
        </section>

        {/* UNASSIGNED */}

        {teams.length > 0 && unassignedGoingPlayers.length > 0 && canManage && (
          <section className="mb-8">
            <h2 className="text-xl font-black mb-1">{tx("Player Pool")}</h2>

            <p className="text-xs text-gray-500 mb-3">
              {tx("These players are available for team assignment.")}
            </p>

            <div className="space-y-2">
              {unassignedGoingPlayers.map((participant) => {
                const player = participant.player_profiles;

                if (!player) return null;

                return (
                  <div
                    key={participant.id}
                    className="rounded-2xl border border-white/5
                      bg-[#090c14] p-3"
                  >
                    <div className="flex items-center gap-3">
                      <PlayerAvatar player={player} />

                      <div className="flex-1">
                        <p className="font-bold">{getPlayerName(player)}</p>

                        <p className="text-xs text-gray-500">
                          {positionLabel(player.primary_position)}
                          {player.baller_id && ` · Baller #${player.baller_id}`}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-3">
                      {teams.map((team) => {
                        const teamIsFull =
                          maxTeamRosterSize > 0 &&
                          (team.game_day_team_players || []).length >=
                            maxTeamRosterSize;

                        return (
                          <button
                            key={team.id}
                            disabled={
                              assigningPlayerId === player.id || teamIsFull
                            }
                            onClick={() =>
                              assignPlayerToTeam(player.id, team.id)
                            }
                            className={`py-2 rounded-xl text-xs font-bold
                              border cursor-pointer disabled:opacity-35
                              disabled:cursor-not-allowed
                              ${getTeamButtonClass(team.color_key)}`}
                          >
                            {teamIsFull
                              ? `${team.name} · ${tx("Заполнена")}`
                              : team.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* INVITES */}

        {canManage && (
          <section className="mb-7">
            <h2 className="text-xl font-black mb-3">{tx("Invite Players")}</h2>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setSelectedMemberIds([]);
                  setInviteOpen(true);
                }}
                className="rounded-[20px]
                border border-violet-800/50
                bg-[#110a22] p-4 text-left cursor-pointer"
              >
                <p className="font-bold">{tx("Invite Members")}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {tx("From Community")}
                </p>
              </button>

              <button
                onClick={createGuestInvite}
                disabled={creatingGuestInvite}
                className="rounded-[20px]
                border border-blue-800/50
                bg-[#07152b] p-4 text-left cursor-pointer"
              >
                <p className="font-bold">{tx("Invite Guest")}</p>
                <p className="text-xs text-gray-500 mt-1">{tx("Share link")}</p>
              </button>
            </div>
          </section>
        )}

        {/* PLAYERS SUMMARY */}

        <section className="mb-7 rounded-[24px] border border-white/5 bg-[#080b14] p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black">{tx("Players")}</h2>
              <p className="text-xs text-gray-500 mt-1">
                {participants.length}
                {tx("in this Game Day")}
              </p>
            </div>

            <button
              onClick={() => setPlayersOpen(true)}
              className="px-3 py-2 rounded-xl border border-violet-500/40
              bg-violet-500/10 text-violet-200 text-xs font-black cursor-pointer"
            >
              {canManage ? tx("Manage →") : tx("View all →")}
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2 mt-4">
            <PlayerStatusStat
              label={tx("Going")}
              value={goingPlayers.length}
              tone="green"
            />
            <PlayerStatusStat
              label={tx("Maybe")}
              value={maybePlayers.length}
              tone="purple"
            />
            <PlayerStatusStat
              label={tx("Invited")}
              value={invitedPlayers.length}
              tone="blue"
            />
            <PlayerStatusStat
              label={tx("Out")}
              value={declinedPlayers.length}
              tone="dark"
            />
          </div>

          {participants.length > 0 && (
            <div className="participant-preview flex flex-wrap items-center gap-y-2 mt-4">
              <div className="flex -space-x-2">
                {sortedParticipants.slice(0, 6).map((participant) => {
                  const player = participant.player_profiles;
                  if (!player) return null;

                  return (
                    <div
                      key={participant.id}
                      className="rounded-full ring-2 ring-[#080b14]"
                      title={getPlayerName(player)}
                    >
                      <PlayerAvatar player={player} />
                    </div>
                  );
                })}
              </div>

              {participants.length > 6 && (
                <span className="ml-3 text-xs text-gray-500">
                  +{participants.length - 6} {tx("ещё")}
                </span>
              )}
            </div>
          )}
        </section>
      </div>

      {/* INVITE MODAL */}

      {inviteOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md max-h-[82vh] overflow-hidden rounded-[28px] border border-violet-700/50 bg-[#070910]">
            <div className="p-5 border-b border-white/5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black">
                    {tx("Invite Members")}
                  </h2>
                  <p className="text-xs text-gray-500 mt-1">
                    {tx("Select Community members for this Game Day")}
                  </p>
                </div>

                <button
                  onClick={() => {
                    if (!invitingSelected) {
                      setInviteOpen(false);
                      setSelectedMemberIds([]);
                    }
                  }}
                  className="w-9 h-9 rounded-full border border-white/10 bg-white/5 text-xl cursor-pointer"
                >
                  ×
                </button>
              </div>

              {availableCommunityPlayerIds.length > 0 && (
                <div className="flex items-center justify-between mt-5">
                  <button
                    onClick={() =>
                      setSelectedMemberIds(
                        allAvailableSelected ? [] : availableCommunityPlayerIds,
                      )
                    }
                    className="rounded-xl border border-violet-400/50 bg-violet-700 px-4 py-3 text-sm font-bold text-white cursor-pointer"
                  >
                    {allAvailableSelected
                      ? tx("Clear selection")
                      : tx("Select all / Выбрать всех")}
                  </button>

                  <span className="text-xs text-gray-500">
                    {selectedMemberIds.length} {tx("выбрано")}
                  </span>
                </div>
              )}
            </div>

            <div className="max-h-[52vh] overflow-y-auto p-5">
              {communityMembers.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-gray-400 font-bold">
                    {tx("No Community members yet")}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {communityMembers.map((member) => {
                    const player = member.player_profiles;

                    if (!player) return null;

                    const status = getPlayerStatus(player.id);
                    const selected = selectedMemberIds.includes(player.id);

                    return (
                      <button
                        key={member.id}
                        type="button"
                        disabled={Boolean(status) || invitingSelected}
                        onClick={() => toggleSelectedMember(player.id)}
                        className={`w-full flex items-center gap-3 rounded-2xl border p-3 text-left transition ${
                          status
                            ? "border-white/5 bg-[#0b0e17] opacity-65 cursor-default"
                            : selected
                              ? "border-violet-500/70 bg-violet-500/10 cursor-pointer"
                              : "border-white/5 bg-[#0b0e17] cursor-pointer"
                        }`}
                      >
                        <div
                          className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 ${
                            selected
                              ? "border-violet-400 bg-violet-500 text-white"
                              : status
                                ? "border-white/10 bg-white/5 text-gray-600"
                                : "border-white/15 bg-black/20 text-transparent"
                          }`}
                        >
                          {selected ? "✓" : "✓"}
                        </div>

                        <PlayerAvatar player={player} />

                        <div className="flex-1 min-w-0">
                          <p className="font-bold truncate">
                            {getPlayerName(player)}
                          </p>

                          <p className="text-xs text-gray-500">
                            {positionLabel(player.primary_position)}
                            {player.baller_id &&
                              ` · Baller #${player.baller_id}`}
                          </p>
                        </div>

                        {status && (
                          <StatusPill
                            status={status}
                            color={
                              status === "GOING"
                                ? "green"
                                : status === "MAYBE"
                                  ? "purple"
                                  : status === "DECLINED"
                                    ? "dark"
                                    : "blue"
                            }
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-white/5 bg-[#070910]">
              {availableCommunityPlayerIds.length === 0 ? (
                <div className="w-full py-3.5 rounded-xl border border-white/5 bg-white/5 text-center text-sm text-gray-500">
                  {tx("Everyone is already in this Game Day")}
                </div>
              ) : (
                <button
                  onClick={inviteSelectedMembers}
                  disabled={selectedMemberIds.length === 0 || invitingSelected}
                  className="w-full py-3.5 rounded-xl
                  bg-gradient-to-r from-violet-600 to-purple-600
                  disabled:opacity-40 disabled:cursor-not-allowed
                  font-black cursor-pointer
                  shadow-[0_0_24px_rgba(124,58,237,0.25)]"
                >
                  {invitingSelected
                    ? tx("Inviting...")
                    : selectedMemberIds.length > 0
                      ? `${tx("Пригласить выбранных")} · ${selectedMemberIds.length}`
                      : tx("Select players")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PLAYERS MANAGE MODAL */}

      {playersOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md max-h-[86vh] overflow-hidden rounded-[28px] border border-violet-700/50 bg-[#070910]">
            <div className="p-5 border-b border-white/5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black">{tx("Players")}</h2>
                  <p className="text-xs text-gray-500 mt-1">
                    {tx("Attendance and team assignment")}
                  </p>
                </div>

                <button
                  onClick={() => setPlayersOpen(false)}
                  className="w-9 h-9 rounded-full border border-white/10 bg-white/5 text-xl cursor-pointer"
                >
                  ×
                </button>
              </div>

              <div className="grid grid-cols-4 gap-2 mt-5">
                <PlayerStatusStat
                  label={tx("Going")}
                  value={goingPlayers.length}
                  tone="green"
                />
                <PlayerStatusStat
                  label={tx("Maybe")}
                  value={maybePlayers.length}
                  tone="purple"
                />
                <PlayerStatusStat
                  label={tx("Invited")}
                  value={invitedPlayers.length}
                  tone="blue"
                />
                <PlayerStatusStat
                  label={tx("Out")}
                  value={declinedPlayers.length}
                  tone="dark"
                />
              </div>
            </div>

            <div className="max-h-[62vh] overflow-y-auto p-4 space-y-2">
              {sortedParticipants.map((participant) => {
                const player = participant.player_profiles;
                if (!player) return null;

                const assignedTeam = playerTeamById.get(player.id);
                const isGuest = participant.participant_type === "GUEST";
                const alreadyMember = communityPlayerIds.has(player.id);

                return (
                  <div
                    key={participant.id}
                    className="rounded-2xl border border-white/5 bg-[#0b0e17] p-3"
                  >
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => router.push(`/players/${player.id}`)}
                        className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
                      >
                        <PlayerAvatar player={player} />

                        <div className="min-w-0">
                          <p className="font-bold truncate">
                            {getPlayerName(player)}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-gray-500">
                              {positionLabel(player.primary_position)}
                            </span>

                            {assignedTeam && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-gray-300">
                                <span
                                  className={`w-2 h-2 rounded-full ${getTeamDotClass(
                                    assignedTeam.color_key,
                                  )}`}
                                />
                                {assignedTeam.name}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>

                      {canManage ? (
                        <select
                          value={participant.attendance_status}
                          disabled={updatingParticipantId === participant.id}
                          onChange={(event) =>
                            updateParticipantAttendance(
                              participant,
                              event.target.value as
                                "INVITED" | "GOING" | "MAYBE" | "DECLINED",
                            )
                          }
                          className="max-w-[108px] bg-[#10131d]
                          border border-white/10 rounded-xl px-2 py-2
                          text-[10px] font-bold text-white outline-none"
                        >
                          <option value="INVITED">{tx("Invited")}</option>
                          <option value="GOING">{tx("Going")}</option>
                          <option value="MAYBE">{tx("Maybe")}</option>
                          <option value="DECLINED">{tx("Out")}</option>
                        </select>
                      ) : (
                        <StatusPill
                          status={participant.attendance_status}
                          color={getStatusTone(participant.attendance_status)}
                        />
                      )}
                    </div>

                    {canManage && isGuest && !alreadyMember && (
                      <button
                        onClick={() =>
                          addGuestToCommunity(player.id, getPlayerName(player))
                        }
                        disabled={addingToCommunity === player.id}
                        className="w-full mt-3 py-2 rounded-xl
                        border border-emerald-500/40 bg-emerald-500/10
                        text-emerald-300 text-sm font-bold cursor-pointer"
                      >
                        {tx("+ Add to Community")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ------------------------------------------------ */
/* TEAM CARD                                        */
/* ------------------------------------------------ */

function TeamCard({
  team,
  format,
  maxRosterSize,
  canManage,
  assigningPlayerId,
  updatingTeamId,
  expanded,
  usedColors,
  onToggleExpanded,
  onModeChange,
  onNameChange,
  onColorChange,
  onToggleCore,
  onUnassign,
}: {
  team: GameTeam;
  format: number;
  maxRosterSize: number;
  canManage: boolean;
  assigningPlayerId: string | null;
  updatingTeamId: string | null;
  expanded: boolean;
  usedColors: string[];
  onToggleExpanded: () => void;
  onModeChange: (teamId: string, mode: TeamMode) => void;
  onNameChange: (teamId: string, name: string) => void;
  onColorChange: (teamId: string, color: TeamColor) => void;
  onToggleCore: (player: TeamPlayer) => void;
  onUnassign: (playerId: string) => void;
}) {
  useLocale();

  const players = team.game_day_team_players || [];
  const substitutes = Math.max(players.length - format, 0);
  const missingForField = Math.max(format - players.length, 0);
  const rosterSummary =
    players.length < format
      ? `${tx("Состав")}: ${players.length}/${maxRosterSize || "–"} · ${tx("Нужно игроков")}: ${missingForField} (${format}×${format})`
      : substitutes > 0
        ? `${tx("Состав")}: ${players.length}/${maxRosterSize || "–"} · ${tx("На поле")}: ${format} · ${tx("Запас")}: ${substitutes}`
        : `${tx("Состав")}: ${players.length}/${maxRosterSize || "–"} · ${tx("На поле")}: ${format}`;
  const [nameDraft, setNameDraft] = useState(team.name);

  const [previousName, setPreviousName] = useState(team.name);
  if (team.name !== previousName) {
    setPreviousName(team.name);
    setNameDraft(team.name);
  }

  const saveName = () => {
    const cleanName = nameDraft.trim();
    if (!cleanName || cleanName === team.name) return;
    onNameChange(team.id, cleanName);
  };

  return (
    <div
      className={`rounded-[24px] border overflow-hidden ${getTeamCardClass(
        team.color_key,
      )}`}
    >
      <div className="p-4 flex items-center gap-3">
        <button
          onClick={onToggleExpanded}
          className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
        >
          <div
            className={`w-3 h-3 rounded-full shrink-0 ${getTeamDotClass(
              team.color_key,
            )}`}
          />

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-black text-lg truncate">{team.name}</h3>
              {team.team_mode === "FIXED" && (
                <span className="text-[10px] text-yellow-300">🔒</span>
              )}
              {team.team_mode === "CORE_PLUS_FILL" && (
                <span className="text-[10px] text-violet-300">★</span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {rosterSummary} · {getTeamModeLabel(team.team_mode)}
            </p>
          </div>
        </button>

        <button
          onClick={onToggleExpanded}
          className="w-9 h-9 rounded-xl border border-white/10 bg-black/20
          flex items-center justify-center text-gray-300 cursor-pointer"
          aria-label={expanded ? tx("Collapse team") : tx("Expand team")}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d={expanded ? "M4 10L8 6L12 10" : "M4 6L8 10L12 6"}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="border-t border-white/5 p-4 pt-3">
          {canManage && (
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-gray-500">
                  {tx("Team name")}
                </label>
                <div className="flex gap-2 mt-1.5">
                  <input
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                        saveName();
                      }
                    }}
                    onBlur={saveName}
                    maxLength={28}
                    className="flex-1 min-w-0 bg-[#0b0e17] border border-white/10
                    rounded-xl px-3 py-2.5 text-sm font-bold outline-none
                    focus:border-violet-500/60"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-gray-500">
                    {tx("Color")}
                  </label>
                  <select
                    value={team.color_key}
                    disabled={updatingTeamId === team.id}
                    onChange={(event) =>
                      onColorChange(team.id, event.target.value as TeamColor)
                    }
                    className="w-full mt-1.5 bg-[#0b0e17] border border-white/10
                    rounded-xl px-3 py-2.5 text-xs font-bold text-white outline-none"
                  >
                    {TEAM_COLOR_OPTIONS.map((option) => (
                      <option
                        key={option.value}
                        value={option.value}
                        disabled={usedColors.includes(option.value)}
                      >
                        {tx(option.label)}
                        {usedColors.includes(option.value) ? tx(" · used") : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-wider text-gray-500">
                    {tx("Mode")}
                  </label>
                  <select
                    value={team.team_mode}
                    disabled={updatingTeamId === team.id}
                    onChange={(event) =>
                      onModeChange(team.id, event.target.value as TeamMode)
                    }
                    className="w-full mt-1.5 bg-[#0b0e17] border border-white/10
                    rounded-xl px-3 py-2.5 text-xs font-bold text-white outline-none"
                  >
                    <option value="RANDOM">{tx("Random")}</option>
                    <option value="FIXED">{tx("Fixed")}</option>
                    <option value="CORE_PLUS_FILL">{tx("Core + Fill")}</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {team.team_mode === "FIXED" && (
            <p className="text-[11px] text-yellow-300/70 mb-3">
              {tx("🔒 All players in this team are protected from Randomize.")}
            </p>
          )}

          {team.team_mode === "CORE_PLUS_FILL" && (
            <p className="text-[11px] text-violet-300/70 mb-3">
              {tx(
                "★ Core players stay. Remaining spots are filled from the pool.",
              )}
            </p>
          )}

          {team.team_mode === "RANDOM" && (
            <p className="text-[11px] text-blue-300/70 mb-3">
              {tx("⚡ All players can be regenerated from the pool.")}
            </p>
          )}

          {players.length === 0 ? (
            <div className="py-4 border border-dashed border-white/10 rounded-xl text-center">
              <p className="text-sm text-gray-600">
                {tx("No players assigned")}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {players.map((item) => {
                const player = item.player_profiles;
                if (!player) return null;

                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 bg-black/20 rounded-xl p-2.5"
                  >
                    <PlayerAvatar player={player} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-sm truncate">
                          {getPlayerName(player)}
                        </p>

                        {item.is_core && (
                          <span className="text-[9px] text-yellow-300">
                            {tx("★ CORE")}
                          </span>
                        )}
                      </div>

                      <p className="text-[10px] text-gray-500">
                        {positionLabel(player.primary_position)}
                      </p>
                    </div>

                    {canManage && team.team_mode === "CORE_PLUS_FILL" && (
                      <button
                        onClick={() => onToggleCore(item)}
                        className={`text-[10px] px-2 py-1 rounded-lg border cursor-pointer ${
                          item.is_core
                            ? "border-yellow-400/50 bg-yellow-400/10 text-yellow-300"
                            : "border-violet-500/30 bg-violet-500/10 text-violet-300"
                        }`}
                      >
                        {item.is_core ? tx("Core ✓") : tx("Make Core")}
                      </button>
                    )}

                    {canManage && (
                      <button
                        onClick={() => onUnassign(player.id)}
                        disabled={assigningPlayerId === player.id}
                        className="text-xs text-gray-500 hover:text-white cursor-pointer"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------ */
/* PLAYERS                                          */
/* ------------------------------------------------ */

function PlayerListSection({
  title,
  players,
  router,
  color,
  canManage,
  communityPlayerIds,
  addingToCommunity,
  onAddToCommunity,
  updatingParticipantId,
  onAttendanceChange,
}: {
  title: string;
  players: Participant[];
  router: ReturnType<typeof useRouter>;
  color: "green" | "purple" | "blue" | "dark";
  canManage: boolean;
  communityPlayerIds: Set<string>;
  addingToCommunity: string | null;
  onAddToCommunity: (id: string, name: string) => void;
  updatingParticipantId: string | null;
  onAttendanceChange: (
    participant: Participant,
    status: "INVITED" | "GOING" | "MAYBE" | "DECLINED",
  ) => void;
}) {
  useLocale();

  if (!players.length) return null;

  return (
    <section className="mb-7">
      <div className="flex justify-between mb-3">
        <h2 className="text-xl font-black">{title}</h2>

        <span className="text-gray-500">{players.length}</span>
      </div>

      <div className="space-y-2">
        {players.map((participant) => {
          const player = participant.player_profiles;

          if (!player) return null;

          const isGuest = participant.participant_type === "GUEST";

          const alreadyMember = communityPlayerIds.has(player.id);

          return (
            <div
              key={participant.id}
              className="rounded-2xl border border-white/5 bg-[#090c14] p-3"
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => router.push(`/players/${player.id}`)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
                >
                  <PlayerAvatar player={player} />

                  <div>
                    <p className="font-bold">{getPlayerName(player)}</p>

                    <p className="text-xs text-gray-500">
                      {positionLabel(player.primary_position)}
                    </p>
                  </div>
                </button>

                {canManage ? (
                  <select
                    value={participant.attendance_status}
                    disabled={updatingParticipantId === participant.id}
                    onChange={(event) =>
                      onAttendanceChange(
                        participant,
                        event.target.value as
                          "INVITED" | "GOING" | "MAYBE" | "DECLINED",
                      )
                    }
                    onClick={(event) => event.stopPropagation()}
                    className="max-w-[112px] bg-[#10131d]
                    border border-white/10 rounded-xl px-2 py-2
                    text-[10px] font-bold text-white outline-none"
                  >
                    <option value="INVITED">{tx("Invited")}</option>
                    <option value="GOING">{tx("Going")}</option>
                    <option value="MAYBE">{tx("Maybe")}</option>
                    <option value="DECLINED">{tx("Out")}</option>
                  </select>
                ) : (
                  <StatusPill
                    status={participant.attendance_status}
                    color={color}
                  />
                )}
              </div>

              {canManage && isGuest && !alreadyMember && (
                <button
                  onClick={() =>
                    onAddToCommunity(player.id, getPlayerName(player))
                  }
                  disabled={addingToCommunity === player.id}
                  className="w-full mt-3 py-2 rounded-xl
                    border border-emerald-500/40
                    bg-emerald-500/10
                    text-emerald-300 text-sm font-bold cursor-pointer"
                >
                  {tx("+ Add to Community")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PlayerAvatar({ player }: { player: Player }) {
  useLocale();
  return <Avatar src={player.avatar_url} name={getPlayerName(player)} />;
}

function getPlayerName(player: Player) {
  return (
    player.display_name ||
    `${player.first_name} ${player.last_name ?? ""}`.trim()
  );
}

/* ------------------------------------------------ */
/* UI                                               */
/* ------------------------------------------------ */

function TeamStat({ label, value }: { label: string; value: number }) {
  useLocale();

  return (
    <div className="rounded-xl border border-white/5 bg-[#0b0e17] px-3 py-2 text-center">
      <p className="text-lg font-black">{value}</p>
      <p className="text-[10px] text-gray-500">{label}</p>
    </div>
  );
}

function PlayerStatusStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "purple" | "blue" | "dark";
}) {
  useLocale();

  const toneMap = {
    green: "border-emerald-500/20 bg-emerald-500/8 text-emerald-300",
    purple: "border-violet-500/20 bg-violet-500/8 text-violet-300",
    blue: "border-blue-500/20 bg-blue-500/8 text-blue-300",
    dark: "border-white/5 bg-white/5 text-gray-400",
  };

  return (
    <div className={`rounded-xl border px-2 py-2 text-center ${toneMap[tone]}`}>
      <p className="font-black text-sm">{value}</p>
      <p className="text-[9px] mt-0.5">{label}</p>
    </div>
  );
}

function getTeamModeLabel(mode: TeamMode) {
  const labels: Record<TeamMode, string> = {
    RANDOM: tx("Random"),
    FIXED: tx("Fixed"),
    CORE_PLUS_FILL: tx("Core + Fill"),
  };

  return labels[mode];
}

function getStatusTone(status: string): "green" | "purple" | "blue" | "dark" {
  if (status === "GOING") return "green";
  if (status === "MAYBE") return "purple";
  if (status === "INVITED") return "blue";
  return "dark";
}

function TeamModeBadge({ mode }: { mode: TeamMode }) {
  useLocale();

  const labels = {
    RANDOM: tx("Random"),
    FIXED: tx("Fixed"),
    CORE_PLUS_FILL: tx("Core + Fill"),
  };

  return <span className="text-[10px] text-violet-300">{labels[mode]}</span>;
}

function StatusButton({
  active,
  icon,
  title,
  type,
  disabled,
  onClick,
}: {
  active: boolean;
  icon: string;
  title: string;
  type: "green" | "purple" | "red";
  disabled: boolean;
  onClick: () => void;
}) {
  useLocale();

  const activeMap = {
    green: "border-emerald-400 bg-emerald-500/15 text-emerald-300",
    purple: "border-violet-400 bg-violet-500/15 text-violet-300",
    red: "border-red-500 bg-red-500/10 text-red-300",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-[20px] py-4 border font-bold cursor-pointer ${
        active ? activeMap[type] : "border-[#252938] bg-[#0b0e17] text-gray-400"
      }`}
    >
      <div className="text-xl">{icon}</div>
      <div className="text-sm mt-1">{title}</div>
    </button>
  );
}

function StatusPill({
  status,
  color,
}: {
  status: string;
  color: "green" | "purple" | "blue" | "dark";
}) {
  useLocale();

  const map = {
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    purple: "border-violet-500/30 bg-violet-500/10 text-violet-300",
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    dark: "border-neutral-700 bg-neutral-800 text-gray-500",
  };

  return (
    <span
      className={`text-[10px] font-bold px-2 py-1 rounded-full border ${map[color]}`}
    >
      {tx(
        (
          {
            GOING: "Иду",
            MAYBE: "Возможно",
            DECLINED: "Не иду",
            INVITED: "Приглашён",
            WAITING: "Ожидание",
          } as Record<string, string>
        )[status] || "Ожидание",
      )}
    </span>
  );
}

function BluePill({ children }: { children: React.ReactNode }) {
  useLocale();

  return (
    <span className="px-3 py-1 rounded-lg text-xs bg-blue-700/20 border border-blue-500/30 text-blue-200">
      {children}
    </span>
  );
}

/* ------------------------------------------------ */
/* TEAM COLORS                                      */
/* ------------------------------------------------ */

function getTeamCardClass(color: string) {
  switch (color) {
    case "BLUE":
      return "border-blue-500/40 bg-blue-500/8";
    case "RED":
      return "border-red-500/40 bg-red-500/8";
    case "YELLOW":
      return "border-yellow-500/40 bg-yellow-500/8";
    case "GREEN":
      return "border-emerald-500/40 bg-emerald-500/8";
    case "ORANGE":
      return "border-orange-500/40 bg-orange-500/10";
    case "WHITE":
      return "border-white/35 bg-white/5";
    case "BLACK":
      return "border-gray-700 bg-black/60";
    case "PURPLE":
    default:
      return "border-violet-500/40 bg-violet-500/8";
  }
}

function getTeamDotClass(color: string) {
  switch (color) {
    case "BLUE":
      return "bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.8)]";
    case "RED":
      return "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.8)]";
    case "YELLOW":
      return "bg-yellow-300 shadow-[0_0_10px_rgba(253,224,71,0.8)]";
    case "GREEN":
      return "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.55)]";
    case "ORANGE":
      return "bg-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.7)]";
    case "WHITE":
      return "bg-white shadow-[0_0_10px_rgba(255,255,255,0.65)]";
    case "BLACK":
      return "bg-black border border-gray-500";
    case "PURPLE":
    default:
      return "bg-violet-400 shadow-[0_0_10px_rgba(167,139,250,0.65)]";
  }
}

function getTeamButtonClass(color: string) {
  switch (color) {
    case "BLUE":
      return "border-blue-500/40 bg-blue-500/10 text-blue-300";
    case "RED":
      return "border-red-500/40 bg-red-500/10 text-red-300";
    case "YELLOW":
      return "border-yellow-500/40 bg-yellow-500/10 text-yellow-300";
    case "GREEN":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "ORANGE":
      return "border-orange-500/40 bg-orange-500/10 text-orange-300";
    case "WHITE":
      return "border-white/35 bg-white/10 text-white";
    case "BLACK":
      return "border-gray-700 bg-black/60 text-gray-300";
    case "PURPLE":
    default:
      return "border-violet-500/40 bg-violet-500/10 text-violet-300";
  }
}

/* ------------------------------------------------ */
/* DATE                                             */
/* ------------------------------------------------ */

function parseDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDay(date: string) {
  return String(parseDate(date).getUTCDate()).padStart(2, "0");
}

function formatMonth(date: string) {
  return parseDate(date)
    .toLocaleDateString(dateLocale(), {
      month: "short",
      timeZone: "UTC",
    })
    .toUpperCase();
}

function formatWeekday(date: string) {
  return parseDate(date)
    .toLocaleDateString(dateLocale(), {
      weekday: "short",
      timeZone: "UTC",
    })
    .toUpperCase();
}
