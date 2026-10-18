"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import PlayerStats from "@/app/components/PlayerStats";
import { supabase } from "@/lib/supabase";

type Player = {
  id: string;
  baller_id: number;
  first_name: string;
  last_name: string | null;
  city: string | null;
  primary_position: string;
  secondary_position: string | null;
  dominant_foot: string | null;
  avatar_url: string | null;
};

export default function PlayerPage() {
  const params = useParams();
  const router = useRouter();

  const playerId = params.id as string;

  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadPlayer = async () => {
      const { data, error } = await supabase
        .from("player_profiles")
        .select("*")
        .eq("id", playerId)
        .single();

      if (error) {
        console.error(error);
      } else {
        setPlayer(data);
      }

      setLoading(false);
    };

    loadPlayer();
  }, [playerId]);

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        Loading player...
      </main>
    );
  }

  if (!player) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        Player not found
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

        <PlayerStats playerId={player.id} />
        <section className="bg-neutral-900 rounded-3xl p-6 mb-6">

          <div className="flex flex-col items-center text-center">

            <div className="w-28 h-28 rounded-full bg-neutral-800 overflow-hidden flex items-center justify-center text-4xl mb-4">

              {player.avatar_url ? (
                <img
                  src={player.avatar_url}
                  alt={player.first_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                "👤"
              )}

            </div>

            <p className="text-gray-500 text-sm">
              Baller ID #{player.baller_id}
            </p>

            <h1 className="text-3xl font-bold mt-1">
              {player.first_name} {player.last_name ?? ""}
            </h1>

            <div className="flex gap-2 mt-3 flex-wrap justify-center">

              <span className="bg-neutral-800 px-3 py-1 rounded-full text-sm">
                {player.primary_position}
              </span>

              {player.secondary_position && (
                <span className="bg-neutral-800 px-3 py-1 rounded-full text-sm">
                  {player.secondary_position}
                </span>
              )}

              {player.city && (
                <span className="bg-neutral-800 px-3 py-1 rounded-full text-sm">
                  {player.city}
                </span>
              )}

            </div>
          </div>

          <div className="border border-neutral-800 rounded-2xl p-4 mt-6">

            <p className="text-gray-500 text-sm">
              Baller Rating
            </p>

            <p className="text-4xl font-bold">
              500
            </p>

            <p className="text-gray-600 text-xs mt-1">
              Provisional
            </p>

          </div>
        </section>

        <section className="mb-6">

          <h2 className="text-xl font-semibold mb-3">
            Career
          </h2>

          <div className="grid grid-cols-2 gap-3">

            <div className="bg-neutral-900 rounded-xl p-4">
              <p className="text-gray-500 text-sm">
                Matches
              </p>
              <p className="text-2xl font-bold">
                0
              </p>
            </div>

            <div className="bg-neutral-900 rounded-xl p-4">
              <p className="text-gray-500 text-sm">
                Goals
              </p>
              <p className="text-2xl font-bold">
                0
              </p>
            </div>

            <div className="bg-neutral-900 rounded-xl p-4">
              <p className="text-gray-500 text-sm">
                Assists
              </p>
              <p className="text-2xl font-bold">
                0
              </p>
            </div>

            <div className="bg-neutral-900 rounded-xl p-4">
              <p className="text-gray-500 text-sm">
                Wins
              </p>
              <p className="text-2xl font-bold">
                0
              </p>
            </div>

          </div>

        </section>

        <section>

          <h2 className="text-xl font-semibold mb-3">
            Achievements
          </h2>

          <div className="flex gap-3">

            <div className="w-20 h-20 bg-neutral-900 opacity-40 rounded-2xl flex flex-col items-center justify-center">
              <span className="text-2xl">⚽</span>
              <span className="text-[10px] mt-1">First Match</span>
            </div>

            <div className="w-20 h-20 bg-neutral-900 opacity-40 rounded-2xl flex flex-col items-center justify-center">
              <span className="text-2xl">🥾</span>
              <span className="text-[10px] mt-1">10 Goals</span>
            </div>

            <div className="w-20 h-20 bg-neutral-900 opacity-40 rounded-2xl flex flex-col items-center justify-center">
              <span className="text-2xl">🎯</span>
              <span className="text-[10px] mt-1">10 Assists</span>
            </div>

          </div>

        </section>

      </div>
    </main>
  );
}