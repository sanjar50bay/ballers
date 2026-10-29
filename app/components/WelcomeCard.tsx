"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { t, positionLabel } from "@/lib/i18n";
import { useLocale } from "./Language";
import type { Profile, Stats } from "./AppState";
import Avatar from "./Avatar";
export const WELCOME_COOLDOWN = 30 * 60 * 1000;
const attemptedEntries = new Set<string>();
const enteredHome =
  typeof window !== "undefined" && window.location.pathname === "/";
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
  const [remaining, setRemaining] = useState(5);
  const previousFocus = useRef(
    typeof document !== "undefined"
      ? (document.activeElement as HTMLElement | null)
      : null,
  );
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = previousFocus.current;
    const tick = setInterval(
      () => setRemaining((n) => Math.max(0, n - 1)),
      1000,
    );
    const done = setTimeout(() => closeRef.current(), 5000);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
      previous?.focus();
    };
  }, []);
  const name =
    profile.display_name ||
    [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  return (
    <div
      className="welcome-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("Твой Baller ID")}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Tab") {
          e.preventDefault();
          e.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
        }
      }}
    >
      <section className="welcome-card collectible-card">
        <div className="card-foil" aria-hidden="true" />
        <div className="card-kicker">
          <span>
            BALLERS<span className="text-[#79ffb0]">.</span>
          </span>
          <span>ID {profile.baller_id}</span>
        </div>
        <p className="card-caption">{t("Твой Baller ID")}</p>
        <div className="card-portrait">
          <Avatar src={profile.avatar_url} name={name} large />
          <span className="position-tag">
            {positionLabel(profile.primary_position)}
          </span>
        </div>
        <h2 id="player-card-name">{name}</h2>
        <p className="ballers-muted card-city">
          {profile.city || t("Твой футбол")}
        </p>
        <div className="stats-grid">
          {[
            [t("В заявках"), stats?.matches],
            [t("Голы"), stats?.goals],
            [t("Ассисты"), stats?.assists],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <b>{value ?? "—"}</b>
              <p>{label}</p>
            </div>
          ))}
        </div>
        <p className="ballers-muted card-proof">
          {t("Только учтённые результаты")}
        </p>
        <button
          autoFocus
          className="neon-button green w-full"
          onClick={onClose}
        >
          {manual ? t("Скрыть карточку") + " ·" : t("На главную ·")} {remaining}{" "}
          {t("с")}
        </button>
        <p className="ballers-muted card-skip">
          {t("Нажми в любом месте, чтобы пропустить")}
        </p>
      </section>
    </div>
  );
}
export default function WelcomeCard({
  profile,
  stats,
}: {
  profile: Profile;
  stats?: Stats;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (path !== "/") return;
    let first: ReturnType<typeof setTimeout> | undefined;
    const showIfDue = () => {
      if (
        document.visibilityState !== "visible" ||
        document.documentElement.dataset.coachActive === "true"
      )
        return;
      try {
        const key = `ballers:welcome:${profile.id}`;
        const last = Number(localStorage.getItem(key));
        if (
          localStorage.getItem("ballers:welcome:disabled") === "true" ||
          (Number.isFinite(last) && Date.now() - last < WELCOME_COOLDOWN) ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        )
          return;
        localStorage.setItem(key, String(Date.now()));
        first = setTimeout(() => setOpen(true), 0);
      } catch {
        /* Storage failure must never block entry. */
      }
    };
    if (enteredHome && !attemptedEntries.has(profile.id)) {
      attemptedEntries.add(profile.id);
      showIfDue();
    }
    const hideForGuide = () => setOpen(false);
    window.addEventListener("ballers:guide-start", hideForGuide);
    // Returning from a background tab also counts as a return, after the cooldown.
    window.addEventListener("focus", showIfDue);
    document.addEventListener("visibilitychange", showIfDue);
    return () => {
      clearTimeout(first);
      window.removeEventListener("ballers:guide-start", hideForGuide);
      window.removeEventListener("focus", showIfDue);
      document.removeEventListener("visibilitychange", showIfDue);
    };
  }, [profile.id, path]);
  return open ? (
    <PlayerCard
      profile={profile}
      stats={stats}
      onClose={() => setOpen(false)}
    />
  ) : null;
}
