"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { countLabel } from "@/lib/display";
import { supabase } from "@/lib/supabase";
import { setAttendance } from "@/lib/pre-match";
import { useApp } from "../components/AppState";
import AppHeader from "../components/AppHeader";
import BottomNav from "../components/BottomNav";
import GameCard from "../components/GameCard";
type Snapshot = {
  manager: boolean;
  my_player_id: string;
  teams: {
    id: string;
    name: string;
    color_key: string;
    player_ids: string[];
  }[];
  players: { id: string; name: string; position: string }[];
};
function MyGame() {
  const query = useSearchParams(),
    router = useRouter();
  const { data, session, loading, error, refresh } = useApp();
  const [tab, setTab] = useState(query.get("history") ? "history" : "current"),
    [snap, setSnap] = useState<Snapshot | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const selected = query.get("game");
  const pool = [...(data?.games || []), ...(data?.history || [])];
  const game =
    pool.find((g) => g.id === selected) ||
    data?.games.find((g) => g.attendance_status === "GOING") ||
    data?.games[0];
  const gameId = game?.id;
  const load = useCallback(async () => {
    if (!gameId) return;
    const { data, error } = await supabase.rpc("ballers_alpha_snapshot", {
      p_game: gameId,
    });
    if (error) {
      setNotice("Составы пока недоступны. Попробуй обновить страницу.");
      return;
    }
    setSnap(data as Snapshot);
  }, [gameId]);
  useEffect(() => {
    const start = setTimeout(() => {
      setSnap(null);
      void load();
    }, 0);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => {
      clearTimeout(start);
      clearInterval(poll);
    };
  }, [load]);
  async function answer(status: "GOING" | "MAYBE" | "DECLINED") {
    if (!game || !data?.profile) return;
    setBusy(true);
    setNotice("");
    try {
      const { error } = await setAttendance(game.id, data.profile.id, status);
      if (error) throw error;
      await refresh();
      await load();
      setNotice("Ответ сохранён.");
      window.dispatchEvent(new Event("ballers:data-changed"));
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Ответ не сохранён. Попробуй снова.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function finishDay() {
    if (
      !game ||
      !confirm(
        `Завершить игровой день «${game.title}»? Сыграно матчей: ${game.match_count}. Ожидающие результаты можно будет подтвердить позже.`,
      )
    )
      return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("ballers_game_action", {
        p_game: game.id,
        p_action: "CLOSE",
        p_payload: {},
      });
      if (error) throw error;
      await refresh();
      setTab("history");
      setNotice("Игровой день завершён. Результаты сохранены в истории.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Не удалось завершить день.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="ballers-shell">
      <AppHeader />
      <h1 className="page-title">Твоя игра</h1>
      <div className="tab-bar">
        <button
          className={tab === "current" ? "selected" : ""}
          onClick={() => setTab("current")}
        >
          Текущий день
        </button>
        <button
          className={tab === "history" ? "selected" : ""}
          onClick={() => setTab("history")}
        >
          История игр
        </button>
      </div>
      {notice && (
        <p role="status" className="neon-panel mb-4">
          {notice}
        </p>
      )}
      {error && (
        <p className="error-panel">
          Не удалось обновить данные.{" "}
          <button onClick={() => void refresh()}>Повторить</button>
        </p>
      )}
      {loading ? (
        <p className="inline-loading">Загружаем игры…</p>
      ) : !session ? (
        <Link className="text-link" href="/">
          Войди на главной →
        </Link>
      ) : tab === "history" ? (
        <>
          <Link className="text-link mb-3" href="/career">
            Мои матчи и статистика →
          </Link>
          {!data?.history.length && (
            <p className="ballers-muted">
              Здесь появятся сыгранные матчи и завершённые дни.
            </p>
          )}
          {data?.history.map((g) => (
            <section key={g.id} className="neon-panel history-day">
              <h2 className="font-bold text-lg">{g.title}</h2>
              <p className="ballers-muted mt-1">
                {new Date(g.game_date + "T12:00:00").toLocaleDateString(
                  "ru-RU",
                )}{" "}
                · {countLabel(g.match_count, "матч", "матча", "матчей")} ·{" "}
                {g.status === "COMPLETED" ? "Завершён" : "Игровой день"}
              </p>
              <Link href={`/games/${g.id}/play#results`} className="text-link">
                Результаты и подтверждения →
              </Link>
            </section>
          ))}
        </>
      ) : game ? (
        <>
          {(data?.games.length || 0) > 1 && (
            <label className="block ballers-muted mb-4">
              Выбрать игровой день
              <select
                aria-label="Выбрать игровой день"
                className="w-full rounded-xl p-3 mt-1 bg-[#101b2b] border border-[#40536c]"
                value={game.id}
                onChange={(e) => {
                  router.push(`/my-game?game=${e.target.value}`);
                }}
              >
                {data?.games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.game_date} · {g.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <GameCard game={game} compact />
          <div className="flex gap-3 justify-between my-3 flex-wrap">
            <Link className="text-link" href={`/games/${game.id}/play#results`}>
              Матчи · {game.match_count} →
            </Link>
            <Link className="text-link" href={`/games/${game.id}/play`}>
              Игровой центр →
            </Link>
          </div>
          {game.status === "OPEN" && (
            <section className="neon-panel">
              <h2 className="font-bold">Будешь играть?</h2>
              <div className="attendance-options">
                {(
                  [
                    ["GOING", "✓ Иду"],
                    ["MAYBE", "Возможно"],
                    ["DECLINED", "Не иду"],
                  ] as const
                ).map(([status, label]) => (
                  <button
                    key={status}
                    disabled={busy}
                    className={
                      game.attendance_status === status ? "chosen" : ""
                    }
                    onClick={() => void answer(status)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="ballers-muted">
                {game.attendance_status === "GOING"
                  ? "Место за тобой"
                  : game.going >= (game.capacity ?? Infinity)
                    ? "Мест нет — при ответе «Иду» попадёшь в очередь"
                    : "Ответь, чтобы организатор видел твой статус"}
              </p>
            </section>
          )}
          <div className="section-heading mt-6">
            <h2>Команды</h2>
            <span className="ballers-muted">
              {countLabel(game.going, "игрок", "игрока", "игроков")}
            </span>
          </div>
          {snap?.teams.map((t) => (
            <details className="team-row" key={t.id}>
              <summary>
                <span
                  className="color-bar"
                  style={{
                    background:
                      {
                        blue: "#63ceff",
                        red: "#ff809c",
                        yellow: "#ffe374",
                        green: "#79ffb0",
                        purple: "#b58aff",
                      }[t.color_key.toLowerCase()] || "#b58aff",
                  }}
                />
                <div>
                  <b>{t.name}</b>
                  <p className="ballers-muted">
                    {t.player_ids.includes(snap.my_player_id)
                      ? "Твоя команда · "
                      : ""}
                    {countLabel(
                      t.player_ids.length,
                      "игрок",
                      "игрока",
                      "игроков",
                    )}
                  </p>
                </div>
              </summary>
              <div className="team-list">
                {t.player_ids.map((id) => (
                  <p key={id} className="py-1">
                    {snap.players.find((p) => p.id === id)?.name || "Игрок"}
                  </p>
                ))}
              </div>
            </details>
          ))}
          {snap?.teams.length === 0 && (
            <p className="ballers-muted">Команды ещё не собраны.</p>
          )}
          {!snap && <p className="ballers-muted">Загружаем составы…</p>}
          <Link
            className="text-link"
            href={`/communities/${game.community_id}/game-days/${game.id}`}
          >
            {snap?.manager ? "Составы и приглашения" : "Все участники"} →
          </Link>
          {snap?.manager && game.status === "OPEN" && (
            <section className="neon-panel mt-6">
              <h2 className="font-bold mb-2">Закончили играть?</h2>
              <p className="ballers-muted mb-4">
                Матчей может быть сколько угодно. Закрой день, когда все
                разошлись.
              </p>
              <button
                className="neon-button green w-full"
                disabled={busy || game.live}
                onClick={() => void finishDay()}
              >
                Завершить игровой день
              </button>
              {game.live && (
                <p className="ballers-muted mt-2">
                  Сначала заверши текущий матч в игровом центре.
                </p>
              )}
            </section>
          )}
        </>
      ) : (
        <section className="neon-panel">
          <h2 className="font-bold">Пока нет ближайшей игры</h2>
          <Link href="/open-games" className="text-link">
            Найти открытый игровой день →
          </Link>
          <br />
          <Link href="/create" className="text-link">
            Создать игровой день →
          </Link>
        </section>
      )}
      <BottomNav />
    </main>
  );
}
export default function MyGamePage() {
  return (
    <Suspense fallback={<main className="ballers-shell">Загружаем…</main>}>
      <MyGame />
    </Suspense>
  );
}
