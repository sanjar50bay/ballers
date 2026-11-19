"use client";
import { uiError, t as tx } from "@/lib/i18n";

import { useApp } from "@/app/components/AppState";
import { useLocale } from "@/app/components/Language";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import {
  useParams,
  usePathname,
  useSearchParams,
  useRouter,
} from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import GameLeader, { type GameControl } from "@/app/components/GameLeader";
import GamePreparation from "@/app/components/GamePreparation";
import dynamic from "next/dynamic";
import { readStart, saveStart, type StartOperation } from "@/lib/game-start";
import MatchCorrections from "@/app/components/MatchCorrections";
import DayResults, { eventLabel } from "@/app/components/DayResults";
import DayRequests from "@/app/components/DayRequests";
import MatchResultsDisclosure from "@/app/components/MatchResultsDisclosure";
import GameDayClosure from "@/app/components/GameDayClosure";
import MatchSound, { MatchSoundControl } from "@/app/components/MatchSound";
import { setAttendance } from "@/lib/pre-match";

type Player = {
  id: string;
  name: string;
  position: string;
  user_id: string | null;
};
type Team = {
  id: string;
  name: string;
  color_key: string;
  player_ids: string[];
};
type Role = {
  team_id: string;
  captain_id: string;
  responsible_id: string;
  can_manage_attendance: boolean;
};
type Match = {
  result_mode?: "TRUSTED" | "CAPTAINS";
  id: string;
  sequence: number;
  team_a: string;
  team_b: string;
  captain_a: string;
  captain_b: string;
  operator_id: string;
  status: string;
  version: number;
  score_a: number;
  score_b: number;
  elapsed_seconds: number;
  running_since: string | null;
  duration_seconds: number;
  goal_limit: number;
  end_mode: string;
  confirmed_a: boolean;
  confirmed_b: boolean;
  is_test: boolean;
  resolution_note: string | null;
};
type Event = {
  id: string;
  match_id: string;
  kind: string;
  player_id: string;
  assist_id: string | null;
  voided: boolean;
  elapsed_seconds: number;
};
type Settings = {
  duration_seconds: number;
  goal_limit: number;
  end_mode: string;
  max_streak: number | null;
  is_open: boolean;
};
type Snapshot = {
  control?: GameControl;
  game: {
    id: string;
    community_id: string;
    title: string;
    status: string;
    format: number;
    game_date: string;
    start_time: string | null;
    venue: string | null;
    capacity: number | null;
  };
  my_player_id: string;
  manager: boolean;
  server_now: string;
  settings: Partial<Settings> & { result_mode?: "TRUSTED" | "CAPTAINS" };
  teams: Team[];
  roles: Role[];
  players: Player[];
  participants: { player_id: string; attendance_status: string }[];
  waitlist: { player_id: string; offered: boolean }[];
  session: {
    team_a: string;
    team_b: string;
    older_team: string;
    queue: string[];
  } | null;
  matches: Match[];
  events: Event[];
  rosters: { match_id: string; player_id: string; team_id: string }[];
};
const statuses: Record<string, string> = {
  LIVE: "Идёт матч",
  PAUSED: "Пауза",
  PENDING: "Ждёт подтверждений",
  DISPUTED: "Спор",
  VERIFIED: "Подтверждён",
  CANCELLED: "Отменён",
};
const section = "rounded-2xl border border-[#37445f] bg-[#0c101b] p-4 mb-4";
const button =
  "rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer";
const field =
  "w-full rounded-xl border border-white/15 bg-[#161b2c] p-3 text-white";
const secondary =
  "rounded-xl border border-white/15 px-4 py-3 text-sm font-bold disabled:opacity-40 cursor-pointer";
const GameParticipants = dynamic(
  () => import("@/app/components/GameParticipants"),
  { loading: () => <p role="status">{tx("Загружаем…")}</p> },
);

