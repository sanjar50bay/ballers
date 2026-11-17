"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigationFor } from "@/lib/navigation";
import { t } from "@/lib/i18n";
import { useLocale } from "./Language";
import { useApp } from "./AppState";
import BottomNav from "./BottomNav";
import AppHeader from "./AppHeader";

export default function NavigationFrame({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = useLocale();
  const path = usePathname();
  const { session } = useApp();
  const location = navigationFor(path);
  const visible =
    !!session && path !== "/onboarding" && !path.startsWith("/join/");
  useEffect(() => {
    document.title = visible
      ? `${t(location.page)} · BALLERS`
      : "BALLERS — твой футбол";
  }, [visible, location.page, locale]);
  return (
    <div
      className={visible ? "app-navigation-frame" : undefined}
      data-section={location.section}
    >
      {visible && (
        <div className="navigation-header">
          <AppHeader />
        </div>
      )}
      {visible && (
        <nav className="section-location" aria-label={t("Текущий раздел")}>
          <div>
            {location.label !== location.page && (
              <span className="section-label">{t(location.label)}</span>
            )}
            <strong aria-current="page">{t(location.page)}</strong>
          </div>
          {location.parent && (
            <Link href={location.parent.href}>
              ← {t(location.parent.label)}
            </Link>
          )}
        </nav>
      )}
      {children}
      {visible && <BottomNav />}
    </div>
  );
}
