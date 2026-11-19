"use client";
import { t } from "@/lib/i18n";

export default function GameDayClosure({
  manager,
  active,
  open,
  busy,
  close,
}: {
  manager: boolean;
  active: boolean;
  open: boolean;
  busy: boolean;
  close: () => void;
}) {
  return (
    <section
      className="game-day-closure"
      data-closed={!open}
      aria-label={t("Завершение игрового дня")}
    >
      <h2>{t(open ? "Игровой день" : "Игровой день закрыт")}</h2>
      {open && (
        <>
          <p id="close-day-reason">
            {t(
              !manager
                ? "Игровой день завершает организатор."
                : active
                  ? "Сначала завершите текущий матч. Затем можно закрыть игровой день."
                  : "Все матчи на сегодня сыграны? Заверши игровой день, чтобы он перешёл в историю.",
            )}
          </p>
          {manager && (
            <button
              type="button"
              className="network-secondary game-day-close-button"
              aria-describedby="close-day-reason"
              disabled={busy || active}
              onClick={() => {
                if (confirm(t("Завершить игровой день?"))) close();
              }}
            >
              {t("Завершить игровой день")}
            </button>
          )}
        </>
      )}
    </section>
  );
}
