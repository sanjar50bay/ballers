"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { Profile, Stats } from "./AppState";
import { PlayerCard } from "./PlayerCard";
export { PlayerCard } from "./PlayerCard";
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
