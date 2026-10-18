"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function OnboardingPage() {
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [city, setCity] = useState("Astana");
  const [birthYear, setBirthYear] = useState("");
  const [primaryPosition, setPrimaryPosition] = useState("MID");
  const [secondaryPosition, setSecondaryPosition] = useState("");
  const [dominantFoot, setDominantFoot] = useState("RIGHT");
  const [loading, setLoading] = useState(false);

  const saveProfile = async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("User not found");
      setLoading(false);
      return;
    }

    const { error } = await supabase.from("player_profiles").insert({
      user_id: user.id,
      first_name: firstName,
      last_name: lastName || null,
      city,
      birth_year: birthYear ? Number(birthYear) : null,
      primary_position: primaryPosition,
      secondary_position: secondaryPosition || null,
      dominant_foot: dominantFoot,
      avatar_url: user.user_metadata?.avatar_url ?? null,
    });

    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }

    router.push("/");
  };

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <h1 className="text-4xl font-bold mb-2">Create your Baller profile</h1>

        <p className="text-gray-400 mb-8">
          Tell us how you play.
        </p>

        <div className="space-y-4">

          <input
            placeholder="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          />

          <input
            placeholder="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          />

          <input
            placeholder="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          />

          <input
            placeholder="Birth year"
            type="number"
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          />

          <select
            value={primaryPosition}
            onChange={(e) => setPrimaryPosition(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          >
            <option value="GK">Goalkeeper</option>
            <option value="DEF">Defender</option>
            <option value="MID">Midfielder</option>
            <option value="ATT">Attacker</option>
          </select>

          <select
            value={secondaryPosition}
            onChange={(e) => setSecondaryPosition(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          >
            <option value="">No secondary position</option>
            <option value="GK">Goalkeeper</option>
            <option value="DEF">Defender</option>
            <option value="MID">Midfielder</option>
            <option value="ATT">Attacker</option>
          </select>

          <select
            value={dominantFoot}
            onChange={(e) => setDominantFoot(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          >
            <option value="RIGHT">Right foot</option>
            <option value="LEFT">Left foot</option>
            <option value="BOTH">Both</option>
          </select>

          <button
            onClick={saveProfile}
            disabled={loading || !firstName}
            className="w-full bg-white text-black rounded-xl py-4 font-semibold disabled:opacity-50"
          >
            {loading ? "Creating profile..." : "Create Baller profile"}
          </button>
        </div>
      </div>
    </main>
  );
}