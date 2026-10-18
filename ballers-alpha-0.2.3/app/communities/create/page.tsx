"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { preMatchError } from "@/lib/pre-match";

export default function CreateCommunityPage() {
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
      alert("User not found");
      setLoading(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("player_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile) {
      alert("Player profile not found");
      setLoading(false);
      return;
    }

    const { error } = await supabase.rpc("ballers_create_community", {
      p_name: name, p_city: city, p_team_mode: teamMode, p_format: Number(format),
      p_team_count: Number(teamCount), p_capacity: capacity ? Number(capacity) : null,
    });
    if (error) { alert(preMatchError(error)); setLoading(false); return; }

    router.push("/");
  };

  return (
    <main className="min-h-screen bg-black text-white px-6 py-8">
      <div className="max-w-md mx-auto">
        <button
          onClick={() => router.back()}
          className="text-gray-400 mb-6"
        >
          ← Back
        </button>

        <h1 className="text-3xl font-bold mb-2">
          Create Community
        </h1>

        <p className="text-gray-400 mb-8">
          Create a permanent football group.
        </p>

        <div className="space-y-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Community name"
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          />

          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="City"
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          />

          <select
            value={teamMode}
            onChange={(e) => setTeamMode(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          >
            <option value="RANDOM">Random teams</option>
            <option value="FIXED">Fixed teams</option>
            <option value="MIXED">Mixed</option>
          </select>

          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          >
            <option value="1">1v1</option>
            <option value="2">2v2</option>
            <option value="3">3v3</option>
            <option value="4">4v4</option>
            <option value="5">5v5</option>
            <option value="6">6v6</option>
            <option value="7">7v7</option>
            <option value="8">8v8</option>
            <option value="9">9v9</option>
            <option value="10">10v10</option>
            <option value="11">11v11</option>
          </select>

          <input
            value={teamCount}
            onChange={(e) => setTeamCount(e.target.value)}
            type="number"
            min="2"
            placeholder="Number of teams"
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          />

          <input
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            type="number"
            placeholder="Player capacity"
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
          />

          <button
            onClick={createCommunity}
            disabled={loading || !name}
            className="w-full bg-white text-black rounded-xl py-4 font-semibold disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Community"}
          </button>
        </div>
      </div>
    </main>
  );
}