"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { useLocale } from "./Language";
import Icon from "./Icon";
export default function CreateMenu() {
  useLocale();
  const [open, setOpen] = useState(false);
  const modal = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    window.addEventListener("keydown", escape);
    const tm = setTimeout(
      () => modal.current?.querySelector<HTMLElement>("button,a")?.focus(),
      0,
    );
    return () => {
      clearTimeout(tm);
      window.removeEventListener("keydown", escape);
      document.body.style.overflow = old;
    };
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <>
      <button
        ref={trigger}
        className="icon-button"
        onClick={() => setOpen(true)}
        aria-label={t("Создать")}
        aria-expanded={open}
      >
        <Icon name="plus" />
      </button>
      {open && (
        <div
          className="dialog-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            ref={modal}
            className="notification-dialog create-menu"
            role="dialog"
            aria-modal="true"
            aria-label={t("Создать")}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "Tab") {
                const els = Array.from(
                  modal.current?.querySelectorAll<HTMLElement>(
                    "a,button:not([disabled])",
                  ) || [],
                );
                if (e.shiftKey && document.activeElement === els[0]) {
                  e.preventDefault();
                  els.at(-1)?.focus();
                } else if (
                  !e.shiftKey &&
                  document.activeElement === els.at(-1)
                ) {
                  e.preventDefault();
                  els[0]?.focus();
                }
              }
            }}
          >
            <header>
              <h2>{t("Создать")}</h2>
              <button
                className="icon-button"
                onClick={close}
                aria-label={t("Закрыть")}
              >
                ×
              </button>
            </header>
            <div className="p-4 space-y-3">
              {[
                ["/create", "Игровой день"],
                ["/teams/create", "Команду"],
                ["/communities/create", "Сообщество"],
              ].map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  className="network-card block"
                  onClick={close}
                >
                  {t(label)} →
                </Link>
              ))}
              {["Организовать турнир", "У меня есть арена"].map((label) => (
                <div
                  className="network-card flex justify-between gap-3"
                  key={label}
                  aria-disabled="true"
                >
                  <span>{t(label)}</span>
                  <span className="ballers-muted">{t("Скоро")}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
