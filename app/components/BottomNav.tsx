"use client";
import { t as tx } from "@/lib/i18n";

import { useLocale } from "@/app/components/Language";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "./AppState";
import Icon from "./Icon";
export default function BottomNav() {
  useLocale();

  const path = usePathname();
  const { data } = useApp();
  const game =
    data?.games.find((g) => g.attendance_status === "GOING") || data?.games[0];
  const tone = game?.live
    ? "live"
    : game?.attendance_status === "GOING"
      ? "going"
      : game
        ? "invited"
        : "none";
  return (
    <nav aria-label={tx("Основная навигация")} className="ballers-nav">
      <div>
        {[
          { href: "/", label: tx("Главная"), icon: "home" },
          { href: "/my-game", label: tx("Игра"), icon: "ball" },
          { href: "/discover", label: tx("Найти"), icon: "search" },
          { href: "/profile", label: tx("Профиль"), icon: "profile" },
        ].map((x) => {
          const active =
            x.href === "/"
              ? path === "/"
              : path.startsWith(x.href) ||
                (x.href === "/profile" && path === "/career") ||
                (x.href === "/discover" &&
                  (path.startsWith("/teams") ||
                    path.startsWith("/communities") ||
                    path === "/open-games" ||
                    path.startsWith("/players")));
          return (
            <Link
              key={x.href}
              href={x.href}
              aria-current={active ? "page" : undefined}
              className={active ? "active" : ""}
            >
              <span className={x.icon === "ball" ? `nav-ball ${tone}` : ""}>
                <Icon name={x.icon} />
              </span>
              <span>
                {x.icon === "ball" && game?.live ? tx("Игра · LIVE") : x.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
