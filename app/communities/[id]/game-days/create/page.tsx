"use client";
import { t as tx } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { preMatchError } from "@/lib/pre-match";

type Community = {
  id: string;
  name: string;
  default_format: number;
  default_team_count: number;
  default_capacity: number | null;
};

export default function CreateGameDayPage() {
  useLocale();

  const params = useParams();
  const router = useRouter();

  const communityId = params.id as string;

  const [community, setCommunity] = useState<Community | null>(null);

  const [date, setDate] = useState("");
  const [time, setTime] = useState("20:00");
  const [venue, setVenue] = useState("");
  const [format, setFormat] = useState("5");
  const [teamCount, setTeamCount] = useState("3");
  const [capacity, setCapacity] = useState("15");

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const loadCommunity = async () => {
      const { data, error } = await supabase
        .from("communities")
        .select(
          `
          id,
          name,
          default_format,
          default_team_count,
          default_capacity
        `,
        )
        .eq("id", communityId)
        .single();

      if (error || !data) {
        console.error(error);
        setLoading(false);
        return;
      }

      setCommunity(data);
      setFormat(String(data.default_format));
      setTeamCount(String(data.default_team_count));
      setCapacity(String(data.default_capacity ?? 15));

      setLoading(false);
    };

    loadCommunity();
  }, [communityId]);

  const createGameDay = async () => {
    if (!community) return;

    if (!date) {
      alert(tx("Choose game date"));
      return;
    }

    setCreating(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert(tx("User not found"));
      setCreating(false);
      return;
    }

    const { data: gameDayId, error } = await supabase.rpc(
      "ballers_create_game_day",
      {
        p_community_id: communityId,
        p_date: date,
        p_time: time || null,
        p_venue: venue || null,
        p_format: Number(format),
        p_team_count: Number(teamCount),
        p_capacity: capacity ? Number(capacity) : null,
      },
    );

    if (error || !gameDayId) {
      alert(error ? preMatchError(error) : tx("Could not create Game Day"));
      setCreating(false);
      return;
    }

    router.push(`/communities/${communityId}`);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-gray-400">{tx("Loading...")}</p>
      </main>
    );
  }

  if (!community) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p>{tx("Community not found")}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white px-6 py-8">
      <div className="max-w-md mx-auto">
        <button
          onClick={() => router.back()}
          className="text-gray-400 mb-6 cursor-pointer hover:text-white transition"
        >
          {tx("← Back")}
        </button>

        <p className="text-blue-400 text-sm mb-1">{tx("New Game Day")}</p>

        <h1 className="text-3xl font-bold mb-2">{community.name}</h1>

        <p className="text-gray-400 mb-8">
          {tx("Create the next football session.")}
        </p>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 block mb-2">
              {tx("Date")}
            </label>

            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 block mb-2">
              {tx("Start time")}
            </label>

            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 block mb-2">
              {tx("Venue")}
            </label>

            <input
              type="text"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder={tx("Arena / field")}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 block mb-2">
              {tx("Format")}
            </label>

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
          </div>

          <div>
            <label className="text-sm text-gray-400 block mb-2">
              {tx("Number of teams")}
            </label>

            <input
              type="number"
              min="2"
              value={teamCount}
              onChange={(e) => setTeamCount(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 block mb-2">
              {tx("Player capacity")}
            </label>

            <input
              type="number"
              min="2"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
            />
          </div>

          <button
            onClick={createGameDay}
            disabled={creating}
            className="w-full bg-blue-500 hover:bg-blue-400 text-white rounded-xl py-4 font-semibold cursor-pointer transition disabled:opacity-50"
          >
            {creating ? tx("Creating...") : tx("Create Game Day")}
          </button>
        </div>
      </div>
    </main>
  );
}
