"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import BottomNav from "@/app/components/BottomNav";
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
  game: {
    id: string;
    community_id: string;
    title: string;
    status: string;
    format: number;
    capacity: number | null;
  };
  my_player_id: string;
  manager: boolean;
  server_now: string;
  settings: Partial<Settings>;
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

export default function PlayPage() {
  const { gameId } = useParams<{ gameId: string }>();
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
  const initialized = useRef(false);
  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc("ballers_alpha_snapshot", {
      p_game: gameId,
    });
    if (error) {
      setError(error.message);
      return;
    }
    const snap = data as Snapshot;
    setS(snap);
    setError("");
    setOffset(new Date(snap.server_now).getTime() - Date.now());
    setClock(Date.now());
    if (!initialized.current) {
      setSettings((old) => ({ ...old, ...snap.settings }));
      initialized.current = true;
    }
  }, [gameId]);
  useEffect(() => {
    const first = window.setTimeout(() => {
      void refresh();
    }, 0);
    const poll = window.setInterval(() => {
      void refresh();
    }, 5000);
    const tick = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);
  async function run(
    task: () => PromiseLike<{ error: { message: string } | null }>,
    message = "Сохранено",
  ) {
    if (busy) return;
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
          : "Нет соединения: действие не подтверждено сервером",
      );
    } finally {
      setBusy(false);
    }
  }
  const gameAction = (action: string, payload: Record<string, unknown> = {}) =>
    run(() =>
      action === "START"
        ? supabase.rpc("ballers_start_match", { p_game: gameId })
        : supabase.rpc("ballers_game_action", {
            p_game: gameId,
            p_action: action,
            p_payload: payload,
          }),
    );
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
  const canOperate =
    !!s && !!live && (s.manager || live.operator_id === s.my_player_id);
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
  if (!s)
    return (
      <main className="min-h-screen bg-[#050710] text-white p-8">
        <p>{error || "Загружаем игровой центр…"}</p>
        <Link className="text-violet-300 underline" href="/">
          На главную
        </Link>
      </main>
    );
  const playerName = (id: string) =>
    s.players.find((p) => p.id === id)?.name || "Игрок";
  const teamName = (id: string) =>
    s.teams.find((t) => t.id === id)?.name || "Команда";
  const rosterIds = live
    ? s.rosters.filter((r) => r.match_id === live.id).map((r) => r.player_id)
    : [];
  const pending = s.matches.filter((m) =>
    ["PENDING", "DISPUTED"].includes(m.status),
  );
  const doBulk = (status: "GOING" | "DECLINED") => {
    if (
      !confirm(
        `Изменить ответы всех участников на «${status === "GOING" ? "Иду" : "Не иду"}»? При нехватке мест игроки попадут в очередь ожидания.`,
      )
    )
      return;
    void run(async () => {
      for (const p of s.participants) {
        const { error } = await setAttendance(gameId, p.player_id, status);
        if (error) return { error };
      }
      return { error: null };
    }, "Ответы обновлены. Проверьте пул и очередь.");
  };
  return (
    <main className="min-h-screen bg-[#050710] text-white pb-24">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-16">
        <header className="flex justify-between items-start gap-4 mb-6">
          <div>
            <Link
              className="text-violet-300 text-sm"
              href={`/communities/${s.game.community_id}/game-days/${gameId}`}
            >
              ← Составы и приглашения
            </Link>
            <h1 className="text-3xl font-black mt-3">Игровой центр</h1>
            <p className="text-gray-400 mt-1">
              {s.game.title} · {s.game.format}×{s.game.format}
            </p>
          </div>
          <Link href="/my-game" className="text-sm text-[#78dcff] mt-12">
            Моя игра →
          </Link>
        </header>
        {error && (
          <div
            role="alert"
            className="p-4 border border-red-500 rounded-xl mb-4"
          >
            Не удалось обновить данные: {error}
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="p-4 rounded-xl bg-violet-950 border border-violet-700 mb-4 flex gap-3 justify-between"
          >
            <span>{notice}</span>
            <button
              aria-label="Закрыть сообщение"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-3 mb-5 items-center">
          <a className="neon-button blue" href="#results">
            Матчи · {s.matches.length}
          </a>
          <Link className="text-link" href="/my-game?history=1">
            История игр →
          </Link>
          {s.manager && s.game.status === "OPEN" && (
            <button
              className="neon-button green"
              disabled={busy || !!live}
              onClick={() => {
                if (
                  confirm(
                    `Завершить игровой день? Матчей: ${s.matches.length}. Результаты и подтверждения сохранятся.`,
                  )
                )
                  void gameAction("CLOSE");
              }}
            >
              Завершить игровой день
            </button>
          )}
          {s.game.status !== "OPEN" && (
            <span className="text-[#79ffb0]">Игровой день завершён</span>
          )}
        </div>
        {live && (
          <section className="rounded-3xl border border-violet-500 bg-gradient-to-br from-violet-950 to-[#09131d] p-5 mb-5">
            <div className="flex justify-between gap-2 text-sm text-gray-300">
              <span>
                Матч #{live.sequence} · {statuses[live.status]}
              </span>
              <span>{live.is_test ? "ТЕСТОВЫЙ" : ""}</span>
            </div>
            <div className="grid grid-cols-3 items-center text-center my-6">
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
              {live.duration_seconds / 60} мин · до {live.goal_limit} голов ·
              оператор: {playerName(live.operator_id)}
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
                    {live.status === "PAUSED" ? "Продолжить" : "Пауза"}
                  </button>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          "Завершить матч с текущим счётом и выполнить ротацию?",
                        )
                      )
                        void matchAction(live, "FINISH");
                    }}
                  >
                    Завершить матч
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
                    Событие
                    <select className={field} name="kind">
                      <option value="GOAL">Гол</option>
                      <option value="OWN_GOAL">Автогол</option>
                      <option value="SAVE">Сейв</option>
                    </select>
                  </label>
                  <label className="block text-sm">
                    Игрок
                    <select name="player" className={field}>
                      {rosterIds.map((id) => (
                        <option key={id} value={id}>
                          {playerName(id)} ·{" "}
                          {teamName(
                            s.rosters.find(
                              (r) =>
                                r.match_id === live.id && r.player_id === id,
                            )?.team_id || "",
                          )}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    Ассистент (только для гола)
                    <select name="assist" className={field}>
                      <option value="">Без ассиста</option>
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
                    Записать событие
                  </button>
                </form>
              </>
            )}
            {s.manager && (
              <label className="block text-sm mt-4">
                Передать учёт
                <select
                  className={field}
                  value={live.operator_id}
                  disabled={busy}
                  onChange={(e) => {
                    void matchAction(live, "OPERATOR", {
                      player_id: e.target.value,
                    });
                  }}
                >
                  {s.participants
                    .filter((p) => p.attendance_status === "GOING")
                    .map((p) => (
                      <option key={p.player_id} value={p.player_id}>
                        {playerName(p.player_id)}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </section>
        )}
        {s.game.status === "OPEN" && (
          <section className={section}>
            <h2 className="text-xl font-bold mb-3">Пара и очередь</h2>
            {s.session ? (
              <>
                <p className="text-lg font-bold">
                  {teamName(s.session.team_a)} vs {teamName(s.session.team_b)}
                </p>
                <p className="text-sm text-gray-400 mt-2">
                  Дольше на поле: {teamName(s.session.older_team)} · Ждут:{" "}
                  {s.session.queue.map(teamName).join(" → ") || "никто"}
                </p>
              </>
            ) : (
              <p className="text-gray-400">
                По умолчанию начнут первые две команды; при первой ничьей
                отдыхает первая. Можно изменить ниже.
              </p>
            )}
            {s.manager && !s.matches.length && (
              <details className="mt-3">
                <summary className="min-h-11 py-2 text-sm text-[#7bd9ff]">
                  Изменить стартовую пару ↓
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
                    Первая команда
                    <select name="a" className={field}>
                      {s.teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    Вторая команда
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
                    Кто отдыхает при первой ничьей
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
                    Сохранить стартовую пару
                  </button>
                </form>
              </details>
            )}
            {s.manager && !live && (
              <button
                className={`${button} mt-4`}
                disabled={
                  busy || s.teams.length < 2 || s.game.status !== "OPEN"
                }
                onClick={() => {
                  void gameAction("START");
                }}
              >
                {s.matches.length
                  ? "Начать следующий матч"
                  : "Начать первый матч"}
              </button>
            )}
          </section>
        )}
        <section
          id="results"
          style={{ scrollMarginTop: 20 }}
          className={section}
        >
          <h2 className="text-xl font-bold mb-4">
            Результаты и подтверждения{" "}
            {pending.length > 0 && `· ${pending.length} ожидают`}
          </h2>
          {!s.matches.length && (
            <p className="text-gray-400">Первый матч ещё не начат.</p>
          )}
          {s.matches.map((m) => (
            <article
              id={`match-${m.id}`}
              style={{ scrollMarginTop: 20 }}
              key={m.id}
              className="border border-white/10 rounded-2xl p-4 mb-3"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <b>
                  #{m.sequence} {teamName(m.team_a)} {m.score_a}:{m.score_b}{" "}
                  {teamName(m.team_b)}
                </b>
                <span className="text-sm text-violet-300">
                  {statuses[m.status]}
                  {m.is_test ? " · тест" : ""}
                </span>
              </div>
              <p className="text-sm text-gray-400 mt-2">
                Капитаны: {m.confirmed_a ? "✓" : "…"} {playerName(m.captain_a)}{" "}
                / {m.confirmed_b ? "✓" : "…"} {playerName(m.captain_b)}
              </p>
              {m.resolution_note && (
                <p className="text-sm text-amber-200 mt-2">
                  Решение/спор: {m.resolution_note}
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
                      Подтвердить результат
                    </button>
                  )}
                {m.status === "PENDING" &&
                  (s.manager ||
                    [m.captain_a, m.captain_b].includes(s.my_player_id)) && (
                    <button
                      className={secondary}
                      disabled={busy}
                      onClick={() => {
                        const reason = prompt("В чём спор?");
                        if (reason) void matchAction(m, "DISPUTE", { reason });
                      }}
                    >
                      Оспорить
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
                          "Укажи причину решения (минимум 5 символов). Тестовые матчи не входят в реальную карьерную статистику.",
                        );
                        if (reason) void matchAction(m, "RESOLVE", { reason });
                      }}
                    >
                      {m.is_test
                        ? "Подтвердить тест с причиной"
                        : "Решить спор"}
                    </button>
                  )}
              </div>
              <details className="mt-3">
                <summary className="min-h-11 py-2 text-sm text-[#76d6ff]">
                  События матча ↓
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
                          {e.kind === "GOAL"
                            ? "⚽ Гол"
                            : e.kind === "SAVE"
                              ? "🧤 Сейв"
                              : "↩ Автогол"}{" "}
                          · {playerName(e.player_id)}
                          {e.assist_id
                            ? ` · ассист ${playerName(e.assist_id)}`
                            : ""}
                        </span>
                        {!e.voided &&
                          (s.manager || m.operator_id === s.my_player_id) && (
                            <button
                              disabled={busy}
                              className="text-violet-300"
                              onClick={() => {
                                if (
                                  confirm(
                                    "Отменить событие? Подтверждения завершённого матча будут сброшены.",
                                  )
                                )
                                  void matchAction(m, "UNDO", { id: e.id });
                              }}
                            >
                              Отменить
                            </button>
                          )}
                      </div>
                    ))}
                </div>
              </details>
            </article>
          ))}
        </section>
        <details className={section}>
          <summary className="min-h-11 py-2 text-lg font-bold">
            Участники и резерв <span className="text-[#73d4ff]">↓</span>
          </summary>
          <p className="text-sm text-gray-400 mb-4">
            Иду:{" "}
            {
              s.participants.filter((p) => p.attendance_status === "GOING")
                .length
            }
            /{s.game.capacity || "∞"} · Ожидают: {s.waitlist.length}
          </p>
          {s.manager && (
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                className={button}
                disabled={busy || !!live}
                onClick={() => doBulk("GOING")}
              >
                Все участники → Иду
              </button>
              <button
                className={secondary}
                disabled={busy || !!live}
                onClick={() => doBulk("DECLINED")}
              >
                Все → Не иду
              </button>
              <button
                className={secondary}
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "Добавить до 14 синтетических игроков сообщества без Google-аккаунтов? Они не записываются на игру автоматически.",
                    )
                  )
                    void run(
                      () =>
                        supabase.rpc("ballers_add_test_players", {
                          p_community: s.game.community_id,
                          p_count: 14,
                        }),
                      "Тестовые профили добавлены. Пригласи их через Invite Members.",
                    );
                }}
              >
                Тестовые игроки +14
              </button>
            </div>
          )}
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {s.participants.map((p) => {
              const w = s.waitlist.find((w) => w.player_id === p.player_id);
              return (
                <div
                  key={p.player_id}
                  className="flex justify-between items-center gap-3 rounded-xl bg-white/5 p-3"
                >
                  <div>
                    <b className="text-sm">{playerName(p.player_id)}</b>
                    <p className="text-sm text-gray-400">
                      {w
                        ? w.offered
                          ? "Место предложено — ждём ответа"
                          : "Очередь ожидания"
                        : {
                            GOING: "Иду",
                            MAYBE: "Возможно",
                            INVITED: "Приглашён",
                            DECLINED: "Не иду",
                          }[p.attendance_status]}
                    </p>
                  </div>
                  {(s.manager || p.player_id === s.my_player_id) && (
                    <select
                      aria-label={`Ответ ${playerName(p.player_id)}`}
                      className="bg-[#161b2c] text-sm rounded-lg p-2 max-w-32"
                      disabled={busy}
                      value={w ? "WAITING" : p.attendance_status}
                      onChange={(e) => {
                        void run(() =>
                          setAttendance(
                            gameId,
                            p.player_id,
                            e.target.value as "GOING" | "MAYBE" | "DECLINED",
                          ),
                        );
                      }}
                    >
                      {w && (
                        <option value="WAITING" disabled>
                          Ожидание
                        </option>
                      )}
                      <option value="INVITED" disabled>
                        Приглашён
                      </option>
                      <option value="GOING">Иду</option>
                      <option value="MAYBE">Возможно</option>
                      <option value="DECLINED">Не иду</option>
                    </select>
                  )}
                </div>
              );
            })}
          </div>
          {!!s.waitlist.length && (
            <p className="mt-3 text-sm text-amber-300">
              Очередь:{" "}
              {s.waitlist
                .map(
                  (w) =>
                    playerName(w.player_id) +
                    (w.offered ? " — место предложено" : ""),
                )
                .join(" → ")}
              . Предложение не переводит игрока в «Иду» автоматически.
            </p>
          )}
        </details>
        {s.manager && s.game.status === "OPEN" && (
          <details className={section}>
            <summary className="min-h-11 py-2 text-lg font-bold">
              Параметры игрового дня <span className="text-[#73d4ff]">↓</span>
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
                  Игроков на поле
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
                  Мест в Game Day
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
                Сохранить формат и места
              </button>
            </form>
          </details>
        )}
        {s.manager && s.game.status === "OPEN" && (
          <details className={section}>
            <summary className="min-h-11 py-2 text-lg font-bold">
              Правила новых матчей <span className="text-[#73d4ff]">↓</span>
            </summary>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                Минуты
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
                      duration_seconds: Math.round(Number(e.target.value) * 60),
                    })
                  }
                />
              </label>
              <label className="text-sm">
                До голов
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
              Окончание
              <select
                className={field}
                value={settings.end_mode}
                onChange={(e) =>
                  setSettings({ ...settings, end_mode: e.target.value })
                }
              >
                <option value="FIRST_REACHED">
                  Время или голы — что раньше
                </option>
                <option value="TIME_ONLY">Только время</option>
                <option value="GOALS_ONLY">Только голы</option>
              </select>
            </label>
            <label className="block text-sm mt-3">
              Предел побед подряд (пусто = нет)
              <input
                className={field}
                type="number"
                min="1"
                value={settings.max_streak ?? ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    max_streak: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
            {settings.max_streak && (
              <p className="text-sm text-amber-200 mt-2">
                Выбранное правило: при достижении предела победитель отдыхает,
                проигравшая остаётся. Объявите его командам заранее.
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
              Открыть добор в списке публичных игр
            </label>
            <p className="text-sm text-gray-400 mb-3">
              Победитель остаётся. При ничьей уходит дольше играющая команда.
              Начатый матч сохраняет свои правила.
            </p>
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                void gameAction("SETTINGS", { ...settings });
              }}
            >
              Сохранить правила
            </button>
          </details>
        )}
        {s.manager && s.game.status === "OPEN" && (
          <details className={section}>
            <summary className="min-h-11 py-2 text-lg font-bold">
              Базовые команды сообщества{" "}
              <span className="text-[#73d4ff]">↓</span>
            </summary>
            <p className="text-sm text-gray-400 mb-4">
              Сохрани нынешние команды и режимы как базу. Отсутствующие
              постоянные игроки сохраняются. В новом Game Day загружаются только
              ответившие «Иду», остальные места заполняются через Random / Core
              + Fill.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className={secondary}
                disabled={busy || !!live}
                onClick={() => {
                  if (
                    confirm(
                      "Сохранить команды как базовые? Названия и режимы обновятся; отсутствующие участники сохранятся.",
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
                Запомнить команды как постоянные
              </button>
              <button
                className={secondary}
                disabled={busy || s.matches.length > 0}
                onClick={() => {
                  if (
                    confirm(
                      "Заменить сегодняшние команды базовыми? Загрузятся только Going; текущие назначения сбросятся.",
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
                Применить постоянные команды к этому дню
              </button>
            </div>
          </details>
        )}
        <details className={section}>
          <summary className="min-h-11 py-2 text-lg font-bold">
            Капитаны и ответственные <span className="text-[#73d4ff]">↓</span>
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
                      can_manage_attendance: fd.get("delegate") === "on",
                    });
                  }}
                  className="border border-white/10 rounded-2xl p-4"
                >
                  <h3 className="font-bold mb-3">
                    {t.name} · {t.player_ids.length} игроков
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="text-sm">
                      Капитан
                      <select
                        name="captain"
                        className={field}
                        defaultValue={role?.captain_id || t.player_ids[0] || ""}
                        disabled={!s.manager || busy || !!live}
                      >
                        {t.player_ids.map((id) => (
                          <option key={id} value={id}>
                            {playerName(id)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm">
                      Ответственный
                      <select
                        name="responsible"
                        className={field}
                        defaultValue={
                          role?.responsible_id || t.player_ids[0] || ""
                        }
                        disabled={!s.manager || busy || !!live}
                      >
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
                        Капитан может менять ответы своей команды
                      </label>
                      <button
                        className={secondary}
                        disabled={busy || !t.player_ids.length || !!live}
                      >
                        Сохранить роли {t.name}
                      </button>
                    </>
                  )}
                </form>
              );
            })}
          </div>
        </details>
        <p className="text-sm text-gray-500">
          Таймер восстанавливается с сервера. При потере связи действие не
          считается сохранённым. Точные минуты игроков не рассчитываются: состав
          матча — заявка, а не журнал замен.
        </p>
      </div>
      <BottomNav />
    </main>
  );
}
