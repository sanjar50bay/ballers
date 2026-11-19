"use client";
import { t as tx, getLocale, setLocale, type Locale } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import ProfilePhotoPicker from "@/app/components/ProfilePhotoPicker";
import {
  resolveProfilePhoto,
  removePreviousPhoto,
  photoError,
  type PhotoChoice,
} from "@/lib/profile-photo";
import { CitySelect } from "@/app/components/Network";
import Link from "next/link";
import { useApp } from "@/app/components/AppState";
import { useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Profile = {
  id: string;
  user_id: string;
  identity_first_name: string | null;
  identity_last_name: string | null;
  display_name: string | null;
  first_name: string;
  last_name: string | null;
  city: string | null;
  primary_position: string;
  secondary_position: string | null;
  dominant_foot: string | null;
  avatar_url: string | null;
  preferred_language: string | null;
};

export default function EditProfilePage() {
  useLocale();

  const router = useRouter();
  const { refresh } = useApp();

  const saveLock = useRef(false);
  const [photo, setPhoto] = useState<PhotoChoice>({ kind: "keep" });
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [city, setCity] = useState("");
  const [primaryPosition, setPrimaryPosition] = useState("MID");
  const [secondaryPosition, setSecondaryPosition] = useState("");
  const [dominantFoot, setDominantFoot] = useState("RIGHT");
  const language = useLocale();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/");
        return;
      }

      const { data, error } = await supabase
        .from("player_profiles")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (error || !data) {
        console.error(error);
        setLoading(false);
        return;
      }

      setProfile(data);

      setDisplayName(
        data.display_name ??
          `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim(),
      );

      setCity(data.city ?? "");
      setPrimaryPosition(data.primary_position ?? "MID");
      setSecondaryPosition(data.secondary_position ?? "");
      setDominantFoot(data.dominant_foot ?? "RIGHT");

      setLoading(false);
    };

    loadProfile();
  }, [router]);

  const saveProfile = async () => {
    if (!profile || saveLock.current || photoBusy) return;
    saveLock.current = true;
    setSaving(true);
    setSaveError("");
    try {
      const {
        data: { session },
        error: authError,
      } = await supabase.auth.getSession();
      if (authError || session?.user.id !== profile.user_id)
        throw new Error("PHOTO_ACCOUNT");
      const avatar = await resolveProfilePhoto(
        supabase,
        profile.user_id,
        photo,
        profile.avatar_url,
      );
      const { error } = await supabase
        .from("player_profiles")
        .update({
          display_name: displayName,
          city,
          primary_position: primaryPosition,
          secondary_position: secondaryPosition || null,
          dominant_foot: dominantFoot,
          preferred_language: getLocale(),
          avatar_url: avatar,
        })
        .eq("id", profile.id)
        .eq("user_id", profile.user_id)
        .abortSignal(AbortSignal.timeout(15000));
      // A lost response can still mean a committed photo update. Read before retrying.
      const { data: confirmed, error: readError } = await supabase
        .from("player_profiles")
        .select(
          "id,avatar_url,display_name,city,primary_position,secondary_position,dominant_foot,preferred_language",
        )
        .eq("id", profile.id)
        .eq("user_id", profile.user_id)
        .abortSignal(AbortSignal.timeout(15000))
        .maybeSingle();
      if (
        readError ||
        !confirmed ||
        confirmed.avatar_url !== avatar ||
        confirmed.display_name !== displayName ||
        confirmed.city !== city ||
        confirmed.primary_position !== primaryPosition ||
        confirmed.secondary_position !== (secondaryPosition || null) ||
        confirmed.dominant_foot !== dominantFoot ||
        confirmed.preferred_language !== getLocale()
      )
        throw error || new Error("PROFILE_SAVE_UNCONFIRMED");
      void removePreviousPhoto(
        supabase,
        profile.user_id,
        profile.avatar_url,
        avatar,
      );
      await refresh();
      router.push("/profile");
    } catch (e) {
      setSaveError(
        photoError(e) ||
          tx(
            "Не удалось подтвердить сохранение. Проверь соединение и повтори.",
          ),
      );
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        {tx("Loading profile...")}
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        {tx("Profile not found")}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white px-6 py-8">
      <div className="max-w-md mx-auto">
        <Link
          href="/profile"
          className="text-gray-400 mb-6 cursor-pointer hover:text-white"
        >
          {tx("← Профиль")}
        </Link>

        <h1 className="text-3xl font-bold mb-2">{tx("Edit Profile")}</h1>

        <p className="text-gray-500 mb-8">
          {tx("Update your football profile.")}
        </p>

        <ProfilePhotoPicker
          choice={photo}
          onChange={setPhoto}
          initialUrl={profile.avatar_url}
          name={displayName}
          position={primaryPosition}
          onPreparing={setPhotoBusy}
          disabled={saving}
        />
        <div className="space-y-5">
          {/* PROTECTED IDENTITY */}
          <div>
            <label className="text-sm text-gray-500 block mb-2">
              {tx("Identity name")}
            </label>

            <div className="bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-gray-400">
              🔒 {profile.identity_first_name ?? profile.first_name}{" "}
              {profile.identity_last_name ?? profile.last_name ?? ""}
            </div>

            <p className="text-xs text-gray-600 mt-2">
              {tx("Identity name is protected to preserve player history.")}
            </p>
          </div>

          {/* DISPLAY NAME */}
          <div>
            <label
              htmlFor="edit-display-name"
              className="text-sm text-gray-500 block mb-2"
            >
              {tx("Display name")}
            </label>

            <input
              id="edit-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
            />
          </div>

          <CitySelect value={city} onChange={setCity} id="edit-city" />

          <div>
            <label
              htmlFor="edit-primary-position"
              className="text-sm text-gray-500 block mb-2"
            >
              {tx("Primary position")}
            </label>

            <select
              id="edit-primary-position"
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
            <label
              htmlFor="edit-secondary-position"
              className="text-sm text-gray-500 block mb-2"
            >
              {tx("Secondary position")}
            </label>

            <select
              id="edit-secondary-position"
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
            <label
              htmlFor="edit-dominant-foot"
              className="text-sm text-gray-500 block mb-2"
            >
              {tx("Dominant foot")}
            </label>

            <select
              id="edit-dominant-foot"
              value={dominantFoot}
              onChange={(e) => setDominantFoot(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
            >
              <option value="RIGHT">{tx("Right")}</option>
              <option value="LEFT">{tx("Left")}</option>
              <option value="BOTH">{tx("Both")}</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="edit-language"
              className="text-sm text-gray-500 block mb-2"
            >
              {tx("Language")}
            </label>

            <select
              id="edit-language"
              value={language}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
            >
              <option value="ru">Русский</option>
              <option value="kk">Қазақша</option>
            </select>
          </div>

          <button
            onClick={saveProfile}
            disabled={saving || photoBusy}
            className="w-full bg-white text-black rounded-2xl py-4 font-semibold cursor-pointer hover:bg-neutral-200 disabled:opacity-50"
          >
            {saving ? tx("Saving...") : tx("Save changes")}
          </button>
          {saveError && (
            <p role="alert" className="error-panel">
              {saveError}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