export default function PlayPage() {
  return (
    <Suspense fallback={<p>…</p>}>
      <UnifiedGame />
    </Suspense>
  );
}
function UnifiedGame() {
  useLocale();
  const { data: home } = useApp();

  const { gameId } = useParams<{ gameId: string }>();
  const params = useSearchParams(),
    router = useRouter(),
    path = usePathname();
  const selected = params.get("tab");
  const tab =
    selected === "participants" || selected === "matches"
      ? selected
      : "overview";
  const chooseTab = (next: string) =>
    router.push(path + "?tab=" + next, { scroll: false });
  useEffect(() => {
    const follow = () => {
      if (location.hash === "#results" || location.hash.startsWith("#match-"))
        router.replace(path + "?tab=matches" + location.hash, {
          scroll: false,
        });
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [path, router]);
  const [pendingStart, setPendingStart] = useState<StartOperation | null>(null);
  const actionLock = useRef(false);
  const revealStarted = useRef(false);

  const [s, setS] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [clock, setClock] = useState(0);
  const [offset, setOffset] = useState(0);
  const [settings, setSettings] = useState<Settings>({
    duration_seconds: 420,
    goal_limit: 2,
    end_mode: "FIRST_REACHED",
    max_streak: null,
    is_open: false,
  });
  const initialized = useRef<string | null>(null);
  const activeGame = useRef<string | null>(gameId);
  const refreshSequence = useRef(0);
  const refreshApplied = useRef(0);
  useEffect(() => {
    activeGame.current = gameId;
    return () => {
      activeGame.current = null;
    };
  }, [gameId]);
  const refresh = useCallback(async () => {
    const request = ++refreshSequence.current;
    const { data, error } = await supabase.rpc("ballers_alpha_snapshot", {
      p_game: gameId,
    });
    if (activeGame.current !== gameId || request < refreshApplied.current)
      return;
    refreshApplied.current = request;
    if (error) {
      setError(error.message);
      return;
    }
    const snap = data as Snapshot;
    setS(snap);
    setError("");
    setOffset(new Date(snap.server_now).getTime() - Date.now());
    setClock(Date.now());
    if (initialized.current !== gameId) {
      setSettings((old) => ({ ...old, ...snap.settings }));
      initialized.current = gameId;
    }
  }, [gameId]);
  useEffect(() => {
    const first = window.setTimeout(() => {
      void refresh();
    }, 0);
    const poll = window.setInterval(() => {
      void refresh();
    }, 5000);
    const onReturn = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    const tick = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [refresh]);
  useEffect(() => {
    const reveal = () => {
      if (tab !== "matches" || location.hash !== "#game-captains") return;
      for (const id of ["game-organizer", "game-captains"]) {
        const el = document.getElementById(id);
        if (el instanceof HTMLDetailsElement) el.open = true;
      }
      document
        .getElementById("game-captains")
        ?.scrollIntoView({ block: "start" });
    };
    const timer = window.setTimeout(reveal, 0);
    window.addEventListener("hashchange", reveal);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", reveal);
    };
  }, [tab, s?.game.id]);
  async function run(
    task: () => PromiseLike<{ error: { message: string } | null }>,
    message = tx("Сохранено"),
  ) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      const result = await task();
      if (result.error) setNotice(result.error.message);
      else {
        setNotice(message);
        window.dispatchEvent(new Event("ballers:data-changed"));
      }
      await refresh();
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : tx("Нет соединения: действие не подтверждено сервером"),
      );
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  const gameAction = (action: string, payload: Record<string, unknown> = {}) =>
    run(() =>
      supabase.rpc("ballers_game_action", {
        p_game: gameId,
        p_action: action,
        p_payload: payload,
      }),
    );
  useEffect(() => {
    const timer = setTimeout(() => {
      if (s?.my_player_id) setPendingStart(readStart(gameId, s.my_player_id));
    }, 0);
    return () => clearTimeout(timer);
  }, [gameId, s?.my_player_id]);
  const startMatch = async () => {
    if (!s?.control || actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setNotice("");
    const operation = pendingStart ||
      readStart(gameId, s.my_player_id) || {
        id: crypto.randomUUID(),
        sequence: s.control.sequence,
        leaderVersion: s.control.version,
      };
    saveStart(gameId, s.my_player_id, operation);
    setPendingStart(operation);
    try {
      const result = await supabase
        .rpc("ballers_start_game_match", {
          p_game: gameId,
          p_operation: operation.id,
          p_expected_sequence: operation.sequence,
          p_leader_version: operation.leaderVersion,
        })
        .abortSignal(AbortSignal.timeout(15000));
      if (result.error) {
        setNotice(result.error.message);
        if (result.error.code === "P0001") {
          saveStart(gameId, s.my_player_id, null);
          setPendingStart(null);
        }
      } else {
        saveStart(gameId, s.my_player_id, null);
        setPendingStart(null);
        revealStarted.current = true;
        chooseTab("matches");
        window.dispatchEvent(new Event("ballers:data-changed"));
      }
      await refresh();
    } catch {
      setNotice(
        tx("Связь прервалась. Проверь запуск — повтор не создаст второй матч."),
      );
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };
  const matchAction = (
    m: Match,
    action: string,
    payload: Record<string, unknown> = {},
  ) =>
    run(() =>
      supabase.rpc("ballers_match_action", {
        p_match: m.id,
        p_version: m.version,
        p_action: action,
        p_payload: payload,
      }),
    );
  const live = s?.matches.find((m) => ["LIVE", "PAUSED"].includes(m.status));
  useEffect(() => {
    if (!live || tab !== "matches" || !revealStarted.current) return;
    const frame = requestAnimationFrame(() => {
      const pitch = document.getElementById(`match-${live.id}`);
      pitch?.focus({ preventScroll: true });
      pitch?.scrollIntoView({ block: "start" });
      revealStarted.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [live, tab]);
  const elapsed = live
    ? live.elapsed_seconds +
      (live.running_since
        ? Math.max(
            0,
            Math.floor(
              (clock + offset - new Date(live.running_since).getTime()) / 1000,
            ),
          )
        : 0)
    : 0;
  const isOwner =
    !!s &&
    !!home?.communities.some(
      (c) => c.id === s.game.community_id && c.role === "OWNER",
    );
  const canOperate =
    !!s &&
    s.game.id === gameId &&
    !!live &&
    s.control?.leader_id === s.my_player_id &&
    live.operator_id === s.my_player_id;
  const autoFinishSent = useRef<string | null>(null);
  useEffect(() => {
    if (
      !live ||
      !canOperate ||
      busy ||
      live.status !== "LIVE" ||
      live.end_mode === "GOALS_ONLY" ||
      elapsed < live.duration_seconds
    )
      return;
    const key = `${live.id}:${live.version}`;
    if (autoFinishSent.current === key) return;
    autoFinishSent.current = key;
    void (async () => {
      const { error } = await supabase.rpc("ballers_match_action", {
        p_match: live.id,
        p_version: live.version,
        p_action: "FINISH",
        p_payload: {},
      });
      if (error) setNotice(error.message);
      await refresh();
    })();
  }, [live, canOperate, busy, elapsed, refresh]);
  if (!s || s.game.id !== gameId)
    return (
      <main className="min-h-screen bg-[#050710] text-white p-8">
        <p>{error ? uiError(error) : tx("Загружаем игровой центр…")}</p>
        <Link className="text-violet-300 underline" href="/">
          {tx("На главную")}
        </Link>
      </main>
    );
  const playerName = (id: string) =>
    s.players.find((p) => p.id === id)?.name || tx("Игрок");
  const teamName = (id: string) =>
    s.teams.find((t) => t.id === id)?.name || tx("Команда");
  const rosterIds = live
    ? s.rosters.filter((r) => r.match_id === live.id).map((r) => r.player_id)
    : [];
  const ownRosterLocked =
    !!live && s.teams.some((team) => team.player_ids.includes(s.my_player_id));
  const pending = s.matches.filter((m) =>
    ["PENDING", "DISPUTED"].includes(m.status),
  );
  const completed = s.matches
    .filter((match) => !["LIVE", "PAUSED"].includes(match.status))
    .sort((a, b) => b.sequence - a.sequence);
  const attention = completed.filter(
    (match) =>
      (match.status === "PENDING" &&
        ((match.captain_a === s.my_player_id && !match.confirmed_a) ||
          (match.captain_b === s.my_player_id && !match.confirmed_b))) ||
      (s.manager &&
        (match.status === "DISPUTED" ||
          (match.is_test && match.status === "PENDING"))),
  ).length;
  const preparation =
    !live && s.game.status === "OPEN" && (s.manager || s.control?.is_leader) ? (
      <GamePreparation
        snapshot={s}
        path={path}
        busy={busy}
        pending={!!pendingStart}
        hasMatches={!!s.matches.length}
        start={() => void startMatch()}
        revealLeader={() => {
          const panel = document.getElementById("game-leader");
          const details = panel?.querySelector("details");
          if (details) details.open = true;
          panel?.scrollIntoView({ block: "start", behavior: "smooth" });
        }}
      />
    ) : null;
  const waitingTeams =
    s.session?.queue ?? (live ? [] : s.teams.slice(2).map((team) => team.id));
  const nextMatch =
    s.game.status === "OPEN" ? (
      <section className="next-match-panel" aria-label={tx("Следующий матч")}>
        <div className="next-match-heading">
          <h2>{tx("Следующий матч")}</h2>
          {!live && <MatchSoundControl />}
          <span>
            {tx(
              live
                ? "После текущего матча"
                : s.session
                  ? "Пара сохранена"
                  : "Предварительная пара",
            )}
          </span>
        </div>
        {live ? (
          <p className="next-match-explanation">
            {tx(
              "Пара определится после завершения текущего матча по правилам ротации.",
            )}
          </p>
        ) : s.session ? (
          <p className="next-match-pair">
            {teamName(s.session.team_a)} <span>{tx("против")}</span>{" "}
            {teamName(s.session.team_b)}
          </p>
        ) : s.teams.length >= 2 ? (
          <>
            <p className="next-match-pair">
              {teamName(s.teams[0].id)} <span>{tx("против")}</span>{" "}
              {teamName(s.teams[1].id)}
            </p>
            <p className="next-match-explanation">
              {tx(
                "Предложены первые две команды. Пара сохранится при запуске или после выбора организатора.",
              )}
            </p>
          </>
        ) : (
          <p className="next-match-explanation">
            {tx("Сначала создайте команды")}
          </p>
        )}
        <div className="match-team-queue">
          <h3>{tx("Очередь команд")}</h3>
          {waitingTeams.length ? (
            <ol>
              {waitingTeams.map((id, index) => (
                <li key={id}>
                  {index + 1}. {teamName(id)}
                </li>
              ))}
            </ol>
          ) : (
            <p>{tx("В очереди нет команд")}</p>
          )}
        </div>
        {s.manager && !s.matches.length && (
          <details className="mt-3">
            <summary className="min-h-11 py-2 text-sm text-[#7bd9ff]">
              {tx("Изменить стартовую пару ↓")}
            </summary>
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                void gameAction("LINEUP", {
                  team_a: fd.get("a"),
                  team_b: fd.get("b"),
                  first_draw_out: fd.get("draw"),
                });
              }}
            >
              <label className="block text-sm">
                {tx("Первая команда")}
                <select name="a" className={field}>
                  {s.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {tx("Вторая команда")}
                <select
                  name="b"
                  className={field}
                  defaultValue={s.teams[1]?.id}
                >
                  {s.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {tx("Кто отдыхает при первой ничьей")}
                <select name="draw" className={field}>
                  {s.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={secondary}
                disabled={busy || s.teams.length < 2}
              >
                {tx("Сохранить стартовую пару")}
              </button>
            </form>
          </details>
        )}
      </section>
    ) : null;
  const leaderPanel = (
    <div id="game-leader">
      <GameLeader
        gameId={gameId}
        control={s.control}
        manager={s.manager}
        open={s.game.status === "OPEN"}
        players={s.players.filter(
          (p) =>
            p.user_id &&
            (s.participants.some(
              (a) => a.player_id === p.id && a.attendance_status === "GOING",
            ) ||
              (s.manager && p.id === s.my_player_id)),
        )}
        refresh={refresh}
      />
    </div>
  );
  return (
    <main className="min-h-screen bg-[#050710] text-white pb-24">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-16">
        <h1 className="page-title my-4">{s.game.title}</h1>
        <nav className="game-tabs" aria-label={tx("Разделы игры")}>
          {[
            ["overview", "Обзор"],
            ["participants", "Участники"],
            ["matches", "Матчи"],
          ].map(([key, label]) => (
            <Link
              key={key}
              id={"tab-" + key}
              href={path + "?tab=" + key}
              aria-current={tab === key ? "page" : undefined}
            >
              {tx(label)}
            </Link>
          ))}
        </nav>
        {error && (
          <div
            role="alert"
            className="p-4 border border-red-500 rounded-xl mb-4"
          >
            {tx("Не удалось обновить данные:")}
            {uiError(error)}
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="p-4 rounded-xl bg-violet-950 border border-violet-700 mb-4 flex gap-3 justify-between"
          >
            <span>{uiError(notice)}</span>
            <button
              aria-label={tx("Закрыть сообщение")}
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}
        {tab === "overview" && preparation}
        {tab !== "matches" && leaderPanel}
        {pendingStart && (
          <button
            disabled={busy}
            className="neon-button mb-4"
            onClick={() => void startMatch()}
          >
            {tx("Проверить запуск")}
          </button>
        )}
        <section hidden={tab !== "overview"} aria-labelledby="tab-overview">
          <div className="neon-panel mb-4">
            <h2>{tx("Когда и где")}</h2>
            <p className="mt-2">
              {s.game.game_date} ·{" "}
              {s.game.start_time?.slice(0, 5) || tx("Время уточняется")}
            </p>
            <p>{s.game.venue || tx("Место уточняется")}</p>
            <p className="ballers-muted mt-2">
              {s.game.format}×{s.game.format} ·{" "}
              {
                s.participants.filter((p) => p.attendance_status === "GOING")
                  .length
              }
              /{s.game.capacity ?? "∞"} {tx("игроков")}
            </p>
          </div>
          {s.game.status === "OPEN" &&
            s.players.some((p) => p.id === s.my_player_id) &&
            !home?.games.find((g) => g.id === gameId)?.request_status && (
              <div className="neon-panel mb-4">
                <h2>{tx("Будешь играть?")}</h2>
                {ownRosterLocked && (
                  <p className="ballers-muted text-sm my-2">
                    {tx(
                      "Составы закреплены на время матча. Изменить их можно после завершения матча.",
                    )}
                  </p>
                )}
                <div className="attendance-options">
                  {[
                    ["GOING", "✓ Иду"],
                    ["MAYBE", "Возможно"],
                    ["DECLINED", "Не иду"],
                  ].map(([status, label]) => (
                    <button
                      key={status}
                      aria-pressed={s.participants.some(
                        (p) =>
                          p.player_id === s.my_player_id &&
                          p.attendance_status === status,
                      )}
                      disabled={busy || ownRosterLocked}
                      onClick={() =>
                        void run(() =>
                          setAttendance(
                            gameId,
                            s.my_player_id,
                            status as "GOING" | "MAYBE" | "DECLINED",
                          ),
                        )
                      }
                    >
                      {tx(label)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          <DayRequests gameId={gameId} open={s.game.status === "OPEN"} />
          {live && (
            <div className="neon-panel mb-4">
              <h2>
                {teamName(live.team_a)} {live.score_a}:{live.score_b}{" "}
                {teamName(live.team_b)}
              </h2>
              <p>
                {tx("Матч ведёт:")} {playerName(live.operator_id)}
              </p>
              <Link href={path + "?tab=matches"} className="neon-button mt-3">
                {tx(canOperate ? "Открыть управление матчем" : "Смотреть матч")}
              </Link>
            </div>
          )}
        </section>
        {tab === "participants" && (
          <GameParticipants
            key={gameId}
            gameId={gameId}
            communityId={s.game.community_id}
            rosterLocked={!!live}
          />
        )}
        <MatchSound
          key={gameId}
          gameId={gameId}
          matches={s.matches}
          events={s.events}
          ready={tab === "matches" && s.game.status === "OPEN"}
        >
          <section hidden={tab !== "matches"} aria-labelledby="tab-matches">
            {!live && nextMatch}
            {tab === "matches" && preparation}
            {live && (
              <section
                id={`match-${live.id}`}
                tabIndex={-1}
                className="live-match-pitch"
                aria-label={tx("Сейчас на поле")}
              >
                <div className="pitch-heading">
                  <h2 className="live-match-eyebrow">{tx("Сейчас на поле")}</h2>
                  <MatchSoundControl />
                </div>
                <div className="flex justify-between gap-2 text-sm text-gray-300">
                  <span>
                    {live.status === "LIVE" && (
                      <span
                        className="live-ball"
                        role="img"
                        aria-label={tx("Матч идёт")}
                      >
                        ⚽
                      </span>
                    )}{" "}
                    {tx("Матч #")}
                    {live.sequence} ·{" "}
                    <span className="live-match-state">
                      {tx(statuses[live.status])}
                    </span>
                  </span>
                  <span>{live.is_test ? tx("ТЕСТОВЫЙ") : ""}</span>
                </div>
                <div className="live-match-scoreboard">
                  <b>{teamName(live.team_a)}</b>
                  <strong className="text-5xl">
                    {live.score_a}:{live.score_b}
                  </strong>
                  <b>{teamName(live.team_b)}</b>
                </div>
                <p className="text-center text-4xl font-mono mb-2">
                  {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
                  {String(elapsed % 60).padStart(2, "0")}
                </p>
                <p className="text-center text-sm text-gray-400 mb-5">
                  {tx("{minutes} мин · до {goals} голов", {
                    minutes: live.duration_seconds / 60,
                    goals: live.goal_limit,
                  })}
                  <br />
                  <span>{tx("Матч ведёт:")}</span>{" "}
                  {playerName(live.operator_id)}
                </p>
                {canOperate && (
                  <>
                    <div className="flex gap-2 justify-center mb-5">
                      <button
                        className={secondary}
                        disabled={busy}
                        onClick={() => {
                          void matchAction(
                            live,
                            live.status === "PAUSED" ? "RESUME" : "PAUSE",
                          );
                        }}
                      >
                        {live.status === "PAUSED"
                          ? tx("Продолжить")
                          : tx("Пауза")}
                      </button>
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              tx(
                                "Завершить матч с текущим счётом и выполнить ротацию?",
                              ),
                            )
                          )
                            void matchAction(live, "FINISH");
                        }}
                      >
                        {tx("Завершить матч")}
                      </button>
                    </div>
                    <form
                      className="space-y-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const fd = new FormData(e.currentTarget);
                        const kind = String(fd.get("kind"));
                        void matchAction(live, "EVENT", {
                          id: crypto.randomUUID(),
                          kind,
                          player_id: fd.get("player"),
                          assist_id:
                            kind === "GOAL" ? fd.get("assist") || null : null,
                        });
                      }}
                    >
                      <label className="block text-sm">
                        {tx("Событие")}
                        <select
                          className={field}
                          name="kind"
                          aria-label={tx("Событие")}
                        >
                          <option value="GOAL">{tx("Гол")}</option>
                          <option value="OWN_GOAL">{tx("Автогол")}</option>
                          <option value="SAVE">{tx("Сейв")}</option>
                          <option value="YELLOW">
                            {tx("Жёлтая карточка")}
                          </option>
                          <option value="RED">{tx("Красная карточка")}</option>
                        </select>
                      </label>
                      <label className="block text-sm">
                        {tx("Игрок")}
                        <select
                          name="player"
                          className={field}
                          aria-label={tx("Игрок")}
                        >
                          {rosterIds.map((id) => (
                            <option key={id} value={id}>
                              {playerName(id)} ·{" "}
                              {teamName(
                                s.rosters.find(
                                  (r) =>
                                    r.match_id === live.id &&
                                    r.player_id === id,
                                )?.team_id || "",
                              )}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-sm">
                        {tx("Ассистент (только для гола)")}
                        <select name="assist" className={field}>
                          <option value="">{tx("Без ассиста")}</option>
                          {rosterIds.map((id) => (
                            <option key={id} value={id}>
                              {playerName(id)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className={`${button} w-full`}
                        disabled={busy || live.status !== "LIVE"}
                      >
                        {tx("Записать событие")}
                      </button>
                    </form>
                  </>
                )}
              </section>
            )}
            {live && nextMatch}
            {tab === "matches" && leaderPanel}
            <MatchResultsDisclosure
              key={gameId}
              active={tab === "matches"}
              count={completed.length}
              waiting={pending.length}
              attention={attention}
            >
              <DayResults
                matches={s.matches}
                events={s.events}
                teams={s.teams}
                rosters={s.rosters}
                players={s.players}
              />
              {!completed.length && (
                <p className="text-gray-400">
                  {tx("Завершённых матчей пока нет.")}
                </p>
              )}
              {completed.map((m) => (
                <article
                  id={`match-${m.id}`}
                  style={{ scrollMarginTop: 20 }}
                  key={m.id}
                  className="match-history-card"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <b>
                      #{m.sequence} {teamName(m.team_a)} {m.score_a}:{m.score_b}{" "}
                      {teamName(m.team_b)}
                    </b>
                    <span className="text-sm text-violet-300">
                      {tx(
                        m.status === "VERIFIED" && m.result_mode === "TRUSTED"
                          ? "Учтён ведущим"
                          : statuses[m.status] || "Ожидает подтверждения",
                      )}
                      {m.is_test ? tx(" · тест") : ""}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mt-2">
                    {tx("Капитаны:")}
                    {m.result_mode === "TRUSTED"
                      ? ""
                      : m.confirmed_a
                        ? "✓"
                        : "…"}{" "}
                    {playerName(m.captain_a)} /{" "}
                    {m.result_mode === "TRUSTED"
                      ? ""
                      : m.confirmed_b
                        ? "✓"
                        : "…"}{" "}
                    {playerName(m.captain_b)}
                  </p>
                  {m.resolution_note && (
                    <p className="text-sm text-amber-200 mt-2">
                      {tx("Решение/спор:")}
                      {m.resolution_note}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {m.status === "PENDING" &&
                      ((m.captain_a === s.my_player_id && !m.confirmed_a) ||
                        (m.captain_b === s.my_player_id && !m.confirmed_b)) && (
                        <button
                          className={button}
                          disabled={busy}
                          onClick={() => {
                            void matchAction(m, "CONFIRM");
                          }}
                        >
                          {tx("Подтвердить результат")}
                        </button>
                      )}
                    {m.status === "PENDING" &&
                      (s.manager ||
                        [m.captain_a, m.captain_b].includes(
                          s.my_player_id,
                        )) && (
                        <button
                          className={secondary}
                          disabled={busy}
                          onClick={() => {
                            const reason = prompt(tx("В чём спор?"));
                            if (reason)
                              void matchAction(m, "DISPUTE", { reason });
                          }}
                        >
                          {tx("Оспорить")}
                        </button>
                      )}
                    {s.manager &&
                      (m.status === "DISPUTED" ||
                        (m.is_test && m.status === "PENDING")) && (
                        <button
                          className={secondary}
                          disabled={busy}
                          onClick={() => {
                            const reason = prompt(
                              tx(
                                "Укажи причину решения (минимум 5 символов). Тестовые матчи не входят в реальную карьерную статистику.",
                              ),
                            );
                            if (reason)
                              void matchAction(m, "RESOLVE", { reason });
                          }}
                        >
                          {m.is_test
                            ? tx("Подтвердить тест с причиной")
                            : tx("Решить спор")}
                        </button>
                      )}
                  </div>
                  <details className="mt-3">
                    <summary className="min-h-11 py-2 text-sm text-[#76d6ff]">
                      {tx("События матча ↓")}
                    </summary>
                    <div className="space-y-1">
                      {s.events
                        .filter((e) => e.match_id === m.id)
                        .map((e) => (
                          <div
                            key={e.id}
                            className={`flex justify-between gap-2 text-sm py-2 ${e.voided ? "line-through text-gray-600" : "text-gray-300"}`}
                          >
                            <span>
                              {eventLabel(e.kind)} · {playerName(e.player_id)}
                              {e.assist_id
                                ? ` · ${tx("ассист")} ${playerName(e.assist_id)}`
                                : ""}
                            </span>
                            {!e.voided &&
                              ((s.manager &&
                                !["LIVE", "PAUSED"].includes(m.status)) ||
                                (m.operator_id === s.my_player_id &&
                                  !(
                                    m.result_mode === "TRUSTED" &&
                                    m.status === "VERIFIED"
                                  ))) && (
                                <button
                                  disabled={busy}
                                  className="text-violet-300"
                                  onClick={() => {
                                    if (
                                      m.result_mode === "TRUSTED" &&
                                      m.status === "VERIFIED"
                                    ) {
                                      const reason = prompt(
                                        tx(
                                          "Причина исправления (минимум 5 символов)",
                                        ),
                                      );
                                      if (reason && reason.trim().length >= 5)
                                        void matchAction(m, "UNDO", {
                                          id: e.id,
                                          reason: reason.trim(),
                                        });
                                    } else if (
                                      confirm(
                                        tx(
                                          "Отменить событие? Подтверждения завершённого матча будут сброшены.",
                                        ),
                                      )
                                    )
                                      void matchAction(m, "UNDO", { id: e.id });
                                  }}
                                >
                                  {tx("Отменить")}
                                </button>
                              )}
                          </div>
                        ))}
                    </div>
                  </details>
                  {["VERIFIED", "PENDING", "DISPUTED"].includes(m.status) && (
                    <MatchCorrections
                      matchId={m.id}
                      version={m.version}
                      manager={s.manager}
                      trusted={
                        m.result_mode === "TRUSTED" && m.status === "VERIFIED"
                      }
                      pending={m.status === "PENDING"}
                      busy={busy}
                      players={s.rosters
                        .filter((r) => r.match_id === m.id)
                        .map((r) => ({
                          id: r.player_id,
                          name: playerName(r.player_id),
                        }))}
                      onAction={(a, p) => void matchAction(m, a, p)}
                    />
                  )}
                </article>
              ))}
            </MatchResultsDisclosure>
            <GameDayClosure
              manager={s.manager}
              active={!!live}
              open={s.game.status === "OPEN"}
              busy={busy}
              close={() => void gameAction("CLOSE")}
            />
            <details
              id="game-organizer"
              className="organizer-settings"
              hidden={!s.manager}
            >
              <summary className="min-h-11 py-3">
                {tx("Настройки организатора")}
              </summary>
              {isOwner && s.game.status === "OPEN" && (
                <button
                  className="network-secondary my-3"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        tx(
                          "Добавить до 14 синтетических игроков сообщества без Google-аккаунтов? Они не записываются на игру автоматически.",
                        ),
                      )
                    )
                      void run(() =>
                        supabase.rpc("ballers_add_test_players", {
                          p_community: s.game.community_id,
                          p_count: 14,
                        }),
                      );
                  }}
                >
                  {tx("Тестовые игроки +14")}
                </button>
              )}
              {s.manager && s.game.status === "OPEN" && (
                <details className={section}>
                  <summary className="min-h-11 py-2 text-lg font-bold">
                    {tx("Параметры игрового дня")}
                    <span className="text-[#73d4ff]">↓</span>
                  </summary>
                  <form
                    key={`${s.game.format}:${s.game.capacity}`}
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      void gameAction("SETUP", {
                        format: Number(fd.get("format")),
                        capacity: Number(fd.get("capacity")),
                      });
                    }}
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-sm">
                        {tx("Игроков на поле")}
                        <select
                          name="format"
                          className={field}
                          defaultValue={s.game.format}
                        >
                          {Array.from({ length: 11 }, (_, i) => (
                            <option key={i + 1} value={i + 1}>
                              {i + 1}×{i + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm">
                        {tx("Мест в Game Day")}
                        <input
                          name="capacity"
                          className={field}
                          type="number"
                          min="1"
                          defaultValue={s.game.capacity ?? 15}
                        />
                      </label>
                    </div>
                    <button
                      className={secondary}
                      disabled={busy || s.matches.length > 0}
                    >
                      {tx("Сохранить формат и места")}
                    </button>
                  </form>
                </details>
              )}
              <section className={section} aria-label={tx("Учёт результатов")}>
                <h2 className="text-lg font-bold">{tx("Учёт результатов")}</h2>
                {s.manager && s.game.status === "OPEN" ? (
                  <label className="block mt-3">
                    {tx("Режим для новых матчей")}
                    <select
                      className={field}
                      aria-label={tx("Режим для новых матчей")}
                      value={s.settings.result_mode || "TRUSTED"}
                      disabled={busy}
                      onChange={(e) =>
                        void run(() =>
                          supabase.rpc("ballers_result_mode", {
                            p_game: gameId,
                            p_mode: e.target.value,
                          }),
                        )
                      }
                    >
                      <option value="TRUSTED">
                        {tx("Доверяем ведущему — сразу в статистику")}
                      </option>
                      <option value="CAPTAINS">
                        {tx("Строгий — подтверждения капитанов")}
                      </option>
                    </select>
                  </label>
                ) : (
                  <p>
                    {tx(
                      s.settings.result_mode === "CAPTAINS"
                        ? "Строгий — подтверждения капитанов"
                        : "Доверяем ведущему — сразу в статистику",
                    )}
                  </p>
                )}
                <p className="ballers-muted mt-3">
                  {tx(
                    "Режим сохраняется при старте матча. Уже начатые и старые матчи не меняются автоматически.",
                  )}
                </p>
              </section>
              {s.manager && s.game.status === "OPEN" && (
                <details className={section}>
                  <summary className="min-h-11 py-2 text-lg font-bold">
                    {tx("Правила новых матчей")}
                    <span className="text-[#73d4ff]">↓</span>
                  </summary>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm">
                      {tx("Минуты")}
                      <input
                        className={field}
                        type="number"
                        min="0.5"
                        max="120"
                        step="0.5"
                        value={settings.duration_seconds / 60}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            duration_seconds: Math.round(
                              Number(e.target.value) * 60,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="text-sm">
                      {tx("До голов")}
                      <input
                        className={field}
                        type="number"
                        min="1"
                        max="99"
                        value={settings.goal_limit}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            goal_limit: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="block text-sm mt-3">
                    {tx("Окончание")}
                    <select
                      className={field}
                      value={settings.end_mode}
                      onChange={(e) =>
                        setSettings({ ...settings, end_mode: e.target.value })
                      }
                    >
                      <option value="FIRST_REACHED">
                        {tx("Время или голы — что раньше")}
                      </option>
                      <option value="TIME_ONLY">{tx("Только время")}</option>
                      <option value="GOALS_ONLY">{tx("Только голы")}</option>
                    </select>
                  </label>
                  <label className="block text-sm mt-3">
                    {tx("Предел побед подряд (пусто = нет)")}
                    <input
                      className={field}
                      type="number"
                      min="1"
                      value={settings.max_streak ?? ""}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          max_streak: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                    />
                  </label>
                  {settings.max_streak && (
                    <p className="text-sm text-amber-200 mt-2">
                      {tx(
                        "Выбранное правило: при достижении предела победитель отдыхает, проигравшая остаётся. Объявите его командам заранее.",
                      )}
                    </p>
                  )}
                  <label className="flex gap-3 my-4 text-sm">
                    <input
                      type="checkbox"
                      checked={settings.is_open}
                      onChange={(e) =>
                        setSettings({ ...settings, is_open: e.target.checked })
                      }
                    />
                    {tx("Открыть добор в списке публичных игр")}
                  </label>
                  <p className="text-sm text-gray-400 mb-3">
                    {tx(
                      "Победитель остаётся. При ничьей уходит дольше играющая команда. Начатый матч сохраняет свои правила.",
                    )}
                  </p>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => {
                      void gameAction("SETTINGS", { ...settings });
                    }}
                  >
                    {tx("Сохранить правила")}
                  </button>
                </details>
              )}
              {s.manager && s.game.status === "OPEN" && (
                <details className={section}>
                  <summary className="min-h-11 py-2 text-lg font-bold">
                    {tx("Базовые команды сообщества")}{" "}
                    <span className="text-[#73d4ff]">↓</span>
                  </summary>
                  <p className="text-sm text-gray-400 mb-4">
                    {tx(
                      "Сохрани нынешние команды и режимы как базу. Отсутствующие постоянные игроки сохраняются. В новом Game Day загружаются только ответившие «Иду», остальные места заполняются через Random / Core + Fill.",
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={secondary}
                      disabled={busy || !!live}
                      onClick={() => {
                        if (
                          confirm(
                            tx(
                              "Сохранить команды как базовые? Названия и режимы обновятся; отсутствующие участники сохранятся.",
                            ),
                          )
                        )
                          void run(() =>
                            supabase.rpc("ballers_squad_action", {
                              p_game: gameId,
                              p_action: "SAVE",
                            }),
                          );
                      }}
                    >
                      {tx("Запомнить команды как постоянные")}
                    </button>
                    <button
                      className={secondary}
                      disabled={busy || s.matches.length > 0}
                      onClick={() => {
                        if (
                          confirm(
                            tx(
                              "Заменить сегодняшние команды базовыми? Загрузятся только Going; текущие назначения сбросятся.",
                            ),
                          )
                        )
                          void run(() =>
                            supabase.rpc("ballers_squad_action", {
                              p_game: gameId,
                              p_action: "APPLY",
                            }),
                          );
                      }}
                    >
                      {tx("Применить постоянные команды к этому дню")}
                    </button>
                  </div>
                </details>
              )}
              {!s.manager ? (
                <section className={section}>
                  <h2 className="font-bold">
                    {tx("Капитаны и ответственные")}
                  </h2>
                  {s.teams.map((t) => {
                    const role = s.roles.find((r) => r.team_id === t.id);
                    return (
                      <p className="mt-3" key={t.id}>
                        {t.name} · {tx("Капитан")}:{" "}
                        {role?.captain_id ? playerName(role.captain_id) : "—"}
                      </p>
                    );
                  })}
                </section>
              ) : (
                <details id="game-captains" className={section}>
                  <summary className="min-h-11 py-2 text-lg font-bold">
                    {tx("Капитаны и ответственные")}
                    <span className="text-[#73d4ff]">↓</span>
                  </summary>
                  <div className="space-y-4">
                    {s.teams.map((t) => {
                      const role = s.roles.find((r) => r.team_id === t.id);
                      return (
                        <form
                          key={`${t.id}:${role?.captain_id}:${role?.responsible_id}:${t.player_ids.join()}`}
                          onSubmit={(e) => {
                            e.preventDefault();
                            const fd = new FormData(e.currentTarget);
                            void gameAction("ROLES", {
                              team_id: t.id,
                              captain_id: fd.get("captain"),
                              responsible_id: fd.get("responsible"),
                              can_manage_attendance:
                                fd.get("delegate") === "on",
                            });
                          }}
                          className="border border-white/10 rounded-2xl p-4"
                        >
                          <h3 className="font-bold mb-3">
                            {`${t.name} · ${t.player_ids.length} ${tx("игроков")}`}
                          </h3>
                          <p className="ballers-muted text-sm mb-3">
                            {tx(
                              role &&
                                t.player_ids.includes(role.captain_id) &&
                                t.player_ids.includes(role.responsible_id)
                                ? "Роли сохранены"
                                : "Выбери людей и сохрани роли команды.",
                            )}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <label className="text-sm">
                              {tx("Капитан")}
                              <select
                                name="captain"
                                aria-label={tx("Капитан")}
                                required
                                className={field}
                                defaultValue={
                                  t.player_ids.includes(role?.captain_id || "")
                                    ? role?.captain_id
                                    : ""
                                }
                                disabled={!s.manager || busy || !!live}
                              >
                                <option value="" disabled>
                                  {tx("Выбери капитана")}
                                </option>
                                {t.player_ids.map((id) => (
                                  <option key={id} value={id}>
                                    {playerName(id)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-sm">
                              {tx("Ответственный")}
                              <select
                                name="responsible"
                                aria-label={tx("Ответственный")}
                                required
                                className={field}
                                defaultValue={
                                  t.player_ids.includes(
                                    role?.responsible_id || "",
                                  )
                                    ? role?.responsible_id
                                    : ""
                                }
                                disabled={!s.manager || busy || !!live}
                              >
                                <option value="" disabled>
                                  {tx("Выбери ответственного")}
                                </option>
                                {t.player_ids.map((id) => (
                                  <option key={id} value={id}>
                                    {playerName(id)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          {s.manager && (
                            <>
                              <label className="flex items-center gap-2 text-sm my-3">
                                <input
                                  name="delegate"
                                  type="checkbox"
                                  defaultChecked={role?.can_manage_attendance}
                                />
                                {tx(
                                  "Капитан может менять ответы своей команды",
                                )}
                              </label>
                              <button
                                className={secondary}
                                disabled={
                                  busy || !t.player_ids.length || !!live
                                }
                              >
                                {tx("Сохранить роли")} {t.name}
                              </button>
                            </>
                          )}
                        </form>
                      );
                    })}
                  </div>
                </details>
              )}
            </details>
            <p className="text-sm text-gray-500">
              {tx(
                "Таймер восстанавливается с сервера. При потере связи действие не считается сохранённым. Точные минуты игроков не рассчитываются: состав матча — заявка, а не журнал замен.",
              )}
            </p>
          </section>
        </MatchSound>
      </div>
    </main>
  );
}
