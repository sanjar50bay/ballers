"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useApp } from "./AppState";
import { useLocale } from "./Language";
import { t } from "@/lib/i18n";

type Progress = {
  state: "running" | "paused" | "done" | "skipped";
  step: number;
};
type GuideContext = {
  open: () => void;
  start: () => void;
  dismiss: () => void;
  offer: boolean;
};
const Context = createContext<GuideContext>({
  open: () => {},
  start: () => {},
  dismiss: () => {},
  offer: false,
});
const steps = [
  {
    href: "/",
    selector: '[data-coach="profile"]',
    title: "Твой профиль",
    body: "Здесь твой Baller ID. В профиле можно указать город, позицию и готовность к приглашениям. Постоянная команда для первой игры не нужна.",
  },
  {
    href: "/discover?kind=communities",
    selector: '[data-coach="directory"]',
    title: "Найди своих",
    body: "Это общий поиск, а не только твои записи. Переключай игроков, команды и сообщества. Выбери «Все города», чтобы не ограничивать результаты.",
  },
  {
    href: "/open-games",
    selector: '[data-coach="join-game"], [data-coach="game-city"]',
    title: "Запишись на игру",
    body: "Выбери город и подходящую игру. В режиме подтверждения заявка сначала поступит организатору. Если игр нет, попробуй другой город. Обучение ничего не отправляет за тебя.",
  },
  {
    href: "/",
    selector: '[data-coach="notifications"]',
    title: "Проверь ответ",
    body: "Приглашения, решения по заявкам и предложения места из резерва появляются в колокольчике. Твои сообщества — на главной, остальные — в разделе «Найти».",
  },
] as const;
const clampStep = (n: number) =>
  Math.max(0, Math.min(steps.length - 1, Number.isInteger(n) ? n : 0));
