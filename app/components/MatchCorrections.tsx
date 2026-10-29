"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { t, dateLocale } from "@/lib/i18n";
import { useLocale } from "./Language";
export default function MatchCorrections({
  matchId,
  version,
  manager,
  trusted,
  pending,
  busy,
  players,
  onAction,
}: {
  matchId: string;
  version: number;
  manager: boolean;
  trusted: boolean;
  pending: boolean;
  busy: boolean;
  players: { id: string; name: string }[];
  onAction: (action: string, payload: Record<string, unknown>) => void;
}) {
  useLocale();
  const [history, setHistory] = useState<
    {
      id: number;
      action: string;
      version: number;
      created_at: string;
      reason: string | null;
      actor: string;
      score_a: string;
      score_b: string;
    }[]
  >([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function load() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const { data, error } = await supabase.rpc("ballers_match_history", {
        p_match: matchId,
      });
      if (error) throw error;
      setHistory(data || []);
    } catch {
      setError(t("Не удалось загрузить историю. Повтори проверку."));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="mt-3 space-y-3">
      {manager && pending && (
        <button
          type="button"
          disabled={busy}
          className="network-secondary"
          onClick={() => {
            const reason = prompt(
              t("Причина исправления (минимум 5 символов)"),
            );
            if (reason?.trim().length && reason.trim().length >= 5)
              onAction("ACCEPT_TRUSTED", { reason: reason.trim() });
          }}
        >
          {t("Учесть без подтверждений")}
        </button>
      )}
      {manager && trusted && (
        <details className="neon-panel p-3">
          <summary className="py-2">
            {t("Добавить пропущенное событие")}
          </summary>
          <p className="ballers-muted">
            {t(
              "Исправление сразу пересчитает результат. Очередь уже сыгранных матчей не меняется.",
            )}
          </p>
          <form
            className="network-form mt-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const kind = String(f.get("kind"));
              onAction("CORRECT_EVENT", {
                id: crypto.randomUUID(),
                kind,
                player_id: f.get("player"),
                assist_id: kind === "GOAL" ? f.get("assist") || null : null,
                reason: String(f.get("reason")).trim(),
              });
            }}
          >
            <label>
              {t("Событие")}
              <select className="network-input" name="kind">
                {[
                  ["GOAL", "Гол"],
                  ["OWN_GOAL", "Автогол"],
                  ["SAVE", "Сейв"],
                  ["YELLOW", "Жёлтая карточка"],
                  ["RED", "Красная карточка"],
                ].map(([v, n]) => (
                  <option key={v} value={v}>
                    {t(n)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Игрок")}
              <select className="network-input" name="player">
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Ассистент (только для гола)")}
              <select className="network-input" name="assist">
                <option value="">{t("Без ассиста")}</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Причина исправления (минимум 5 символов)")}
              <input
                className="network-input"
                name="reason"
                required
                minLength={5}
                maxLength={500}
              />
            </label>
            <button className="network-secondary" disabled={busy}>
              {t("Сохранить исправление")}
            </button>
          </form>
        </details>
      )}
      <details
        onToggle={(e) => {
          if (e.currentTarget.open) void load();
        }}
        key={`${matchId}:${version}`}
      >
        <summary className="py-2">{t("История изменений результата")}</summary>
        <button
          className="text-link"
          disabled={loading}
          onClick={() => void load()}
        >
          {t("Обновить историю")}
        </button>
        {error && <p role="alert">{error}</p>}
        {history.map((h) => (
          <p key={h.id} className="ballers-muted my-2">
            {new Date(h.created_at).toLocaleString(dateLocale())} · {h.actor} ·{" "}
            {t(
              (
                {
                  EVENT: "Записать событие",
                  CORRECT_EVENT: "Добавить пропущенное событие",
                  UNDO: "Отменено",
                  FINISH: "Завершить матч",
                  ACCEPT_TRUSTED: "Учесть без подтверждений",
                  CONFIRM: "Подтвердить результат",
                  RESOLVE: "Решить спор",
                  DISPUTE: "Оспорить",
                  PAUSE: "Пауза",
                  RESUME: "Продолжить",
                  OPERATOR: "Кто ведёт счёт матча",
                } as Record<string, string>
              )[h.action] || "Изменение",
            )}{" "}
            · {h.score_a}:{h.score_b}
            {h.reason ? ` · ${h.reason}` : ""}
          </p>
        ))}
      </details>
    </div>
  );
}
