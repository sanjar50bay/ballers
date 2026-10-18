"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "./AppState";
import Icon from "./Icon";
export default function BottomNav() {
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
    <nav aria-label="Основная навигация" className="ballers-nav">
      <div>
        {[
          { href: "/", label: "Главная", icon: "home" },
          { href: "/my-game", label: "Игра", icon: "ball" },
          { href: "/communities", label: "Сообщества", icon: "people" },
          { href: "/profile", label: "Профиль", icon: "profile" },
        ].map((x) => {
          const active =
            x.href === "/"
              ? path === "/"
              : path.startsWith(x.href) ||
                (x.href === "/profile" && path === "/career");
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
                {x.icon === "ball" && game?.live ? "Игра · LIVE" : x.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