export function HelpButton() {
  useLocale();
  const guide = useContext(Context);
  return (
    <button
      className="icon-button help-trigger"
      type="button"
      data-help-trigger
      aria-label={t("Помощь")}
      title={t("Помощь")}
      onClick={guide.open}
    >
      ?
    </button>
  );
}
export function GuideInvite() {
  useLocale();
  const guide = useContext(Context);
  if (!guide.offer) return null;
  return (
    <section className="guide-invite" aria-label={t("Первые шаги")}>
      <div>
        <b>{t("Впервые в BALLERS?")}</b>
        <p className="ballers-muted">
          {t("Покажем за 4 шага, как найти своих и записаться на игру.")}
        </p>
      </div>
      <div className="guide-actions">
        <button className="network-secondary" onClick={guide.start}>
          {t("Показать шаги")}
        </button>
        <button className="text-link" onClick={guide.dismiss}>
          {t("Не сейчас")}
        </button>
      </div>
    </section>
  );
}
export default function CoachProvider({ children }: { children: ReactNode }) {
  useLocale();
  const { session, data } = useApp();
  const router = useRouter();
  const user = session?.user.id;
  const key = user ? `ballers:guide:v1:${user}` : null;
  const [stored, setStored] = useState<{
    key: string | null;
    progress: Progress | null;
    loaded: boolean;
  }>({ key: null, progress: null, loaded: false });
  const [help, setHelp] = useState(false),
    [active, setActive] = useState<number | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const tm = setTimeout(() => {
      let progress: Progress | null = null;
      try {
        const raw = key ? localStorage.getItem(key) : null;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (["running", "paused", "done", "skipped"].includes(parsed.state))
            progress = { state: parsed.state, step: clampStep(parsed.step) };
        }
      } catch {}
      setStored({ key, progress, loaded: true });
      setActive(null);
      setHelp(false);
    }, 0);
    return () => clearTimeout(tm);
  }, [key]);
  const save = useCallback(
    (progress: Progress) => {
      if (!key) return;
      try {
        localStorage.setItem(key, JSON.stringify(progress));
      } catch {}
      setStored({ key, progress, loaded: true });
    },
    [key],
  );
  const finish = useCallback(
    (state: Progress["state"], step: number) => {
      save({ state, step: clampStep(step) });
      setActive(null);
      document.documentElement.removeAttribute("data-coach-active");
      setTimeout(() => {
        if (origin.current?.isConnected)
          origin.current.focus({ preventScroll: true });
        else
          document
            .querySelector<HTMLElement>("[data-help-trigger]")
            ?.focus({ preventScroll: true });
      }, 0);
    },
    [save],
  );
  const go = useCallback(
    (index: number) => {
      const i = clampStep(index);
      save({ state: "running", step: i });
      setActive(i);
      router.push(steps[i].href);
    },
    [router, save],
  );
  const start = useCallback(
    (index = 0) => {
      if (!data?.profile || !session) return;
      origin.current = document.activeElement as HTMLElement | null;
      setHelp(false);
      document.documentElement.dataset.coachActive = "true";
      window.dispatchEvent(new Event("ballers:guide-start"));
      go(index);
    },
    [data?.profile, session, go],
  );
  useEffect(() => {
    if (active === null) return;
    document.documentElement.dataset.coachActive = "true";
    return () => {
      document.documentElement.removeAttribute("data-coach-active");
    };
  }, [active]);
  const progress = stored.key === key ? stored.progress : null;
  return (
    <Context.Provider
      value={{
        open: () => {
          origin.current = document.activeElement as HTMLElement | null;
          setHelp(true);
        },
        start: () => start(),
        dismiss: () => save({ state: "skipped", step: 0 }),
        offer:
          !!data?.profile &&
          !!key &&
          stored.loaded &&
          stored.key === key &&
          !progress &&
          active === null,
      }}
    >
      {children}
      {help && (
        <HelpDialog
          onClose={() => setHelp(false)}
          canStart={!!data?.profile}
          resume={progress?.state === "paused" || progress?.state === "running"}
          onStart={() => start()}
          onResume={() => start(progress?.step ?? 0)}
        />
      )}
      {active !== null && data?.profile && (
        <GuideStep
          key={`${key}:${active}`}
          index={active}
          onMove={go}
          onFinish={finish}
        />
      )}
    </Context.Provider>
  );
}
function HelpDialog({
  onClose,
  onStart,
  onResume,
  canStart,
  resume,
}: {
  onClose: () => void;
  onStart: () => void;
  onResume: () => void;
  canStart: boolean;
  resume: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const timer = setTimeout(
      () => ref.current?.querySelector<HTMLButtonElement>("button")?.focus(),
      0,
    );
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = old;
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="notification-dialog help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Tab") {
            const els = Array.from(
              ref.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled),a[href]",
              ) || [],
            );
            if (e.shiftKey && document.activeElement === els[0]) {
              e.preventDefault();
              els.at(-1)?.focus();
            } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
              e.preventDefault();
              els[0]?.focus();
            }
          }
        }}
      >
        <div className="section-heading">
          <h2 id="help-title">{t("Помощь")}</h2>
          <button
            className="icon-button"
            aria-label={t("Закрыть помощь")}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="ballers-muted">
          {t(
            "Найди свою компанию или начни с открытой игры — команда не обязательна.",
          )}
        </p>
        {canStart ? (
          <>
            <button className="neon-button w-full mt-5" onClick={onStart}>
              {t("Пройти обучение")}
            </button>
            {resume && (
              <button
                className="network-secondary w-full mt-3"
                onClick={onResume}
              >
                {t("Продолжить обучение")}
              </button>
            )}
          </>
        ) : (
          <Link className="neon-button mt-5" href="/" onClick={onClose}>
            {t("Войти через Google")}
          </Link>
        )}
        <div className="help-links">
          <Link href="/discover?kind=communities" onClick={onClose}>
            <b>{t("Все сообщества")}</b>
            <span>
              {t("Общий каталог, включая сообщества других организаторов.")}
            </span>
          </Link>
          <Link href="/communities" onClick={onClose}>
            <b>{t("Мои сообщества")}</b>
            <span>{t("Только те, в которых ты уже участвуешь.")}</span>
          </Link>
          <Link href="/discover?kind=teams" onClick={onClose}>
            <b>{t("Найти команду →")}</b>
            <span>
              {t("Постоянные составы. Вступление подтверждает ответственный.")}
            </span>
          </Link>
          <Link href="/open-games" onClick={onClose}>
            <b>{t("Найти игру →")}</b>
            <span>
              {t("Игровые дни с открытым набором и заявкой на участие.")}
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
type Box = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  vw: number;
  vh: number;
};
function GuideStep({
  index,
  onMove,
  onFinish,
}: {
  index: number;
  onMove: (n: number) => void;
  onFinish: (s: Progress["state"], n: number) => void;
}) {
  const path = usePathname();
  const step = steps[index];
  const panel = useRef<HTMLDivElement>(null),
    target = useRef<HTMLElement | null>(null);
  const [box, setBox] = useState<Box | null>(null),
    [unavailable, setUnavailable] = useState(false),
    [panelSize, setPanelSize] = useState({ w: 320, h: 280 });
  const expected = step.href.split("?")[0];
  const arrived = useRef(false);
  useEffect(() => {
    if (path !== expected && arrived.current) {
      const tm = setTimeout(() => onFinish("paused", index), 0);
      return () => clearTimeout(tm);
    }
  }, [path, expected, index, onFinish]);
  useEffect(() => {
    if (path !== expected) return;
    let found = false,
      frame = 0;
    const update = () => {
      const el = target.current;
      if (!el?.isConnected) return;
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth,
        vh = window.visualViewport?.height || innerHeight;
      const b = {
        top: Math.max(6, Math.min(vh - 6, r.top - 5)),
        left: Math.max(6, Math.min(vw - 6, r.left - 5)),
        right: Math.max(6, Math.min(vw - 6, r.right + 5)),
        bottom: Math.max(6, Math.min(vh - 6, r.bottom + 5)),
        width: r.width,
        height: r.height,
        vw,
        vh,
      };
      setBox((old) =>
        old &&
        Object.keys(b).every((k) => old[k as keyof Box] === b[k as keyof Box])
          ? old
          : b,
      );
    };
    const request = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const locate = () => {
      const candidates = Array.from(
        step.selector
          .split(",")
          .flatMap((selector) =>
            Array.from(document.querySelectorAll<HTMLElement>(selector)),
          ),
      );
      const el = candidates.find((e) => e.getClientRects().length > 0);
      if (!el || el === target.current) return;
      if (target.current) resize.unobserve(target.current);
      found = true;
      arrived.current = true;
      target.current = el;
      el.scrollIntoView({ block: "center", behavior: "instant" });
      resize.observe(el);
      request();
    };
    const resize = new ResizeObserver(request);
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    locate();
    const timeout = setTimeout(() => {
      if (!found) setUnavailable(true);
    }, 8000);
    window.addEventListener("resize", request);
    window.addEventListener("scroll", request, true);
    window.visualViewport?.addEventListener("resize", request);
    const click = (e: MouseEvent) => {
      if (target.current?.contains(e.target as Node) && index !== 1)
        onFinish(index === steps.length - 1 ? "done" : "paused", index + 1);
    };
    document.addEventListener("click", click, true);
    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", request);
      window.removeEventListener("scroll", request, true);
      window.visualViewport?.removeEventListener("resize", request);
      document.removeEventListener("click", click, true);
    };
  }, [path, expected, index, step.selector, onFinish]);
  useEffect(() => {
    const tm = setTimeout(
      () =>
        panel.current
          ?.querySelector<HTMLElement>("[data-next]")
          ?.focus({ preventScroll: true }),
      50,
    );
    const resize = new ResizeObserver(() => {
      const r = panel.current?.getBoundingClientRect();
      if (r)
        setPanelSize((old) =>
          old.w === r.width && old.h === r.height
            ? old
            : { w: r.width, h: r.height },
        );
    });
    if (panel.current) resize.observe(panel.current);
    return () => {
      clearTimeout(tm);
      resize.disconnect();
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onFinish("skipped", index);
        return;
      }
      if (e.key !== "Tab") return;
      const focusable =
        'button:not(:disabled),a[href],select,input:not(:disabled),[tabindex="0"]';
      const els = [
        ...(target.current?.matches(focusable)
          ? [target.current]
          : Array.from(
              target.current?.querySelectorAll<HTMLElement>(focusable) || [],
            )),
        ...Array.from(
          panel.current?.querySelectorAll<HTMLElement>(focusable) || [],
        ),
      ].filter((el) => el.getClientRects().length);
      if (!els.length) return;
      e.preventDefault();
      const n = els.indexOf(document.activeElement as HTMLElement);
      els[(n + (e.shiftKey ? -1 : 1) + els.length) % els.length]?.focus({
        preventScroll: true,
      });
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [index, onFinish]);
  const vw = box?.vw ?? (typeof window !== "undefined" ? innerWidth : 390),
    vh = box?.vh ?? (typeof window !== "undefined" ? innerHeight : 844);
  const left = box
    ? Math.max(12, Math.min(box.left, vw - panelSize.w - 12))
    : 12;
  const desired = box
    ? box.bottom + panelSize.h + 22 < vh
      ? box.bottom + 12
      : box.top - panelSize.h - 12
    : Math.max(12, (vh - panelSize.h) / 2);
  const top = Math.max(12, Math.min(desired, vh - panelSize.h - 12));
  return (
    <div className="coach-layer">
      {box ? (
        <>
          <div
            className="coach-shade"
            style={{ top: 0, left: 0, width: "100%", height: box.top }}
          />
          <div
            className="coach-shade"
            style={{ top: box.bottom, left: 0, width: "100%", bottom: 0 }}
          />
          <div
            className="coach-shade"
            style={{
              top: box.top,
              left: 0,
              width: box.left,
              height: Math.max(0, box.bottom - box.top),
            }}
          />
          <div
            className="coach-shade"
            style={{
              top: box.top,
              left: box.right,
              right: 0,
              height: Math.max(0, box.bottom - box.top),
            }}
          />
          <div
            className="coach-highlight"
            aria-hidden="true"
            style={{
              top: box.top,
              left: box.left,
              width: Math.max(0, box.right - box.left),
              height: Math.max(0, box.bottom - box.top),
            }}
          />
        </>
      ) : (
        <div className="coach-shade" style={{ inset: 0 }} />
      )}
      <div
        ref={panel}
        className="coach-tip"
        role="dialog"
        aria-modal="false"
        aria-labelledby="coach-title"
        aria-describedby="coach-body"
        style={{ top, left }}
      >
        <p className="eyebrow" aria-live="polite">
          {t("Шаг {step} из {total}", { step: index + 1, total: steps.length })}
        </p>
        <h2 id="coach-title">{t(step.title)}</h2>
        <p id="coach-body">{t(step.body)}</p>
        {!box && (
          <p className="ballers-muted" role="status">
            {t(
              unavailable
                ? "Элемент пока недоступен. Можно перейти дальше или закрыть обучение."
                : "Открываем шаг…",
            )}
          </p>
        )}
        <div className="guide-actions">
          {index > 0 && (
            <button
              className="network-secondary"
              onClick={() => onMove(index - 1)}
            >
              {t("Назад")}
            </button>
          )}
          <button
            data-next
            className="neon-button"
            onClick={() =>
              index === steps.length - 1
                ? onFinish("done", index)
                : onMove(index + 1)
            }
          >
            {t(index === steps.length - 1 ? "Готово" : "Далее")}
          </button>
          <button
            className="text-link"
            onClick={() => onFinish("skipped", index)}
          >
            {t("Пропустить")}
          </button>
        </div>
      </div>
    </div>
  );
}
