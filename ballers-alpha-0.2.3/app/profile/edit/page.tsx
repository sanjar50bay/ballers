"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Profile = {
  id: string;
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
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [city, setCity] = useState("");
  const [primaryPosition, setPrimaryPosition] = useState("MID");
  const [secondaryPosition, setSecondaryPosition] = useState("");
  const [dominantFoot, setDominantFoot] = useState("RIGHT");
  const [language, setLanguage] = useState("ru");

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
          `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim()
      );

      setCity(data.city ?? "");
      setPrimaryPosition(data.primary_position ?? "MID");
      setSecondaryPosition(data.secondary_position ?? "");
      setDominantFoot(data.dominant_foot ?? "RIGHT");
      setLanguage(data.preferred_language ?? "ru");

      setLoading(false);
    };

    loadProfile();
  }, [router]);

  const saveProfile = async () => {
    if (!profile) return;

    setSaving(true);

    const { error } = await supabase
      .from("player_profiles")
      .update({
        display_name: displayName,
        city,
        primary_position: primaryPosition,
        secondary_position: secondaryPosition || null,
        dominant_foot: dominantFoot,
        preferred_language: language,
      })
      .eq("id", profile.id);

    if (error) {
      alert(error.message);
      setSaving(false);
      return;
    }

    router.push("/");
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        Loading profile...
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        Profile not found
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white px-6 py-8">
      <div className="max-w-md mx-auto">

        <button
          onClick={() => router.back()}
          className="text-gray-400 mb-6 cursor-pointer hover:text-white"
        >
          ← Back
        </button>

        <h1 className="text-3xl font-bold mb-2">
          Edit Profile
        </h1>

        <p className="text-gray-500 mb-8">
          Update your football profile.
        </p>

        {/* PHOTO */}
        <section className="flex flex-col items-center mb-8">
          <div className="w-28 h-28 rounded-full bg-neutral-800 overflow-hidden flex items-center justify-center text-4xl">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt="Profile"
                className="w-full h-full object-cover"
              />
            ) : (
              "👤"
            )}
          </div>

          <button
            onClick={() =>
              alert("Photo upload comes next")
            }
            className="mt-3 text-sm text-blue-400 cursor-pointer"
          >
            Change photo
          </button>
        </section>

        <div className="space-y-5">

          {/* PROTECTED IDENTITY */}
          <div>
            <label className="text-sm text-gray-500 block mb-2">
              Identity name
            </label>

            <div className="bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-gray-400">
              🔒{" "}
              {profile.identity_first_name ??
                profile.first_name}{" "}
              {profile.identity_last_name ??
                profile.last_name ??
                ""}
            </div>

            <p className="text-xs text-gray-600 mt-2">
              Identity name is protected to preserve player history.
            </p>
          </div>

          {/* DISPLAY NAME */}
          <div>
            <label className="text-sm text-gray-500 block mb-2">
              Display name
            </label>

            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
            />
          </div>

          <div>
            <label className="text-sm text-gray-500 block mb-2">
              City
            </label>

            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
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
              <option value="GK">Goalkeeper</option>
              <option value="DEF">Defender</option>
              <option value="MID">Midfielder</option>
              <option value="ATT">Attacker</option>
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
              <option value="">None</option>
              <option value="GK">Goalkeeper</option>
              <option value="DEF">Defender</option>
              <option value="MID">Midfielder</option>
              <option value="ATT">Attacker</option>
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
              <option value="RIGHT">Right</option>
              <option value="LEFT">Left</option>
              <option value="BOTH">Both</option>
            </select>
          </div>

          <div>
            <label className="text-sm text-gray-500 block mb-2">
              Language
            </label>

            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
            >
              <option value="ru">Русский</option>
              <option value="kk">Қазақша</option>
              <option value="en">English</option>
            </select>
          </div>

          <button
            onClick={saveProfile}
            disabled={saving}
            className="w-full bg-white text-black rounded-2xl py-4 font-semibold cursor-pointer hover:bg-neutral-200 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>

        </div>

      </div>
    </main>
  );
}