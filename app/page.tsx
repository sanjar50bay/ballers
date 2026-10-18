"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import PlayerStats from "./components/PlayerStats";
import BottomNav from "./components/BottomNav";
import { setAttendance, preMatchError } from "@/lib/pre-match";

type PlayerProfile = {
  id: string;
  baller_id: number;
  first_name: string;
  last_name: string | null;
  display_name: string | null;
  city: string | null;
  primary_position: string;
  secondary_position: string | null;
  dominant_foot: string | null;
  avatar_url: string | null;
};

type Community = {
  id: string;
  name: string;
  city: string | null;
  team_mode: string;
  default_format: number;
  default_team_count: number;
  default_capacity: number | null;
};

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
};

type ParticipationRow = {
  id: string;
  attendance_status: string;
  participant_type: string;
  game_days: GameDay | null;
};

export default function Home() {
  const router = useRouter();

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [nextGame, setNextGame] = useState<GameDay | null>(null);
  const [invitations, setInvitations] = useState<ParticipationRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const loadHome = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const { data: profileData, error: profileError } = await supabase
      .from("player_profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profileData) {
      router.push("/onboarding");
      return;
    }

    setProfile(profileData);

    // -----------------------------
    // COMMUNITIES
    // -----------------------------

    const { data: memberships, error: membershipError } = await supabase
      .from("community_members")
      .select(`
        community_id,
        communities (
          id,
          name,
          city,
          team_mode,
          default_format,
          default_team_count,
          default_capacity
        )
      `)
      .eq("player_id", profileData.id);

    if (membershipError) {
      console.error(membershipError);
    }

    const communityList =
      ((memberships || []) as unknown as { communities: Community | null }[])
        .map(item => item.communities)
        .filter((item): item is Community => item !== null);

    setCommunities(communityList);

    // -----------------------------
    // PARTICIPATIONS
    // -----------------------------

    const { data: participantData, error: participantError } =
      await supabase
        .from("game_participants")
        .select(`
          id,
          attendance_status,
          participant_type,
          game_days (
            id,
            community_id,
            title,
            game_date,
            start_time,
            venue,
            format,
            team_count,
            capacity,
            status
          )
        `)
        .eq("player_id", profileData.id);

    if (participantError) {
      console.error(participantError);
    }

    const today = new Date().toISOString().split("T")[0];

    const rows: ParticipationRow[] =
      (participantData as unknown as ParticipationRow[]) || [];

    // Invitations
    const invited = rows
      .filter(
        (row) =>
          row.attendance_status === "INVITED" &&
          row.game_days &&
          row.game_days.game_date >= today
      )
      .sort((a, b) => {
        const aValue = `${a.game_days?.game_date} ${
          a.game_days?.start_time ?? ""
        }`;

        const bValue = `${b.game_days?.game_date} ${
          b.game_days?.start_time ?? ""
        }`;

        return aValue.localeCompare(bValue);
      });

    setInvitations(invited);

    // -----------------------------
    // FIND NEXT GAME
    // -----------------------------

    const candidateGames: GameDay[] = [];

    rows.forEach((row) => {
      if (
        row.game_days &&
        row.game_days.game_date >= today &&
        row.attendance_status !== "DECLINED"
      ) {
        candidateGames.push(row.game_days);
      }
    });

    const communityIds = communityList.map(
      (community: Community) => community.id
    );

    if (communityIds.length > 0) {
      const { data: communityGames } = await supabase
        .from("game_days")
        .select(`
          id,
          community_id,
          title,
          game_date,
          start_time,
          venue,
          format,
          team_count,
          capacity,
          status
        `)
        .in("community_id", communityIds)
        .gte("game_date", today)
        .order("game_date", { ascending: true });

      if (communityGames) {
        communityGames.forEach((game) => {
          if (!candidateGames.some((item) => item.id === game.id)) {
            candidateGames.push(game);
          }
        });
      }
    }

    candidateGames.sort((a, b) => {
      const aValue = `${a.game_date} ${a.start_time ?? "00:00"}`;
      const bValue = `${b.game_date} ${b.start_time ?? "00:00"}`;

      return aValue.localeCompare(bValue);
    });

    setNextGame(candidateGames[0] ?? null);

    setLoading(false);
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadHome(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadHome]);

  const respondToInvite = async (
    participantId: string,
    status: "GOING" | "MAYBE" | "DECLINED"
  ) => {
    setRespondingId(participantId);

    const invitation = invitations.find(item => item.id === participantId);
    if (!profile || !invitation?.game_days) { setRespondingId(null); return; }
    const { error } = await setAttendance(invitation.game_days.id, profile.id, status);

    if (error) {
      alert(preMatchError(error));
      setRespondingId(null);
      return;
    }

    await loadHome();
    setRespondingId(null);
  };

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setCommunities([]);
    setNextGame(null);
    setInvitations([]);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#02030a] text-white flex items-center justify-center">
        <div className="text-violet-400 animate-pulse">
          Loading BALLERS...
        </div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="min-h-screen bg-[#02030a] text-white flex items-center justify-center px-6">
        <div className="w-full max-w-md">
          <h1 className="text-5xl font-black tracking-tight">
            BALLERS
          </h1>

          <p className="text-gray-500 mt-3 mb-10">
            Play. Connect. Compete.
          </p>

          <button
            onClick={signInWithGoogle}
            className="w-full py-4 rounded-2xl font-bold text-white cursor-pointer
            bg-gradient-to-r from-violet-700 via-purple-600 to-blue-600
            shadow-[0_0_35px_rgba(124,58,237,0.35)]
            hover:shadow-[0_0_45px_rgba(124,58,237,0.55)]
            transition"
          >
            Continue with Google
          </button>
        </div>
      </main>
    );
  }

  const visibleName =
    profile.display_name ||
    `${profile.first_name} ${profile.last_name ?? ""}`.trim();

  return (
    <main className="min-h-screen bg-[#02030a] text-white">
      <div className="max-w-md mx-auto px-4 pt-6 pb-28">

        {/* HEADER */}

        <header className="flex items-center justify-between mb-5">
          <h1 className="text-3xl font-black tracking-tight">
            BALLERS
          </h1>

          <div className="flex items-center gap-3">

            <button
              className="w-10 h-10 rounded-full border border-violet-900/50 bg-[#0a0d17] flex items-center justify-center cursor-pointer"
              title="Notifications"
              aria-label="Открыть уведомления"
              onClick={() => window.dispatchEvent(new Event("ballers:open-notifications"))}
            >
              🔔
            </button>

            <button
              onClick={() => router.push("/profile/edit")}
              className="w-10 h-10 rounded-full overflow-hidden border border-violet-500/60 cursor-pointer
              shadow-[0_0_15px_rgba(139,92,246,0.3)]"
            >
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={visibleName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="flex items-center justify-center w-full h-full bg-neutral-900">
                  👤
                </span>
              )}
            </button>

          </div>
        </header>

        {/* PLAYER HERO */}

        <section
          className="relative overflow-hidden rounded-[26px] border border-violet-800/50
          bg-gradient-to-br from-[#11152a] via-[#090b17] to-[#130725]
          shadow-[0_0_30px_rgba(109,40,217,0.15)]
          p-5 mb-6"
        >
          <div
            className="absolute -right-16 -top-16 w-52 h-52 rounded-full
            bg-violet-600/20 blur-3xl"
          />

          <div
            className="absolute -left-20 bottom-0 w-48 h-32 rounded-full
            bg-blue-600/10 blur-3xl"
          />

          <div className="relative z-10">

            <p className="text-sky-400 text-sm">
              Welcome back
            </p>

            <div className="flex items-center gap-4 mt-2">

              <button
                onClick={() => router.push("/profile/edit")}
                className="w-20 h-20 rounded-2xl overflow-hidden bg-[#131521]
                border border-violet-500/50 shrink-0 cursor-pointer
                shadow-[0_0_22px_rgba(124,58,237,0.22)]"
              >
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={visibleName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-3xl flex items-center justify-center w-full h-full">
                    👤
                  </span>
                )}
              </button>

              <div className="min-w-0 flex-1">

                <h2 className="text-2xl font-black truncate">
                  {visibleName}
                </h2>

                <div className="flex items-center justify-between mt-1">
                  <p className="text-gray-400 text-sm">
                    Baller ID #{profile.baller_id}
                  </p>

                  <button
                    onClick={() => router.push("/profile/edit")}
                    className="text-violet-400 text-sm cursor-pointer hover:text-violet-300"
                  >
                    Edit
                  </button>
                </div>

                <div className="flex gap-2 mt-4 flex-wrap">

                  <NeonTag>
                    {profile.primary_position}
                  </NeonTag>

                  {profile.secondary_position && (
                    <DarkTag>
                      {profile.secondary_position}
                    </DarkTag>
                  )}

                  {profile.city && (
                    <DarkTag>
                      ◉ {profile.city}
                    </DarkTag>
                  )}

                </div>

              </div>

            </div>

            {/* STATS */}

            <div className="grid grid-cols-4 gap-1 mt-5 bg-black/30 border border-white/5 rounded-2xl p-3">

              <MiniStat
                value="—"
                label="Unrated"
                accent
              />

              <MiniStat
                value="—"
                label="Games"
              />

              <MiniStat
                value="—"
                label="Goals"
              />

              <MiniStat
                value="—"
                label="Assists"
              />

            </div>

            {/* ACHIEVEMENTS */}

            <div className="grid grid-cols-4 gap-2 mt-4">

              <Achievement
                icon="⚡"
                label="Playmaker"
              />

              <Achievement
                icon="♛"
                label="Top Scorer"
              />

              <Achievement
                icon="👥"
                label="Team Player"
              />

              <Achievement
                icon="★"
                label="Regular"
                green
              />

            </div>

          </div>
        </section>

        <PlayerStats playerId={profile.id} />
        <Link href="/open-games" className="block my-5 rounded-2xl border border-violet-500/50 bg-violet-950/30 p-4 font-bold">Найти открытую игру →</Link>
        {/* INVITATIONS */}

        {invitations.length > 0 && (
          <section className="mb-7">

            <div className="flex items-center justify-between mb-3">

              <h2 className="text-xl font-bold">
                Invitations
              </h2>

              <div
                className="px-2.5 py-1 rounded-full text-xs font-bold
                bg-violet-500/15 border border-violet-500/40 text-violet-300"
              >
                {invitations.length}
              </div>

            </div>

            <div className="space-y-4">

              {invitations.map((invite) => {
                const game = invite.game_days;

                if (!game) return null;

                return (
                  <div
                    key={invite.id}
                    className="relative overflow-hidden rounded-[24px]
                    border border-violet-500/60
                    bg-gradient-to-br from-[#130b2b] via-[#080b19] to-[#071427]
                    p-5
                    shadow-[0_0_28px_rgba(124,58,237,0.18)]"
                  >

                    <div
                      className="absolute -right-10 -top-10 w-36 h-36
                      bg-violet-600/20 rounded-full blur-3xl"
                    />

                    <div className="relative">

                      <p className="text-violet-400 text-xs font-bold uppercase tracking-wider">
                        Game invitation
                      </p>

                      <h3 className="text-xl font-black mt-1">
                        {game.title}
                      </h3>

                      <p className="text-gray-300 mt-3">
                        {formatGameDate(game.game_date)}
                        {game.start_time &&
                          ` · ${game.start_time.slice(0, 5)}`}
                      </p>

                      {game.venue && (
                        <p className="text-gray-500 text-sm mt-1">
                          ◉ {game.venue}
                        </p>
                      )}

                      <div className="flex gap-2 mt-3">

                        <DarkTag>
                          {game.format}v{game.format}
                        </DarkTag>

                        <DarkTag>
                          {game.team_count} teams
                        </DarkTag>

                        {game.capacity && (
                          <DarkTag>
                            {game.capacity} players
                          </DarkTag>
                        )}

                      </div>

                      <p className="text-sm font-semibold mt-5 mb-3">
                        Will you attend?
                      </p>

                      <div className="grid grid-cols-3 gap-2">

                        <button
                          disabled={respondingId === invite.id}
                          onClick={() =>
                            respondToInvite(
                              invite.id,
                              "GOING"
                            )
                          }
                          className="rounded-xl py-3
                          border border-emerald-500/60
                          bg-emerald-500/10
                          text-emerald-300
                          font-bold cursor-pointer
                          hover:bg-emerald-500/20
                          hover:shadow-[0_0_20px_rgba(16,185,129,0.25)]
                          transition"
                        >
                          ✓ Going
                        </button>

                        <button
                          disabled={respondingId === invite.id}
                          onClick={() =>
                            respondToInvite(
                              invite.id,
                              "MAYBE"
                            )
                          }
                          className="rounded-xl py-3
                          border border-violet-700/50
                          bg-violet-950/20
                          text-violet-300
                          font-bold cursor-pointer
                          hover:bg-violet-900/30 transition"
                        >
                          ? Maybe
                        </button>

                        <button
                          disabled={respondingId === invite.id}
                          onClick={() =>
                            respondToInvite(
                              invite.id,
                              "DECLINED"
                            )
                          }
                          className="rounded-xl py-3
                          border border-neutral-700
                          bg-neutral-900/60
                          text-gray-400
                          font-bold cursor-pointer
                          hover:bg-neutral-800 transition"
                        >
                          × Out
                        </button>

                      </div>

                      <button
                        onClick={() =>
                          router.push(
                            `/communities/${game.community_id}/game-days/${game.id}`
                          )
                        }
                        className="text-sm text-violet-400 mt-4 cursor-pointer hover:text-violet-300"
                      >
                        View Game Day →
                      </button>

                    </div>

                  </div>
                );
              })}

            </div>

          </section>
        )}

        {/* NEXT GAME */}

        <section className="mb-7">

          <div className="flex items-center justify-between mb-3">

            <h2 className="text-xl font-bold">
              Next Game
            </h2>

            <span className="text-violet-400 text-sm">
              Upcoming
            </span>

          </div>

          {nextGame ? (
            <div
              onClick={() =>
                router.push(
                  `/communities/${nextGame.community_id}/game-days/${nextGame.id}`
                )
              }
              className="relative overflow-hidden rounded-[24px]
              border border-blue-600/60
              bg-gradient-to-br from-[#07142b] via-[#080a18] to-[#170725]
              p-5 cursor-pointer
              shadow-[0_0_28px_rgba(37,99,235,0.13)]
              hover:border-violet-500
              hover:shadow-[0_0_35px_rgba(124,58,237,0.22)]
              transition"
            >

              <div
                className="absolute right-0 top-0 w-40 h-full
                bg-gradient-to-l from-violet-800/20 to-transparent"
              />

              <div className="relative flex gap-4">

                <div
                  className="w-16 h-[76px] rounded-xl
                  bg-[#12152e] border border-violet-700/50
                  flex flex-col items-center justify-center shrink-0"
                >
                  <span className="text-[10px] text-violet-300">
                    {formatMonth(nextGame.game_date)}
                  </span>

                  <span className="text-2xl font-black">
                    {formatDay(nextGame.game_date)}
                  </span>

                  <span className="text-[10px] text-gray-500">
                    {formatWeekday(nextGame.game_date)}
                  </span>
                </div>

                <div className="min-w-0">

                  <h3 className="text-xl font-black truncate">
                    {nextGame.title}
                  </h3>

                  <p className="text-gray-400 text-sm mt-1">
                    {nextGame.start_time
                      ? nextGame.start_time.slice(0, 5)
                      : "Time TBD"}
                  </p>

                  {nextGame.venue && (
                    <p className="text-gray-500 text-sm">
                      ◉ {nextGame.venue}
                    </p>
                  )}

                  <div className="flex gap-2 mt-3 flex-wrap">

                    <BlueTag>
                      {nextGame.format}v{nextGame.format}
                    </BlueTag>

                    <BlueTag>
                      {nextGame.team_count} teams
                    </BlueTag>

                    {nextGame.capacity && (
                      <BlueTag>
                        {nextGame.capacity} players
                      </BlueTag>
                    )}

                  </div>

                </div>

              </div>

            </div>
          ) : (
            <div className="border border-blue-900/30 bg-[#070b16] rounded-2xl p-5 text-gray-500">
              No upcoming games
            </div>
          )}

        </section>

        {/* COMMUNITIES */}

        <section className="mb-8">

          <div className="flex items-center justify-between mb-3">

            <h2 className="text-xl font-bold">
              My Communities
            </h2>

            {communities.length > 0 && (
              <span className="text-emerald-400 text-sm">
                {communities.length}
              </span>
            )}

          </div>

          {communities.length === 0 ? (
            <button
              onClick={() =>
                router.push("/communities/create")
              }
              className="w-full rounded-2xl p-5 border border-violet-800/40
              bg-[#090b14] text-left cursor-pointer"
            >
              <p className="font-semibold">
                Create your first Community
              </p>

              <p className="text-sm text-gray-500 mt-1">
                Start organizing your football group.
              </p>
            </button>
          ) : (
            <div className="space-y-3">

              {communities.map((community) => (
                <div
                  key={community.id}
                  onClick={() =>
                    router.push(
                      `/communities/${community.id}`
                    )
                  }
                  className="relative overflow-hidden
                  rounded-[22px]
                  border border-emerald-800/40
                  bg-gradient-to-r from-[#061712] via-[#061216] to-[#090b17]
                  p-5 cursor-pointer
                  hover:border-emerald-500/60
                  hover:shadow-[0_0_25px_rgba(16,185,129,0.12)]
                  transition"
                >

                  <div
                    className="absolute -right-10 -bottom-14
                    w-32 h-32 rounded-full
                    bg-emerald-500/10 blur-2xl"
                  />

                  <div className="relative">

                    <h3 className="text-xl font-black">
                      {community.name}
                    </h3>

                    <p className="text-gray-500 text-sm mt-1">
                      ◉ {community.city || "Unknown city"}
                    </p>

                    <div className="flex gap-2 mt-4 flex-wrap">

                      <DarkTag>
                        {community.default_format}v
                        {community.default_format}
                      </DarkTag>

                      <DarkTag>
                        {community.default_team_count} teams
                      </DarkTag>

                      <DarkTag>
                        {community.team_mode}
                      </DarkTag>

                    </div>

                  </div>

                </div>
              ))}

              <button
                onClick={() =>
                  router.push("/communities/create")
                }
                className="w-full py-3 rounded-xl
                border border-neutral-800
                text-gray-400
                font-semibold cursor-pointer
                hover:border-violet-700
                hover:text-violet-300 transition"
              >
                + Create another community
              </button>

            </div>
          )}

        </section>

        {/* SIGN OUT */}

        <button
          onClick={signOut}
          className="w-full text-sm text-gray-600 hover:text-gray-400 cursor-pointer"
        >
          Sign out
        </button>

      </div>

      {/* MOBILE NAV */}

      <BottomNav />

    </main>
  );
}

// ----------------------------------------------------
// COMPONENTS
// ----------------------------------------------------

function MiniStat({
  value,
  label,
  accent = false,
}: {
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="text-center border-r border-white/5 last:border-r-0">

      <p
        className={`text-lg font-black ${
          accent
            ? "text-yellow-300"
            : "text-white"
        }`}
      >
        {value}
      </p>

      <p className="text-[10px] text-gray-500">
        {label}
      </p>

    </div>
  );
}

function Achievement({
  icon,
  label,
  green = false,
}: {
  icon: string;
  label: string;
  green?: boolean;
}) {
  return (
    <div className="text-center opacity-60">

      <div
        className={`mx-auto w-11 h-11 rounded-xl
        flex items-center justify-center text-xl
        border ${
          green
            ? "border-emerald-500/50 bg-emerald-500/10"
            : "border-violet-500/50 bg-violet-500/10"
        }`}
      >
        {icon}
      </div>

      <p className="text-[9px] text-gray-500 mt-1">
        {label}
      </p>

    </div>
  );
}

function NeonTag({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <span
      className="px-3 py-1 rounded-lg text-xs font-bold
      bg-violet-600/25
      border border-violet-500/60
      text-violet-200
      shadow-[0_0_12px_rgba(124,58,237,0.2)]"
    >
      {children}
    </span>
  );
}

function DarkTag({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <span
      className="px-3 py-1 rounded-lg text-xs
      bg-[#161924]
      border border-white/5
      text-gray-300"
    >
      {children}
    </span>
  );
}

function BlueTag({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <span
      className="px-3 py-1 rounded-lg text-xs
      bg-blue-800/30
      border border-blue-700/30
      text-blue-200"
    >
      {children}
    </span>
  );
}

// ----------------------------------------------------
// DATE HELPERS
// ----------------------------------------------------

function parseDateParts(date: string) {
  const [year, month, day] = date
    .split("-")
    .map(Number);

  return new Date(
    Date.UTC(year, month - 1, day)
  );
}

function formatDay(date: string) {
  return String(
    parseDateParts(date).getUTCDate()
  ).padStart(2, "0");
}

function formatMonth(date: string) {
  return parseDateParts(date)
    .toLocaleDateString("en-US", {
      month: "short",
      timeZone: "UTC",
    })
    .toUpperCase();
}

function formatWeekday(date: string) {
  return parseDateParts(date)
    .toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: "UTC",
    })
    .toUpperCase();
}

function formatGameDate(date: string) {
  return parseDateParts(date)
    .toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      weekday: "short",
      timeZone: "UTC",
    });
}