"use client";
import Link from "next/link";
import { t as tx, dateLocale, positionLabel } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import CommunityMenu from "@/app/components/CommunityMenu";
import BottomNav from "@/app/components/BottomNav";

type Community = {
  id: string;
  name: string;
  city: string | null;
  team_mode: string;
  default_format: number;
  default_team_count: number;
  default_capacity: number | null;
  created_by: string;
};

type Player = {
  id: string;
  baller_id: number;
  first_name: string;
  last_name: string | null;
  display_name?: string | null;
  city: string | null;
  primary_position: string;
  secondary_position: string | null;
  avatar_url: string | null;
};

type Member = {
  id: string;
  role: string;
  member_status: string;
  player_profiles: Player | null;
};

type GameDay = {
  id: string;
  title: string;
  game_date: string;
  start_time: string | null;
  venue: string | null;
  format: number;
  team_count: number;
  capacity: number | null;
  status: string;
};

export default function CommunityPage() {
  useLocale();

  const params = useParams();
  const router = useRouter();

  const communityId = params.id as string;

  const [community, setCommunity] = useState<Community | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [nextGame, setNextGame] = useState<GameDay | null>(null);

  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  const loadCommunity = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/");
      return;
    }

    const { data: myProfile, error: profileError } = await supabase
      .from("player_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (profileError || !myProfile) {
      router.push("/onboarding");
      return;
    }

    setMyPlayerId(myProfile.id);

    const { data: communityData, error: communityError } = await supabase
      .from("communities")
      .select("*")
      .eq("id", communityId)
      .single();

    if (communityError || !communityData) {
      console.error("Community error:", communityError);
      setLoading(false);
      return;
    }

    setCommunity(communityData);

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
          city,
          primary_position,
          secondary_position,
          avatar_url
        )
      `,
      )
      .eq("community_id", communityId);

    if (memberError) {
      console.error("Members error:", memberError);
    }

    const cleanMembers = (memberData || []) as unknown as Member[];

    cleanMembers.sort((a, b) => {
      const roleOrder: Record<string, number> = {
        OWNER: 0,
        MANAGER: 1,
        MEMBER: 2,
      };

      return (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9);
    });

    setMembers(cleanMembers);

    const mine = cleanMembers.find(
      (member) => member.player_profiles?.id === myProfile.id,
    );

    setMyRole(mine?.role ?? null);

    const today = new Date().toISOString().split("T")[0];

    const { data: nextGameData, error: gameError } = await supabase
      .from("game_days")
      .select(
        `
        id,
        title,
        game_date,
        start_time,
        venue,
        format,
        team_count,
        capacity,
        status
      `,
      )
      .eq("community_id", communityId)
      .gte("game_date", today)
      .order("game_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (gameError) {
      console.error("Game error:", gameError);
    }

    setNextGame(nextGameData || null);
    setLoading(false);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCommunity();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [communityId]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#02030a] text-white flex items-center justify-center">
        <p className="text-violet-400 animate-pulse">
          {tx("Loading Community...")}
        </p>
      </main>
    );
  }

  if (!community) {
    return (
      <main className="min-h-screen bg-[#02030a] text-white flex items-center justify-center">
        {tx("Community not found")}
      </main>
    );
  }

  const regularMembers = members.filter(
    (member) => member.member_status === "REGULAR",
  );

  const guestMembers = members.filter(
    (member) => member.member_status === "GUEST",
  );

  const canManage = myRole === "OWNER" || myRole === "MANAGER";

  return (
    <main className="min-h-screen bg-[#02030a] text-white pb-24">
      <div className="max-w-md mx-auto px-4 pt-6">
        {/* TOP BAR */}

        <div className="flex items-center justify-between mb-5">
          <button
            onClick={() => router.back()}
            className="w-10 h-10 rounded-full
            border border-violet-900/50
            bg-[#090b14]
            flex items-center justify-center
            cursor-pointer
            hover:border-violet-600 transition"
          >
            ←
          </button>

          <p className="font-bold">{tx("Community")}</p>

          <CommunityMenu
            community={community}
            canManage={canManage}
            onSaved={() => void loadCommunity()}
          />
        </div>

        {/* COMMUNITY HERO */}

        <section
          className="relative overflow-hidden
          rounded-[28px]
          border border-emerald-700/50
          bg-gradient-to-br
          from-[#071c17]
          via-[#071017]
          to-[#120825]
          p-5 mb-6
          shadow-[0_0_34px_rgba(16,185,129,0.12)]"
        >
          <div
            className="absolute -right-16 -top-16
            w-52 h-52
            bg-emerald-500/15
            rounded-full blur-3xl"
          />

          <div
            className="absolute -left-20 bottom-0
            w-48 h-32
            bg-violet-600/12
            rounded-full blur-3xl"
          />

          <div className="relative">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-emerald-400 text-xs uppercase tracking-wider font-bold">
                  {tx("Football Community")}
                </p>

                <h1 className="text-3xl font-black mt-1 leading-tight">
                  {community.name}
                </h1>
                <Link
                  className="text-link"
                  href={`/discover/community/${communityId}`}
                >
                  {tx("Команды сообщества →")}
                </Link>

                <p className="text-gray-400 mt-2 text-sm">
                  ◉ {community.city || tx("Unknown city")}
                </p>
              </div>

              <div
                className="w-14 h-14 rounded-2xl
                border border-emerald-500/40
                bg-emerald-500/10
                flex items-center justify-center
                text-2xl shrink-0"
              >
                ⚽
              </div>
            </div>

            <div className="flex gap-2 flex-wrap mt-5">
              <CommunityTag>
                {community.default_format}×{community.default_format}
              </CommunityTag>

              <CommunityTag>
                {community.default_team_count} {tx("команды")}
              </CommunityTag>

              <CommunityTag>
                {tx(
                  (
                    {
                      RANDOM: "Случайное распределение по командам",
                      FIXED: "Fixed",
                      MIXED: "Mixed",
                    } as Record<string, string>
                  )[community.team_mode] || "Mixed",
                )}
              </CommunityTag>

              {community.default_capacity && (
                <CommunityTag>
                  {tx("{count} мест на игру по умолчанию", {
                    count: community.default_capacity,
                  })}
                </CommunityTag>
              )}
            </div>

            <div
              className="grid grid-cols-3 gap-1
              bg-black/25 border border-white/5
              rounded-2xl p-3 mt-5"
            >
              <CommunityStat
                value={String(regularMembers.length)}
                label={tx("Members")}
              />

              <CommunityStat value="0" label={tx("Games")} />

              <CommunityStat value="—" label={tx("Rank")} />
            </div>
          </div>
        </section>

        {/* NEXT GAME */}

        <section className="mb-7">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-black">{tx("Next Game")}</h2>

            {nextGame && (
              <span className="text-blue-400 text-sm">{tx("Upcoming")}</span>
            )}
          </div>

          {nextGame ? (
            <div
              onClick={() =>
                router.push(
                  `/communities/${communityId}/game-days/${nextGame.id}`,
                )
              }
              className="relative overflow-hidden
              rounded-[24px]
              border border-blue-600/50
              bg-gradient-to-br
              from-[#07162e]
              via-[#080b18]
              to-[#170725]
              p-5
              cursor-pointer
              hover:border-violet-500
              hover:shadow-[0_0_30px_rgba(124,58,237,0.2)]
              transition"
            >
              <div
                className="absolute right-0 top-0
                w-40 h-full
                bg-gradient-to-l
                from-violet-800/15
                to-transparent"
              />

              <div className="relative flex gap-4">
                <div
                  className="w-16 h-[76px]
                  rounded-xl
                  bg-[#12152d]
                  border border-violet-700/50
                  flex flex-col
                  items-center justify-center
                  shrink-0"
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

                <div className="min-w-0 flex-1">
                  <h3 className="text-xl font-black truncate">
                    {nextGame.title}
                  </h3>

                  <p className="text-gray-300 text-sm mt-1">
                    {nextGame.start_time
                      ? nextGame.start_time.slice(0, 5)
                      : tx("Time TBD")}
                  </p>

                  {nextGame.venue && (
                    <p className="text-gray-500 text-sm mt-1">
                      ◉ {nextGame.venue}
                    </p>
                  )}

                  <div className="flex gap-2 flex-wrap mt-3">
                    <BlueTag>
                      {nextGame.format}×{nextGame.format}
                    </BlueTag>

                    <BlueTag>
                      {nextGame.team_count} {tx("команды")}
                    </BlueTag>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div
              className="rounded-[22px]
              border border-blue-900/30
              bg-[#070b16]
              p-5"
            >
              <p className="text-gray-400">{tx("No upcoming games")}</p>

              {canManage && (
                <button
                  onClick={() =>
                    router.push(`/communities/${communityId}/game-days/create`)
                  }
                  className="mt-4 text-blue-400 font-semibold
                  cursor-pointer hover:text-blue-300"
                >
                  {tx("Create Game Day →")}
                </button>
              )}
            </div>
          )}
        </section>

        {/* ACTIONS */}

        {canManage && (
          <section className="mb-7">
            <h2 className="text-xl font-black mb-3">{tx("Manage")}</h2>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() =>
                  router.push(`/communities/${communityId}/game-days/create`)
                }
                className="rounded-[20px]
                border border-violet-700/50
                bg-gradient-to-br
                from-[#160b2d]
                to-[#090b14]
                p-4 text-left
                cursor-pointer
                hover:border-violet-500
                hover:shadow-[0_0_22px_rgba(124,58,237,0.18)]
                transition"
              >
                <div
                  className="w-10 h-10 rounded-xl
                  bg-violet-500/10
                  border border-violet-500/40
                  flex items-center justify-center
                  text-violet-400 text-xl mb-3"
                >
                  +
                </div>

                <p className="font-bold">{tx("Create Game Day")}</p>

                <p className="text-xs text-gray-500 mt-1">
                  {tx("Schedule next football session")}
                </p>
              </button>

              <CommunityMenu
                community={community}
                canManage={canManage}
                inviteOnly
              />
            </div>
          </section>
        )}

        {/* MEMBERS */}

        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-black">{tx("Players")}</h2>

            <span className="text-sm text-gray-500">{members.length}</span>
          </div>

          <div className="space-y-2">
            {members.map((member, index) => {
              const player = member.player_profiles;

              if (!player) return null;

              const isMe = player.id === myPlayerId;

              return (
                <div
                  key={member.id}
                  onClick={() => router.push(`/players/${player.id}`)}
                  className={`relative
                  flex items-center gap-3
                  rounded-2xl
                  border p-3
                  cursor-pointer
                  transition
                  ${
                    isMe
                      ? "border-violet-500/50 bg-violet-500/8 shadow-[0_0_18px_rgba(124,58,237,0.1)]"
                      : "border-white/5 bg-[#090c14] hover:border-violet-900/60"
                  }`}
                >
                  <span className="w-5 text-[11px] text-gray-600 text-center">
                    {index + 1}
                  </span>

                  <PlayerAvatar player={player} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold truncate">
                        {getPlayerName(player)}
                      </p>

                      {isMe && (
                        <span
                          className="text-[8px]
                          px-1.5 py-0.5
                          rounded-md
                          bg-violet-500/15
                          border border-violet-500/30
                          text-violet-300
                          font-bold"
                        >
                          {tx("Ты")}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className="text-[10px]
                        px-2 py-0.5
                        rounded-md
                        bg-violet-500/10
                        border border-violet-500/30
                        text-violet-300"
                      >
                        {positionLabel(player.primary_position)}
                      </span>

                      {player.secondary_position && (
                        <span className="text-[10px] text-gray-600">
                          {positionLabel(player.secondary_position)}
                        </span>
                      )}

                      <span className="text-[10px] text-gray-600">
                        #{player.baller_id}
                      </span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-black text-sm">—</p>

                    <p className="text-[9px] text-gray-600">{tx("Unrated")}</p>
                  </div>

                  <RoleBadge role={member.role} />
                </div>
              );
            })}
          </div>
        </section>

        {/* COMMUNITY INFO */}

        <section
          className="rounded-[22px]
          border border-white/5
          bg-[#080b14]
          p-5 mb-8"
        >
          <h2 className="text-lg font-black mb-4">
            {tx("Community Overview")}
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <InfoBlock
              label={tx("Format")}
              value={`${community.default_format}v${community.default_format}`}
            />

            <InfoBlock
              label={tx("Teams")}
              value={String(community.default_team_count)}
            />

            <InfoBlock
              label={tx("Mode")}
              value={tx(
                (
                  {
                    RANDOM: "Случайное распределение по командам",
                    FIXED: "Fixed",
                    MIXED: "Mixed",
                  } as Record<string, string>
                )[community.team_mode] || "Mixed",
              )}
            />

            <InfoBlock
              label={tx("Guests")}
              value={String(guestMembers.length)}
            />
          </div>
        </section>
      </div>
      <BottomNav />
    </main>
  );
}

/* ---------------------------------------------- */
/* COMPONENTS                                     */
/* ---------------------------------------------- */

function PlayerAvatar({ player }: { player: Player }) {
  useLocale();

  return (
    <div
      className="w-11 h-11 rounded-full
      overflow-hidden
      bg-[#151824]
      border border-violet-900/60
      shrink-0"
    >
      {player.avatar_url ? (
        <img
          src={player.avatar_url}
          alt={getPlayerName(player)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">👤</div>
      )}
    </div>
  );
}

function getPlayerName(player: Player) {
  return (
    player.display_name ||
    `${player.first_name} ${player.last_name ?? ""}`.trim()
  );
}

function RoleBadge({ role }: { role: string }) {
  useLocale();

  if (role === "OWNER") {
    return (
      <span
        className="absolute top-2 right-2
        text-[8px] font-bold
        text-yellow-300
        bg-yellow-500/10
        border border-yellow-500/30
        px-2 py-0.5 rounded-full"
      >
        {tx("организатор")}
      </span>
    );
  }

  if (role === "MANAGER") {
    return (
      <span
        className="absolute top-2 right-2
        text-[8px] font-bold
        text-blue-300
        bg-blue-500/10
        border border-blue-500/30
        px-2 py-0.5 rounded-full"
      >
        {tx("менеджер")}
      </span>
    );
  }

  return null;
}

function CommunityTag({ children }: { children: React.ReactNode }) {
  useLocale();

  return (
    <span
      className="px-3 py-1
      rounded-lg
      text-xs font-semibold
      bg-emerald-500/10
      border border-emerald-500/30
      text-emerald-200"
    >
      {children}
    </span>
  );
}

function BlueTag({ children }: { children: React.ReactNode }) {
  useLocale();

  return (
    <span
      className="px-3 py-1
      rounded-lg
      text-xs font-semibold
      bg-blue-700/20
      border border-blue-500/30
      text-blue-200"
    >
      {children}
    </span>
  );
}

function CommunityStat({ value, label }: { value: string; label: string }) {
  useLocale();

  return (
    <div className="text-center border-r border-white/5 last:border-r-0">
      <p className="font-black text-lg">{value}</p>

      <p className="text-[10px] text-gray-500">{label}</p>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  useLocale();

  return (
    <div
      className="rounded-xl
      bg-[#10131d]
      border border-white/5
      p-3"
    >
      <p className="text-[10px] uppercase tracking-wider text-gray-600">
        {label}
      </p>

      <p className="font-bold mt-1">{value}</p>
    </div>
  );
}

/* ---------------------------------------------- */
/* DATE                                           */
/* ---------------------------------------------- */

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
