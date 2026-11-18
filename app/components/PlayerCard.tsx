"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { t, positionLabel } from "@/lib/i18n";
import { useLocale } from "./Language";
import type { Profile, Stats } from "./AppState";
import Avatar from "./Avatar";
import CardFireworks from "./CardFireworks";
function subscribeMotion(listener: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}
const readMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export function PlayerCard({
  profile,
  stats,
  onClose,
  manual = false,
}: {
  profile: Profile;
  stats?: Stats;
  onClose: () => void;
  manual?: boolean;
}) {
  useLocale();
  const reduced = useSyncExternalStore(subscribeMotion, readMotion, () => true);
  const [revealing, setRevealing] = useState(!manual);
  const playing = revealing && !reduced;
  const previousFocus = useRef(
    typeof document !== "undefined"
      ? (document.activeElement as HTMLElement | null)
      : null,
  );
  useEffect(() => {
    const old = document.body.style.overflow,
      previous = previousFocus.current;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (!revealing) return;
    const timer = window.setTimeout(
      () => setRevealing(false),
      reduced ? 0 : 2800,
    );
    const hide = () => {
      if (document.visibilityState === "hidden") setRevealing(false);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [revealing, reduced]);
  const name =
    profile.display_name ||
    [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  return (
    <div
      className="welcome-backdrop player-card-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("Твой Baller ID")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
        if (e.key === "Tab") {
          const controls = Array.from(
            e.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          ).filter((el) => el.getClientRects().length > 0);
          const first = controls[0],
            last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          } else if (
            !controls.includes(document.activeElement as HTMLButtonElement)
          ) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div
        className={
          "player-card-dialog" + (playing ? " player-card-revealing" : "")
        }
      >
        <CardFireworks active={playing} />
        <header className="player-card-header">
          <span className="player-card-brand">
            BALLERS<span>.</span>
          </span>
          <button
            type="button"
            autoFocus
            className="player-card-close"
            aria-label={t("Скрыть карточку")}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <section className="player-passport" aria-label={t("Паспорт игрока")}>
          <div className="player-passport-body">
            <div className="player-passport-art">
              <span className="player-card-watermark" aria-hidden="true">
                B.
              </span>
              <Avatar src={profile.avatar_url} name={name} large />
              <span className="player-card-art-label">BALLER ID</span>
            </div>
            <div className="player-passport-copy">
              <p className="player-card-caption">{t("Твой Baller ID")}</p>
              <p className="player-card-id">#{profile.baller_id}</p>
              <h2>{name}</h2>
              <p className="player-card-position">
                {positionLabel(profile.primary_position)}
              </p>
              <p className="player-card-city">
                {profile.city || t("Твой футбол")}
              </p>
              <span className="player-card-sign" aria-hidden="true">
                BALLERS<span>.</span>
              </span>
            </div>
          </div>
          <dl className="player-card-stats">
            {[
              [t("Матчи в составе"), stats?.matches],
              [t("Голы"), stats?.goals],
              [t("Ассисты"), stats?.assists],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt>{label}</dt>
                <dd>{value ?? "—"}</dd>
              </div>
            ))}
          </dl>
          <p className="player-card-proof">{t("Только учтённые результаты")}</p>
        </section>
        <p className="player-card-status" role="status" aria-live="polite">
          {playing
            ? t("Твой выход!")
            : reduced
              ? t("Эффекты отключены настройками устройства.")
              : t("Твоя игра. Твоя история.")}
        </p>
        <div className="player-card-actions">
          <button
            type="button"
            className="neon-button"
            disabled={reduced}
            onClick={() => setRevealing((value) => !value)}
          >
            {playing ? t("Пропустить эффекты") : t("Повторить выход")}
          </button>
          <button type="button" className="neon-button green" onClick={onClose}>
            {manual ? t("Скрыть карточку") : t("Продолжить")}
          </button>
        </div>
      </div>
    </div>
  );
}
