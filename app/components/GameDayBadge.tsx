"use client";
import { useSyncExternalStore } from "react";
import { t } from "@/lib/i18n";
import { localDate } from "@/lib/community-schedule";

function subscribe(onChange: () => void) {
  const tick = window.setInterval(onChange, 60000);
  window.addEventListener("focus", onChange);
  return () => {
    window.clearInterval(tick);
    window.removeEventListener("focus", onChange);
  };
}
const snapshot = () => localDate();
const serverSnapshot = () => "";

export default function GameDayBadge({
  day,
  next = false,
}: {
  day: { status: string; game_date: string; live: boolean };
  next?: boolean;
}) {
  const today = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const label = day.live
    ? "Матч идёт"
    : day.status !== "OPEN"
      ? "День завершён"
      : day.game_date === today
        ? "Сегодня"
        : today && day.game_date < today
          ? "Прошедший игровой день"
          : next
            ? "Ближайшая игра"
            : "Запланирована";
  return (
    <p
      className="game-day-badge"
      data-today={day.game_date === today}
      data-live={day.live}
    >
      {t(label)}
    </p>
  );
}
