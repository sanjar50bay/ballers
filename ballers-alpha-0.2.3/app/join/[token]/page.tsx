"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { preMatchError } from "@/lib/pre-match";

type Invite = {
  invite_id: string;
  token: string;
  invite_type: string;
  community_id: string;
  community_name: string;
  game_day_id: string;
  game_title: string;
  game_date: string;
  start_time: string | null;
  venue: string | null;
  format: number;
  capacity: number | null;
  is_active: boolean;
};

export default function JoinPage() {
  const params = useParams();
  const router = useRouter();

  const token = params.token as string;

  const [invite, setInvite] = useState<Invite | null>(null);
  const [loading, setLoading] = useState(true);

  const [userReady, setUserReady] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [joining, setJoining] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [primaryPosition, setPrimaryPosition] = useState("MID");
  const [secondaryPosition, setSecondaryPosition] = useState("");
  const [dominantFoot, setDominantFoot] = useState("RIGHT");

  const joinGame = useCallback(async (_playerId: string, inviteData: Invite) => {
    setJoining(true);
    const { error } = await supabase.rpc(inviteData.invite_type === "COMMUNITY" ? "ballers_join_community_invite" : "ballers_join_game_invite", { p_token: token });
    if (error) { alert(preMatchError(error)); setJoining(false); setLoading(false); return; }
    router.push(inviteData.invite_type === "COMMUNITY" ? `/communities/${inviteData.community_id}` : `/communities/${inviteData.community_id}/game-days/${inviteData.game_day_id}`);
  }, [router, token]);

  useEffect(() => {
    const loadInvite = async () => {
      const { data, error } = await supabase.rpc(
        "get_invite_by_token",
        {
          invite_token: token,
        }
      );

      if (error || !data || data.length === 0) {
        console.error("Invite error:", error);
        setLoading(false);
        return;
      }

      const inviteData = data[0] as Invite;

      setInvite(inviteData);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      setUserReady(true);

      const { data: profile, error: profileError } = await supabase
        .from("player_profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profileError) {
        console.error("Profile error:", profileError);
      }

      if (!profile) {
        setFirstName(
          user.user_metadata?.full_name?.split(" ")[0] ??
            user.user_metadata?.name?.split(" ")[0] ??
            ""
        );

        setNeedsProfile(true);
        setLoading(false);
        return;
      }

      await joinGame(profile.id, inviteData);
    };

    loadInvite();
  }, [token, joinGame]);

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/join/${token}`,
      },
    });

    if (error) {
      alert(error.message);
    }
  };

  const createProfileAndJoin = async () => {
    if (!invite || !firstName) return;

    setJoining(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("User not found");
      setJoining(false);
      return;
    }

    const { data: profile, error } = await supabase
      .from("player_profiles")
      .insert({
        user_id: user.id,
        first_name: firstName,
        city: "Astana",
        primary_position: primaryPosition,
        secondary_position: secondaryPosition || null,
        dominant_foot: dominantFoot,
        avatar_url:
          user.user_metadata?.avatar_url ??
          user.user_metadata?.picture ??
          null,
      })
      .select("id")
      .single();

    if (error || !profile) {
      alert(error?.message || "Could not create profile");
      setJoining(false);
      return;
    }

    await joinGame(profile.id, invite);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-gray-400">
          Loading invite...
        </p>
      </main>
    );
  }

  if (!invite) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">
            Invite not found
          </h1>

          <p className="text-gray-500 mt-2">
            This invite may be invalid or expired.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white px-6 py-10">
      <div className="max-w-md mx-auto">

        <div className="mb-8">
          <p className="text-gray-500 text-sm">
            BALLERS
          </p>

          <p className="text-blue-400 text-sm mt-6">
            You&apos;re invited
          </p>

          <h1 className="text-3xl font-bold mt-1">
            {invite.invite_type === "COMMUNITY" ? invite.community_name : invite.game_title}
          </h1>

          <p className="text-gray-400 mt-1">
            {invite.community_name}
          </p>
        </div>

        {/* GAME CARD */}
        {invite.invite_type !== "COMMUNITY" && <section className="bg-blue-950/30 border border-blue-800/40 rounded-3xl p-5">

          <p className="text-lg font-medium">
            {invite.game_date}

            {invite.start_time &&
              ` · ${invite.start_time.slice(0, 5)}`}
          </p>

          {invite.venue && (
            <p className="text-gray-400 mt-1">
              {invite.venue}
            </p>
          )}

          <div className="flex gap-2 mt-4 flex-wrap">

            <span className="bg-blue-900/40 px-3 py-1 rounded-full text-sm">
              {invite.format}v{invite.format}
            </span>

            {invite.capacity && (
              <span className="bg-blue-900/40 px-3 py-1 rounded-full text-sm">
                {invite.capacity} players
              </span>
            )}

            <span className="bg-neutral-800 px-3 py-1 rounded-full text-sm">
              Guest invite
            </span>

          </div>
        </section>}

        {invite.invite_type === "COMMUNITY" && <p className="text-gray-300">Приглашение в сообщество. После входа ты станешь участником, но ответ на каждую игру выбираешь отдельно.</p>}

        {/* NOT LOGGED IN */}
        {!userReady && (
          <section className="mt-7">

            <p className="text-gray-400 text-sm mb-4">
              Войди через Google, чтобы принять приглашение.
            </p>

            <button
              onClick={signInWithGoogle}
              className="w-full bg-white text-black rounded-2xl py-4 font-semibold cursor-pointer hover:bg-neutral-200 transition"
            >
              Continue with Google
            </button>

          </section>
        )}

        {/* NEW PLAYER */}
        {userReady && needsProfile && (
          <section className="mt-8">

            <h2 className="text-xl font-semibold">
              Complete your Baller profile
            </h2>

            <p className="text-gray-500 text-sm mt-1 mb-5">
              Just a few football details.
            </p>

            <div className="space-y-4">

              <div>
                <label className="text-sm text-gray-500 block mb-2">
                  First name
                </label>

                <input
                  value={firstName}
                  onChange={(e) =>
                    setFirstName(e.target.value)
                  }
                  placeholder="First name"
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
                />
              </div>

              <div>
                <label className="text-sm text-gray-500 block mb-2">
                  Primary position
                </label>

                <select
                  value={primaryPosition}
                  onChange={(e) =>
                    setPrimaryPosition(e.target.value)
                  }
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
                >
                  <option value="GK">
                    Goalkeeper
                  </option>

                  <option value="DEF">
                    Defender
                  </option>

                  <option value="MID">
                    Midfielder
                  </option>

                  <option value="ATT">
                    Attacker
                  </option>
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-500 block mb-2">
                  Secondary position
                </label>

                <select
                  value={secondaryPosition}
                  onChange={(e) =>
                    setSecondaryPosition(e.target.value)
                  }
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
                >
                  <option value="">
                    None
                  </option>

                  <option value="GK">
                    Goalkeeper
                  </option>

                  <option value="DEF">
                    Defender
                  </option>

                  <option value="MID">
                    Midfielder
                  </option>

                  <option value="ATT">
                    Attacker
                  </option>
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-500 block mb-2">
                  Dominant foot
                </label>

                <select
                  value={dominantFoot}
                  onChange={(e) =>
                    setDominantFoot(e.target.value)
                  }
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
                >
                  <option value="RIGHT">
                    Right
                  </option>

                  <option value="LEFT">
                    Left
                  </option>

                  <option value="BOTH">
                    Both
                  </option>
                </select>
              </div>

              <button
                onClick={createProfileAndJoin}
                disabled={!firstName || joining}
                className="w-full bg-blue-500 hover:bg-blue-400 text-white rounded-2xl py-4 font-semibold cursor-pointer transition disabled:opacity-50"
              >
                {joining
                  ? "Joining..."
                  : "Join Game"}
              </button>

            </div>

          </section>
        )}

        {/* EXISTING USER AUTO JOIN */}
        {userReady && !needsProfile && joining && (
          <div className="mt-8 bg-neutral-900 rounded-2xl p-5 text-center">
            <p className="text-gray-400">
              Joining game...
            </p>
          </div>
        )}

      </div>
    </main>
  );
}