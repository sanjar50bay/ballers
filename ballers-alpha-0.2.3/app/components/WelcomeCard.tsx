"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { Profile, Stats } from "./AppState";
import Avatar from "./Avatar";
export default function WelcomeCard({
  profile,
  stats,
}: {
  profile: Profile;
  stats?: Stats;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false),
    [remaining, setRemaining] = useState(5);
  const name =
    profile.display_name ||
    [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  useEffect(() => {
    if (path !== "/") return;
    let first: ReturnType<typeof setTimeout> | undefined;
    try {
      const key = `ballers:welcome:${profile.id}`,
        today = new Date().toLocaleDateString("en-CA");
      if (
        localStorage.getItem("ballers:welcome:disabled") === "true" ||
        localStorage.getItem(key) === today ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        return;
      localStorage.setItem(key, today);
      first = setTimeout(() => {
        setOpen(true);
        setRemaining(5);
      }, 0);
    } catch {
      /* A blocked store must never block entry. */
    }
    return () => clearTimeout(first);
  }, [profile.id, path]);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(
      () => setRemaining((v) => Math.max(0, v - 1)),
      1000,
    );
    const done = setTimeout(() => setOpen(false), 5000);
    return () => {
      clearInterval(timer);
      clearTimeout(done);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="welcome-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Твой Baller ID"
      onClick={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
        if (e.key === "Tab") {
          e.preventDefault();
          e.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
        }
      }}
    >
      <section className="welcome-card">
        <p className="text-sm tracking-[.2em] text-[#79ffb0]">
          BALLERS · PLAYER CARD
        </p>
        <Avatar src={profile.avatar_url} name={name} large />
        <h2>{name}</h2>
        <p className="ballers-muted mt-2">
          Baller #{profile.baller_id} · {profile.city || "Твой футбол"} ·{" "}
          {profile.primary_position}
        </p>
        <div className="stats-grid">
          {[
            ["В заявках", stats?.matches],
            ["Голы", stats?.goals],
            ["Ассисты", stats?.assists],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <b>{value ?? "—"}</b>
              <p>{label}</p>
            </div>
          ))}
        </div>
        <p className="ballers-muted mb-5">
          Подтверждённые показатели · без тестов
        </p>
        <button
          autoFocus
          className="neon-button green w-full"
          onClick={() => setOpen(false)}
        >
          На главную · {remaining} с
        </button>
        <p className="ballers-muted mt-3">
          Нажми в любом месте, чтобы пропустить
        </p>
      </section>
    </div>
  );
}
