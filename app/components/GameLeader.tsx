"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { t, uiError } from "@/lib/i18n";
import { useLocale } from "./Language";

export type GameControl = {
  required: boolean;
  leader_id: string | null;
  leader_name: string | null;
  version: number;
  sequence: number;
  is_leader: boolean;
  history: {
    id: number;
    action: string;
    actor_name: string;
    leader_name: string;
    previous_name: string | null;
    reason: string | null;
  }[];
};

export default function GameLeader({
  gameId,
  control,
  manager,
  open,
  players,
  refresh,
}: {
  gameId: string;
  control?: GameControl;
  manager: boolean;
  open: boolean;
  players: { id: string; name: string }[];
  refresh: () => Promise<void>;
}) {
  useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!control)
    return (
      <p className="error-panel">
        {t("Управление матчем временно недоступно. Обратись к организатору.")}
      </p>
    );
  const recover = !!control.leader_id && !control.is_leader;
  return (
    <section className="leader-panel" aria-label={t("Ведущий игры")}>
      <p>
        <b>{t("Матч ведёт:")}</b>{" "}
        <span>{control.leader_name || t("Ещё не назначен")}</span>
      </p>
      <p className="ballers-muted mt-2">
        {t(
          control.is_leader
            ? "Управление у тебя"
            : "Управление только у ведущего. Остальные смотрят матч.",
        )}
      </p>
      {error && (
        <p role="alert" className="error-panel mt-3">
          {uiError(error)}
        </p>
      )}
      {open && (manager || control.is_leader) && (
        <details className="mt-3">
          <summary className="min-h-11 py-2 cursor-pointer">
            {t(
              !control.leader_id
                ? "Кто ведёт матч?"
                : control.is_leader
                  ? "Передать управление"
                  : "Восстановить управление",
            )}
          </summary>
          <form
            key={control.version}
            className="space-y-3 mt-3"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              const form = new FormData(event.currentTarget);
              const disclosure = event.currentTarget.closest("details");
              setBusy(true);
              setError("");
              try {
                const { error } = await supabase
                  .rpc("ballers_set_game_leader", {
                    p_game: gameId,
                    p_player: form.get("leader"),
                    p_version: control.version,
                    p_reason: form.get("reason") || null,
                  })
                  .abortSignal(AbortSignal.timeout(15000));
                if (error) setError(error.message);
                else if (disclosure) {
                  disclosure.open = false;
                  disclosure.querySelector("summary")?.focus();
                }
                await refresh();
              } catch {
                setError(
                  t(
                    "Не удалось подтвердить передачу. Обнови данные перед повтором.",
                  ),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="network-field">
              <span>{t("Ведущий игры")}</span>
              <select name="leader" required defaultValue="" disabled={busy}>
                <option value="" disabled>
                  {t("Выбери человека")}
                </option>
                {players
                  .filter((p) => p.id !== control.leader_id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            {recover && (
              <label className="network-field">
                <span>{t("Причина восстановления")}</span>
                <input
                  name="reason"
                  required
                  minLength={5}
                  maxLength={300}
                  disabled={busy}
                />
              </label>
            )}
            <button
              className="neon-button"
              disabled={
                busy || !players.some((p) => p.id !== control.leader_id)
              }
            >
              {t(
                busy
                  ? "Подожди…"
                  : !control.leader_id
                    ? "Назначить ведущего"
                    : recover
                      ? "Восстановить управление"
                      : "Передать управление",
              )}
            </button>
          </form>
        </details>
      )}
      {!!control.history.length && (
        <details className="mt-3">
          <summary className="min-h-11 py-2 cursor-pointer">
            {t("История управления")}
          </summary>
          <ol className="space-y-3 mt-2">
            {control.history.map((row) => (
              <li key={row.id} className="ballers-muted">
                <b>{row.actor_name}</b> → {row.leader_name}
                {row.reason && <p>{row.reason}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
