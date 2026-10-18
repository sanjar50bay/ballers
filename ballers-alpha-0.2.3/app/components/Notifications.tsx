"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { setAttendance } from "@/lib/pre-match";
import { useApp } from "./AppState";
import Icon from "./Icon";
type Notice = {
  id: string;
  player_id: string;
  game_day_id: string;
  match_id: string | null;
  kind: string;
  message: string;
  read_at: string | null;
  completed_at: string | null;
  created_at: string;
};
type Feed = { unread: number; active: Notice[]; history: Notice[] };
const BellContext = createContext({ count: 0, show: () => {} });
export function BellButton() {
  const { count, show } = useContext(BellContext);
  return (
    <button
      className="icon-button"
      aria-label={`Уведомления${count ? `, непрочитанных ${count}` : ""}`}
      onClick={show}
    >
      <Icon name="bell" />
      {count > 0 && (
        <span className="bell-count">{count > 99 ? "99+" : count}</span>
      )}
    </button>
  );
}
export default function Notifications({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session } = useApp(),
    path = usePathname();
  const [feed, setFeed] = useState<Feed>({
      unread: 0,
      active: [],
      history: [],
    }),
    [open, setOpen] = useState(false),
    [tab, setTab] = useState("active"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null),
    previousFocus = useRef<HTMLElement | null>(null),
    generation = useRef(0);
  const load = useCallback(async () => {
    const g = generation.current;
    if (!session) return;
    try {
      const { data, error } = await supabase
        .rpc("ballers_notification_feed")
        .abortSignal(AbortSignal.timeout(12000));
      if (g !== generation.current) return;
      if (error) throw error;
      setFeed(data as Feed);
      setError("");
    } catch {
      if (g === generation.current)
        setError(
          "Не удалось обновить уведомления. Проверь соединение и миграцию 004.",
        );
    }
  }, [session]);
  useEffect(() => {
    generation.current++;
    const first = setTimeout(() => {
      if (!session) {
        setFeed({ unread: 0, active: [], history: [] });
        setOpen(false);
      } else void load();
    }, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10000);
    const invalidate = () => {
      generation.current++;
    };
    return () => {
      invalidate();
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, session]);
  const show = useCallback(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    setOpen(true);
    void load();
  }, [load]);
  const close = () => {
    setOpen(false);
    previousFocus.current?.focus();
  };
  useEffect(() => {
    window.addEventListener("ballers:open-notifications", show);
    return () => window.removeEventListener("ballers:open-notifications", show);
  }, [show]);
  useEffect(() => {
    if (!open) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = setTimeout(
      () => dialog.current?.querySelector<HTMLButtonElement>("button")?.focus(),
      0,
    );
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = before;
    };
  }, [open]);
  async function mark(n: Notice) {
    const { error } = await supabase.rpc("ballers_mark_read", { p_id: n.id });
    if (error) {
      setError("Не удалось сохранить прочтение. Попробуй снова.");
      return false;
    }
    await load();
    return true;
  }
  async function answer(n: Notice, status: "GOING" | "MAYBE" | "DECLINED") {
    setBusy(true);
    try {
      const { error } = await setAttendance(n.game_day_id, n.player_id, status);
      if (error) throw error;
      await mark(n);
      window.dispatchEvent(new Event("ballers:data-changed"));
    } catch {
      setError("Ответ не сохранён. Проверь соединение и попробуй снова.");
    } finally {
      setBusy(false);
    }
  }
  const items = tab === "active" ? feed.active : feed.history;
  return (
    <BellContext.Provider value={{ count: feed.unread, show }}>
      {children}
      {session &&
        !["/", "/my-game", "/profile", "/communities", "/create"].includes(
          path,
        ) && (
          <div className="fixed top-3 right-4 z-50 bg-[#080c16] rounded-xl">
            <BellButton />
          </div>
        )}
      {open && session && (
        <div
          className="dialog-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            ref={dialog}
            className="notification-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Уведомления"
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "Tab") {
                const els = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>(
                    "button:not([disabled]),a[href]",
                  ),
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
              <h2>Уведомления</h2>
              <button
                className="icon-button"
                aria-label="Закрыть уведомления"
                onClick={close}
              >
                ×
              </button>
            </header>
            <div className="tab-bar mx-4 mt-0">
              <button
                className={tab === "active" ? "selected" : ""}
                onClick={() => setTab("active")}
              >
                Актуальное · {feed.active.length}
              </button>
              <button
                className={tab === "history" ? "selected" : ""}
                onClick={() => setTab("history")}
              >
                История
              </button>
            </div>
            {error && (
              <div className="error-panel mx-4" role="alert">
                {error}
                <button className="text-link" onClick={() => void load()}>
                  Повторить
                </button>
              </div>
            )}
            {!items.length && (
              <p className="ballers-muted p-5">
                {tab === "active"
                  ? "Всё прочитано. Нет незавершённых запросов."
                  : "В истории пока ничего нет."}
              </p>
            )}
            {items.map((n) => (
              <article key={n.id} className="notification-item">
                <p className="font-bold">{n.message}</p>
                <p className="ballers-muted mt-1">
                  {new Date(n.created_at).toLocaleString("ru-RU", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {n.completed_at
                    ? " · Выполнено"
                    : n.read_at
                      ? " · Прочитано"
                      : ""}
                </p>
                {tab === "active" &&
                  ["INVITE", "PLACE_OFFER"].includes(n.kind) && (
                    <div className="attendance-options">
                      {(
                        [
                          ["GOING", "Иду"],
                          ["MAYBE", "Возможно"],
                          ["DECLINED", "Не иду"],
                        ] as const
                      ).map(([s, l]) => (
                        <button
                          key={s}
                          disabled={busy}
                          onClick={() => void answer(n, s)}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  )}
                <div className="flex gap-4 flex-wrap items-center mt-2">
                  <Link
                    className="text-link"
                    href={
                      n.kind === "CONFIRM"
                        ? `/games/${n.game_day_id}/play#match-${n.match_id || "results"}`
                        : `/my-game?game=${n.game_day_id}`
                    }
                    onClick={() => {
                      close();
                      void mark(n);
                    }}
                  >
                    Открыть {n.kind === "CONFIRM" ? "результат" : "игру"} →
                  </Link>
                  {!n.read_at && (
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={() => void mark(n)}
                    >
                      Прочитано
                    </button>
                  )}
                </div>
                {tab === "active" &&
                  n.read_at &&
                  ["CONFIRM", "INVITE", "PLACE_OFFER"].includes(n.kind) && (
                    <p className="ballers-muted">
                      Ожидает твоего ответа, даже если уже прочитано.
                    </p>
                  )}
              </article>
            ))}
          </div>
        </div>
      )}
    </BellContext.Provider>
  );
}
