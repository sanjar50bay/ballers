"use client";
import { useState } from "react";
import { t } from "@/lib/i18n";
import { useLocale } from "./Language";
import {
  dayResults,
  type DayMatch,
  type DayEvent,
  type DayTeam,
  type DayRoster,
} from "@/lib/day-results";
export const eventLabel = (kind: string) =>
  t(
    (
      {
        GOAL: "Гол",
        OWN_GOAL: "Автогол",
        SAVE: "Сейв",
        YELLOW: "Жёлтая карточка",
        RED: "Красная карточка",
      } as Record<string, string>
    )[kind] || "Событие",
  );
export default function DayResults({
  matches,
  events,
  teams,
  rosters,
  players,
}: {
  matches: DayMatch[];
  events: DayEvent[];
  teams: DayTeam[];
  rosters: DayRoster[];
  players: { id: string; name: string }[];
}) {
  useLocale();
  const [tab, setTab] = useState("table"),
    [test, setTest] = useState(false);
  const d = dayResults(matches, events, teams, rosters, test);
  const player = (id: string) =>
    players.find((p) => p.id === id)?.name || t("Игрок");
  return (
    <section
      className="day-results neon-panel"
      aria-label={t("Итоги игрового дня")}
    >
      <h2>{t("Итоги игрового дня")}</h2>
      <div className="network-actions">
        <button
          className={!test ? "network-secondary selected" : "network-secondary"}
          onClick={() => setTest(false)}
        >
          {t("Реальные матчи")}
        </button>
        <button
          className={test ? "network-secondary selected" : "network-secondary"}
          onClick={() => setTest(true)}
        >
          {t("Тестовые матчи")}
        </button>
      </div>
      <p className="ballers-muted my-3">
        {t("Подтверждено: {count}", { count: d.confirmed })} ·{" "}
        {t("Ждут решения: {count}", { count: d.pending })}
      </p>
      <div
        className="network-tabs"
        role="group"
        aria-label={t("Итоги игрового дня")}
      >
        {[
          ["table", "Таблица дня"],
          ["scorers", "Бомбардиры"],
          ["protocol", "Протоколы"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            className={tab === key ? "selected" : ""}
            onClick={() => setTab(key)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {tab === "table" && (
        <>
          <p className="ballers-muted my-3">
            {t(
              "Победа — 3, ничья — 1, поражение — 0. Сортировка: очки, разница мячей, забитые мячи.",
            )}
          </p>
          <div
            className="table-scroll"
            tabIndex={0}
            aria-label={t("Таблица дня")}
          >
            <table className="day-table">
              <thead>
                <tr>
                  {["Команда", "И", "В", "Н", "П", "Мячи", "Очки"].map((x) => (
                    <th key={x}>{t(x)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.table.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">{r.name}</th>
                    <td>{r.played}</td>
                    <td>{r.wins}</td>
                    <td>{r.draws}</td>
                    <td>{r.losses}</td>
                    <td>
                      {r.gf}:{r.ga}
                    </td>
                    <td className="text-[#79ffb0]">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ballers-muted mt-2">
            {t("И — игры · В — победы · Н — ничьи · П — поражения")}
          </p>
        </>
      )}
      {tab === "scorers" && (
        <div className="table-scroll" tabIndex={0}>
          <table className="day-table">
            <thead>
              <tr>
                {["Игрок", "Голы", "Ассисты", "Сейвы"].map((x) => (
                  <th key={x}>{t(x)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.scorers.map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    {player(r.id)}
                    <small className="block ballers-muted">
                      {r.team_ids
                        .map((id) => teams.find((x) => x.id === id)?.name)
                        .filter(Boolean)
                        .join(" / ")}
                    </small>
                  </th>
                  <td>{r.goals}</td>
                  <td>{r.assists}</td>
                  <td>{r.saves}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!d.scorers.length && (
            <p className="p-3 ballers-muted">
              {t("Пока нет подтверждённых событий.")}
            </p>
          )}
        </div>
      )}
      {tab === "protocol" && (
        <div className="mt-4">
          {matches
            .filter((m) => m.is_test === test)
            .map((m) => (
              <details key={m.id} className="protocol-card">
                <summary>
                  #{m.sequence} {teams.find((x) => x.id === m.team_a)?.name}{" "}
                  {m.score_a}:{m.score_b}{" "}
                  {teams.find((x) => x.id === m.team_b)?.name}
                  <small className="block ballers-muted">
                    {t(
                      (
                        {
                          VERIFIED: "Подтверждён",
                          PENDING: "Ждёт подтверждений",
                          DISPUTED: "Спор",
                          LIVE: "Идёт матч",
                          PAUSED: "Пауза",
                          CANCELLED: "Отменён",
                        } as Record<string, string>
                      )[m.status] || m.status,
                    )}
                  </small>
                </summary>
                {[m.team_a, m.team_b].map((id) => (
                  <div key={id} className="mt-3">
                    <b>{teams.find((x) => x.id === id)?.name}</b>
                    <p className="ballers-muted">
                      {rosters
                        .filter((r) => r.match_id === m.id && r.team_id === id)
                        .map((r) => player(r.player_id))
                        .join(" · ") || t("Нет игроков")}
                    </p>
                  </div>
                ))}
                {events
                  .filter((e) => e.match_id === m.id)
                  .map((e) => (
                    <p
                      key={e.id}
                      className={
                        e.voided ? "line-through ballers-muted mt-2" : "mt-2"
                      }
                    >
                      {String(Math.floor(e.elapsed_seconds / 60)).padStart(
                        2,
                        "0",
                      )}
                      :{String(e.elapsed_seconds % 60).padStart(2, "0")} ·{" "}
                      {eventLabel(e.kind)} · {player(e.player_id)}
                      {e.assist_id
                        ? " · " + t("ассист") + ": " + player(e.assist_id)
                        : ""}
                      {e.voided ? " · " + t("Отменено") : ""}
                    </p>
                  ))}
                <a className="text-link mt-3" href={"#match-" + m.id}>
                  {t("Подтверждения и спор →")}
                </a>
              </details>
            ))}
          {!matches.some((m) => m.is_test === test) && (
            <p className="ballers-muted">{t("Пока нет матчей этого типа.")}</p>
          )}
        </div>
      )}
      <p className="ballers-muted mt-4">
        {t(
          "В зачёт идут только подтверждённые матчи выбранного типа. Автоголы не входят в личные голы.",
        )}
      </p>
    </section>
  );
}
