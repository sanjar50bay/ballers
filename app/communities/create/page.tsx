"use client";
import { t as tx } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { preMatchError } from "@/lib/pre-match";

export default function CreateCommunityPage() {
  useLocale();

  const router = useRouter();

  const [name, setName] = useState("Wednesday Football");
  const [city, setCity] = useState("Astana");
  const [teamMode, setTeamMode] = useState("RANDOM");
  const [format, setFormat] = useState("5");
  const [teamCount, setTeamCount] = useState("3");
  const [capacity, setCapacity] = useState("15");
  const [loading, setLoading] = useState(false);

  const createCommunity = async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert(tx("User not found"));
      setLoading(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("player_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile) {
      alert(tx("Player profile not found"));
      setLoading(false);
      return;
    }

    const { error } = await supabase.rpc("ballers_create_community", {
      p_name: name,
      p_city: city,
      p_team_mode: teamMode,
      p_format: Number(format),
      p_team_count: Number(teamCount),
      p_capacity: capacity ? Number(capacity) : null,
    });
    if (error) {
      alert(preMatchError(error));
      setLoading(false);
      return;
    }

    router.push("/");
  };

  return (
    <main className="min-h-screen bg-black text-white px-6 py-8">
      <div className="max-w-md mx-auto">
        <button onClick={() => router.back()} className="text-gray-400 mb-6">
          {tx("← Back")}
        </button>

        <h1 className="text-3xl font-bold mb-2">{tx("Create Community")}</h1>

        <p className="text-gray-400 mb-8">
          {tx("Create a permanent football group.")}
        </p>

        <div className="space-y-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tx("Community name")}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          />

          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={tx("City")}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          />

          <select
            value={teamMode}
            onChange={(e) => setTeamMode(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          >
            <option value="RANDOM">{tx("Random teams")}</option>
            <option value="FIXED">{tx("Fixed teams")}</option>
            <option value="MIXED">{tx("Mixed")}</option>
          </select>

          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          >
            <option value="1">1×1</option>
            <option value="2">2×2</option>
            <option value="3">3×3</option>
            <option value="4">4×4</option>
            <option value="5">5×5</option>
            <option value="6">6×6</option>
            <option value="7">7×7</option>
            <option value="8">8×8</option>
            <option value="9">9×9</option>
            <option value="10">10×10</option>
            <option value="11">11×11</option>
          </select>

          <input
            value={teamCount}
            onChange={(e) => setTeamCount(e.target.value)}
            type="number"
            min="2"
            placeholder={tx("Number of teams")}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          />

          <input
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            type="number"
            placeholder={tx("Player capacity")}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          />

          <button
            onClick={createCommunity}
            disabled={loading || !name}
            className="w-full bg-white text-black rounded-xl py-4 font-semibold disabled:opacity-50"
          >
            {loading ? tx("Creating...") : tx("Create Community")}
          </button>
        </div>
      </div>
    </main>
  );
}
