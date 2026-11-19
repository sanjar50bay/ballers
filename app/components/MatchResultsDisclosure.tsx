"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { t } from "@/lib/i18n";

export default function MatchResultsDisclosure({
  active,
  count,
  waiting,
  attention,
  children,
}: {
  active: boolean;
  count: number;
  waiting: number;
  attention: number;
  children: ReactNode;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!active) return;
    const reveal = () => {
      const root = disclosure.current;
      const hash = location.hash;
      if (!root || (hash !== "#results" && !hash.startsWith("#match-"))) return;
      const target = document.getElementById(hash.slice(1));
      if (!target) return;
      if (target === root || root.contains(target)) root.open = true;
      target.scrollIntoView({ block: "start" });
    };
    const timer = window.setTimeout(reveal, 0);
    window.addEventListener("hashchange", reveal);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", reveal);
    };
  }, [active]);
  return (
    <details
      id="results"
      ref={disclosure}
      className="match-results-disclosure"
      data-attention={attention > 0}
    >
      <summary aria-label={t("Результаты и исправления")}>
        <span className="match-results-title">
          {t("Результаты и исправления")}
        </span>
        <span>{t("Матчей: {count}", { count })}</span>
        {waiting > 0 && (
          <span>{t("Ждут решения: {count}", { count: waiting })}</span>
        )}
        {attention > 0 && (
          <strong role="status">
            {t("Требуют твоего действия: {count}", { count: attention })}
          </strong>
        )}
      </summary>
      <div className="match-results-content">{children}</div>
    </details>
  );
}
