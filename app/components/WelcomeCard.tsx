"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { t, positionLabel } from "@/lib/i18n";
import { useLocale } from "./Language";
import type { Profile, Stats } from "./AppState";
import Avatar from "./Avatar";
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
  const previousFocus = useRef(
    typeof document !== "undefined"
      ? (document.activeElement as HTMLElement | null)
      : null,
  );
  useEffect(() => {
    const previous = previousFocus.current;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
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
            [t("Матчи в составе"), stats?.matches],
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
          {manual ? t("Скрыть карточку") : t("Продолжить")}
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (sessionStorage.getItem("ballers:welcome:new-profile") !== profile.id)
        return;
      // Consume before rendering: focus, refresh, another login cannot replay it.
      sessionStorage.removeItem("ballers:welcome:new-profile");
      const key = `ballers:welcome:shown:${profile.id}`;
      if (
        localStorage.getItem(key) ||
        localStorage.getItem("ballers:welcome:disabled") === "true" ||
        localStorage.getItem("ballers:network-return")
      )
        return;
      localStorage.setItem(key, "true");
      if (document.documentElement.dataset.coachActive !== "true")
        timer = setTimeout(() => setOpen(true), 0);
    } catch {
      /* Entry must work even when browser storage is unavailable. */
    }
    const hide = () => setOpen(false);
    window.addEventListener("ballers:guide-start", hide);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("ballers:guide-start", hide);
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
