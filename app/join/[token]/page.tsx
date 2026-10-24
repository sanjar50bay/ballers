"use client";
import { uiError, t as tx } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { preMatchError } from "@/lib/pre-match";
import {
  ensureRegistrationProfile,
  ownRegistrationProfile,
  registrationError,
  registrationUser,
  registrationValidation,
} from "@/lib/profile-registration";

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
  useLocale();

  const params = useParams();

  const token = params.token as string;

  const [invite, setInvite] = useState<Invite | null>(null);
  const [loading, setLoading] = useState(true);

  const [userReady, setUserReady] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [joining, setJoining] = useState(false);
  const [formError, setFormError] = useState("");
  const submitting = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (formError) {
      errorRef.current?.scrollIntoView({ block: "center" });
      errorRef.current?.focus({ preventScroll: true });
    }
  }, [formError]);

  const [firstName, setFirstName] = useState("");
  const [primaryPosition, setPrimaryPosition] = useState("MID");
  const [secondaryPosition, setSecondaryPosition] = useState("");
  const [dominantFoot, setDominantFoot] = useState("RIGHT");

  const joinGame = useCallback(
    async (_playerId: string, inviteData: Invite) => {
      setJoining(true);
      setFormError("");
      try {
        const { error } = await supabase
          .rpc(
            inviteData.invite_type === "COMMUNITY"
              ? "ballers_join_community_invite"
              : "ballers_join_game_invite",
            { p_token: token },
          )
          .abortSignal(AbortSignal.timeout(15000));
        if (error) throw error;
        // New document refreshes shared profile/community state, preserving this invite's target.
        window.location.replace(
          inviteData.invite_type === "COMMUNITY"
            ? `/communities/${inviteData.community_id}`
            : `/communities/${inviteData.community_id}/game-days/${inviteData.game_day_id}`,
        );
      } catch (e) {
        setFormError(
          "Не удалось принять приглашение. " +
            (e && typeof e === "object" && "message" in e
              ? preMatchError({ message: String(e.message) })
              : tx("Проверь соединение и попробуй снова.")),
        );
      } finally {
        setJoining(false);
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    const loadInvite = async () => {
      try {
        const { data, error } = await supabase
          .rpc("get_invite_by_token", { invite_token: token })
          .abortSignal(AbortSignal.timeout(15000));
        if (error) throw error;
        if (!data?.length) {
          setLoading(false);
          return;
        }
        const inviteData = data[0] as Invite;
        setInvite(inviteData);
        const user = await registrationUser(supabase);
        if (!user) {
          setLoading(false);
          return;
        }
        setUserReady(true);
        const profile = await ownRegistrationProfile(supabase, user.id);
        if (!profile) {
          setFirstName(
            user.user_metadata?.full_name?.split(" ")[0] ??
              user.user_metadata?.name?.split(" ")[0] ??
              "",
          );
          setNeedsProfile(true);
          setLoading(false);
          return;
        }
        await joinGame(profile.id, inviteData);
      } catch (e) {
        setFormError(registrationError(e));
        setLoading(false);
      }
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
      alert(uiError(error.message));
    }
  };

  const createProfileAndJoin = async () => {
    if (!invite || submitting.current) return;
    const input = {
      first_name: firstName,
      city: "Astana",
      primary_position: primaryPosition,
      secondary_position: secondaryPosition || null,
      dominant_foot: dominantFoot,
    };
    const invalid = registrationValidation(input);
    if (invalid) {
      setFormError(invalid);
      return;
    }
    submitting.current = true;
    setJoining(true);
    setFormError("");
    try {
      const user = await registrationUser(supabase);
      if (!user) {
        setUserReady(false);
        return;
      }
      const profile = await ensureRegistrationProfile(supabase, user, input);
      const current = await registrationUser(supabase);
      if (current?.id !== user.id) {
        setUserReady(false);
        return;
      }
      await joinGame(profile.id, invite);
    } catch (e) {
      setFormError(registrationError(e));
    } finally {
      submitting.current = false;
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-gray-400">{tx("Loading invite...")}</p>
      </main>
    );
  }

  if (!invite && formError)
    return (
      <main className="ballers-shell py-10">
        <p role="alert" className="error-panel">
          {tx(formError)}
        </p>
        <button
          className="neon-button mt-4"
          onClick={() => window.location.reload()}
        >
          {tx("Повторить загрузку")}
        </button>
      </main>
    );

  if (!invite) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">{tx("Invite not found")}</h1>

          <p className="text-gray-500 mt-2">
            {tx("This invite may be invalid or expired.")}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white px-6 py-10">
      <div className="max-w-md mx-auto">
        {formError && (
          <section className="error-panel mb-5">
            <p ref={errorRef} tabIndex={-1} role="alert">
              {tx(formError)}
            </p>
            {!needsProfile && (
              <button
                className="text-link mt-3"
                onClick={() => window.location.reload()}
              >
                {tx("Повторить принятие приглашения")}
              </button>
            )}
          </section>
        )}

        <div className="mb-8">
          <p className="text-gray-500 text-sm">BALLERS</p>

          <p className="text-blue-400 text-sm mt-6">{tx("You're invited")}</p>

          <h1 className="text-3xl font-bold mt-1">
            {invite.invite_type === "COMMUNITY"
              ? invite.community_name
              : invite.game_title}
          </h1>

          <p className="text-gray-400 mt-1">{invite.community_name}</p>
        </div>

        {/* GAME CARD */}
        {invite.invite_type !== "COMMUNITY" && (
          <section className="bg-blue-950/30 border border-blue-800/40 rounded-3xl p-5">
            <p className="text-lg font-medium">
              {invite.game_date}

              {invite.start_time && ` · ${invite.start_time.slice(0, 5)}`}
            </p>

            {invite.venue && (
              <p className="text-gray-400 mt-1">{invite.venue}</p>
            )}

            <div className="flex gap-2 mt-4 flex-wrap">
              <span className="bg-blue-900/40 px-3 py-1 rounded-full text-sm">
                {invite.format}×{invite.format}
              </span>

              {invite.capacity && (
                <span className="bg-blue-900/40 px-3 py-1 rounded-full text-sm">
                  {invite.capacity} {tx("игроков")}
                </span>
              )}

              <span className="bg-neutral-800 px-3 py-1 rounded-full text-sm">
                {tx("Guest invite")}
              </span>
            </div>
          </section>
        )}

        {invite.invite_type === "COMMUNITY" && (
          <p className="text-gray-300">
            {tx(
              "Приглашение в сообщество. После входа ты станешь участником, но ответ на каждую игру выбираешь отдельно.",
            )}
          </p>
        )}

        {/* NOT LOGGED IN */}
        {!userReady && (
          <section className="mt-7">
            <p className="text-gray-400 text-sm mb-4">
              {tx("Войди через Google, чтобы принять приглашение.")}
            </p>

            <button
              onClick={signInWithGoogle}
              className="w-full bg-white text-black rounded-2xl py-4 font-semibold cursor-pointer hover:bg-neutral-200 transition"
            >
              {tx("Continue with Google")}
            </button>
          </section>
        )}

        {/* NEW PLAYER */}
        {userReady && needsProfile && (
          <section className="mt-8">
            <h2 className="text-xl font-semibold">
              {tx("Complete your Baller profile")}
            </h2>

            <p className="text-gray-500 text-sm mt-1 mb-5">
              {tx("Just a few football details.")}
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-500 block mb-2">
                  {tx("First name")}
                </label>

                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder={tx("First name")}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
                />
              </div>

              <div>
                <label className="text-sm text-gray-500 block mb-2">
                  {tx("Primary position")}
                </label>

                <select
                  value={primaryPosition}
                  onChange={(e) => setPrimaryPosition(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
                >
                  <option value="GK">{tx("Goalkeeper")}</option>

                  <option value="DEF">{tx("Defender")}</option>

                  <option value="MID">{tx("Midfielder")}</option>

                  <option value="ATT">{tx("Attacker")}</option>
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-500 block mb-2">
                  {tx("Secondary position")}
                </label>

                <select
                  value={secondaryPosition}
                  onChange={(e) => setSecondaryPosition(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
                >
                  <option value="">{tx("None")}</option>

                  <option value="GK">{tx("Goalkeeper")}</option>

                  <option value="DEF">{tx("Defender")}</option>

                  <option value="MID">{tx("Midfielder")}</option>

                  <option value="ATT">{tx("Attacker")}</option>
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-500 block mb-2">
                  {tx("Dominant foot")}
                </label>

                <select
                  value={dominantFoot}
                  onChange={(e) => setDominantFoot(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
                >
                  <option value="RIGHT">{tx("Right")}</option>

                  <option value="LEFT">{tx("Left")}</option>

                  <option value="BOTH">{tx("Both")}</option>
                </select>
              </div>

              <button
                onClick={createProfileAndJoin}
                disabled={!firstName || joining}
                className="w-full bg-blue-500 hover:bg-blue-400 text-white rounded-2xl py-4 font-semibold cursor-pointer transition disabled:opacity-50"
              >
                {joining ? tx("Joining...") : tx("Join Game")}
              </button>
            </div>
          </section>
        )}

        {/* EXISTING USER AUTO JOIN */}
        {userReady && !needsProfile && joining && (
          <div className="mt-8 bg-neutral-900 rounded-2xl p-5 text-center">
            <p className="text-gray-400">{tx("Joining game...")}</p>
          </div>
        )}
      </div>
    </main>
  );
}
