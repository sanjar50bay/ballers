"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { preMatchError, setAttendance } from "@/lib/pre-match";
import { useApp, type GameDay } from "./AppState";

export default function GameAttendanceActions({ game }: { game: GameDay }) {
  const { data, refresh, error: refreshError } = useApp();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const playerId = data?.profile?.id;
  const path = `/games/${game.id}/play`;

  async function answer(status: "GOING" | "DECLINED") {
    if (!playerId || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setConfirm(false);
    try {
      const result = await setAttendance(
        game.id,
        playerId,
        status,
        AbortSignal.timeout(12000),
      );
      if (result.error) setError(preMatchError(result.error));
    } catch {
      setError(t("Не удалось проверить ответ. Обнови данные перед повтором."));
    } finally {
      // Read authoritative status: GOING may result in a request or a waitlist.
      await refresh();
      locked.current = false;
      setBusy(false);
    }
  }

  if (!playerId || game.status !== "OPEN") return null;
  if (game.live)
    return (
      <p className="next-game-hint">
        {t("Матч уже начался. Участие меняется на экране игры.")}
      </p>
    );
  if (
    game.queued ||
    game.request_status === "PENDING" ||
    !game.attendance_status
  )
    return (
      <Link className="next-game-response-link" href={path}>
        {t(
          game.queued
            ? "Открыть резерв →"
            : game.request_status === "PENDING"
              ? "Посмотреть заявку →"
              : "Условия участия →",
        )}
      </Link>
    );

  return (
    <div className="next-game-response" aria-label={t("Твоё участие")}>
      <p className="next-game-hint">
        {t(
          game.attendance_status === "INVITED" ||
            game.attendance_status === "MAYBE"
            ? "Сможешь сыграть?"
            : "Твой ответ можно изменить",
        )}
      </p>
      <div className="next-game-answer-buttons" aria-busy={busy}>
        <button
          className="next-game-going"
          type="button"
          aria-pressed={game.attendance_status === "GOING"}
          disabled={
            busy || !!refreshError || game.attendance_status === "GOING"
          }
          onClick={() => void answer("GOING")}
        >
          {t("Иду")}
        </button>
        <button
          type="button"
          aria-pressed={game.attendance_status === "DECLINED"}
          disabled={
            busy || !!refreshError || game.attendance_status === "DECLINED"
          }
          onClick={() =>
            game.attendance_status === "GOING"
              ? setConfirm(true)
              : void answer("DECLINED")
          }
        >
          {t("Не могу")}
        </button>
      </div>
      {confirm && (
        <div
          className="next-game-confirm"
          role="group"
          aria-label={t("Отмена участия")}
        >
          <p>
            {t(
              "Отказаться от игры? Твоё место освободится, назначение в состав будет снято.",
            )}
          </p>
          <button
            type="button"
            disabled={busy || !!refreshError}
            onClick={() => void answer("DECLINED")}
          >
            {t("Да, не смогу")}
          </button>
          <button type="button" onClick={() => setConfirm(false)}>
            {t("Оставить участие")}
          </button>
        </div>
      )}
      {busy && (
        <p role="status" className="next-game-hint">
          {t("Проверяем твой ответ…")}
        </p>
      )}
      {error && (
        <p className="error-panel" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
